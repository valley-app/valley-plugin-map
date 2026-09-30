import type { LngLat } from './types'

const EARTH_RADIUS_M = 6_371_000

/** Two coordinates are "the same place" within ~10 m — enough to recognise a
 *  search hit in a saved place or a route stop. */
export const SAME_SPOT = 1e-4

/** True when `a` and `b` name the same spot (see {@link SAME_SPOT}). */
export function sameSpot(a: { lng: number; lat: number }, b: { lng: number; lat: number }): boolean {
  return Math.abs(a.lng - b.lng) < SAME_SPOT && Math.abs(a.lat - b.lat) < SAME_SPOT
}

const toRad = (deg: number): number => (deg * Math.PI) / 180

/** Great-circle distance between two `[lng, lat]` points, in metres. */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Total length of a polyline of `[lng, lat]` points, in metres. */
export function lineLengthMeters(coords: LngLat[]): number {
  let total = 0
  for (let i = 1; i < coords.length; i++) total += haversineMeters(coords[i - 1], coords[i])
  return total
}

/** Axis-aligned bounds `[sw, ne]` of a set of points, or null when empty. */
export function boundsOf(coords: LngLat[]): [LngLat, LngLat] | null {
  if (coords.length === 0) return null
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat]
  ]
}

/** Metres per degree of latitude — constant enough at any latitude for a
 *  GPS accuracy ring (the meridian varies by ~0.6% pole to equator). */
const METERS_PER_DEG_LAT = 111_320

/**
 * A closed ring approximating a circle of `radiusMeters` around a point.
 *
 * Drawn as a real polygon rather than a `circle-radius` paint expression because
 * an accuracy ring is a *ground* distance: a pixel radius would have to be
 * re-derived on every zoom frame, and would still be wrong the moment the map is
 * pitched. A polygon is simply in the map's coordinate space and needs no upkeep.
 *
 * The longitude step is divided by cos(lat) so the ring stays circular on the
 * ground instead of stretching into an ellipse away from the equator; near the
 * poles that divisor is floored, where a metre of longitude stops being a
 * meaningful quantity at all.
 */
export function circleRing(center: LngLat, radiusMeters: number, steps = 64): LngLat[] {
  const [lng, lat] = center
  const dLat = radiusMeters / METERS_PER_DEG_LAT
  const dLng = radiusMeters / (METERS_PER_DEG_LAT * Math.max(0.01, Math.cos(toRad(lat))))
  const ring: LngLat[] = []
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI
    ring.push([lng + dLng * Math.cos(angle), lat + dLat * Math.sin(angle)])
  }
  return ring
}

/** True when lng ∈ [-180,180] and lat ∈ [-90,90] and both are finite. */
export function isValidLngLat(lng: number, lat: number): boolean {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  )
}
