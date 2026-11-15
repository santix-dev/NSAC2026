#!/usr/bin/env python3
"""
PyroSync — Carga de etl/harmonized_output.csv a Supabase (tabla harmonized_hotspots).

Requisitos previos:
  1. Ejecutar en el SQL Editor de Supabase el script de SUPABASE_SCHEMA.md
     (tabla, índices, trigger de geom y RPCs) y luego
     etl/sql/002_patagonia_env_extension.sql (región + variables ambientales)
     y etl/sql/003_security_postgis_extensions_schema.sql (seguridad).
  2. Copiar etl/.env.example a etl/.env y completar SUPABASE_URL y
     SUPABASE_SERVICE_ROLE_KEY (la service role key saltea RLS para insertar).

Uso:
    python etl/upload_supabase.py
    python etl/upload_supabase.py --batch-size 1000 --start-batch 37   # reanudar
    python etl/upload_supabase.py --dry-run                            # validar sin subir
    python etl/upload_supabase.py --replace                            # vaciar la tabla y recargar

Nota: la carga es append-only. Para recargar desde cero, ejecutá antes en el
SQL Editor:  TRUNCATE harmonized_hotspots RESTART IDENTITY;
"""
from __future__ import annotations

import argparse
import math
import os
import random
import sys
import time
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from tqdm import tqdm

ETL_DIR = Path(__file__).resolve().parent
DEFAULT_CSV = ETL_DIR / "harmonized_output.csv"
ENV_PATH = ETL_DIR / ".env"
TABLE = "harmonized_hotspots"

COLUMNS = [
    "grid_cell_id",
    "acq_date",
    "year",
    "month",
    "lat",
    "lon",
    "harmonized_weight",
    "raw_detections_count",
    "sensor_source",
    "max_frp",
    "thermal_type",
    # Extensión etl/sql/002_patagonia_env_extension.sql
    "region",
    "slope_deg",
    "soil_moisture_pct",
    "cloud_cover_pct",
    "wind_speed_kmh",
    "wind_direction_deg",
    "ndvi_pre_fire",
    "wind_max_kmh",
    "env_source",
]
# Tablas auxiliares reales (etl/env/build_aux.py) — se suben si existen los CSV
AUX_TABLES = {
    "region_month_env": "region_month_env.csv",
    "env_grid_clim": "env_grid_clim.csv",
}
VALID_SENSORS = {"MODIS", "VIIRS", "BOTH"}
VALID_THERMAL = {"VEGETATION", "VOLCANIC_INDUSTRIAL"}
VALID_REGIONS = {"CORDOBA", "PATAGONIA"}


def load_settings() -> tuple[str, str]:
    load_dotenv(ENV_PATH)
    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    missing = [n for n, v in (("SUPABASE_URL", url), ("SUPABASE_SERVICE_ROLE_KEY", key)) if not v]
    if missing:
        sys.exit(f"✗ Faltan variables en {ENV_PATH}: {', '.join(missing)} (ver etl/.env.example)")
    return url, key


def load_records(csv_path: Path) -> list[dict]:
    if not csv_path.exists():
        sys.exit(f"✗ No existe {csv_path}. Ejecutá primero: python etl/harmonize.py")

    df = pd.read_csv(csv_path, dtype={"grid_cell_id": str, "sensor_source": str, "thermal_type": str, "region": str, "env_source": str})
    missing = [c for c in COLUMNS if c not in df.columns]
    if missing:
        sys.exit(f"✗ {csv_path.name} no tiene las columnas {missing}")
    df = df[COLUMNS]

    # Validaciones contra el esquema de SUPABASE_SCHEMA.md
    errors = []
    if df[["grid_cell_id", "acq_date", "lat", "lon", "sensor_source"]].isna().any().any():
        errors.append("hay valores nulos en columnas NOT NULL")
    if not set(df["sensor_source"].unique()) <= VALID_SENSORS:
        errors.append(f"sensor_source inválido: {set(df['sensor_source'].unique()) - VALID_SENSORS}")
    if not set(df["thermal_type"].unique()) <= VALID_THERMAL:
        errors.append(f"thermal_type inválido: {set(df['thermal_type'].unique()) - VALID_THERMAL}")
    if not set(df["region"].unique()) <= VALID_REGIONS:
        errors.append(f"region inválida: {set(df['region'].unique()) - VALID_REGIONS}")
    if errors:
        sys.exit("✗ CSV inválido: " + "; ".join(errors))

    df["year"] = df["year"].astype(int)
    df["month"] = df["month"].astype(int)
    df["raw_detections_count"] = df["raw_detections_count"].astype(int)
    df["acq_date"] = pd.to_datetime(df["acq_date"]).dt.strftime("%Y-%m-%d")

    # NaN -> None (JSON null) para max_frp opcional
    records = df.astype(object).where(df.notna(), None).to_dict(orient="records")
    return records


