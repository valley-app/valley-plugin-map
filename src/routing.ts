import { withMapRequest, type MapRequest } from './requests'
import type { LngLat, MapSettings, RouteStep, TravelMode, Waypoint } from './types'
import { isValidLngLat } from './geo'
import { api } from './runtime'
import { effectiveRoutingProvider, parseAccountProviderChoice } from './settings'

// FOSSGIS runs one public OSRM instance per profile — the same service
// openstreetmap.org's own directions use. The `/driving/` path segment is fixed
// on all three; the profile is the host prefix.
const OSM_ROUTING = 'https://routing.openstreetmap.de'
// The old demo server: car profile only, kept as the fallback when FOSSGIS is down.
const OSRM_DEMO = 'https://router.project-osrm.org/route/v1'
const MAPBOX_DIR = 'https://api.mapbox.com/directions/v5/mapbox'

/** Raw routing result; `elevations` is aligned 1:1 with `geometry` when present. */
export interface RawRoute {
  geometry: LngLat[]
  distanceM: number
  durationS: number
  elevations?: number[]
  steps?: RouteStep[]
  /**
   * Where the router actually snapped each requested waypoint, in request order.
   * A geocoder hit is a building centroid or a POI node, so the typed coordinate
   * can sit tens of metres off the carriageway — drawing the A/B markers there
   * makes the line look like it stops short of its own pin.
   */
  snapped?: LngLat[]
  /** Set when the requested travel mode could not be honoured (car stand-in). */
  modeApproximated?: boolean
}

const coordsParam = (waypoints: Waypoint[]): string =>
  waypoints.map((w) => `${w.lng},${w.lat}`).join(';')

const OSRM_QUERY = 'overview=full&geometries=geojson&steps=true'

/** FOSSGIS host serving `mode`: walking → foot, cycling → bike, else car. */
export function osrmProfileHost(mode: TravelMode): string {
  return mode === 'walking' ? 'routed-foot' : mode === 'cycling' ? 'routed-bike' : 'routed-car'
}

/** Per-mode OSRM request — a walk and a drive return genuinely different routes. */
export function osrmUrl(waypoints: Waypoint[], mode: TravelMode): string {
  return `${OSM_ROUTING}/${osrmProfileHost(mode)}/route/v1/driving/${coordsParam(waypoints)}?${OSRM_QUERY}`
}

/** Car-only demo server, used when the per-mode host cannot be reached. */
export function osrmDemoUrl(waypoints: Waypoint[]): string {
  return `${OSRM_DEMO}/driving/${coordsParam(waypoints)}?${OSRM_QUERY}`
}

async function fetchJson(waypoints: Waypoint[], mode: TravelMode, request: MapRequest, demo = false): Promise<unknown> {
  const result = await request.services.publicJson({ service: 'route', waypoints, mode, demo })
  if (result.status < 200 || result.status >= 300) throw new Error(`Routing failed (${result.status})`)
  return result.json
}

export function parseOsrmResponse(json: unknown): RawRoute | null {
  const route = (json as { routes?: unknown[] })?.routes?.[0] as
    | { geometry?: { coordinates?: unknown }; distance?: number; duration?: number }
    | undefined
  const coords = route?.geometry?.coordinates
  if (!Array.isArray(coords)) return null
  const geometry: LngLat[] = []
  for (const c of coords) {
    if (Array.isArray(c) && isValidLngLat(Number(c[0]), Number(c[1]))) {
      geometry.push([Number(c[0]), Number(c[1])])
    }
  }
  if (geometry.length < 2) return null
  return {
    geometry,
    distanceM: Number(route?.distance ?? 0),
    durationS: Number(route?.duration ?? 0),
    steps: parseOsrmSteps(json),
    snapped: parseOsrmWaypoints(json)
  }
}

/**
 * The snapped positions from an OSRM/Mapbox Directions response's top-level
 * `waypoints[].location`. Pure.
 *
 * All-or-nothing on purpose: a partial list would pair snapped and typed
 * coordinates by index and put *some* markers in the wrong place, which is worse
 * than leaving every marker on the coordinate the user chose.
 */
