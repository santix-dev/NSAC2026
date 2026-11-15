#!/usr/bin/env python3
"""
PyroSync — Exporta una COPIA de los datos reales para la web (respaldo sin base de datos).

La web consulta Supabase; si la base no responde, lee estos archivos estáticos (mismos datos
reales que se cargaron en Supabase), en lugar de generar datos de prueba.

Entradas:  etl/harmonized_output.csv, etl/aux_data/region_month_env.csv, etl/aux_data/env_grid_clim.csv
Salidas:   web/public/data/{hotspots.csv, raw_detections.csv, region_month_env.csv, env_grid_clim.csv, meta.json}

Uso (después de harmonize.py y build_aux.py):
    python etl/export_web_snapshot.py
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ETL = Path(__file__).resolve().parent
OUT = ETL.parent / "web" / "public" / "data"

HOTSPOT_COLS = [
    "grid_cell_id", "region", "acq_date", "lat", "lon", "harmonized_weight", "raw_detections_count",
    "sensor_source", "max_frp", "thermal_type", "slope_deg", "soil_moisture_pct", "cloud_cover_pct",
    "wind_speed_kmh", "wind_direction_deg", "ndvi_pre_fire", "wind_max_kmh", "env_source",
]


def main() -> int:
    src = ETL / "harmonized_output.csv"
    if not src.exists():
        sys.exit("✗ Falta etl/harmonized_output.csv (correr harmonize.py)")
    OUT.mkdir(parents=True, exist_ok=True)

    h = pd.read_csv(src)
    missing = [c for c in HOTSPOT_COLS if c not in h.columns]
    if missing:
        sys.exit(f"✗ harmonized_output.csv no tiene {missing}; re-correr build_aux.py y harmonize.py")
    h = h[HOTSPOT_COLS].sort_values(["acq_date", "grid_cell_id"])
    h.to_csv(OUT / "hotspots.csv", index=False, float_format="%.6g")

    files = {"hotspots.csv": len(h)}
    raw_src = ETL / "raw_detections.csv"
    if raw_src.exists():
        r = pd.read_csv(raw_src, dtype={"acq_time": str, "confidence": str})
        cols = ["acq_date", "acq_time", "lat", "lon", "sensor", "platform", "confidence", "frp", "thermal_type", "in_calendar"]
        r[cols].to_csv(OUT / "raw_detections.csv", index=False, float_format="%.6g")
        files["raw_detections.csv"] = len(r)
    else:
        print("  ⚠ falta etl/raw_detections.csv (harmonize.py); en modo respaldo no se verán las detecciones originales")
    for name in ("region_month_env.csv", "env_grid_clim.csv"):
        p = ETL / "aux_data" / name
        if p.exists():
            d = pd.read_csv(p)
            d.to_csv(OUT / name, index=False, float_format="%.6g")
            files[name] = len(d)
        else:
            print(f"  ⚠ falta aux_data/{name}; la web no tendrá esa capa en modo respaldo")

    viirs_only = h.loc[h["sensor_source"] == "VIIRS"].sort_values("acq_date")["harmonized_weight"]
    calib_path = ETL / "calibration.json"
    calib = json.loads(calib_path.read_text(encoding="utf-8")) if calib_path.exists() else {}
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "alpha": float(viirs_only.iloc[0]) if len(viirs_only) else None,
        "date_range": [h["acq_date"].min(), h["acq_date"].max()],
        "rows": files,
        "calibration": calib,
        "source": "NASA FIRMS MODIS C6.1 + VIIRS S-NPP C2 → NOAA-20 (desde 02-11-2026) armonizado (etl/harmonize.py)",
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    for f, n in files.items():
        print(f"✔ web/public/data/{f}: {n:,} filas ({(OUT / f).stat().st_size / 1e6:.1f} MB)")
    print(f"✔ meta.json · α = {meta['alpha']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
