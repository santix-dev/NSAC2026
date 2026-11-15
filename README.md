# Foco Cero — Monitoreo satelital de puntos calientes (MODIS + VIIRS armonizados)

> **NASA Space Apps Challenge 2026** | Challenge: *Harmonization of MODIS and VIIRS Hot Spots*

**Foco Cero** (antes PyroSync) es una plataforma web de observación terrestre que unifica más de dos décadas de detecciones térmicas satelitales (**MODIS Terra/Aqua** desde el año 2000 y **VIIRS S-NPP/NOAA-20** desde 2012) en una serie temporal consistente, eliminando las distorsiones espaciales entre sensores y separando incendios reales de anomalías geológicas o industriales.

---

## El Problema Científico
1. **Discontinuidad Espacial:** MODIS posee una resolución nominal de **1 km × 1 km**, mientras que VIIRS opera a **375 m × 375 m** (~7 veces mayor detalle). Un mismo frente de fuego detectado como 1 punto en MODIS se fragmenta en múltiples detecciones en VIIRS, creando un salto artificial en los registros históricos a partir de 2012.
2. **Contaminación Térmica No Biológica:** Los sensores infrarrojos medios y térmicos (MIR/TIR) captan fuentes estacionarias persistentes como **actividad volcánica** y **antorchas de gas/petróleo (*gas flares*)**, distorsionando las estadísticas de incendios forestales y quemas agrícolas.

## Solución Implementada
- **Grilla Espacial Unificada (1 km):** Proyección de ambos sensores sobre celdas regulares de $0.01^\circ \times 0.01^\circ$ (~1.1 km) contabilizando *Celdas Activas por Día*.
- **Filtro Geológico de Persistencia Estacionaria:** Clasificación automática de fuentes térmicas fijas recurrentes (`VOLCANIC_INDUSTRIAL`) frente a eventos dinámicos de biomasa (`VEGETATION`).
- **Calibración Cruzada (2012–2024):** Ajuste estadístico derivado del período de solapamiento de ambos satélites para garantizar continuidad temporal.
- **Calendario Interactivo de Quemas:** Matriz Año × Mes (2000–2026) con paletas accesibles (*Viridis* / *YlOrRd*), comparación contra la **Mediana Histórica Multi-Anual** y exportación directa a **CSV**.

---

## Estructura del Proyecto

```text
pyrosync/
├── CLAUDE.md                  # Instrucciones y restricciones para asistentes IA
├── README.md                  # Documentación general
├── docs/
│   ├── ARCHITECTURE.md        # Arquitectura técnica y diseño UI/UX
│   ├── METHODOLOGY.md         # Fórmulas de armonización y criterios geológicos
│   └── SUPABASE_SCHEMA.md     # Esquema SQL + PostGIS
├── etl/
│   ├── requirements.txt       # pandas, numpy, supabase, python-dotenv
│   ├── harmonize.py           # Pipeline de limpieza, grilla 1km y calibración
│   └── upload_supabase.py     # Carga masiva a PostgreSQL
└── web/                       # Aplicación Next.js (App Router + Tailwind + PostGIS)
```

---

## Inicio Rápido

### 1. Base de Datos (Supabase)
1. Crear un proyecto en [Supabase](https://supabase.com).
2. Ejecutar el script completo de `docs/SUPABASE_SCHEMA.md` en el **SQL Editor**.
3. Ejecutar luego, en orden, los scripts de `etl/sql/` (`002` … `005`): variables ambientales, seguridad, tablas ambientales reales y catálogo de regiones.

### 2. Pipeline ETL (Python)
1. Descargar los archivos históricos CSV de **MODIS C6.1** y **VIIRS S-NPP** desde [NASA FIRMS Country Archive](https://firms.modaps.eosdis.nasa.gov/country/) y guardarlos en `etl/raw_data/`.
2. Ejecutar:
```bash
cd etl
pip install -r requirements.txt
python fetch_firms.py          # trae de la API de FIRMS los días que faltan (requiere FIRMS_MAP_KEY en etl/.env)
python harmonize.py            # --generate-sample solo para probar el pipeline (no subir a producción)
python upload_supabase.py --replace
python export_web_snapshot.py  # copia de respaldo de los datos reales en web/public/data
```
La web nunca genera datos: si Supabase no responde, lee la copia de `web/public/data`.

El histórico completo (2000–hoy) se descarga una sola vez del FIRMS Country Archive (`raw_data/`). Después,
`fetch_firms.py` completa solo los días nuevos para cada región (API de área, tramos de 10 días, versión estándar
SP si ya existe y NRT si no) y los guarda en `raw_data/firms_api_MODIS.csv` / `firms_api_VIIRS.csv`. `harmonize.py`
descarta las detecciones que aparezcan en más de un archivo.

### 3. Aplicación Web (Next.js)
```bash
cd web
npm install
cp .env.example .env.local # Configurar NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev
```

---

## Fuentes de Datos Oficiales
- **NASA FIRMS (Fire Information for Resource Management System):** MODIS Collection 6.1 (MCD14ML) y VIIRS 375m (VNP14IMGTDL_NRT / Suomi-NPP Archive).
- **Inspiración Regional:** CONAE (Comisión Nacional de Actividades Espaciales) — Casos de estudio en Delta del Paraná, Sierras de Córdoba, Patagonia Andina, Cuyo y Cuenca Neuquina.