# CLAUDE.md — Contexto y Reglas del Proyecto (NASA Space Apps 2026)

## 1. Identidad y Estrategia Científica
- **Nombre:** Foco Cero (antes PyroSync). Logo: `web/public/brand/` (isotipo SVG para tema oscuro + logo original).
- **Desafío:** NASA Space Apps Challenge 2026 — *Harmonization of MODIS and VIIRS Hot Spots* (en colaboración con CONAE).
- **Enfoque Dual (Calibración + Operación):**
  1. **Calibración Histórica (Sierras de Córdoba, Argentina):** Se utiliza el registro histórico completo (2000–2026) y de baja nubosidad de Córdoba para calcular el factor empírico de armonización espacial/radiométrica ($\alpha$) entre MODIS (1 km) y VIIRS (375 m) en la ventana de solapamiento 2012–2024.
  2. **Foco Interactivo Principal (Patagonia Andina — Comarca Andina / PN Los Alerces):** El mapa interactivo abre por defecto en Patagonia, aplicando el modelo armonizado junto con variables físicas (pendiente SRTM, humedad de suelo SAOCOM/SMAP, viento, cobertura de nubes, severidad Sentinel-2, red de sensores IoT en campo) para visualizar hacia dónde avanzó el fuego, zonas propensas, métodos de prevención y protocolo **International Charter**.

## 2. Equipo y Reglas de Arquitectura
- **Equipo:** 2 Desarrolladores Backend + 1 Geólogo.
- **Arquitectura Zero-Friction:** Todo el procesamiento ETL ocurre offline en Python. Los datos armonizados y capas ambientales se almacenan en **Supabase (PostgreSQL + PostGIS)**. El frontend en **Next.js (App Router)** consulta directamente vía Supabase RPC y despliega en Vercel. **Excepción acordada (nov-2026):** la capa de focos en tiempo casi real se sirve desde la ruta de servidor `web/src/app/api/firms-live` (FIRMS NRT NOAA-20/21 + MODIS, key solo en el servidor, caché 15 min); no se armoniza ni alimenta el calendario. También se muestran mosaicos de imagen GOES-19 (GOES-Este) de NASA GIBS directamente en el mapa, como el mapa base.
- **Sensores y Fuentes Obligatorias a Citar y Modelar:**
  - **NASA FIRMS:** MODIS C6.1 (1 km) + VIIRS 375 m (S-NPP hasta 01-11-2026; NOAA-20 desde 02-11-2026; NOAA-21 en tiempo real).
  - **NASA SRTM:** Inclinación del terreno / pendiente (`slope_deg`).
  - **CONAE SAOCOM (Banda L) + NASA SMAP:** Humedad del suelo penetrando humo y nubes (`soil_moisture_pct`).
  - **ESA Sentinel-2:** Severidad de área quemada (dNBR) y vegetación previa (NDVI) a 10 m.
  - **NASA POWER / MERRA-2:** Velocidad y dirección del viento (`wind_speed_kmh`, `wind_direction_deg`).
  - **MODIS Cloud Mask:** Porcentaje de cobertura nubosa (`cloud_cover_pct`) para cuantificar incertidumbre óptica.
  - **Red de Sensores Terrestres (IoT):** Estaciones meteorológicas/suelo en valles patagónicos.
  - **International Charter (Space & Major Disasters):** Protocolo de activación satelital de emergencia.

## 3. Convenciones UI/UX y Requisitos del Hackathon
- **Tema:** Oscuro técnico (`bg-slate-950`, tarjetas `bg-slate-900 border-slate-800`).
- **Accesibilidad:** Calendario de Actividad de Quemas (2000–2026) con paleta colorblind-safe **Viridis** por defecto (opción secundaria **YlOrRd**).
- **Transparencia:** Incluir modal visible con metodología multi-agencia y declaración explícita de uso de IA (Claude).
- **Fallback:** `web/src/lib/fireService.ts` debe conectar a Supabase RPC y contar con datos científicos realistas en memoria si no hay conexión a DB.