export function parseOsrmWaypoints(json: unknown): LngLat[] | undefined {
  const waypoints = (json as { waypoints?: unknown })?.waypoints
  if (!Array.isArray(waypoints) || waypoints.length === 0) return undefined
  const out: LngLat[] = []
  for (const w of waypoints) {
    const location = (w as { location?: unknown })?.location
    if (!Array.isArray(location)) return undefined
    const [lng, lat] = location
    // `typeof`, not `Number()`: `Number(null)` is 0, a perfectly valid longitude
    // that `isValidLngLat` would wave through and drop the marker in the ocean.
    if (typeof lng !== 'number' || typeof lat !== 'number' || !isValidLngLat(lng, lat)) return undefined
    out.push([lng, lat])
  }
  return out
}

/** Synthesize a human instruction from an OSRM/Mapbox maneuver (OSRM omits text). */
export function osrmManeuverText(
  maneuver: { type?: unknown; modifier?: unknown } | undefined,
  name?: string
): string {
  const type = String(maneuver?.type ?? '').trim()
  const modifier = String(maneuver?.modifier ?? '').trim()
  const onto = name ? ` onto ${name}` : ''
  switch (type) {
    case 'depart':
      return name ? `Head out on ${name}` : 'Head out'
    case 'arrive':
      return 'Arrive at your destination'
    case 'turn':
      return `Turn ${modifier || 'ahead'}${onto}`
    case 'fork':
      return `Keep ${modifier || 'ahead'}${onto}`
    case 'merge':
      return `Merge${modifier ? ` ${modifier}` : ''}${onto}`
    case 'roundabout':
    case 'rotary':
      return `Take the roundabout${onto}`
    case 'on ramp':
      return `Take the ramp${modifier ? ` on the ${modifier}` : ''}${onto}`
    case 'off ramp':
      return `Take the exit${modifier ? ` on the ${modifier}` : ''}${onto}`
    case 'end of road':
      return `Turn ${modifier || 'ahead'}${onto}`
    case 'continue':
    case 'new name':
      return name ? `Continue onto ${name}` : 'Continue'
    default:
      return name ? `Continue onto ${name}` : 'Continue'
  }
}

/** Parse turn-by-turn steps from an OSRM/Mapbox Directions response. Pure. */
export function parseOsrmSteps(json: unknown): RouteStep[] | undefined {
  const legs = (json as { routes?: Array<{ legs?: unknown[] }> })?.routes?.[0]?.legs
  if (!Array.isArray(legs)) return undefined
  const out: RouteStep[] = []
  for (const leg of legs) {
    const steps = (leg as { steps?: unknown[] })?.steps
    if (!Array.isArray(steps)) continue
    for (const s of steps) {
      const step = s as {
        maneuver?: { type?: unknown; modifier?: unknown; instruction?: unknown }
        name?: unknown
        distance?: unknown
        duration?: unknown
      }
      const name = String(step.name ?? '').trim() || undefined
      // Mapbox provides a ready instruction; OSRM does not — synthesize it.
      const provided = String(step.maneuver?.instruction ?? '').trim()
      const instruction = provided || osrmManeuverText(step.maneuver, name)
      out.push({
        instruction,
        distanceM: Number(step.distance ?? 0),
        durationS: Number(step.duration ?? 0),
        name
      })
    }
  }
  return out.length ? out : undefined
}

/** Parse turn-by-turn steps from an OpenRouteService GeoJSON response. Pure. */
export function parseOrsSteps(json: unknown): RouteStep[] | undefined {
  const segments = (json as { features?: Array<{ properties?: { segments?: unknown[] } }> })
    ?.features?.[0]?.properties?.segments
  if (!Array.isArray(segments)) return undefined
  const out: RouteStep[] = []
  for (const seg of segments) {
    const steps = (seg as { steps?: unknown[] })?.steps
    if (!Array.isArray(steps)) continue
    for (const s of steps) {
      const step = s as { instruction?: unknown; name?: unknown; distance?: unknown; duration?: unknown }
      const instruction = String(step.instruction ?? '').trim()
      if (!instruction) continue
      const name = String(step.name ?? '').trim()
      out.push({
        instruction,
        distanceM: Number(step.distance ?? 0),
        durationS: Number(step.duration ?? 0),
        name: name && name !== '-' ? name : undefined
      })
    }
  }
  return out.length ? out : undefined
}

