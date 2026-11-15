/** Clave de región del catálogo (tabla regions) o "CUSTOM" para un área definida por el usuario. */
export type RegionKey = string;
export type StudyRegion = string;

export interface Region {
  key: string;
  name: string;
  subtitle: string | null;
  role: string | null;
  country: string;
  bbox: BBox;
  isCalibration: boolean;
  calibrationRegion: string | null;
  defaultYear: number | null;
}

/** [min_lon, min_lat, max_lon, max_lat] (EPSG:4326) */
export type BBox = [number, number, number, number];

export type SensorSource = "MODIS" | "VIIRS" | "BOTH";
export type ThermalType = "VEGETATION" | "VOLCANIC_INDUSTRIAL";
export type EnvSource = "AUX" | "PARAMETRIC" | "MIXED";
/** supabase = base en vivo · snapshot = copia estática de los mismos datos reales (respaldo) */
export type DataSource = "supabase" | "snapshot";
export type Palette = "viridis" | "ylorrd";
/**
 * Serie que se muestra: armonizada (α), cada sensor por separado (celdas-día con detección de
 * ese sensor, la unidad con la que se calibra α) o cruda (detecciones sumadas de ambos).
 */
export type SeriesMode = "harmonized" | "modis" | "viirs" | "raw";

/** Fila de harmonized_hotspots (celda 0.01° × día) — ver etl/harmonize.py */
export interface HotspotRecord {
  grid_cell_id: string;
  region: StudyRegion | null;
  acq_date: string; // YYYY-MM-DD
  lat: number;
  lon: number;
  harmonized_weight: number;
  raw_detections_count: number;
  sensor_source: SensorSource;
  max_frp: number | null;
  thermal_type: ThermalType;
  slope_deg: number | null;
  soil_moisture_pct: number | null;
  cloud_cover_pct: number | null;
  wind_speed_kmh: number | null;
  wind_direction_deg: number | null;
  ndvi_pre_fire: number | null;
  /** Viento máximo diario a 10 m (NASA POWER WS10M_MAX). null si no se cargó. */
  wind_max_kmh: number | null;
  env_source: EnvSource | null;
}

/** Promedios reales sobre toda una región de estudio para un mes (tabla region_month_env). */
export interface RegionMonthEnv {
  region: StudyRegion;
  year: number;
  month: number;
  cloud_cover_pct: number | null;
  ndvi: number | null;
  soil_moisture_pct: number | null;
  wind_speed_kmh: number | null;
  wind_direction_deg: number | null;
  wind_max_kmh: number | null;
}

/** Climatología mensual real en celdas de 0.05° (tabla env_grid_clim). */
export interface EnvGridCell {
  cell_id: string;
  month: number;
  region: StudyRegion;
  lat: number;
  lon: number;
  slope_deg: number | null;
  cloud_cover_pct: number | null;
  ndvi: number | null;
  soil_moisture_pct: number | null;
  wind_speed_kmh: number | null;
  wind_max_kmh: number | null;
}

/** Celda del Calendario de Actividad de Quemas (año × mes) */
export interface CalendarCell {
  year: number;
  month: number; // 1..12
  has_coverage: boolean; // false antes de MODIS (nov-2000) o después del último dato
  harmonized_events: number;
  raw_events: number;
  active_cells: number;
  avg_frp: number | null;
  avg_cloud_cover: number | null;
  cloud_from_model: boolean; // true si la nubosidad NO viene de las celdas con focos del mes
  cloud_origin: "cells" | "region" | null; // celdas con focos · promedio regional MODIS · sin dato
  avg_soil_moisture: number | null;
  avg_slope: number | null;
  avg_wind_speed: number | null;
  avg_wind_direction: number | null;
  avg_ndvi: number | null;
  /** Celdas-día con detección MODIS (MODIS o BOTH) / VIIRS (VIIRS o BOTH) / ambos; null si la base aún no los devuelve */
  modis_cells: number | null;
  viirs_cells: number | null;
  both_cells: number | null;
}

export interface CalendarResult {
  cells: CalendarCell[];
  source: DataSource;
  warning?: string;
}

export interface HotspotsResult {
  rows: HotspotRecord[];
  source: DataSource;
  truncated: boolean;
  warning?: string;
}

export interface RecurrenceCell {
  lat_idx: number;
  lon_idx: number;
  cell_days: number;
}

export interface MonthlyBaseline {
  month: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface MapLayers {
  live: boolean;
  hotspots: boolean;
  spread: boolean;
  susceptibility: boolean;
  iot: boolean;
  wind: boolean;
  park: boolean;
  goes: boolean;
}

/** Detección original de FIRMS (sin grilla ni pesos), en su posición real. */
export interface RawDetection {
  acq_date: string;
  acq_time: string | null; // HHMM UTC
  lat: number;
  lon: number;
  sensor: "MODIS" | "VIIRS";
  platform: string | null; // Terra, Aqua, SNPP, N20, N21
  confidence: string | null;
  frp: number | null;
  thermal_type: ThermalType;
  /** true = entra en la serie armonizada (MODIS + plataforma VIIRS de referencia) */
  in_calendar: boolean;
}

export interface RawDetectionsResult {
  rows: RawDetection[];
  truncated: boolean;
  source: DataSource;
  /** false si la base todavía no tiene la tabla de detecciones originales */
  available: boolean;
}
