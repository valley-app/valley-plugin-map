import type { IndexEntry } from '@valley/plugin-sdk/types'
import type { GeoPin } from './types'
import { isValidLngLat } from './geo'

/** Coerce a value to a finite number (accepting numeric strings), else null. */
function coerceNum(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.trim())
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Parse a combined "lat,lng" coordinate value — a string like "47.37, 8.54" or
 * a two-element `[lat, lng]` array, or an object with latitude/longitude aliases
 * (the human/Google-Maps convention, latitude first). Returns a geographically
 * valid `{ lat, lng }` or null.
 */
export function parseLatLngPair(value: unknown): { lat: number; lng: number } | null {
  let parts: unknown[] | null = null
  if (typeof value === 'string') {
    parts = value.trim().split(/\s*[,;/|]\s*|\s+/).filter(Boolean)
  } else if (Array.isArray(value)) {
    parts = value
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    parts = [record.lat ?? record.latitude, record.lng ?? record.lon ?? record.long ?? record.longitude]
  }
  if (!parts || parts.length !== 2) return null
  const lat = coerceNum(parts[0])
  const lng = coerceNum(parts[1])
  if (lat === null || lng === null || !isValidLngLat(lng, lat)) return null
  return { lat, lng }
}

/**
 * Extract `{ lat, lng }` from a note's frontmatter, tolerating the common
 * spellings: explicit `lat`/`latitude` + `lng`/`lon`/`long`/`longitude`, or a
 * combined `location`/`geo`/`coordinates`/`coords` "lat,lng" value.
 */
export function geoFromFrontmatter(
  fm: Record<string, unknown> | undefined
): { lat: number; lng: number } | null {
  if (!fm) return null

  const lat = coerceNum(fm.lat ?? fm.latitude)
  const lng = coerceNum(fm.lng ?? fm.lon ?? fm.long ?? fm.longitude)
  if (lat !== null && lng !== null && isValidLngLat(lng, lat)) return { lat, lng }

  for (const key of ['location', 'geo', 'coordinates', 'coords', 'latlng']) {
    const pair = parseLatLngPair(fm[key])
    if (pair && isValidLngLat(pair.lng, pair.lat)) return pair
  }
  return null
}

/**
 * Plot every non-excluded note carrying coordinate frontmatter as a pin. Pure —
 * the renderer feeds the store's scoped index entries.
 */
export function parseGeoPins(entries: IndexEntry[]): GeoPin[] {
  const pins: GeoPin[] = []
  for (const entry of entries) {
    if (entry.excluded || entry.kind !== 'note') continue
    const geo = geoFromFrontmatter(entry.frontmatter)
    if (!geo) continue
    pins.push({ relPath: entry.relPath, title: entry.title, lng: geo.lng, lat: geo.lat })
  }
  return pins
}
