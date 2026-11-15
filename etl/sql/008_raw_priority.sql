-- 008: escala de prioridad de atención por sensor en las detecciones originales.
-- Columnas calculadas por etl/priority_scale.py (vía harmonize.py → raw_detections.csv):
--   delta_t         T(4 µm) − T(11 µm) en K (sustituto del contraste con el fondo; FIRMS no trae el fondo)
--   priority_score  índice 0–100 dentro de la escala PROPIA del sensor
--   priority_level  1 Bajo · 2 Medio · 3 Alto · 4 Extremo (no comparable entre sensores)
ALTER TABLE public.raw_detections
  ADD COLUMN IF NOT EXISTS delta_t real,
  ADD COLUMN IF NOT EXISTS priority_score smallint,
  ADD COLUMN IF NOT EXISTS priority_level smallint CHECK (priority_level BETWEEN 1 AND 4);

DROP FUNCTION IF EXISTS public.get_raw_detections(double precision, double precision, double precision, double precision, date, date, text, boolean);

CREATE OR REPLACE FUNCTION public.get_raw_detections(
  min_lon double precision, min_lat double precision, max_lon double precision, max_lat double precision,
  start_date date, end_date date, sensor_filter text DEFAULT NULL, exclude_non_fire boolean DEFAULT true)
RETURNS TABLE(acq_date date, acq_time text, lat double precision, lon double precision, sensor text, platform text,
              confidence text, frp double precision, thermal_type text, in_calendar boolean,
              delta_t real, priority_score smallint, priority_level smallint)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT r.acq_date, r.acq_time, r.lat, r.lon, r.sensor, r.platform, r.confidence, r.frp, r.thermal_type, r.in_calendar,
         r.delta_t, r.priority_score, r.priority_level
  FROM raw_detections r
  WHERE r.geom && ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)
    AND r.acq_date BETWEEN start_date AND end_date
    AND (sensor_filter IS NULL OR r.sensor = sensor_filter)
    AND (NOT exclude_non_fire OR r.thermal_type = 'VEGETATION')
  ORDER BY r.acq_date, r.acq_time, r.id;
$function$;

GRANT EXECUTE ON FUNCTION public.get_raw_detections(double precision, double precision, double precision, double precision, date, date, text, boolean) TO anon, authenticated;