def insert_with_retry(client, rows: list[dict], max_retries: int, base_delay: float,
                      table: str = TABLE, upsert: bool = False) -> None:
    for attempt in range(1, max_retries + 1):
        try:
            q = client.table(table)
            (q.upsert(rows, returning="minimal") if upsert else q.insert(rows, returning="minimal")).execute()
            return
        except Exception as exc:  # errores de red, 5xx, timeouts de PostgREST
            if attempt == max_retries:
                raise
            delay = base_delay * 2 ** (attempt - 1) + random.uniform(0, base_delay)
            tqdm.write(f"  ⚠ intento {attempt}/{max_retries} falló ({type(exc).__name__}: {exc}); "
                       f"reintento en {delay:.1f}s")
            time.sleep(delay)


def upload_aux_tables(client, aux_dir: Path, args) -> int:
    """Sube (upsert por clave primaria) las tablas auxiliares reales si existen sus CSV."""
    failures = 0
    for table, fname in AUX_TABLES.items():
        path = aux_dir / fname
        if not path.exists():
            print(f"  · {fname} no existe (python etl/env/build_aux.py); se omite '{table}'")
            continue
        df = pd.read_csv(path)
        recs = df.astype(object).where(df.notna(), None).to_dict(orient="records")
        n = math.ceil(len(recs) / args.batch_size)
        print(f"▶ {len(recs):,} filas → '{table}' (upsert)")
        with tqdm(total=len(recs), unit="fila") as bar:
            for b in range(n):
                rows = recs[b * args.batch_size : (b + 1) * args.batch_size]
                try:
                    insert_with_retry(client, rows, args.max_retries, args.retry_delay, table=table, upsert=True)
                except Exception as exc:
                    failures += 1
                    tqdm.write(f"  ✗ {table} lote {b}: {exc}")
                bar.update(len(rows))
    return failures


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Sube harmonized_output.csv a Supabase por lotes")
    p.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    p.add_argument("--batch-size", type=int, default=1000)
    p.add_argument("--start-batch", type=int, default=0, help="Índice de lote desde el cual reanudar")
    p.add_argument("--max-retries", type=int, default=5)
    p.add_argument("--retry-delay", type=float, default=2.0, help="Demora base (s) del backoff exponencial")
    p.add_argument("--dry-run", action="store_true", help="Valida el CSV y los lotes sin conectarse")
    p.add_argument(
        "--replace",
        action="store_true",
        help="Borra TODAS las filas de la tabla antes de subir (pide confirmación; usar --yes para omitirla)",
    )
    p.add_argument("--yes", action="store_true", help="No pedir confirmación con --replace")
    p.add_argument("--aux-dir", type=Path, default=ETL_DIR / "aux_data", help="Carpeta de las tablas auxiliares")
    p.add_argument("--aux-only", action="store_true", help="Subir solo las tablas auxiliares (región-mes y grilla ISF)")
    p.add_argument("--raw-only", action="store_true", help="Subir solo las detecciones originales (raw_detections.csv)")
    return p.parse_args(argv)


RAW_TABLE = "raw_detections"


