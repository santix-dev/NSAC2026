#!/usr/bin/env python3
"""
goes_events.py — Imágenes satelitales de incendios históricos para el mapa (offline, Earth Engine).

NASA GIBS solo conserva ~90 días de GOES-Este. Para los incendios clave anteriores este script
exporta, desde Google Earth Engine, una secuencia de imágenes por día y las deja listas para la web:

  • GOES-16 ABI (NOAA/GOES/16/MCMIPF, jul-2017 → 07-abr-2025) y GOES-19 (NOAA/GOES/19/MCMIPF, desde
    07-abr-2025), disco completo cada 10 min, 2 km. Se toma 1 imagen por hora (11–23 UTC = 8–20 h AR):
      - natural:  color natural con verde sintético (Bah et al. 2018: G = 0.45·R + 0.10·NIR + 0.45·B)
      - firetemp: "Fire Temperature RGB" de NOAA (R = C07 3.9 µm, G = C06 2.2 µm, B = C05 1.6 µm)
  • Antes de GOES-16 (Cholila 2015, Córdoba 2013): MODIS Terra y Aqua (MOD09GA / MYD09GA, 500 m),
    1 imagen por satélite y día (≈10:30 y ≈13:30 hora local), color natural.

Salida (la web la lee sola, sin base de datos):
  web/public/goes/<evento>/<producto>_<YYYYMMDDTHHMMZ>.jpg
  web/public/goes/events.json   (manifiesto: eventos, límites, horarios y archivos)

Uso (desde la raíz del repo, con la misma cuenta que gee_export.py):
  python etl/env/goes_events.py --project ispstars
  python etl/env/goes_events.py --project ispstars --only cholila-2015 --force

Los eventos se editan en etl/env/goes_events.json. Es reanudable: no vuelve a bajar lo que ya existe.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    import ee
except ImportError:  # pragma: no cover
    sys.exit("✗ Falta earthengine-api: pip install -r etl/env/requirements-env.txt")

ROOT = Path(__file__).resolve().parents[2]
EVENTS_FILE = Path(__file__).with_name("goes_events.json")
OUT = ROOT / "web" / "public" / "goes"

# Mismas regiones que harmonize.REGIONS, con un margen para ver humo que sale del área
REGIONS = {
    "CORDOBA": (-65.20, -32.60, -64.00, -30.80),
    "PATAGONIA": (-72.20, -43.50, -70.80, -41.50),
}
MARGIN_DEG = 0.6
WIDTH_PX = 900
GOES16_END = datetime(2025, 4, 7, 18, 0, tzinfo=timezone.utc)
GOES16_START = datetime(2017, 7, 10, tzinfo=timezone.utc)
GOES_HOURS_UTC = range(11, 24)  # 8–20 h en Argentina (UTC−3)
AR = timezone(timedelta(hours=-3))


# --------------------------------------------------------------------------- GOES ABI
def _goes_scaled(img: ee.Image) -> ee.Image:
    """Aplica scale/offset de las propiedades CMI_Cxx_scale / CMI_Cxx_offset (doc. de EE)."""
    names = img.select("CMI_C..").bandNames()
    scales = names.map(lambda n: img.getNumber(ee.String(n).cat("_scale")))
    offsets = names.map(lambda n: img.getNumber(ee.String(n).cat("_offset")))
    return (
        img.select(names)
        .multiply(ee.Image.constant(scales))
        .add(ee.Image.constant(offsets))
        .rename(names)
    )


def goes_natural(img: ee.Image) -> ee.Image:
    s = _goes_scaled(img)
    green = s.expression("0.45 * R + 0.10 * N + 0.45 * B", {"R": s.select("CMI_C02"), "N": s.select("CMI_C03"), "B": s.select("CMI_C01")})
    rgb = ee.Image.cat([s.select("CMI_C02"), green, s.select("CMI_C01")]).rename(["r", "g", "b"])
    return rgb.visualize(min=0, max=0.7, gamma=1.3)


def goes_firetemp(img: ee.Image) -> ee.Image:
    s = _goes_scaled(img)
    rgb = ee.Image.cat([s.select("CMI_C07"), s.select("CMI_C06"), s.select("CMI_C05")]).rename(["r", "g", "b"])
    # Rangos de la receta NOAA/CIRA: C07 0–60 °C (273–333 K, gamma 0.4), C06 0–100 %, C05 0–75 %
    return rgb.visualize(min=[273, 0, 0], max=[333, 1, 0.75], gamma=[0.4, 1, 1])


def goes_collection(t: datetime) -> str:
    return "NOAA/GOES/16/MCMIPF" if t < GOES16_END else "NOAA/GOES/19/MCMIPF"


# --------------------------------------------------------------------------- MODIS
def modis_natural(img: ee.Image) -> ee.Image:
    rgb = img.select(["sur_refl_b01", "sur_refl_b04", "sur_refl_b03"]).multiply(0.0001)
    return rgb.visualize(min=0, max=0.3, gamma=1.4)


# --------------------------------------------------------------------------- export
def download(url: str, dest: Path, retries: int = 4) -> None:
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                data = r.read()
            dest.write_bytes(data)
            return
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(5 * (attempt + 1))


def thumb(image: ee.Image, region: ee.Geometry) -> str:
    return image.getThumbURL({"region": region, "dimensions": WIDTH_PX, "format": "jpg", "crs": "EPSG:3857"})


def export_event(ev: dict, force: bool) -> dict | None:
    w, s, e, n = REGIONS[ev["region"]]
    w, s, e, n = w - MARGIN_DEG, s - MARGIN_DEG, e + MARGIN_DEG, n + MARGIN_DEG
    region = ee.Geometry.Rectangle([w, s, e, n], proj="EPSG:4326", geodesic=False)
    folder = OUT / ev["id"]
    folder.mkdir(parents=True, exist_ok=True)
    frames: dict[str, list[dict]] = {"natural": [], "firetemp": []}
    sensors: set[str] = set()

    for day in ev["days"]:
        d0 = datetime.fromisoformat(day).replace(tzinfo=AR)
        if d0.astimezone(timezone.utc) < GOES16_START:
            # ---- MODIS Terra/Aqua: una imagen diaria por satélite
            for coll, sat, local_hour in (("MODIS/061/MOD09GA", "Terra", 10.5), ("MODIS/061/MYD09GA", "Aqua", 13.5)):
                t = d0 + timedelta(hours=local_hour)
                tag = t.astimezone(timezone.utc).strftime("%Y%m%dT%H%MZ")
                f = folder / f"natural_{tag}.jpg"
                if force or not f.exists():
                    col = ee.ImageCollection(coll).filterDate(day, (d0 + timedelta(days=1)).date().isoformat())
                    if col.size().getInfo() == 0:
                        print(f"  · {sat} {day}: sin imagen")
                        continue
                    download(thumb(modis_natural(col.first()), region), f)
                    print(f"  ✓ {f.relative_to(ROOT)}")
                frames["natural"].append({"time": t.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"), "file": f.name, "sat": f"MODIS {sat}"})
                sensors.add(f"MODIS {sat} (500 m)")
            continue

        # ---- GOES-16 / GOES-19: una imagen por hora de luz
        for h in GOES_HOURS_UTC:
            t = datetime(d0.year, d0.month, d0.day, h, 0, tzinfo=timezone.utc)
            coll = goes_collection(t)
            sat = "GOES-16" if "16" in coll else "GOES-19"
            col = ee.ImageCollection(coll).filterDate(t.isoformat(), (t + timedelta(minutes=10)).isoformat())
            tag = t.strftime("%Y%m%dT%H%MZ")
            needed = [p for p in ("natural", "firetemp") if force or not (folder / f"{p}_{tag}.jpg").exists()]
            if needed:
                if col.size().getInfo() == 0:
                    print(f"  · {sat} {t:%Y-%m-%d %H:%M} UTC: sin imagen")
                    continue
                img = col.first()
                for p in needed:
                    vis = goes_natural(img) if p == "natural" else goes_firetemp(img)
                    download(thumb(vis, region), folder / f"{p}_{tag}.jpg")
                print(f"  ✓ {ev['id']} {sat} {t:%Y-%m-%d %H:%M} UTC")
            for p in ("natural", "firetemp"):
                if (folder / f"{p}_{tag}.jpg").exists():
                    frames[p].append({"time": t.isoformat().replace("+00:00", "Z"), "file": f"{p}_{tag}.jpg", "sat": sat})
            sensors.add(f"{sat} ABI (2 km)")

    if not frames["natural"] and not frames["firetemp"]:
        return None
    return {
        "id": ev["id"],
        "name": ev["name"],
        "region": ev["region"],
        "days": ev["days"],
        "note": ev.get("note"),
        "bounds": [[s, w], [n, e]],
        "sensors": sorted(sensors),
        "frames": {k: v for k, v in frames.items() if v},
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True, help="Proyecto de Google Cloud con Earth Engine (ej. ispstars)")
    ap.add_argument("--only", help="ids de evento separados por comas")
    ap.add_argument("--force", action="store_true", help="volver a bajar aunque ya existan")
    a = ap.parse_args()

    ee.Initialize(project=a.project)
    events = json.loads(EVENTS_FILE.read_text(encoding="utf-8"))["events"]
    only = {x.strip() for x in a.only.split(",")} if a.only else None
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / "events.json"
    manifest = {e["id"]: e for e in json.loads(manifest_path.read_text(encoding="utf-8"))["events"]} if manifest_path.exists() else {}

    for ev in events:
        if only and ev["id"] not in only:
            continue
        print(f"▶ {ev['id']}: {ev['name']} · {', '.join(ev['days'])}")
        out = export_event(ev, a.force)
        if out:
            manifest[ev["id"]] = out
            n = sum(len(v) for v in out["frames"].values())
            print(f"  ✔ {n} imágenes · {', '.join(out['sensors'])}")
        else:
            print("  ⚠ sin imágenes para este evento")
        # el manifiesto se guarda después de cada evento: si se corta, lo hecho queda usable
        ordered = [manifest[e["id"]] for e in events if e["id"] in manifest]
        manifest_path.write_text(
            json.dumps({"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                        "source": "Google Earth Engine: NOAA GOES-16/19 ABI MCMIPF; NASA MODIS MOD09GA/MYD09GA",
                        "events": ordered}, ensure_ascii=False, indent=1),
            encoding="utf-8",
        )
    total = sum(f.stat().st_size for f in OUT.rglob("*.jpg")) / 1e6
    print(f"\n✔ web/public/goes/events.json · {total:.1f} MB de imágenes")


if __name__ == "__main__":
    main()
