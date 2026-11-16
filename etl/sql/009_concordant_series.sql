-- 009: serie "Armonizada" por concordancia MODIS–VIIRS (nov-2026).
-- Cada celda-día guarda la prioridad máxima de cada sensor (etl/priority_scale.py) y si concuerdan:
--   concordant = la vieron ambos sensores y |MODIS − VIIRS| ≤ 1 nivel de su propia escala.
-- El calendario devuelve concordant_cells (serie "Armonizada"); harmonized_events (peso α) pasa a ser
-- la serie "Combinación" en la app, desde nov-2012.
ALTER TABLE public.harmonized_hotspots
  ADD COLUMN IF NOT EXISTS modis_priority smallint CHECK (modis_priority BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS viirs_priority smallint CHECK (viirs_priority BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS concordant boolean;

DROP FUNCTION IF EXISTS public.get_burning_calendar_env(double precision, double precision, double precision, double precision, boolean);

CREATE FUNCTION public.get_burning_calendar_env(
  min_lon double precision, min_lat double precision, max_lon double precision, max_lat double precision,
  exclude_non_fire boolean DEFAULT true)
RETURNS TABLE(year integer, month integer, harmonized_events double precision, raw_events bigint, active_cells bigint,
              avg_frp double precision, avg_cloud_cover double precision, avg_soil_moisture double precision,
              avg_slope double precision, avg_wind_speed double precision, avg_wind_direction double precision,
              avg_ndvi double precision, modis_cells bigint, viirs_cells bigint, both_cells bigint,
              concordant_cells bigint)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    h.year,
    h.month,
    ROUND(SUM(h.harmonized_weight)::numeric, 1)::double precision,
    SUM(h.raw_detections_count)::bigint,
    COUNT(*)::bigint,
    ROUND(AVG(h.max_frp)::numeric, 2)::double precision,
    ROUND(AVG(h.cloud_cover_pct)::numeric, 1)::double precision,
    ROUND(AVG(h.soil_moisture_pct)::numeric, 1)::double precision,
    ROUND(AVG(h.slope_deg)::numeric, 1)::double precision,
    ROUND(AVG(h.wind_speed_kmh)::numeric, 1)::double precision,
    ROUND(MOD((DEGREES(ATAN2(AVG(SIN(RADIANS(h.wind_direction_deg))),
                             AVG(COS(RADIANS(h.wind_direction_deg))))) + 360)::numeric, 360), 0)::double precision,
    ROUND(AVG(h.ndvi_pre_fire)::numeric, 3)::double precision,
    COUNT(*) FILTER (WHERE h.sensor_source IN ('MODIS', 'BOTH'))::bigint,
    COUNT(*) FILTER (WHERE h.sensor_source IN ('VIIRS', 'BOTH'))::bigint,
    COUNT(*) FILTER (WHERE h.sensor_source = 'BOTH')::bigint,
    -- NULL mientras la columna no se haya cargado (la app usa entonces la copia estática)
    CASE WHEN COUNT(h.concordant) = 0 THEN NULL ELSE COUNT(*) FILTER (WHERE h.concordant)::bigint END
  FROM harmonized_hotspots h
  WHERE h.geom && ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)
    AND (NOT exclude_non_fire OR h.thermal_type = 'VEGETATION')
  GROUP BY h.year, h.month
  ORDER BY h.year, h.month;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_burning_calendar_env(double precision, double precision, double precision, double precision, boolean) TO anon, authenticated;
