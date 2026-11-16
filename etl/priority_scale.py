"""
Escala de PRIORIDAD DE ATENCIÓN por sensor (Foco Cero).

Cada sensor (MODIS, VIIRS) tiene su PROPIA escala — no es una escala común ni una
calibración entre sensores. "VIIRS · Alto" y "MODIS · Alto" significan "de los focos más
intensos que ese sensor suele ver", no que los dos fuegos sean iguales.

Parámetros por foco (FIRMS, ambos sensores):
  1. Densidad de potencia radiativa  FRPd = FRP / (scan · track)        [MW/km²]
     (la FRP por píxel crece con el área del píxel hacia el borde de la franja;
      la densidad elimina ese efecto)
  2. Contraste térmico espectral     ΔT = T(4 µm) − T(11 µm)            [K]
     MODIS: brightness (banda 21/22) − bright_t31; VIIRS: bright_ti4 − bright_ti5.
     FIRMS NO incluye la temperatura de fondo; ΔT es el mismo sustituto en ambos sensores.
     · Se evalúa por separado de día y de noche (de noche el contraste es mayor).
     · VIIRS I4 se satura a ~367 K: en esos focos ΔT queda censurado (y se invierte respecto
       de la FRP), así que un foco saturado recibe el percentil máximo de ΔT.

Índice de prioridad (0–100), con P = percentil dentro del sensor en su período de referencia:
    IP = w · P(FRPd) + (1 − w) · P(ΔT | día/noche)          w = 0,5 por defecto
Categorías (cortes fijos = percentiles 50 / 80 / 95 del IP del sensor en el período de referencia):
    1 Bajo < P50 ≤ 2 Medio < P80 ≤ 3 Alto < P95 ≤ 4 Extremo
Períodos de referencia: MODIS 2000-11-01 → 2024-12-31; VIIRS (S-NPP) 2012-11-20 → 2024-12-31.
NOAA-20 / NOAA-21 (mismo instrumento VIIRS) se clasifican con la escala VIIRS.

Uso:
    python priority_scale.py --raw-dir raw_data            # diagnóstico y cortes
    (harmonize.py la aplica al generar raw_detections.csv)
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

W_DEFAULT = 0.5
CUTS = (50.0, 80.0, 95.0)
LEVELS = {1: "Bajo", 2: "Medio", 3: "Alto", 4: "Extremo"}
VIIRS_I4_SATURATION_K = 366.99
REFERENCE = {
    "MODIS": (pd.Timestamp("2000-11-01"), pd.Timestamp("2024-12-31")),
    "VIIRS": (pd.Timestamp("2012-11-20"), pd.Timestamp("2024-12-31")),
}
REFERENCE_PLATFORMS = {"MODIS": {"Terra", "Aqua", "MODIS"}, "VIIRS": {"SNPP"}}


# ---------------------------------------------------------------------------
def features(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    area = pd.to_numeric(df["scan"], errors="coerce") * pd.to_numeric(df["track"], errors="coerce")
    out["frpd"] = pd.to_numeric(df["frp"], errors="coerce") / area.where(area > 0)
    out["delta_t"] = pd.to_numeric(df["brightness"], errors="coerce") - pd.to_numeric(df["bright_t31"], errors="coerce")
    out["saturated"] = (df["sensor"] == "VIIRS") & (pd.to_numeric(df["brightness"], errors="coerce") >= VIIRS_I4_SATURATION_K)
    out["daynight"] = df["daynight"].astype(str).str.upper().where(lambda s: s.isin(["D", "N"]))
    return out


def _pct(ref: np.ndarray, x: np.ndarray) -> np.ndarray:
    """Percentil (rango medio, 0–100) de x dentro de la distribución de referencia ref."""
    ref = np.sort(ref[np.isfinite(ref)])
    if ref.size == 0:
        return np.full(x.shape, np.nan)
    lo = np.searchsorted(ref, x, side="left")
    hi = np.searchsorted(ref, x, side="right")
    p = 100.0 * (lo + hi) / (2.0 * ref.size)
    return np.where(np.isfinite(x), p, np.nan)


def reference_mask(df: pd.DataFrame, sensor: str) -> pd.Series:
    start, end = REFERENCE[sensor]
    d = pd.to_datetime(df["acq_date"])
    m = (df["sensor"] == sensor) & d.between(start, end) & df["platform"].isin(REFERENCE_PLATFORMS[sensor])
    if "thermal_type" in df:
        m &= df["thermal_type"] == "VEGETATION"
    return m


def score(df: pd.DataFrame, f: pd.DataFrame, refs: dict, w: float, censor: bool = True) -> pd.Series:
    ip = pd.Series(np.nan, index=df.index)
    for sensor, r in refs.items():
        sel = df["sensor"] == sensor
        if not sel.any():
            continue
        p_frp = _pct(r["frpd"], f.loc[sel, "frpd"].to_numpy())
        p_dt = np.full(sel.sum(), np.nan)
        dn = f.loc[sel, "daynight"].to_numpy()
        dt = f.loc[sel, "delta_t"].to_numpy()
        for k in ("D", "N"):
            mk = dn == k
            if mk.any():
                p_dt[mk] = _pct(r[f"dt_{k}"], dt[mk])
        if censor:
            p_dt = np.where(f.loc[sel, "saturated"].to_numpy(), 100.0, p_dt)
        ip.loc[sel] = w * p_frp + (1 - w) * p_dt
    return ip


def fit(df: pd.DataFrame, w: float = W_DEFAULT, censor: bool = True) -> tuple[dict, dict]:
    """Devuelve (distribuciones de referencia, modelo con cortes) por sensor."""
    f = features(df)
    refs, model = {}, {"w": w, "censor_viirs_saturation": censor, "cuts_percentiles": list(CUTS), "sensors": {}}
    for sensor in REFERENCE:
        m = reference_mask(df, sensor) & f["frpd"].notna() & f["delta_t"].notna()
        if not m.any():
            continue
        r = {"frpd": f.loc[m, "frpd"].to_numpy()}
        for k in ("D", "N"):
            mk = m & (f["daynight"] == k)
            # ΔT de referencia: sin los saturados (su valor no es una medición válida)
            r[f"dt_{k}"] = f.loc[mk & ~f["saturated"], "delta_t"].to_numpy()
        refs[sensor] = r
        ip_ref = score(df.loc[m], f.loc[m], {sensor: r}, w, censor)
        cuts = np.percentile(ip_ref.dropna(), CUTS)
        q = [5, 25, 50, 75, 95, 99]
        model["sensors"][sensor] = {
            "reference_period": [str(REFERENCE[sensor][0].date()), str(REFERENCE[sensor][1].date())],
            "reference_platforms": sorted(REFERENCE_PLATFORMS[sensor]),
            "n_reference": int(m.sum()),
            "ip_cuts": [round(float(c), 2) for c in cuts],
            "frpd_quantiles_mw_km2": dict(zip(map(str, q), np.round(np.percentile(r["frpd"], q), 2).tolist())),
            "delta_t_quantiles_day_k": dict(zip(map(str, q), np.round(np.percentile(r["dt_D"], q), 1).tolist())) if r["dt_D"].size else {},
            "delta_t_quantiles_night_k": dict(zip(map(str, q), np.round(np.percentile(r["dt_N"], q), 1).tolist())) if r["dt_N"].size else {},
            "saturated_share_pct": round(float(f.loc[m, "saturated"].mean() * 100), 2),
        }
    return refs, model


def classify(ip: pd.Series, sensors: pd.Series, model: dict) -> pd.Series:
    lvl = pd.Series(pd.NA, index=ip.index, dtype="Int64")
    for sensor, cfg in model["sensors"].items():
        sel = (sensors == sensor) & ip.notna()
        c = cfg["ip_cuts"]
        lvl.loc[sel] = 1 + np.searchsorted(np.asarray(c), ip[sel].to_numpy(), side="right")
    return lvl


def apply(df: pd.DataFrame, w: float = W_DEFAULT, censor: bool = True) -> tuple[pd.DataFrame, dict]:
    """Agrega delta_t, priority_score (0–100) y priority_level (1–4) a cada detección."""
    refs, model = fit(df, w, censor)
    f = features(df)
    ip = score(df, f, refs, w, censor)
    out = df.copy()
    out["delta_t"] = f["delta_t"].round(1)
    out["priority_score"] = ip.round(0).astype("Int64")
    out["priority_level"] = classify(ip, df["sensor"], model)
    return out, model


# ---------------------------------------------------------------------------
def weighted_kappa(a: np.ndarray, b: np.ndarray, k: int = 4) -> float:
    """Kappa ponderado cuadrático entre dos clasificaciones ordinales 1..k."""
    ok = ~(pd.isna(a) | pd.isna(b))
    a, b = np.asarray(a[ok], int) - 1, np.asarray(b[ok], int) - 1
    o = np.zeros((k, k))
    np.add.at(o, (a, b), 1)
    o /= o.sum()
    e = np.outer(o.sum(1), o.sum(0))
    wgt = np.subtract.outer(np.arange(k), np.arange(k)) ** 2 / (k - 1) ** 2
    return float(1 - (wgt * o).sum() / (wgt * e).sum())


def report(df: pd.DataFrame) -> dict:
    f = features(df)
    out: dict = {"correlations": {}, "sensitivity": {}, "distribution": {}}
    for (sensor, dn), g in f.join(df[["sensor"]]).groupby(["sensor", "daynight"]):
        ok = ~g["saturated"]
        out["correlations"][f"{sensor}_{dn}"] = {
            "spearman_frpd_dT_no_saturados": round(float(g.loc[ok, "frpd"].corr(g.loc[ok, "delta_t"], method="spearman")), 3),
            "saturados_pct": round(float(g["saturated"].mean() * 100), 1),
        }
    base, model = apply(df)
    for sensor in model["sensors"]:
        sel = reference_mask(df, sensor)
        dist = {}
        for dn in ("D", "N"):
            s = base.loc[sel & (f["daynight"] == dn), "priority_level"]
            dist[dn] = {LEVELS[i]: round(float((s == i).mean() * 100), 1) for i in LEVELS}
        out["distribution"][sensor] = dist
    for w in (0.3, 0.7, 1.0):
        alt, _ = apply(df, w=w)
        out["sensitivity"][f"w={w}"] = {s: round(weighted_kappa(base.loc[df.sensor == s, "priority_level"].to_numpy(),
                                                                  alt.loc[df.sensor == s, "priority_level"].to_numpy()), 3)
                                        for s in model["sensors"]}
    nc, _ = apply(df, censor=False)
    out["sensitivity"]["sin_censura_VIIRS"] = {"VIIRS": round(weighted_kappa(base.loc[df.sensor == "VIIRS", "priority_level"].to_numpy(),
                                                                             nc.loc[df.sensor == "VIIRS", "priority_level"].to_numpy()), 3)}
    out["model"] = model
    return out


def main(argv=None) -> int:
    import harmonize as h

    ap = argparse.ArgumentParser(description="Escala de prioridad de atención por sensor (diagnóstico)")
    ap.add_argument("--raw-dir", type=Path, default=Path(__file__).parent / "raw_data")
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "priority_report.json")
    a = ap.parse_args(argv)
    df = h.assign_region(h.load_raw_directory(a.raw_dir))
    st = h.PipelineStats()
    df = h.stage2_stationary_mask(h.stage1_quality_filter(df, st), st)
    rep = report(df)
    a.out.write_text(json.dumps(rep, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(rep, indent=2, ensure_ascii=False))
    return 0




# ---------------------------------------------------------------------------
# Concordancia por celda armonizada (serie "Armonizada" desde nov-2026)
# ---------------------------------------------------------------------------
GRID_SCALE = 100


def cell_priority(cells: pd.DataFrame, raw: pd.DataFrame) -> pd.DataFrame:
    """Agrega a cada celda-día armonizada la prioridad máxima de cada sensor y si concuerdan.

    modis_priority / viirs_priority = nivel máximo (1–4) de las detecciones de ese sensor que entran
    en la serie (in_calendar) dentro de la celda 0,01° ese día.
    concordant = la celda la vieron ambos sensores y |MODIS − VIIRS| ≤ 1 nivel.
    """
    r = raw[raw["in_calendar"].astype(str).str.lower().isin(["true", "1"]) & raw["priority_level"].notna()].copy()
    lat = np.floor(pd.to_numeric(r["lat"]).to_numpy() * GRID_SCALE).astype(np.int64).astype(str)
    lon = np.floor(pd.to_numeric(r["lon"]).to_numpy() * GRID_SCALE).astype(np.int64).astype(str)
    r["key"] = pd.Series(lat, index=r.index) + "_" + pd.Series(lon, index=r.index) + "|" + pd.to_datetime(r["acq_date"]).dt.strftime("%Y-%m-%d")
    lv = r.groupby(["key", "sensor"])["priority_level"].max().unstack()
    out = cells.copy()
    key = out["grid_cell_id"].astype(str) + "|" + pd.to_datetime(out["acq_date"]).dt.strftime("%Y-%m-%d")
    out["modis_priority"] = key.map(lv["MODIS"]).astype("Int64") if "MODIS" in lv else pd.NA
    out["viirs_priority"] = key.map(lv["VIIRS"]).astype("Int64") if "VIIRS" in lv else pd.NA
    both = (out["sensor_source"] == "BOTH") & out["modis_priority"].notna() & out["viirs_priority"].notna()
    diff = (out["modis_priority"].astype("Float64") - out["viirs_priority"].astype("Float64")).abs()
    out["concordant"] = (both & (diff <= 1)).fillna(False).astype(bool)
    return out


def _cli_cells(argv=None) -> int:
    """python priority_scale.py --cells harmonized_output.csv --raw raw_detections.csv"""
    ap = argparse.ArgumentParser()
    ap.add_argument("--cells", type=Path, required=True)
    ap.add_argument("--raw", type=Path, required=True)
    a = ap.parse_args(argv)
    cells = pd.read_csv(a.cells, dtype={"grid_cell_id": str})
    raw = pd.read_csv(a.raw, dtype={"acq_time": str, "confidence": str})
    out = cell_priority(cells.drop(columns=["modis_priority", "viirs_priority", "concordant"], errors="ignore"), raw)
    out.to_csv(a.cells, index=False)
    print(f"✔ {a.cells.name}: {int(out['concordant'].sum()):,} celdas concordantes de {int((out['sensor_source'] == 'BOTH').sum()):,} vistas por ambos")
    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(_cli_cells(sys.argv[1:]) if "--cells" in sys.argv else main())
