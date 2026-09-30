import { withMapRequest, type MapRequest } from './requests'
import type { ElevationPoint, LngLat, MapSettings } from './types'
import { haversineMeters } from './geo'
import { api } from './runtime'
import { effectiveElevationProvider, parseAccountProviderChoice } from './settings'

/** Default cap on how many points we query for an elevation profile. */
export const MAX_ELEVATION_SAMPLES = 80

/** Evenly downsample a polyline to at most `maxSamples` points (keeps endpoints). Pure. */
export function sampleLineString(coords: LngLat[], maxSamples = MAX_ELEVATION_SAMPLES): LngLat[] {
  if (coords.length <= maxSamples) return [...coords]
  const out: LngLat[] = []
  const step = (coords.length - 1) / (maxSamples - 1)
  for (let i = 0; i < maxSamples; i++) out.push(coords[Math.round(i * step)])
  return out
}

/**
 * Build a distance/elevation profile from coordinates and their (aligned)
 * elevations. Cumulative distance is measured along `coords`; NaN elevations are
 * carried forward from the previous finite value so the line stays continuous.
 * Pure.
 */
export function buildProfile(
  coords: LngLat[],
  elevations: number[]
): { profile: ElevationPoint[]; ascentM: number; descentM: number } {
  const profile: ElevationPoint[] = []
  let distance = 0
  let ascent = 0
  let descent = 0
  let lastElevation = NaN
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) distance += haversineMeters(coords[i - 1], coords[i])
    let elevation = elevations[i]
    if (!Number.isFinite(elevation)) elevation = lastElevation
    if (!Number.isFinite(elevation)) elevation = 0
    if (Number.isFinite(lastElevation)) {
      const delta = elevation - lastElevation
      if (delta > 0) ascent += delta
      else descent -= delta
    }
    lastElevation = elevation
    profile.push({ distanceM: distance, elevationM: elevation })
  }
  return { profile, ascentM: ascent, descentM: descent }
}

async function fetchOpenElevation(samples: LngLat[], request: MapRequest): Promise<number[]> {
  const result = await request.services.publicJson({ service: 'elevation', coordinates: samples })
  if (result.status < 200 || result.status >= 300) throw new Error(`Elevation lookup failed (${result.status})`)
  const json = result.json as { results?: { elevation?: number }[] }
  return (json.results ?? []).map((entry) => Number(entry.elevation))
}

/**
 * Resolve an elevation profile for a route geometry. When the router already
 * supplied per-vertex elevations (ORS 3D), use those directly; otherwise sample
 * the line and query the configured elevation service. Returns null when
 * elevation is disabled or unavailable.
 */
export async function computeElevationProfile(
  geometry: LngLat[],
  settings: MapSettings,
  inlineElevations?: number[],
  request?: MapRequest
): Promise<{ profile: ElevationPoint[]; ascentM: number; descentM: number } | null> {
  if (geometry.length < 2) return null
  if (inlineElevations && inlineElevations.length === geometry.length) {
    return buildProfile(geometry, inlineElevations)
  }
  const provider = effectiveElevationProvider(settings)
  if (provider === 'none') return null
  if (!request) return withMapRequest(api, undefined, scope => computeElevationProfile(geometry, settings, inlineElevations, scope))
  request.check()
  const samples = sampleLineString(geometry)
  try {
    const account = parseAccountProviderChoice(provider)
    let elevations: number[]
    if (account) {
      try {
        elevations = await request.services.elevation(account.connectionId, samples).then((result) => {
            if (!result.ok) throw new Error(result.error ?? 'Elevation lookup failed')
            return result.data?.elevations ?? []
          })
      } catch {
        request.check()
        elevations = await fetchOpenElevation(samples, request)
      }
    } else {
      elevations = await fetchOpenElevation(samples, request)
    }
    if (elevations.length !== samples.length) return null
    return buildProfile(samples, elevations)
  } catch {
    request.check()
    return null
  }
}
