#!/usr/bin/env python3
"""
fire_imagery.py — Busca y exporta imágenes donde SE VEA el fuego o el humo de cada incendio histórico.

Por qué no alcanza con GOES: su píxel es de 2 km (3–4 km en Patagonia); un frente de fuego de
cientos de metros no se distingue y, sobre toda la región, el incendio ocupa unos pocos píxeles.
Este script, en cambio, RASTREA cada incendio:

 1. Ubica el incendio con los focos armonizados del ETL (etl/harmonized_output.csv): centro y
    recuadro ajustado al área quemada, y los días con actividad.
 2. Busca en Earth Engine todas las pasadas en ±6 días de los días pico:
      • Landsat 8/9 (30 m) y Sentinel-2 (10–20 m, desde jun-2015): composición de onda corta
        SWIR2–NIR–Rojo, en la que el FRENTE DE FUEGO se ve naranja/amarillo brillante y el humo
        es casi transparente; y color natural (humo).
      • MODIS Terra/Aqua (500 m, 2 pasadas diarias): color natural para la COLUMNA DE HUMO y
        7-2-1 para el frente activo, sobre un recuadro más amplio.
 3. Mide en cada escena, dentro del recuadro del incendio: píxeles de fuego activo (criterio de
    Schroeder et al. 2016 para Landsat: ρ7/ρ5 > 2.5, ρ7−ρ5 > 0.3, ρ7 > 0.5; análogo con B12/B8A en
    Sentinel-2), cobertura de nubes y cobertura de datos.
 4. Elige las mejores: primero las que muestran fuego activo, después las más despejadas; y las
    pasadas MODIS de los días con más focos y menos nubes.

Salida (la web la lee sola):
  web/public/goes/<evento>/<sensor>_<YYYYMMDDTHHMMZ>_<producto>.jpg
  web/public/goes/events.json   (manifiesto con escenas, límites y métricas)

Uso (desde la raíz del repo, después de harmonize.py):
  python etl/env/fire_imagery.py --project ispstars
  python etl/env/fire_imagery.py --project ispstars --only cholila-2015 --force
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

try:
    import ee
except ImportError:  # pragma: no cover
    sys.exit("✗ Falta earthengine-api: pip install -r etl/env/requirements-env.txt")

ROOT = Path(__file__).resolve().parents[2]
EVENTS_FILE = Path(__file__).with_name("fire_events.json")
HARMONIZED = ROOT / "etl" / "harmonized_output.csv"
OUT = ROOT / "web" / "public" / "goes"

SEARCH_DAYS = 6          # ventana de búsqueda alrededor de los días pico
FIRE_RADIUS_DEG = 0.35   # focos que pertenecen al incendio (alrededor del centro)
PAD_DEG = 0.08
MIN_SPAN_DEG = 0.30
CONTEXT_PAD_DEG = 0.45   # recuadro MODIS: incluye la columna de humo
MAX_HIGHRES = 4
MAX_MODIS = 4
WIDTH_PX = 1200

S2_START = datetime(2015, 6, 23, tzinfo=timezone.utc)


# --------------------------------------------------------------------------- ubicación del incendio
def fire_box(h: pd.DataFrame, region: str, days: list[str]):
    d = pd.to_datetime(days)
    lo, hi = d.min() - pd.Timedelta(days=SEARCH_DAYS), d.max() + pd.Timedelta(days=SEARCH_DAYS)
    w = h[(h.region == region) & (h.thermal_type == "VEGETATION") & h.acq_date.between(lo, hi)]
    if w.empty:
        return None
    peak = w[w.acq_date.isin(d)]
    if peak.empty:
        peak = w
    c_lat = float(np.average(peak.lat, weights=peak.harmonized_weight))
    c_lon = float(np.average(peak.lon, weights=peak.harmonized_weight))
    near = w[(abs(w.lat - c_lat) < FIRE_RADIUS_DEG) & (abs(w.lon - c_lon) < FIRE_RADIUS_DEG * 1.35)]
    s, n = near.lat.min() - PAD_DEG, near.lat.max() + PAD_DEG
    west, e = near.lon.min() - PAD_DEG, near.lon.max() + PAD_DEG
    if n - s < MIN_SPAN_DEG:
        m = (n + s) / 2
        s, n = m - MIN_SPAN_DEG / 2, m + MIN_SPAN_DEG / 2
    if e - west < MIN_SPAN_DEG:
        m = (e + west) / 2
        west, e = m - MIN_SPAN_DEG / 2, m + MIN_SPAN_DEG / 2
    per_day = near.groupby(near.acq_date.dt.strftime("%Y-%m-%d"))["raw_detections_count"].sum().to_dict()
    return (round(west, 3), round(s, 3), round(e, 3), round(n, 3)), (c_lat, c_lon), per_day, (lo, hi)


# --------------------------------------------------------------------------- sensores
def landsat_toa(ic_id: str):
    return ee.ImageCollection(ic_id)


def s2_l1c():
    return ee.ImageCollection("COPERNICUS/S2_HARMONIZED")


SENSORS = {
    # nombre: (colección, bandas swir/nir/red/green/blue, escala reflectancia, resolución)
    "Landsat 8": dict(col=lambda: landsat_toa("LANDSAT/LC08/C02/T1_TOA"), b=("B7", "B6", "B5", "B4", "B3", "B2"), k=1.0, res="30 m", scale=60),
    "Landsat 9": dict(col=lambda: landsat_toa("LANDSAT/LC09/C02/T1_TOA"), b=("B7", "B6", "B5", "B4", "B3", "B2"), k=1.0, res="30 m", scale=60),
    "Sentinel-2": dict(col=s2_l1c, b=("B12", "B11", "B8A", "B4", "B3", "B2"), k=1e-4, res="10–20 m", scale=60),
}


def refl(img: ee.Image, sensor: str) -> ee.Image:
    swir2, swir1, nir, red, green, blue = SENSORS[sensor]["b"]
    return img.select([swir2, swir1, nir, red, green, blue], ["s2", "s1", "nir", "r", "g", "b"]).multiply(SENSORS[sensor]["k"])


def hot_mask(r: ee.Image) -> ee.Image:
    """Píxeles de fuego activo inequívocos (Schroeder et al. 2016, adaptado a SWIR2/NIR)."""
    s2, nir = r.select("s2"), r.select("nir")
    return s2.divide(nir.max(1e-4)).gt(2.5).And(s2.subtract(nir).gt(0.3)).And(s2.gt(0.5))


def cloud_mask(img: ee.Image, sensor: str, day: str, geom: ee.Geometry) -> ee.Image:
    if sensor.startswith("Landsat"):
        qa = img.select("QA_PIXEL")
        return qa.bitwiseAnd(1 << 3).neq(0).Or(qa.bitwiseAnd(1 << 1).neq(0))
    real = (
        ee.ImageCollection("COPERNICUS/S2_CLOUD_PROBABILITY")
        .filterBounds(geom)
        .filterDate(day, (datetime.fromisoformat(day) + timedelta(days=1)).date().isoformat())
        .select("probability")
    )
    # base en 0 por si no hay máscara de nubes para esa fecha (el mosaico deja arriba la real)
    base = ee.ImageCollection([ee.Image.constant(0).rename("probability").toFloat()])
    return base.merge(real.map(lambda i: i.toFloat())).mosaic().gt(60)


def vis_swir(r: ee.Image) -> ee.Image:
    # SWIR2–NIR–Rojo: fuego activo naranja/amarillo, vegetación verde, quemado oscuro
    return r.select(["s2", "nir", "r"]).visualize(min=0, max=[0.55, 0.5, 0.3], gamma=1.15)


def vis_natural(r: ee.Image) -> ee.Image:
    return r.select(["r", "g", "b"]).visualize(min=0, max=0.3, gamma=1.3)


# --------------------------------------------------------------------------- utilidades EE
def rect(b) -> ee.Geometry:
    w, s, e, n = b
    return ee.Geometry.Rectangle([w, s, e, n], proj="EPSG:4326", geodesic=False)


def download(url: str, dest: Path, retries: int = 4) -> None:
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=240) as r:
                dest.write_bytes(r.read())
            return
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(5 * (attempt + 1))


def thumb(image: ee.Image, b) -> str:
    return image.getThumbURL({"region": rect(b), "dimensions": WIDTH_PX, "format": "jpg", "crs": "EPSG:3857"})


def iso_z(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:00Z")


# --------------------------------------------------------------------------- búsqueda de escenas
def highres_candidates(sensor: str, geom: ee.Geometry, start: str, end: str) -> list[dict]:
    col = SENSORS[sensor]["col"]().filterBounds(geom).filterDate(start, end)
    stamps = col.aggregate_array("system:time_start").getInfo() or []
    days = sorted({datetime.fromtimestamp(t / 1000, tz=timezone.utc).date().isoformat() for t in stamps})
    out = []
    for day in days:
        nxt = (datetime.fromisoformat(day) + timedelta(days=1)).date().isoformat()
        sub = col.filterDate(day, nxt)
        img = sub.mosaic()
        r = refl(img, sensor)
        stats = ee.Image.cat(
            [
                hot_mask(r).rename("hot"),
                cloud_mask(img, sensor, day, geom).rename("cloud"),
                r.select("r").mask().rename("valid"),
            ]
        ).unmask(0).reduceRegion(ee.Reducer.mean(), geom, SENSORS[sensor]["scale"], maxPixels=1e9, bestEffort=True)
        try:
            st = stats.getInfo()
        except Exception as ex:  # escena problemática: se saltea
            print(f"    · {sensor} {day}: {ex}")
            continue
        t = sub.aggregate_min("system:time_start").getInfo()
        area_px = geom.area(1).divide(SENSORS[sensor]["scale"] ** 2).getInfo()
        out.append(
            dict(sensor=sensor, day=day, time=iso_z(t), hot_px=int(round((st.get("hot") or 0) * area_px)),
                 cloud=round(st.get("cloud") or 0, 2), valid=round(st.get("valid") or 0, 2), img=img)
        )
        print(f"    · {sensor:10} {day}: fuego {out[-1]['hot_px']:>6} px · nubes {out[-1]['cloud']:.0%} · datos {out[-1]['valid']:.0%}")
    return out


def modis_candidates(geom: ee.Geometry, start: str, end: str, per_day: dict) -> list[dict]:
    out = []
    for coll, sat, hour in (("MODIS/061/MOD09GA", "MODIS Terra", "14:30"), ("MODIS/061/MYD09GA", "MODIS Aqua", "17:30")):
        col = ee.ImageCollection(coll).filterDate(start, end)
        ids = col.aggregate_array("system:index").getInfo() or []
        for idx in ids:
            img = ee.Image(f"{coll}/{idx}")
            day = f"{idx[:4]}-{idx[5:7]}-{idx[8:10]}"
            det = per_day.get(day, 0) + 0.5 * (per_day.get((datetime.fromisoformat(day) - timedelta(days=1)).date().isoformat(), 0))
            if det <= 0:
                continue
            cloudy = img.select("state_1km").bitwiseAnd(3).eq(1)
            try:
                cl = cloudy.reduceRegion(ee.Reducer.mean(), geom, 1000, bestEffort=True).getInfo().get("state_1km") or 0
            except Exception as ex:
                print(f"    · {sat} {day}: {ex}")
                continue
            out.append(dict(sensor=sat, day=day, time=f"{day}T{hour}:00Z", det=det, cloud=round(cl, 2), img=img,
                            score=det * (1 - cl)))
    return out


def modis_vis(img: ee.Image, product: str) -> ee.Image:
    if product == "natural":
        return img.select(["sur_refl_b01", "sur_refl_b04", "sur_refl_b03"]).multiply(1e-4).resample("bilinear").visualize(min=0, max=0.3, gamma=1.4)
    # 7-2-1: frente activo rojo/naranja, quemado marrón oscuro
    return img.select(["sur_refl_b07", "sur_refl_b02", "sur_refl_b01"]).multiply(1e-4).resample("bilinear").visualize(min=0, max=[0.35, 0.5, 0.3], gamma=1.2)


# --------------------------------------------------------------------------- antes / después / recuperación
STAGES = {
    # etapa: (desde, hasta) en días respecto del inicio (pre) o del fin (post/recuperación) del incendio
    "pre": (-75, -2),
    "post": (3, 60),
    "recovery": (120, 300),
}
RECOVERY_TARGET_DAYS = 180
STAGE_LABELS = {"pre": "Antes del incendio", "post": "Después (incendio apagado)", "recovery": "Recuperación (meses después)"}
# Severidad dNBR (Key & Benson 2006, USGS FIREMON)
DNBR_CLASSES = [
    ("Baja", 0.10, 0.27, "#fde725"),
    ("Moderada-baja", 0.27, 0.44, "#fca636"),
    ("Moderada-alta", 0.44, 0.66, "#e45a31"),
    ("Alta", 0.66, 9.99, "#9c179e"),
]


def fire_span(per_day: dict, min_det: int = 3) -> tuple[pd.Timestamp, pd.Timestamp]:
    """Primer y último día con actividad real dentro del recuadro (≥ min_det detecciones)."""
    act = sorted(d for d, n in per_day.items() if n >= min_det) or sorted(per_day)
    return pd.Timestamp(act[0]), pd.Timestamp(act[-1])


def clear_candidates(sensor: str, geom: ee.Geometry, start: str, end: str) -> list[dict]:
    """Escenas despejadas: nubes, nieve (NDSI > 0.4) y cobertura de datos sobre el incendio."""
    col = SENSORS[sensor]["col"]().filterBounds(geom).filterDate(start, end)
    stamps = col.aggregate_array("system:time_start").getInfo() or []
    days = sorted({datetime.fromtimestamp(t / 1000, tz=timezone.utc).date().isoformat() for t in stamps})
    out = []
    for day in days:
        nxt = (datetime.fromisoformat(day) + timedelta(days=1)).date().isoformat()
        sub = col.filterDate(day, nxt)
        img = sub.mosaic()
        r = refl(img, sensor)
        ndsi = r.normalizedDifference(["g", "s1"])
        stats = ee.Image.cat(
            [
                cloud_mask(img, sensor, day, geom).rename("cloud"),
                ndsi.gt(0.4).rename("snow"),
                r.select("r").mask().rename("valid"),
            ]
        ).unmask(0).reduceRegion(ee.Reducer.mean(), geom, 120, maxPixels=1e9, bestEffort=True)
        try:
            st = stats.getInfo()
        except Exception as ex:
            print(f"    · {sensor} {day}: {ex}")
            continue
        out.append(dict(sensor=sensor, day=day, time=iso_z(sub.aggregate_min("system:time_start").getInfo()),
                        cloud=round(st.get("cloud") or 0, 2), snow=round(st.get("snow") or 0, 2),
                        valid=round(st.get("valid") or 0, 2), img=img))
    return out


def pick_stage(cands: list[dict], stage: str, anchor: pd.Timestamp) -> dict | None:
    ok = [c for c in cands if c["valid"] >= 0.9]
    if not ok:
        return None
    dist = lambda c: abs((pd.Timestamp(c["day"]) - anchor).days)  # noqa: E731
    good = [c for c in ok if c["cloud"] <= 0.12 and c["snow"] <= 0.15]
    if good:
        if stage == "pre":       # la más cercana al inicio
            return min(good, key=dist)
        if stage == "post":      # la primera despejada después del fin
            return min(good, key=lambda c: c["day"])
        return min(good, key=dist)  # recuperación: la más cercana a ~6 meses
    return min(ok, key=lambda c: c["cloud"] + c["snow"] + dist(c) / 1000)


def process_stages(ev: dict, h: pd.DataFrame, force: bool) -> dict | None:
    fb = fire_box(h, ev["region"], ev["days"])
    if not fb:
        return None
    box, _, per_day, _ = fb
    geom = rect(box)
    f_start, f_end = fire_span(per_day)
    today = pd.Timestamp(datetime.now(timezone.utc).date())
    folder = OUT / ev["id"]
    folder.mkdir(parents=True, exist_ok=True)
    print(f"  incendio activo {f_start.date()} → {f_end.date()} (días con ≥3 detecciones en el recuadro)")
    chosen: dict[str, dict] = {}
    for stage, (d0, d1) in STAGES.items():
        ref = f_start if stage == "pre" else f_end
        lo, hi = ref + pd.Timedelta(days=d0), min(ref + pd.Timedelta(days=d1), today)
        if lo >= today:
            print(f"  · {STAGE_LABELS[stage]}: todavía no hay imágenes (desde {lo.date()})")
            continue
        cands: list[dict] = []
        for sensor in SENSORS:
            if sensor == "Sentinel-2" and hi.tz_localize("UTC") < S2_START:
                continue
            cands += clear_candidates(sensor, geom, lo.date().isoformat(), (hi + pd.Timedelta(days=1)).date().isoformat())
        anchor = ref + pd.Timedelta(days=RECOVERY_TARGET_DAYS) if stage == "recovery" else ref
        c = pick_stage(cands, stage, anchor)
        if not c:
            print(f"  · {STAGE_LABELS[stage]}: sin escena útil entre {lo.date()} y {hi.date()}")
            continue
        chosen[stage] = c
        print(f"  ✓ {STAGE_LABELS[stage]}: {c['sensor']} {c['day']} · nubes {c['cloud']:.0%} · nieve {c['snow']:.0%}")

    timeline: dict = {"fire_start": f_start.date().isoformat(), "fire_end": f_end.date().isoformat(), "stages": {}}
    for stage, c in chosen.items():
        tag = c["time"].replace("-", "").replace(":", "")[:13] + "Z"
        slug = c["sensor"].lower().replace(" ", "").replace("-", "")
        products = {}
        for p in ("natural", "swir"):
            f = folder / f"{stage}_{slug}_{tag}_{p}.jpg"
            if force or not f.exists():
                download(thumb((vis_swir if p == "swir" else vis_natural)(refl(c["img"], c["sensor"])), box), f)
            products[p] = {"file": f.name, "bounds": [[box[1], box[0]], [box[3], box[2]]]}
        days_rel = (pd.Timestamp(c["day"]) - (f_start if stage == "pre" else f_end)).days
        timeline["stages"][stage] = dict(label=STAGE_LABELS[stage], time=c["time"], day=c["day"], sensor=c["sensor"],
                                         resolution=SENSORS[c["sensor"]]["res"], cloud=c["cloud"], snow=c["snow"],
                                         days_from_fire=days_rel, products=products)

    # ---- severidad dNBR (antes vs. después), con nubes enmascaradas en ambas
    if "pre" in chosen and "post" in chosen:
        def nbr(c):
            r = refl(c["img"], c["sensor"])
            clouds = cloud_mask(c["img"], c["sensor"], c["day"], geom)
            return r.normalizedDifference(["nir", "s2"]).updateMask(clouds.Not())
        dnbr = nbr(chosen["pre"]).subtract(nbr(chosen["post"])).rename("dnbr")
        cls = ee.Image(0)
        for i, (_, lo_, hi_, _) in enumerate(DNBR_CLASSES, start=1):
            cls = cls.where(dnbr.gte(lo_).And(dnbr.lt(hi_)), i)
        cls = cls.updateMask(dnbr.mask()).rename("cls")
        area = ee.Image.pixelArea().divide(1e4).addBands(cls).reduceRegion(
            ee.Reducer.sum().group(groupField=1, groupName="cls"), geom, 30, maxPixels=1e10, bestEffort=True
        ).getInfo()
        ha = {int(g["cls"]): g["sum"] for g in area.get("groups", [])}
        f = folder / "severity_dnbr.png"
        if force or not f.exists():
            vis = cls.updateMask(cls.gt(0)).visualize(min=1, max=len(DNBR_CLASSES), palette=[c[3] for c in DNBR_CLASSES])
            url = vis.getThumbURL({"region": geom, "dimensions": WIDTH_PX, "format": "png", "crs": "EPSG:3857"})
            download(url, f)
        burned = sum(v for k, v in ha.items() if k >= 1)
        timeline["severity"] = dict(
            file=f.name, bounds=[[box[1], box[0]], [box[3], box[2]]],
            pre=chosen["pre"]["day"], post=chosen["post"]["day"],
            sensors=sorted({chosen["pre"]["sensor"], chosen["post"]["sensor"]}),
            classes=[dict(name=n, min=lo_, max=None if hi_ > 9 else hi_, color=col, ha=round(ha.get(i, 0)))
                     for i, (n, lo_, hi_, col) in enumerate(DNBR_CLASSES, start=1)],
            burned_ha=round(burned),
        )
        print(f"  ✓ Severidad dNBR: {round(burned):,} ha afectadas (dNBR ≥ 0,10) dentro del recuadro")
    return timeline if timeline["stages"] else None


# --------------------------------------------------------------------------- evento
def process_event(ev: dict, h: pd.DataFrame, force: bool) -> dict | None:
    fb = fire_box(h, ev["region"], ev["days"])
    if not fb:
        print("  ⚠ sin focos armonizados en la ventana: revisar 'days' o correr harmonize.py")
        return None
    box, center, per_day, (lo, hi) = fb
    ctx = (box[0] - CONTEXT_PAD_DEG, box[1] - CONTEXT_PAD_DEG * 0.6, box[2] + CONTEXT_PAD_DEG * 1.4, box[3] + CONTEXT_PAD_DEG * 0.6)
    geom = rect(box)
    start, end = lo.date().isoformat(), (hi + pd.Timedelta(days=1)).date().isoformat()
    print(f"  recuadro del incendio {box} · {sum(per_day.values())} detecciones en {len(per_day)} días")

    # ---- alta resolución
    hr: list[dict] = []
    for sensor in SENSORS:
        if sensor == "Sentinel-2" and hi.tz_localize("UTC") < S2_START:
            continue
        hr += highres_candidates(sensor, geom, start, end)
    hr = [c for c in hr if c["valid"] >= 0.5]
    fire = sorted([c for c in hr if c["hot_px"] >= 5], key=lambda c: -c["hot_px"])
    clear = sorted([c for c in hr if c["hot_px"] < 5 and c["cloud"] < 0.6], key=lambda c: c["cloud"])
    pick_hr = (fire[:MAX_HIGHRES] + clear)[: max(1, MAX_HIGHRES if fire else 2)]

    # ---- MODIS (humo y frente a 500 m)
    md = sorted([c for c in modis_candidates(rect(ctx), start, end, per_day) if c["cloud"] < 0.85], key=lambda c: -c["score"])
    pick_md, seen = [], set()
    for c in md:  # como máximo una pasada por día
        if c["day"] in seen:
            continue
        seen.add(c["day"])
        pick_md.append(c)
        if len(pick_md) >= MAX_MODIS:
            break

    folder = OUT / ev["id"]
    if force and folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True, exist_ok=True)
    scenes = []
    for c in sorted(pick_hr + pick_md, key=lambda c: c["time"]):
        tag = c["time"].replace("-", "").replace(":", "")[:13] + "Z"
        slug = c["sensor"].lower().replace(" ", "").replace("-", "")
        is_modis = c["sensor"].startswith("MODIS")
        b = ctx if is_modis else box
        products = {}
        for p in ("swir", "natural"):
            f = folder / f"{slug}_{tag}_{p}.jpg"
            if not f.exists():
                vis = modis_vis(c["img"], p) if is_modis else (vis_swir if p == "swir" else vis_natural)(refl(c["img"], c["sensor"]))
                download(thumb(vis, b), f)
            products[p] = {"file": f.name, "bounds": [[b[1], b[0]], [b[3], b[2]]]}
        scenes.append(
            dict(time=c["time"], day=c["day"], sensor=c["sensor"], resolution="500 m" if is_modis else SENSORS[c["sensor"]]["res"],
                 hot_px=c.get("hot_px"), cloud=c["cloud"], detections=int(per_day.get(c["day"], 0)), products=products)
        )
        what = f"fuego {c['hot_px']} px" if not is_modis else f"{int(per_day.get(c['day'], 0))} detecciones"
        print(f"  ✓ {c['sensor']} {c['day']} · {what} · nubes {c['cloud']:.0%}")
    if not scenes:
        return None
    return dict(id=ev["id"], name=ev["name"], region=ev["region"], days=ev["days"], center=[round(center[0], 4), round(center[1], 4)],
                fire_bounds=[[box[1], box[0]], [box[3], box[2]]], scenes=scenes)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True)
    ap.add_argument("--only", help="ids de evento separados por comas")
    ap.add_argument("--force", action="store_true", help="borra y vuelve a generar las imágenes del evento")
    ap.add_argument("--stages-only", action="store_true",
                    help="solo agrega Antes / Después / Recuperación y severidad a los eventos ya exportados")
    a = ap.parse_args()
    if not HARMONIZED.exists():
        sys.exit("✗ Falta etl/harmonized_output.csv: correr antes python etl/harmonize.py")
    ee.Initialize(project=a.project)
    h = pd.read_csv(HARMONIZED, usecols=["region", "acq_date", "lat", "lon", "harmonized_weight", "raw_detections_count", "thermal_type"], parse_dates=["acq_date"])
    events = json.loads(EVENTS_FILE.read_text(encoding="utf-8"))["events"]
    only = {x.strip() for x in a.only.split(",")} if a.only else None
    OUT.mkdir(parents=True, exist_ok=True)
    mpath = OUT / "events.json"
    old = json.loads(mpath.read_text(encoding="utf-8")) if mpath.exists() else {}
    if any("scenes" not in e for e in old.get("events", [])):
        # formato viejo (goes_events.py: GOES por hora sobre toda la región): se borra entero
        print("  · borrando imágenes del formato anterior (GOES por hora)")
        for d in OUT.iterdir():
            shutil.rmtree(d) if d.is_dir() else d.unlink()
        old = {}
    manifest = {e["id"]: e for e in old.get("events", [])}
    valid_ids = {e["id"] for e in events}
    for d in OUT.iterdir():  # carpetas de eventos que ya no están en la lista (p. ej. del script anterior)
        if d.is_dir() and d.name not in valid_ids:
            shutil.rmtree(d)

    for ev in events:
        if only and ev["id"] not in only:
            continue
        print(f"▶ {ev['id']}: {ev['name']}")
        if a.stages_only and ev["id"] in manifest:
            out = manifest[ev["id"]]
        else:
            out = process_event(ev, h, a.force)
        if out:
            print("  — Antes / Después / Recuperación")
            tl = process_stages(ev, h, a.force)
            if tl:
                out["timeline"] = tl
            manifest[ev["id"]] = out
        else:
            manifest.pop(ev["id"], None)
            print("  ⚠ no se encontraron imágenes útiles")
        ordered = [manifest[e["id"]] for e in events if e["id"] in manifest]
        mpath.write_text(json.dumps({
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": "Google Earth Engine: USGS Landsat 8/9 C2 TOA, ESA Sentinel-2 L1C, NASA MODIS MOD09GA/MYD09GA",
            "events": ordered}, ensure_ascii=False, indent=1), encoding="utf-8")
    total = sum(f.stat().st_size for f in OUT.rglob("*.jpg")) / 1e6
    print(f"\n✔ web/public/goes/events.json · {total:.1f} MB de imágenes")


if __name__ == "__main__":
    main()
