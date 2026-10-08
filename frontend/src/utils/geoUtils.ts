/**
 * Utilidades de cálculo geoespacial (Fórmula de Haversine)
 */

export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Radio de la Tierra en metros
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

// Altitud base de referencia del suelo en Bogotá (Campus UNAL / Sabana: ~2.580 m s.n.m.)
export const DEFAULT_BOGOTA_GROUND_ALTITUDE = 2580;
export const METERS_PER_FLOOR = 3.2;

/**
 * Calcula el número aproximado de piso de un edificio según la altura relativa sobre el suelo.
 */
export function getFloorFromRelativeAltitude(relativeMeters: number): number {
  if (relativeMeters <= 2) return 0; // Nivel del suelo / Planta Baja
  return Math.max(1, Math.round(relativeMeters / METERS_PER_FLOOR));
}

/**
 * Formatea una descripción legible de altitud para tarjetas, mapas y modales.
 */
export function formatAltitudeLabel(altitude?: number, relativeAltitude?: number): string {
  const alt = altitude ?? DEFAULT_BOGOTA_GROUND_ALTITUDE;
  const rel = relativeAltitude ?? Math.max(0, alt - DEFAULT_BOGOTA_GROUND_ALTITUDE);

  if (rel >= 4) {
    const floor = getFloorFromRelativeAltitude(rel);
    return `+${Math.round(rel)}m • Edificio (Piso ${floor})`;
  }

  return `${Math.round(alt)}m • Nivel Suelo`;
}

/**
 * Determina si la altitud califica como "elevada / en edificio" y retorna su descriptor.
 */
export function getAltitudeStatus(relativeAltitude?: number): {
  isElevated: boolean;
  floor: number;
  tag: string;
} {
  const rel = relativeAltitude ?? 0;
  const isElevated = rel >= 4;
  const floor = getFloorFromRelativeAltitude(rel);

  return {
    isElevated,
    floor,
    tag: isElevated ? `Piso ${floor} (+${Math.round(rel)}m)` : 'Nivel Calle',
  };
}
