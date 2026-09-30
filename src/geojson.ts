import { uiText } from './localization'
import type { GeoPin, LngLat, Place, Route, Waypoint } from './types'
import { isValidLngLat } from './geo'

/** Minimal GeoJSON shapes (avoids a runtime dependency on @types/geojson). */
export interface GeoJsonGeometry {
  type: 'Point' | 'LineString' | 'Polygon'
  coordinates: LngLat | LngLat[] | LngLat[][]
}
export interface GeoJsonFeature {
  type: 'Feature'
  geometry: GeoJsonGeometry
  properties: Record<string, unknown>
}
export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJsonFeature[]
}

export function pointFeature(
  lng: number,
  lat: number,
  properties: Record<string, unknown> = {}
): GeoJsonFeature {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties }
}

export function lineFeature(
  coords: LngLat[],
  properties: Record<string, unknown> = {}
): GeoJsonFeature {
  return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties }
}

export function polygonFeature(
  ring: LngLat[],
  properties: Record<string, unknown> = {}
): GeoJsonFeature {
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties }
}

export function emptyCollection(): GeoJsonFeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

export function placesToFeatureCollection(places: Place[]): GeoJsonFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: places.map((p) =>
      pointFeature(p.lng, p.lat, { id: p.id, name: p.name, color: p.color ?? null })
    )
  }
}

export function pinsToFeatureCollection(pins: GeoPin[]): GeoJsonFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pins.map((p) => pointFeature(p.lng, p.lat, { relPath: p.relPath, title: p.title }))
  }
}

/** A route as a FeatureCollection: the snapped LineString + a Point per waypoint. */
export function routeToFeatureCollection(route: Route): GeoJsonFeatureCollection {
  const features: GeoJsonFeature[] = []
  if (route.geometry && route.geometry.length > 1) {
    features.push(
      lineFeature(route.geometry, { name: route.name, mode: route.mode, kind: 'route' })
    )
  }
  route.waypoints.forEach((w, i) => {
    features.push(pointFeature(w.lng, w.lat, { label: w.label, index: i, kind: 'waypoint' }))
  })
  return { type: 'FeatureCollection', features }
}

function coordPair(value: unknown): LngLat | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const lng = Number(value[0])
  const lat = Number(value[1])
  return isValidLngLat(lng, lat) ? [lng, lat] : null
}

/**
 * Parse a route out of GeoJSON text. Accepts a FeatureCollection (a LineString
 * for the geometry, Points for waypoints), a bare LineString, or a bare Feature.
 * Falls back to the line's endpoints when no explicit waypoints are present.
 */
export function parseRouteFromGeoJson(
  text: string
): { waypoints: Waypoint[]; geometry?: LngLat[] } | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  if (!json || typeof json !== 'object') return null

  const geometries: GeoJsonGeometry[] = []
  const root = json as { type?: string; geometry?: GeoJsonGeometry; features?: unknown[] }
  if (root.type === 'FeatureCollection' && Array.isArray(root.features)) {
    for (const f of root.features) {
      const g = (f as { geometry?: GeoJsonGeometry })?.geometry
      if (g && (g.type === 'LineString' || g.type === 'Point')) geometries.push(g)
    }
  } else if (root.type === 'Feature' && root.geometry) {
    geometries.push(root.geometry)
  } else if (root.type === 'LineString' || root.type === 'Point') {
    geometries.push(json as GeoJsonGeometry)
  }

  let geometry: LngLat[] | undefined
  const waypoints: Waypoint[] = []
  for (const g of geometries) {
    if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
      const line: LngLat[] = []
      for (const c of g.coordinates as unknown[]) {
        const pair = coordPair(c)
        if (pair) line.push(pair)
      }
      if (line.length > 1) geometry = line
    } else if (g.type === 'Point') {
      const pair = coordPair(g.coordinates)
      if (pair) waypoints.push({ lng: pair[0], lat: pair[1], label: '' })
    }
  }

  if (waypoints.length === 0 && geometry && geometry.length > 1) {
    const first = geometry[0]
    const last = geometry[geometry.length - 1]
    waypoints.push({ lng: first[0], lat: first[1], label: uiText('map.route.start') })
    waypoints.push({ lng: last[0], lat: last[1], label: uiText('map.route.end') })
  }
  if (waypoints.length === 0 && !geometry) return null
  return { waypoints, geometry }
}

/** Serialize a route to pretty GeoJSON text for export. */
export function routeToGeoJsonText(route: Route): string {
  return JSON.stringify(routeToFeatureCollection(route), null, 2)
}
