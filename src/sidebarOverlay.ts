import type { LngLat } from './types'

export type OverlayMarkerKind = 'origin' | 'destination' | 'station' | 'change'
/** A sidebar tab's overlay after validation: fresh arrays, bounded sizes, finite WGS84 coordinates. */
export type SidebarOverlay = {
  paths: { points: LngLat[]; stops: LngLat[]; color?: string }[]
  markers: { lng: number; lat: number; kind: OverlayMarkerKind; label?: string }[]
  color?: string
  fit: string
}

const MAX_PATHS = 8, MAX_POINTS = 2000, MAX_STOPS = 500, MAX_MARKERS = 64
const KINDS: readonly OverlayMarkerKind[] = ['origin', 'destination', 'station', 'change']

const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const color = (value: unknown): string | undefined => typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : undefined
const valid = (lng: unknown, lat: unknown): lng is number => typeof lng === 'number' && typeof lat === 'number' && Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90
function points(value: unknown, maximum: number): LngLat[] {
  if (!Array.isArray(value)) return []
  const result: LngLat[] = []
  for (const entry of value.slice(0, maximum)) if (Array.isArray(entry) && valid(entry[0], entry[1])) result.push([entry[0], entry[1] as number])
  return result
}

/**
 * The `overlay` of a `map.sidebarTab` snapshot, or `null` when it holds nothing
 * drawable. Everything is copied, so nothing of the provider's objects reaches the map.
 */
export function normalizeSidebarOverlay(raw: unknown): SidebarOverlay | null {
  const value = record(raw)
  if (!value) return null
  const overlayColor = color(value.color)
  const paths = (Array.isArray(value.paths) ? value.paths.slice(0, MAX_PATHS) : []).flatMap(entry => {
    const path = record(entry)
    const line = points(path?.points, MAX_POINTS)
    if (!path || line.length < 2) return []
    const pathColor = color(path.color)
    return [{ points: line, stops: points(path.stops, MAX_STOPS), ...(pathColor ? { color: pathColor } : {}) }]
  })
  const markers = (Array.isArray(value.markers) ? value.markers.slice(0, MAX_MARKERS) : []).flatMap(entry => {
    const marker = record(entry)
    if (!marker || !valid(marker.lng, marker.lat)) return []
    const kind = KINDS.includes(marker.kind as OverlayMarkerKind) ? marker.kind as OverlayMarkerKind : 'station'
    const label = typeof marker.label === 'string' && marker.label.trim() ? marker.label.trim().slice(0, 80) : undefined
    return [{ lng: marker.lng, lat: marker.lat as number, kind, ...(label ? { label } : {}) }]
  })
  if (!paths.length && !markers.length) return null
  const fit = typeof value.fit === 'string' ? value.fit.slice(0, 200) : ''
  return { paths, markers, ...(overlayColor ? { color: overlayColor } : {}), fit }
}

/** Every point an overlay shows, for fitting the camera. */
export function overlayPoints(overlay: SidebarOverlay): LngLat[] {
  return [...overlay.paths.flatMap(path => path.points), ...overlay.markers.map((marker): LngLat => [marker.lng, marker.lat])]
}
