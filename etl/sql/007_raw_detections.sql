-- 007: detecciones originales de FIRMS (sin grilla ni pesos) para verlas en el mapa por sensor.
-- Las carga etl/upload_supabase.py desde etl/raw_detections.csv (harmonize.py).
CREATE TABLE IF NOT EXISTS public.raw_detections (
  id bigserial PRIMARY KEY,
  region text NOT NULL,
  acq_date date NOT NULL,
  acq_time text,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  sensor text NOT NULL CHECK (sensor IN ('MODIS', 'VIIRS')),
  platform text,
  confidence text,
  frp double precision,
  thermal_type text NOT NULL DEFAULT 'VEGETATION',
  in_calendar boolean NOT NULL DEFAULT true,
  geom extensions.geometry(Point, 4326) GENERATED ALWAYS AS (extensions.ST_SetSRID(extensions.ST_MakePoint(lon, lat), 4326)) STORED
);
CREATE INDEX IF NOT EXISTS raw_detections_geom_idx ON public.raw_detections USING gist (geom);
CREATE INDEX IF NOT EXISTS raw_detections_date_idx ON public.raw_detections (acq_date);

ALTER TABLE public.raw_detections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read access" ON public.raw_detections;
CREATE POLICY "Allow public read access" ON public.raw_detections FOR SELECT TO anon, authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.raw_detections FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_raw_detections(
  min_lon double precision, min_lat double precision, max_lon double precision, max_lat double precision,
  start_date date, end_date date, sensor_filter text DEFAULT NULL, exclude_non_fire boolean DEFAULT true)
RETURNS TABLE(acq_date date, acq_time text, lat double precision, lon double precision, sensor text, platform text,
              confidence text, frp double precision, thermal_type text, in_calendar boolean)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT r.acq_date, r.acq_time, r.lat, r.lon, r.sensor, r.platform, r.confidence, r.frp, r.thermal_type, r.in_calendar
  FROM raw_detections r
  WHERE r.geom && ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)
    AND r.acq_date BETWEEN start_date AND end_date
    AND (sensor_filter IS NULL OR r.sensor = sensor_filter)
    AND (NOT exclude_non_fire OR r.thermal_type = 'VEGETATION')
  ORDER BY r.acq_date, r.acq_time, r.id;
$function$;

GRANT EXECUTE ON FUNCTION public.get_raw_detections(double precision, double precision, double precision, double precision, date, date, text, boolean) TO anon, authenticated;
