#!/usr/bin/env python3
"""
audit_harmonization.py — Verificación independiente de etl/harmonized_output.csv.

Recalcula desde la salida (sin reutilizar el código de harmonize.py) cada criterio de la
metodología y dice si se cumple. Uso, desde etl/:  python audit_harmonization.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ETL = Path(__file__).resolve().parent
OUT = ETL / "harmonized_output.csv"
CAL = ETL / "calibration.json"

ok_all = True


def check(name: str, ok: bool, detail: str) -> None:
    global ok_all
    ok_all &= bool(ok)
    print(f"  [{'OK ' if ok else 'NO '}] {name}: {detail}")


def main() -> None:
    if not OUT.exists():
        sys.exit("✗ Falta etl/harmonized_output.csv")
    h = pd.read_csv(OUT, parse_dates=["acq_date"])
    cal = json.loads(CAL.read_text(encoding="utf-8")) if CAL.exists() else {}
    alpha = cal.get("alpha")
    alpha_n20 = cal.get("alpha_n20") or alpha
    snpp_end = pd.Timestamp(cal.get("snpp_end") or "2026-11-01")
    w0, w1 = (pd.Timestamp(x) for x in cal.get("calibration_window", ["2012-11-20", "2024-12-31"]))
    print(f"Archivo: {len(h):,} celdas-día · {h.acq_date.min().date()} → {h.acq_date.max().date()}")
    print(f"calibration.json: α = {alpha} · α_N20 = {alpha_n20} · ventana {w0.date()} → {w1.date()}\n")

    print("1) Estructura de la grilla (Etapa 3)")
    dup = h.duplicated(["grid_cell_id", "acq_date"]).sum()
    check("una fila por celda y día", dup == 0, f"{dup} duplicados")
    lat_i = np.floor(h.lat * 100 + 1e-9).astype(int)
    lon_i = np.floor(h.lon * 100 + 1e-9).astype(int)
    rebuilt = lat_i.astype(str) + "_" + lon_i.astype(str)
    match = (rebuilt == h.grid_cell_id).mean()
    check("lat/lon dentro de su celda 0,01°", match > 0.999, f"{match:.2%} coinciden")
    check("sensor_source válido", h.sensor_source.isin(["MODIS", "VIIRS", "BOTH"]).all(), h.sensor_source.value_counts().to_dict())

    print("\n2) Pesos (Etapa 4, variante de la metodología)")
    m_or_b = h.sensor_source.isin(["MODIS", "BOTH"])
    check("peso 1 en toda celda-día con MODIS", np.allclose(h.loc[m_or_b, "harmonized_weight"], 1.0), f"{m_or_b.sum():,} celdas")
    vo = h.sensor_source == "VIIRS"
    exp = np.where(h.loc[vo, "acq_date"] > snpp_end, alpha_n20, alpha)
    check("peso α en celdas-día solo-VIIRS", np.allclose(h.loc[vo, "harmonized_weight"], exp, atol=1e-6), f"{vo.sum():,} celdas")

    print("\n3) Factor α recalculado desde cero (Córdoba, VEGETATION, ventana simultánea)")
    c = h[(h.region == "CORDOBA") & (h.thermal_type == "VEGETATION") & h.acq_date.between(w0, w1)]
    nm = int(c.sensor_source.isin(["MODIS", "BOTH"]).sum())
    nv = int(c.sensor_source.isin(["VIIRS", "BOTH"]).sum())
    a2 = nm / nv
    check("α = Σ MODIS / Σ VIIRS", abs(a2 - alpha) < 1e-6, f"{nm:,} / {nv:,} = {a2:.4f} (archivo: {alpha:.4f})")
    p = h[(h.region == "PATAGONIA") & (h.thermal_type == "VEGETATION") & h.acq_date.between(w0, w1)]
    ap = p.sensor_source.isin(["MODIS", "BOTH"]).sum() / p.sensor_source.isin(["VIIRS", "BOTH"]).sum()
    print(f"  [i ] α que daría Patagonia sola: {ap:.4f} (diferencia con Córdoba {100 * (ap / alpha - 1):+.1f} %) → mide qué tan válida es la transferencia")

    print("\n4) ¿Se eliminó el salto de 2012? (VEGETATION; ideal: serie armonizada ≈ serie solo-MODIS)")
    for reg in ("CORDOBA", "PATAGONIA"):
        r = h[(h.region == reg) & (h.thermal_type == "VEGETATION")]
        modis = r[r.sensor_source.isin(["MODIS", "BOTH"])].groupby(r.acq_date.dt.year).size()
        harm = r.groupby(r.acq_date.dt.year)["harmonized_weight"].sum()
        raw = r.groupby(r.acq_date.dt.year).size()  # celdas-día con cualquier sensor (crudo en celdas)
        win = range(2013, 2025)
        cont = harm.reindex(win, fill_value=0).sum() / modis.reindex(win, fill_value=0).sum()
        crudo = raw.reindex(win, fill_value=0).sum() / modis.reindex(win, fill_value=0).sum()
        removed = (crudo - cont) / (crudo - 1) if crudo > 1 else float("nan")
        check(f"{reg}: continuidad 2013–2024 (armonizada/MODIS)", abs(cont - 1) <= 0.15,
              f"{cont:.2f} (sin armonizar sería {crudo:.2f}; la armonización elimina {removed:.0%} del exceso)")

    print("\n5) Filtro geológico/industrial (Etapa 2)")
    vi = h[h.thermal_type != "VEGETATION"]
    print(f"  [i ] {vi.grid_cell_id.nunique()} celdas marcadas como fuente fija · {len(vi):,} celdas-día excluidas del calendario")

    print("\n6) Variables ambientales (Etapa 5)")
    for col in ("slope_deg", "soil_moisture_pct", "cloud_cover_pct", "wind_speed_kmh", "ndvi_pre_fire"):
        print(f"  [i ] {col}: {h[col].notna().mean():.1%} con dato")
    print(f"  [i ] env_source: {h.env_source.value_counts().to_dict()}")

    print("\nRESULTADO:", "todos los criterios se cumplen" if ok_all else "hay criterios que NO se cumplen (ver [NO ])")


if __name__ == "__main__":
    main()
