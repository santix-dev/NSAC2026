# Metodología Científica: Transferencia de Calibración (Córdoba → Patagonia) y Modelo Multi-Sensor

## 1. Armonización MODIS (1 km) + VIIRS (375 m)
1. **Filtrado de Calidad:** MODIS `confidence >= 30`; VIIRS `confidence IN ('n', 'h')`.
2. **Enmascaramiento Geológico/Industrial:** Celdas de $0.01^\circ$ (~1 km, la misma grilla de la etapa 3) con recurrencia estacionaria (>8 años distintos o >40 días/año en promedio) se etiquetan como `VOLCANIC_INDUSTRIAL` y se excluyen del análisis de biomasa (`VEGETATION`).
   - *Decisión del equipo (opción A):* el criterio original evaluaba la persistencia en la coordenada redondeada a $0.001^\circ$, pero la geolocalización de MODIS varía cientos de metros entre pasadas y con datos reales (FIRMS MODIS C6.1, 2000–2026) no marcaba ninguna fuente. A escala de celda $0.01^\circ$ marca 17 celdas en Córdoba con 99 % de coincidencia contra las fuentes estáticas de FIRMS (`type = 2`) y ninguna en Patagonia. El criterio original sigue disponible con `harmonize.py --stationary-scale point`.
3. **Grilla Espacial Unificada (1 km):** Proyección a celdas de $0.01^\circ \times 0.01^\circ$ agrupando por `(grid_cell_id, acq_date)`. Múltiples sub-píxeles VIIRS colapsan en 1 celda-día activa.
4. **Calibración Cruzada en Sierras de Córdoba (2012–2024):**
   Dado que Córdoba posee el registro histórico más continuo y con menor interferencia nubosa, se calcula allí el factor $\alpha$:
   $$\alpha = \frac{\sum_{2012}^{2024} N_{\text{MODIS, grid}}}{\sum_{2012}^{2024} N_{\text{VIIRS, grid}}}$$
   Este coeficiente normaliza el peso de detecciones exclusivas de VIIRS (`harmonized_weight = alpha`) y se transfiere al dominio de **Patagonia Andina** para eliminar el salto artificial post-2012.
   - **Variante B (`harmonize.py --harmonization viirs-scaled`):** antes del 20-01-2012 la serie es MODIS (peso 1); desde entonces es VIIRS reescalado: `harmonized_weight = alpha` en celdas-día con VIIRS y `0` en las solo-MODIS (se conservan sus detecciones crudas). Por construcción $\alpha \cdot N_{\text{VIIRS}} = N_{\text{MODIS}}$ en la ventana de calibración, por lo que la serie empalma en nivel.
   - **Diagnóstico de continuidad** (serie armonizada / serie solo-MODIS en 2012–2024, ideal = 1,00), con datos reales FIRMS 2000–2026: fórmula original → Córdoba 1,67 · Patagonia 1,73; variante B → Córdoba 1,00 · Patagonia 1,10 (el 10 % residual mide cuánto difiere la relación MODIS/VIIRS de Patagonia respecto de la de Córdoba).
   - **Ventana efectiva de calibración:** la fórmula exige el período de observación *simultánea*. El archivo FIRMS VIIRS S-NPP (Collection 2) comienza el **20-11-2012**, por lo que el ETL toma como inicio la primera fecha con datos VIIRS (no el 01-01-2012). Con datos reales: $\alpha = 4.887 / 8.771 = 0{,}5572$ (incluir enero–noviembre de 2012 sin VIIRS lo inflaría a 0,5735).
   - **Continuidad tras el fin de Suomi-NPP (VIIRS S-NPP → NOAA-20):** FIRMS dejó de producir datos S-NPP el **02-11-2026 13:00 UTC** y recomienda NOAA-20/NOAA-21 como reemplazo directo (mismo instrumento VIIRS, misma órbita, ~50 min de diferencia). El calendario usa **una sola plataforma VIIRS por día** — S-NPP hasta el 01-11-2026 y NOAA-20 desde el 02-11-2026 — porque sumar plataformas multiplicaría las pasadas y crearía un escalón artificial, que es justamente lo que la armonización elimina. NOAA-20 se lleva a la escala de S-NPP con una calibración en cadena sobre el período en que vuelan ambos (Córdoba, celdas-día VEGETATION, desde el primer dato NOAA-20 hasta el 01-11-2026):
     $$\beta = \frac{\sum N_{\text{S-NPP, grid}}}{\sum N_{\text{NOAA-20, grid}}}, \qquad \alpha_{\text{N20}} = \alpha \cdot \beta$$
     y las celdas-día solo-VIIRS posteriores al 01-11-2026 pesan $\alpha_{\text{N20}}$. Así se conserva la misma ventana y el mismo $\alpha$ (2012–2024); sin datos de solapamiento se usa $\alpha_{\text{N20}} = \alpha$. NOAA-21 no entra en el calendario: se muestra en la capa de **tiempo casi real** de la web (últimas 72 h, NOAA-20 + NOAA-21 + MODIS, sin armonizar), cuyo objetivo es detectar, no contar.