/**
 * OpenRouteService reports its snap points as `way_points` — *indices into the
 * geometry*, not coordinates. Resolving them keeps the markers consistent when
 * the user switches provider in settings; without it they visibly jump. Pure.
 */
export function parseOrsWaypoints(json: unknown, geometry: LngLat[]): LngLat[] | undefined {
  const indices = (json as { features?: Array<{ properties?: { way_points?: unknown } }> })
    ?.features?.[0]?.properties?.way_points
  if (!Array.isArray(indices) || indices.length === 0) return undefined
  const out: LngLat[] = []
  for (const value of indices) {
    const index = Number(value)
    if (!Number.isInteger(index) || index < 0 || index >= geometry.length) return undefined
    out.push(geometry[index])
  }
  return out
}

export function orsProfile(mode: TravelMode): string {
  return mode === 'walking' ? 'foot-walking' : mode === 'cycling' ? 'cycling-regular' : 'driving-car'
}

export function parseOrsResponse(json: unknown): RawRoute | null {
  const feature = (json as { features?: unknown[] })?.features?.[0] as
    | { geometry?: { coordinates?: unknown }; properties?: { summary?: { distance?: number; duration?: number } } }
    | undefined
  const coords = feature?.geometry?.coordinates
  if (!Array.isArray(coords)) return null
  const geometry: LngLat[] = []
  const elevations: number[] = []
  let hasElevation = false
  for (const c of coords) {
    if (!Array.isArray(c) || !isValidLngLat(Number(c[0]), Number(c[1]))) continue
    geometry.push([Number(c[0]), Number(c[1])])
    if (c.length >= 3 && Number.isFinite(Number(c[2]))) {
      elevations.push(Number(c[2]))
      hasElevation = true
    } else {
      elevations.push(NaN)
    }
  }
  if (geometry.length < 2) return null
  const summary = feature?.properties?.summary
  return {
    geometry,
    distanceM: Number(summary?.distance ?? 0),
    durationS: Number(summary?.duration ?? 0),
    elevations: hasElevation ? elevations : undefined,
    steps: parseOrsSteps(json),
    snapped: parseOrsWaypoints(json, geometry)
  }
}

export function mapboxProfile(mode: TravelMode): string {
  return mode === 'walking' ? 'walking' : mode === 'cycling' ? 'cycling' : 'driving'
}

export function mapboxDirectionsUrl(waypoints: Waypoint[], mode: TravelMode, token: string): string {
  return `${MAPBOX_DIR}/${mapboxProfile(mode)}/${coordsParam(waypoints)}?overview=full&geometries=geojson&steps=true&access_token=${encodeURIComponent(token)}`
}

/** Compute a road-snapped route between ≥2 waypoints via the configured provider. */
export async function planRoute(
  waypoints: Waypoint[],
  mode: TravelMode,
  settings: MapSettings,
  request?: MapRequest
): Promise<RawRoute> {
  if (waypoints.length < 2) throw new Error('Add at least two waypoints')
  if (!request) return withMapRequest(api, undefined, scope => planRoute(waypoints, mode, settings, scope))
  request.check()

  const provider = effectiveRoutingProvider(settings)
  const account = parseAccountProviderChoice(provider)
  if (account) {
    const result = await request.services.route(
      account.connectionId,
      waypoints.map((waypoint) => [waypoint.lng, waypoint.lat]),
      mode
    )
    if (result.ok && result.data && result.data.coordinates.length >= 2) {
      return {
        geometry: result.data.coordinates,
        distanceM: result.data.distanceMeters ?? 0,
        durationS: result.data.durationSeconds ?? 0
      }
    }
  }

  // Default: the free FOSSGIS OSRM instance for the requested mode.
  try {
    const parsed = parseOsrmResponse(await fetchJson(waypoints, mode, request))
    if (parsed) return parsed
  } catch {
    request.check()
    // Fall through to the demo server rather than failing the whole plan.
  }

  // Last resort: the car-only demo server. A walk/ride routed here is a car
  // route wearing the wrong badge, so say so instead of showing it silently.
  const parsed = parseOsrmResponse(await fetchJson(waypoints, mode, request, true))
  if (!parsed) throw new Error('No route found')
  return { ...parsed, modeApproximated: mode !== 'driving' }
}
