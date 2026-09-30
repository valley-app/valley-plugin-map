import { withMapRequest, type MapRequest } from './requests'
import type { GeoResult, LngLat, MapSettings } from './types'
import { isValidLngLat } from './geo'
import { api } from './runtime'
import { effectiveSearchProvider, parseAccountProviderChoice } from './settings'
import { GEOCODE_SEARCH_LIMIT, PUBLIC_SEARCH_ID, searchProviderIdentity } from './geocodeProviders'

export interface GeocodedPlaces { provider: string; places: GeoResult[] }

/**
 * A geocoder HTTP failure that carries its status.
 *
 * 429 is the one worth telling apart: the free Nominatim endpoint throttles by
 * IP and keeps refusing for a while afterwards, so "search is broken" and "you
 * are being rate-limited, wait a minute" need different answers — and only the
 * second one has a fix the user can act on (a Mapbox token, which routes
 * geocoding away from the shared endpoint entirely).
 */
export class GeocodeError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`Geocoding failed (${status})`)
    this.name = 'GeocodeError'
    this.status = status
  }
}

/**
 * Split a geocoder's full label into the short name a row leads with and the
 * region/country context under it: "Birmenstorf, Bezirk Baden, Aargau, Schweiz"
 * → `{ name: 'Birmenstorf', context: 'Bezirk Baden, Aargau, Schweiz' }`. Both
 * providers hand us the short form separately (Nominatim `name`, Mapbox `text`);
 * `short` falls back to the first comma-separated segment when they don't.
 */
export function splitLabel(full: string, short: string): { name: string; context?: string } {
  const head = short || full.split(',')[0].trim()
  if (!head || !full.startsWith(head)) return { name: head || full, context: head ? full : undefined }
  const context = full.slice(head.length).replace(/^\s*,\s*/, '').trim()
  return { name: head, context: context || undefined }
}

/**
 * Rejoin a split hit into one line. The UI wants the two halves apart (a bold
 * name over a muted region), but anything that emits a single string — the
 * topbar readout, the CLI's "Centred on …" — wants the whole address back.
 */
export function fullName(hit: GeoResult): string {
  return hit.context ? `${hit.name}, ${hit.context}` : hit.name
}

/** Parse a Nominatim `/search` JSON array into geocoder hits. Pure. */
export function parseNominatimSearch(json: unknown): GeoResult[] {
  if (!Array.isArray(json)) return []
  const out: GeoResult[] = []
  for (const row of json.slice(0, GEOCODE_SEARCH_LIMIT)) {
    const lat = Number((row as { lat?: unknown }).lat)
    const lng = Number((row as { lon?: unknown }).lon)
    const full = String((row as { display_name?: unknown }).display_name ?? '').trim().slice(0, 500)
    const short = String((row as { name?: unknown }).name ?? '').trim().slice(0, 500)
    if (full && isValidLngLat(lng, lat)) out.push({ ...splitLabel(full, short), lng, lat })
  }
  return out
}

/** Parse a Mapbox geocoding response into hits. Pure. */
export function parseMapboxGeocode(json: unknown): GeoResult[] {
  const features = (json as { features?: unknown[] })?.features
  if (!Array.isArray(features)) return []
  const out: GeoResult[] = []
  for (const f of features) {
    const center = (f as { center?: unknown }).center
    const full = String((f as { place_name?: unknown }).place_name ?? '').trim()
    const short = String((f as { text?: unknown }).text ?? '').trim()
    if (Array.isArray(center) && center.length >= 2) {
      const lng = Number(center[0])
      const lat = Number(center[1])
      if (full && isValidLngLat(lng, lat)) out.push({ ...splitLabel(full, short), lng, lat })
    }
  }
  return out
}

/** Forward-geocode a free-text query into ranked location hits. */
export async function searchPlaces(query: string, settings: MapSettings, request?: MapRequest, near?: LngLat): Promise<GeoResult[]> {
  return (await searchPlacesWithProvider(query, settings, request, near)).places
}

/** `near` biases ambiguous names toward a point (the map centre) without excluding farther matches. */
export async function searchPlacesWithProvider(query: string, settings: MapSettings, request?: MapRequest, near?: LngLat): Promise<GeocodedPlaces> {
  const q = query.trim()
  if (!q) return { provider: searchProviderIdentity(settings), places: [] }
  if (!request) return withMapRequest(api, undefined, scope => searchPlacesWithProvider(query, settings, scope, near))
  request.check()
  const account = parseAccountProviderChoice(effectiveSearchProvider(settings))
  if (account) {
    const result = await request.services.geocode(account.connectionId, q, GEOCODE_SEARCH_LIMIT, near)
    if (result.ok) {
      return { provider: searchProviderIdentity(settings), places: (result.data?.places ?? []).slice(0, GEOCODE_SEARCH_LIMIT).map((place) => ({
        ...splitLabel((place.description || place.name).slice(0, 500), place.name.slice(0, 500)),
        lng: place.longitude,
        lat: place.latitude
      })) }
    }
  }
  const result = await request.services.publicJson({ service: 'search', query: q, ...(near ? { near } : {}) })
  if (result.status < 200 || result.status >= 300) throw new GeocodeError(result.status)
  return { provider: PUBLIC_SEARCH_ID, places: parseNominatimSearch(result.json) }
}

/** Reverse-geocode a coordinate into a human label (best-effort). */
export async function reverseGeocode(
  lng: number,
  lat: number,
  settings: MapSettings,
  request?: MapRequest
): Promise<string | null> {
  if (!request) return withMapRequest(api, undefined, scope => reverseGeocode(lng, lat, settings, scope))
  request.check()
  try {
    const account = parseAccountProviderChoice(effectiveSearchProvider(settings))
    if (account) {
      const result = await request.services.reverseGeocode(account.connectionId, lng, lat)
      if (result.ok) {
        const hit = result.data?.places[0]
        if (hit) return hit.description || hit.name
      }
    }
    const result = await request.services.publicJson({ service: 'reverse', longitude: lng, latitude: lat })
    if (result.status < 200 || result.status >= 300) return null
    const json = result.json as { display_name?: unknown }
    const name = String(json.display_name ?? '').trim()
    return name || null
  } catch {
    request.check()
    return null
  }
}
