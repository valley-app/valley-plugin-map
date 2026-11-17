import type { LngLat } from './types'

export type OverlayMarkerKind = 'origin' | 'destination' | 'station' | 'change'
/** A sidebar tab's overlay after validation: fresh arrays, bounded sizes, finite WGS84 coordinates. */
export type SidebarOverlay = {
  paths: { points: LngLat[]; stops: { point: LngLat; name?: string }[]; color?: string }[]
  markers: { lng: number; lat: number; kind: OverlayMarkerKind; label?: string }[]
  color?: string
  fit: string
  attribution?: string
}

const MAX_PATHS = 8, MAX_POINTS = 2000, MAX_STOPS = 500, MAX_MARKERS = 64
const KINDS: readonly OverlayMarkerKind[] = ['origin', 'destination', 'station', 'change']

const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const color = (value: unknown): string | undefined => typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : undefined
const valid = (lng: unknown, lat: unknown): lng is number => typeof lng === 'number' && typeof lat === 'number' && Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90
const label = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : undefined
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
    if (!path) return []
    // Fewer than two points draw no line; such a path still marks its stops, unconnected.
    const drawn = points(path.points, MAX_POINTS), line = drawn.length >= 2 ? drawn : []
    const pathColor = color(path.color)
    const names = Array.isArray(path.stopNames) ? path.stopNames : []
    const stops = (Array.isArray(path.stops) ? path.stops.slice(0, MAX_STOPS) : []).flatMap((entry, index) => {
      if (!Array.isArray(entry) || !valid(entry[0], entry[1])) return []
      const name = label(names[index])
      return [{ point: [entry[0], entry[1] as number] as LngLat, ...(name ? { name } : {}) }]
    })
    if (!line.length && !stops.length) return []
    return [{ points: line, stops, ...(pathColor ? { color: pathColor } : {}) }]
  })
  const markers = (Array.isArray(value.markers) ? value.markers.slice(0, MAX_MARKERS) : []).flatMap(entry => {
    const marker = record(entry)
    if (!marker || !valid(marker.lng, marker.lat)) return []
    const kind = KINDS.includes(marker.kind as OverlayMarkerKind) ? marker.kind as OverlayMarkerKind : 'station'
    const name = label(marker.label)
    return [{ lng: marker.lng, lat: marker.lat as number, kind, ...(name ? { label: name } : {}) }]
  })
  if (!paths.length && !markers.length) return null
  const fit = typeof value.fit === 'string' ? value.fit.slice(0, 200) : ''
  const attribution = typeof value.attribution === 'string' && value.attribution.trim() ? value.attribution.trim().slice(0, 120) : undefined
  return { paths, markers, ...(overlayColor ? { color: overlayColor } : {}), fit, ...(attribution ? { attribution } : {}) }
}

/** Every point an overlay shows, for fitting the camera. */
export function overlayPoints(overlay: SidebarOverlay): LngLat[] {
  return [...overlay.paths.flatMap(path => [...path.points, ...path.stops.map(stop => stop.point)]), ...overlay.markers.map((marker): LngLat => [marker.lng, marker.lat])]
}