## 2. Modelo de Susceptibilidad y Propagación en Patagonia Andina
Para cada celda de 1 km en Patagonia se calcula un **Índice de Susceptibilidad de Incendio ($ISF \in [0, 100]$)**:
$$ISF = 0.30 \cdot S_{\text{pendiente}} + 0.30 \cdot (100 - H_{\text{suelo}}) + 0.20 \cdot V_{\text{viento}} + 0.20 \cdot R_{\text{histórico}}$$
- **$S_{\text{pendiente}}$ (NASA SRTM):** Normalización de la inclinación del terreno ($0^\circ \to 0$, $\ge 30^\circ \to 100$). El fuego acelera exponencialmente cuesta arriba por precalentamiento radiativo.
- **$H_{\text{suelo}}$ (CONAE SAOCOM + NASA SMAP):** Humedad volumétrica del suelo. El radar banda L de SAOCOM penetra columnas de humo denso y nubes donde MODIS/Sentinel-2 quedan ciegos.
- **$V_{\text{viento}}$ (NASA POWER + Estaciones IoT):** Velocidad y azimut predominante (Oeste/Noroeste) que define el vector de avance probable.
- **Incertidumbre por Nubes (`cloud_cover_pct`):** Cuantifica días nublados por mes para alertar posibles sub-detecciones ópticas.

## 3. Protocolo de Prevención y Activación International Charter
- **Prevención Geográfica:**
  - *Pendiente $> 20^\circ$ + Alta carga vegetal (NDVI Sentinel-2):* Fajas cortafuegos en pie de ladera y manejo de combustible en interfaz urbano-forestal.
  - *Humedad SAOCOM/IoT $< 15\%$ + Ráfagas $> 35\text{ km/h}$:* Prohibición total de quemas y despliegue preventivo de brigadistas.
- **Activación del International Charter:** Cuando un foco armonizado supera el percentil 90 histórico en zonas de pendiente crítica y alta nubosidad, se recomienda activar el **Charter** para programar pasadas de emergencia de **SAOCOM** (radar todo-tiempo) y **Sentinel-2** (mapeo de severidad dNBR a 10 m).
## Series "Armonizada" (concordancia de prioridad) y "Combinación" — nov-2026

**Escala de prioridad por sensor** (`etl/priority_scale.py`): cada detección recibe Bajo/Medio/Alto/Extremo dentro de la escala propia de su sensor, con IP = 0,5·P(FRP/km²) + 0,5·P(ΔT 4–11 µm, día/noche) y cortes fijos P50/P80/P95 del período de referencia (MODIS 2000–2024, VIIRS S-NPP 2012–2024). Los focos con VIIRS I4 saturado reciben el contraste máximo.

**Celda concordante** (`priority_scale.cell_priority`): celda-día de 0,01° detectada por MODIS y por VIIRS (plataformas de la serie) en la que el nivel máximo de cada sensor es igual o difiere en un nivel: `|MODIS − VIIRS| ≤ 1`.

| Serie | Qué cuenta | Período |
|---|---|---|
| **Armonizada** | celdas concordantes | nov-2012 → hoy (antes no existe VIIRS para comparar) |
| **Combinación** | Σ peso (1 si MODIS, α si solo VIIRS) — la armonización por conteo de las secciones anteriores | nov-2012 → hoy |
| **MODIS** | celdas con detección MODIS | nov-2000 → hoy |

Concordancia con los datos reales (Córdoba + Patagonia): 4.014 celdas concordantes de 4.964 vistas por ambos sensores (81 %); mismo nivel 36 %; kappa ponderado 0,33 (0,39 para Aqua y VIIRS en la misma pasada). La serie Armonizada cuenta del orden de la mitad de las celdas que ve MODIS, por lo que no empalma con la serie MODIS anterior a 2012: para 2000–2012 se usa la serie MODIS. Línea base de las series que requieren VIIRS: 2013–2024.
