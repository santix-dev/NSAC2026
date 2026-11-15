# Arquitectura del Sistema y Diseño UI/UX

## 1. Diagrama de Flujo de Datos

```text
[NASA FIRMS ARCHIVE CSVs]
   ├── modis_2000_2026.csv (1 km)
   └── viirs_2012_2026.csv (375 m)
            │
            ▼  (Offline ETL - Python)
[etl/harmonize.py]
   ├── 1. Filtro de confianza (MODIS >= 30, VIIRS != 'l')
   ├── 2. Clasificación Geológica (Persistencia estacionaria -> VOLCANIC_INDUSTRIAL)
   ├── 3. Agregación Espacial (Grilla 0.01° × 0.01° por día)
   └── 4. Calibración Cruzada (Factor alpha 2012-2024)
            │
            ▼
[SUPABASE (PostgreSQL + PostGIS)]
   ├── Tabla: harmonized_hotspots (Índice espacial GIST)
   ├── RPC: get_burning_calendar(min_lon, min_lat, max_lon, max_lat, exclude_non_fire)
   └── RPC: get_hotspots_export(min_lon, min_lat, max_lon, max_lat, start_year, end_year, exclude_non_fire)
            │
            ▼
[NEXT.JS FRONTEND (Vercel)]
   ├── ControlBar (Presets regionales, Toggles Armonización/Geología, Export CSV)
   ├── MapSelector (Mapa interactivo BBox + Inputs Lat/Lon)
   ├── KpiStrip (Total eventos, Mes pico, Anomalía vs. Mediana)
   ├── BurnCalendar (Matriz Heatmap 2000-2026 × Ene-Dic con escala Viridis)
   └── AnomalyChart (Barras año activo vs. Línea Mediana Histórica + Banda P25-P75)
```

---

## 2. Estructura de Componentes Frontend (`web/src/`)

```text
web/src/
├── app/
│   ├── layout.tsx                 # Tema oscuro slate-950, tipografía Inter/JetBrains Mono
│   └── page.tsx                   # Estado global del AOI (Bounding Box), filtros y año seleccionado
├── components/
│   ├── HeaderBar.tsx              # Logo Foco Cero, selector de Presets y botón Exportar CSV
│   ├── FilterControls.tsx         # Switches: [Serie Armonizada] y [Filtro Geológico]
│   ├── MapSelector.tsx            # Mapa Leaflet con rectángulo BBox editable + inputs manuales Lat/Lon
│   ├── KpiCards.tsx               # 3 tarjetas métricas resumen del área seleccionada
│   ├── BurnCalendar.tsx           # Heatmap Año × Mes (2000-2026) con selector Viridis / YlOrRd
│   └── AnomalyChart.tsx           # Gráfico Recharts: Año seleccionado vs. Mediana Histórica
├── lib/
│   ├── supabase.ts                # Inicialización cliente Supabase
│   ├── fireService.ts             # Llamadas RPC + cálculo de medianas/percentiles + fallback mock
│   └── presets.ts                 # Coordenadas predefinidas de regiones críticas
└── types/
    └── fire.ts                    # Interfaces TypeScript compartidas
```

---

## 3. Regiones Predefinidas (`web/src/lib/presets.ts`)

Incluir estos 5 Bounding Boxes (`[min_lon, min_lat, max_lon, max_lat]`) para demostración inmediata:
1. **Delta del Paraná (Argentina):** `[-60.85, -34.20, -58.30, -32.00]` — Humedales con quemas recurrentes y picos extremos (2008, 2020).
2. **Sierras de Córdoba (Argentina):** `[-65.20, -32.60, -64.00, -30.80]` — Interfaz urbano-forestal crítica de primavera.
3. **Patagonia Andina — Comarca Paralelo 42 (Argentina):** `[-71.80, -42.50, -71.10, -41.70]` — Bosque andino-patagónico de alta severidad.
4. **Valles Agrícolas de Cuyo — San Juan / Mendoza:** `[-69.00, -33.20, -68.10, -31.30]` — Quemas agrícolas controladas y borde árido.
5. **Cuenca Neuquina — Vaca Muerta (Demo Filtro Geológico):** `[-69.60, -38.80, -68.40, -37.80]` — Ideal para encender/apagar el switch geológico y observar la remoción de *gas flares* estacionarios.

---

## 4. Interacciones Clave de Usuario (UX)
1. **Selección de AOI:** El usuario elige un *Preset*, dibuja un rectángulo en el mapa o escribe `Lat Min/Max` y `Lon Min/Max`. Automáticamente se invoca `get_burning_calendar`.
2. **Inspección Temporal:** Hacer clic en cualquier fila (año) del **Calendario de Actividad de Quemas** actualiza el gráfico inferior de **Comparación vs. Mediana Histórica** para ese año.
3. **Exportación:** El botón **Descargar CSV** ejecuta `get_hotspots_export` y genera un archivo `.csv` estándar con columnas limpias (`grid_cell_id, acq_date, lat, lon, harmonized_weight, raw_detections_count, sensor_source, max_frp, thermal_type`).