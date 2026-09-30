import { uiText } from './localization'
import type { LngLat, Route, Waypoint } from './types'
import { isValidLngLat } from './geo'

/** Escape a string for safe inclusion in an XML attribute/text node. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Serialize a route to GPX 1.1: each waypoint becomes a `<wpt>`, and the snapped
 * geometry (or the waypoints, as a fallback) becomes a single `<trk>` segment.
 */
export function routeToGpx(route: Route): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Valley Map" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${xmlEscape(route.name)}</name></metadata>`
  ]
  route.waypoints.forEach((w, i) => {
    lines.push(`  <wpt lat="${w.lat}" lon="${w.lng}"><name>${xmlEscape(w.label || `Point ${i + 1}`)}</name></wpt>`)
  })
  const track: LngLat[] = route.geometry?.length
    ? route.geometry
    : route.waypoints.map((w) => [w.lng, w.lat])
  if (track.length > 1) {
    lines.push(`  <trk><name>${xmlEscape(route.name)}</name><trkseg>`)
    for (const [lng, lat] of track) lines.push(`    <trkpt lat="${lat}" lon="${lng}"></trkpt>`)
    lines.push('  </trkseg></trk>')
  }
  lines.push('</gpx>')
  return lines.join('\n')
}

/** Pull every `lat="…" lon="…"` pair out of a tag body (order-independent). */
function readLatLon(tag: string): LngLat | null {
  const lat = /\blat\s*=\s*"([^"]+)"/i.exec(tag)
  const lon = /\blon\s*=\s*"([^"]+)"/i.exec(tag)
  if (!lat || !lon) return null
  const la = Number(lat[1])
  const lo = Number(lon[1])
  return isValidLngLat(lo, la) ? [lo, la] : null
}

/**
 * Parse GPX text into a route shape: `<wpt>`/`<rtept>` become waypoints, and the
 * `<trkpt>` sequence becomes the geometry. Dependency-free regex parse (GPX is
 * flat XML); tolerant of attribute order and missing names.
 */
export function gpxToRoute(xml: string): { waypoints: Waypoint[]; geometry?: LngLat[] } | null {
  const waypoints: Waypoint[] = []
  const geometry: LngLat[] = []

  const ptRe = /<(wpt|rtept)\b([^>]*)>([\s\S]*?)<\/\1>|<(wpt|rtept)\b([^>]*)\/>/gi
  let m: RegExpExecArray | null
  while ((m = ptRe.exec(xml))) {
    const attrs = m[2] ?? m[5] ?? ''
    const body = m[3] ?? ''
    const pair = readLatLon(attrs)
    if (!pair) continue
    const name = /<name>([\s\S]*?)<\/name>/i.exec(body)?.[1]?.trim() ?? ''
    waypoints.push({ lng: pair[0], lat: pair[1], label: name })
  }

  const trkRe = /<trkpt\b([^>]*?)(?:\/>|>[\s\S]*?<\/trkpt>)/gi
  while ((m = trkRe.exec(xml))) {
    const pair = readLatLon(m[1] ?? '')
    if (pair) geometry.push(pair)
  }

  if (waypoints.length === 0 && geometry.length > 1) {
    const first = geometry[0]
    const last = geometry[geometry.length - 1]
    waypoints.push({ lng: first[0], lat: first[1], label: uiText('map.route.start') })
    waypoints.push({ lng: last[0], lat: last[1], label: uiText('map.route.end') })
  }
  if (waypoints.length === 0 && geometry.length === 0) return null
  return { waypoints, geometry: geometry.length > 1 ? geometry : undefined }
}
