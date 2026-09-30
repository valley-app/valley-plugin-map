import type { ValleyPluginApi } from '@valley/plugin-sdk'
import type { LngLat, Waypoint, TravelMode } from './types'

export interface MapUsageQuota {
  service: 'routing' | 'elevation'
  limit: number
  remaining: number
  observedAt: number
  resetAt?: number
}

export interface MapConnectionInfo {
  id: string
  provider: string
  displayName: string
  email?: string
  capabilities: string[]
  secretState: 'absent' | 'ok' | 'unreadable'
  usage?: MapUsageQuota[]
}

export interface MapPlaceHit {
  id: string
  name: string
  description?: string
  longitude: number
  latitude: number
}

type Result<T> = { ok: boolean; data?: T; error?: string }
export type PublicMapRequest =
  | { service: 'search'; query: string; near?: LngLat }
  | { service: 'reverse'; longitude: number; latitude: number }
  | { service: 'route'; waypoints: Waypoint[]; mode: TravelMode; demo?: boolean }
  | { service: 'elevation'; coordinates: LngLat[] }

export function mapServices(api: ValleyPluginApi, request?: { id: string; check(): void; cancel(): void }) {
  const call = async <T>(method: string, payload: Record<string, unknown>): Promise<T> => {
    request?.check()
    const result = await api.backend.call<T>(method, { ...payload, ...(request ? { requestId: request.id } : {}) })
    if (result && typeof result === 'object' && '__mapRequestCancelled' in result) request?.cancel()
    request?.check()
    return result
  }
  return {
    listConnections: (capability?: string) => api.backend.call<Result<{ connections: MapConnectionInfo[] }>>('listConnections', { capability }),
    geocode: (connectionId: string, query: string, limit = 8, near?: LngLat) => call<Result<{ places: MapPlaceHit[] }>>('geocode', { connectionId, query, limit, ...(near ? { near } : {}) }),
    reverseGeocode: (connectionId: string, longitude: number, latitude: number) => call<Result<{ places: MapPlaceHit[] }>>('reverseGeocode', { connectionId, longitude, latitude }),
    route: (connectionId: string, coordinates: LngLat[], profile?: string) => call<Result<{ coordinates: LngLat[]; distanceMeters?: number; durationSeconds?: number }>>('route', { connectionId, coordinates, profile }),
    elevation: (connectionId: string, coordinates: LngLat[]) => call<Result<{ elevations: number[] }>>('elevation', { connectionId, coordinates }),
    publicJson: (payload: PublicMapRequest) => call<{ status: number; json: unknown }>('publicJson', payload),
    resource: (url: string) => api.backend.call<{ bodyBase64: string }>('resource', { url }),
    offlineRange: (payload: { path: string; offset: number; length: number }) => api.backend.call<{ bodyBase64: string; etag?: string }>('offlineRange', payload),
    tile: (payload: { connectionId: string; style: string; z: number; x: number; y: number }) => api.backend.call<{ bodyBase64: string }>('tile', payload)
  }
}
