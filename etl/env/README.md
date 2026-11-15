# Variables ambientales reales (reemplazan al modelo paramétrico)

| Variable | Fuente | Período | Resolución |
|---|---|---|---|
| `slope_deg` | NASA SRTM 30 m → media por celda 0.01° | estática | 1 km |
| `ndvi_pre_fire` | MODIS MOD13A3 (mes anterior a la celda-día) | 2000–hoy | 1 km |
| `cloud_cover_pct` | MODIS MOD09GA `state_1km` (% de días nublados) | 2000–hoy | 1 km |
| `soil_moisture_pct` | NASA GLDAS-2.1 Noah 0–10 cm; SMAP L3 si falta GLDAS | 2000–hoy / 2015–hoy | 27 km / 9 km |
| `wind_speed_kmh`, `wind_direction_deg` | NASA POWER (MERRA-2) WS10M / WD10M, nodo más cercano | 2000–hoy | ~0.5° |

SAOCOM no se usa en la serie: su producto de humedad cubre la región pampeana, no la Patagonia Andina.

## Pasos (en tu PC, desde la carpeta del repo)

```bash
pip install -r etl/env/requirements-env.txt
earthengine authenticate                                  # solo la primera vez (abre el navegador)
python etl/env/gee_export.py --project ispstars --wait    # 10 GeoTIFFs a Google Drive/pyrosync_env
#   -> descargar la carpeta de Drive a etl/aux_data/rasters/
python etl/env/fetch_power.py                             # viento NASA POWER -> etl/aux_data/power_wind_nodes.csv
python etl/harmonize.py                                   # celdas-día (si no existe harmonized_output.csv)
python etl/env/build_aux.py                               # -> etl/aux_data/terrain_cells.csv + env_cell_month.csv
python etl/harmonize.py                                   # re-procesa: env_source = 'AUX'
```

## Imágenes de incendios históricos (fuego y humo visibles)

GOES tiene píxeles de 2 km (3–4 km en Patagonia): un incendio puntual casi no se distingue y NASA GIBS
solo guarda ~90 días. Para los incendios clave, `fire_imagery.py` **rastrea** cada incendio con
Earth Engine y elige las imágenes donde se ve:

1. Ubica el incendio con los focos armonizados (`etl/harmonized_output.csv`): recuadro ajustado y días activos.
2. Revisa todas las pasadas en ±6 días de **Landsat 8/9** (30 m) y **Sentinel-2** (10–20 m, desde jun-2015)
   y mide píxeles de fuego activo (criterio de Schroeder et al. 2016), nubes y cobertura.
3. Revisa **MODIS Terra/Aqua** (500 m) en los días con más focos y menos nubes, para la columna de humo.
4. Exporta las mejores en dos versiones: **onda corta** (SWIR2–NIR–rojo: el frente de fuego en
   naranja/amarillo, el humo casi transparente) y **color natural** (humo).

```bash
python etl/env/fire_imagery.py --project ispstars             # requiere haber corrido harmonize.py
python etl/env/fire_imagery.py --project ispstars --only cholila-2015 --force
```

Eventos en `etl/env/fire_events.json` (un incendio por evento; editable). Salida:
`web/public/goes/<evento>/*.jpg` + `web/public/goes/events.json`. La web los muestra al elegir ese
año y mes con la capa "Imagen satelital (humo)", y acerca el mapa al incendio.

### Antes / Después / Recuperación y severidad (dNBR)

Para cada incendio, `fire_imagery.py` además elige escenas Landsat 8/9 o Sentinel-2 despejadas
(nubes ≤ 12 %, nieve ≤ 15 %, cobertura ≥ 90 % del recuadro):

- **Antes**: la más cercana al inicio, entre 75 y 2 días antes.
- **Después**: la primera despejada entre 3 y 60 días después del último día con focos.
- **Recuperación**: la más cercana a ~6 meses después (ventana de 4 a 10 meses).
- **Severidad**: dNBR = NBR(antes) − NBR(después), NBR = (NIR − SWIR2)/(NIR + SWIR2), clases USGS
  (Key & Benson 2006) y hectáreas por clase dentro del recuadro.

Para agregarlo a los incendios ya exportados sin volver a buscar las imágenes del fuego:

```bash
python etl/env/fire_imagery.py --project ispstars --stages-only
```