def upload_raw_detections(client, csv_path: Path, args) -> int:
    """Reemplaza la tabla de detecciones originales (sin armonizar) con etl/raw_detections.csv."""
    if not csv_path.exists():
        print(f"  · {csv_path.name} no existe (python etl/harmonize.py lo genera); se omite '{RAW_TABLE}'")
        return 0
    df = pd.read_csv(csv_path, dtype={"acq_time": str, "confidence": str})
    df["acq_time"] = df["acq_time"].str.zfill(4)
    recs = df.astype(object).where(df.notna(), None).to_dict(orient="records")
    print(f"▶ {len(recs):,} detecciones originales → '{RAW_TABLE}' (reemplazo completo)")
    client.table(RAW_TABLE).delete().gte("id", 0).execute()
    failures = 0
    n = math.ceil(len(recs) / args.batch_size)
    with tqdm(total=len(recs), unit="fila") as bar:
        for b in range(n):
            rows = recs[b * args.batch_size : (b + 1) * args.batch_size]
            try:
                insert_with_retry(client, rows, args.max_retries, args.retry_delay, table=RAW_TABLE)
            except Exception as exc:
                failures += 1
                tqdm.write(f"  ✗ {RAW_TABLE} lote {b}: {exc}")
            bar.update(len(rows))
    return failures


def main(argv=None) -> int:
    args = parse_args(argv)
    records = load_records(args.csv)
    n_batches = math.ceil(len(records) / args.batch_size)
    print(f"▶ {len(records):,} filas → {n_batches} lotes de {args.batch_size} en '{TABLE}'")

    if args.dry_run:
        print("✔ Dry-run: CSV válido. Primera fila:", records[0] if records else None)
        return 0

    url, key = load_settings()
    from supabase import create_client  # import diferido: --dry-run no requiere la librería

    client = create_client(url, key)

    if args.aux_only:
        return 1 if upload_aux_tables(client, args.aux_dir, args) else 0
    if args.raw_only:
        return 1 if upload_raw_detections(client, args.csv.parent / "raw_detections.csv", args) else 0

    if args.replace:
        existing = client.table(TABLE).select("id", count="exact").limit(1).execute().count or 0
        print(f"⚠ --replace: se borrarán {existing:,} filas de '{TABLE}' antes de subir {len(records):,} nuevas.")
        if not args.yes and input("  Escribí BORRAR para confirmar: ").strip() != "BORRAR":
            print("✗ Cancelado; no se modificó nada.")
            return 1
        client.table(TABLE).delete().gte("id", 0).execute()
        left = client.table(TABLE).select("id", count="exact").limit(1).execute().count or 0
        if left:
            sys.exit(f"✗ Quedaron {left} filas sin borrar; revisá permisos y reintentá.")
        print("  ✔ tabla vaciada")

    failed: list[int] = []
    uploaded = 0
    batch_ids = range(args.start_batch, n_batches)
    with tqdm(total=len(records) - args.start_batch * args.batch_size, unit="fila") as bar:
        for b in batch_ids:
            rows = records[b * args.batch_size : (b + 1) * args.batch_size]
            try:
                insert_with_retry(client, rows, args.max_retries, args.retry_delay)
                uploaded += len(rows)
            except Exception as exc:
                failed.append(b)
                tqdm.write(f"  ✗ lote {b} falló definitivamente: {exc}")
            bar.update(len(rows))

    print(f"✔ {uploaded:,} filas insertadas en '{TABLE}'")
    aux_failures = upload_aux_tables(client, args.aux_dir, args)
    raw_failures = upload_raw_detections(client, args.csv.parent / "raw_detections.csv", args)
    if raw_failures:
        print(f"✗ {raw_failures} lote(s) de detecciones originales fallidos; reintentá con: python etl/upload_supabase.py --raw-only")
    if aux_failures:
        print(f"✗ {aux_failures} lote(s) auxiliares fallidos; reintentá con: python etl/upload_supabase.py --aux-only")
    if failed:
        print(f"✗ {len(failed)} lote(s) fallidos: {failed}")
        print(f"  Reanudá desde el primero con: python etl/upload_supabase.py --start-batch {failed[0]}")
        print("  (los lotes posteriores ya subidos se duplicarían; si es el caso, hacé TRUNCATE y recargá)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
