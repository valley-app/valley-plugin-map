import { DEFAULT_PIN_ICONS } from '../pinIconDefaults'
import { uiText, initBackendLocalization } from '../localization'
import type { PluginBackendApi } from '@valley/plugin-sdk'
import type { PluginFetchRequest, PluginFetchResponse } from '@valley/plugin-sdk/pluginNetwork'
import type { LngLat, TravelMode, Waypoint } from '../types'
import type { MapPlaceHit, MapUsageQuota } from '../serviceClient'
import { isValidLngLat } from '../geo'
import { osrmUrl, osrmDemoUrl, orsProfile } from '../routing'
import { createBackendRequests, type MapBackendRequest } from './requests'
import { ACCOUNT_SEARCH_URL, PUBLIC_SEARCH_URL, GEOCODE_SEARCH_LIMIT } from '../geocodeProviders'

const encode = (value: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
const decode = (value: string): unknown => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), (character) => character.charCodeAt(0))))
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(uiText('backend.request'))
  return value as Record<string, unknown>
}
const text = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new Error(uiText('backend.text'))
  return value.trim()
}
function coordinates(value: unknown, minimum = 1, maximum = 100): LngLat[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new Error(uiText('backend.coordinates'))
  return value.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'number' || typeof entry[1] !== 'number' || !isValidLngLat(entry[0], entry[1])) throw new Error(uiText('backend.coordinate'))
    return [entry[0], entry[1]]
  })
}
function travelMode(value: unknown): TravelMode {
  if (value === undefined) return 'driving'
  if (value !== 'driving' && value !== 'walking' && value !== 'cycling') throw new Error(uiText('backend.travelMode'))
  return value
}
function featureToPlace(value: unknown): MapPlaceHit | null {
  const feature = object(value)
  const properties = feature.properties && typeof feature.properties === 'object' ? object(feature.properties) : {}
  const geometry = feature.geometry && typeof feature.geometry === 'object' ? object(feature.geometry) : {}
  const point = geometry.coordinates ?? properties.coordinates
  const location = point && !Array.isArray(point) && typeof point === 'object' ? object(point) : {}
  const longitude = Number(Array.isArray(point) ? point[0] : location.longitude)
  const latitude = Number(Array.isArray(point) ? point[1] : location.latitude)
  if (!isValidLngLat(longitude, latitude)) return null
  return { id: String(feature.id ?? `${longitude},${latitude}`).slice(0, 500), name: String(properties.name ?? feature.text ?? feature.place_name ?? 'Place').slice(0, 500), description: String(properties.full_address ?? feature.place_name ?? '').slice(0, 500), longitude, latitude }
}

export function register(api: PluginBackendApi): () => void {
  initBackendLocalization(api)
  const requests = createBackendRequests(api.network)
  const offlineFiles = new Map<string, Promise<{ handle: string; sha1?: string }>>()
  const usage = new Map<string, MapUsageQuota[]>()
  const captureUsage = (id: string, service: MapUsageQuota['service'], response: PluginFetchResponse) => {
    const headers = Object.fromEntries(Object.entries(response.headers).map(([name, value]) => [name.toLowerCase(), value]))
    const integer = (name: string) => /^\d+$/.test(headers[name] ?? '') && Number.isSafeInteger(Number(headers[name])) ? Number(headers[name]) : undefined
    const limit = integer('x-ratelimit-limit')
    const remaining = integer('x-ratelimit-remaining')
    const reset = integer('x-ratelimit-reset')
    if (limit === undefined || limit <= 0 || remaining === undefined || remaining > limit) return
    const snapshots = (usage.get(id) ?? []).filter((entry) => entry.service !== service)
    snapshots.push({ service, limit, remaining, observedAt: Date.now(), ...(reset && reset <= 8640000000000 ? { resetAt: reset * 1000 } : {}) })
    usage.set(id, snapshots)
    if (usage.size > 128) usage.delete(usage.keys().next().value!)
  }
  // The status decides first: a failing service often answers with an HTML page,
  // which must read as the failed request it is, not as a JSON syntax error.
  const responseJson = (response: PluginFetchResponse) => {
    const failure = new Error(uiText('backend.serviceRequest', { status: response.status }))
    if (response.status < 200 || response.status >= 300) throw failure
    let json: unknown
    try { json = decode(response.bodyBase64) } catch { throw failure }
    return object(json)
  }
  const connection = async (connectionId: unknown, capability: string, request?: MapBackendRequest) => {
    const id = text(connectionId)
    const account = (await api.accounts.list()).find((entry) => entry.id === id && entry.capabilities.includes(capability))
    request?.check()
    if (!account) throw new Error(uiText('backend.capability', { capability }))
    const host = account.provider === 'mapbox' ? 'api.mapbox.com' : account.provider === 'openrouteservice' ? 'api.heigit.org' : null
    if (!host) throw new Error(uiText('backend.provider'))
    const handle = await api.accounts.authorize(id, capability, { host, port: 443, security: 'tls' })
    request?.check()
    return { account, credential: { handle, placement: account.provider === 'mapbox' ? 'query' as const : 'header' as const, name: account.provider === 'mapbox' ? 'access_token' : 'Authorization' } }
  }
  const disposers: Array<() => void> = [api.accounts.subscribe(() => { usage.clear(); api.rpc.emit('connectionsChanged', undefined) })]
  const handle = (method: string, run: (payload: Record<string, unknown>, request: MapBackendRequest) => unknown | Promise<unknown>, wrapped = true, scoped = false) => {
    disposers.push(api.rpc.handle(method, async (payload) => {
      let input: Record<string, unknown> | undefined
      try {
        input = object(payload ?? {})
        const value = input
        const data = scoped
          ? await requests.run(input.requestId, async request => await run(value, request))
          : await run(input, { check() {}, fetch: request => api.network.fetch(request) })
        return wrapped ? { ok: true, data } : data
      } catch (error) {
        if (scoped && input && !requests.active(input.requestId)) return { __mapRequestCancelled: true }
        if (!wrapped) throw error
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }))
  }
  handle('pinIcons', async () => {
    const grant = await api.storage.open({ area: 'metadata', path: 'assets/icon/map-icon', kind: 'directory', mode: 'write' })
    const location = (path: string) => ({ handle: grant.handle, path })
    try {
      await api.storage.mkdir(location(''))
      for (const [name, svg] of Object.entries(DEFAULT_PIN_ICONS)) {
        if (!await api.storage.stat(location(`${name}.svg`))) await api.storage.write(location(`${name}.svg`), svg)
      }
      const icons: Record<string, string> = {}
      const failed: string[] = []
      let bytes = 0
      for (const entry of await api.storage.list(location(''))) {
        if (!/^[^/\\]+\.svg$/i.test(entry.name)) continue
        if (entry.kind !== 'file' || entry.size > 256_000 || bytes + entry.size > 2_000_000) { failed.push(entry.name); continue }
        try { icons[entry.name.slice(0, -4)] = await api.storage.read(location(entry.name)); bytes += entry.size }
        catch { failed.push(entry.name) }
      }
      return { icons, failed }
    } finally { await api.storage.close(grant.handle) }
  }, false)
  handle('beginRequest', () => requests.begin(), false)
  handle('cancelRequest', ({ requestId }) => requests.cancel(requestId), false)
  handle('finishRequest', ({ requestId }) => requests.finish(requestId), false)
  handle('listConnections', async ({ capability }) => ({ connections: (await api.accounts.list()).filter((account) => account.capabilities.some((entry) => entry.startsWith('geo.') || entry === 'map.style') && (capability === undefined || account.capabilities.includes(text(capability)))).map((account) => ({ id: account.id, provider: account.provider, displayName: account.displayName || account.provider, ...(account.address ? { email: account.address } : {}), capabilities: account.capabilities, secretState: account.credentialState ?? 'absent', usage: usage.get(account.id) ?? [] })) }))
  handle('geocode', async ({ connectionId, query, limit = 8, near }, request) => {
    const { credential } = await connection(connectionId, 'geo.search', request)
    if (typeof limit !== 'number' || !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 20) throw new Error(uiText('backend.limit'))
    const bias = near === undefined ? '' : `&proximity=${coordinates([near])[0].join(',')}`
    const url = `${ACCOUNT_SEARCH_URL}?q=${encodeURIComponent(text(query))}&limit=${limit}${bias}`
    const json = responseJson(await request.fetch({ url, credential }))
    if (!Array.isArray(json.features)) throw new Error(uiText('backend.request'))
    const places = json.features.slice(0, Number(limit)).map(featureToPlace).filter((place) => place !== null)
    if (json.features.length && !places.length) throw new Error(uiText('backend.coordinate'))
    return { places }
  }, true, true)
  handle('reverseGeocode', async ({ connectionId, longitude, latitude }, request) => {
    const [[lng, lat]] = coordinates([[longitude, latitude]])
    const { credential } = await connection(connectionId, 'geo.reverse', request)
    const json = responseJson(await request.fetch({ url: `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&limit=1`, credential }))
    return { places: (Array.isArray(json.features) ? json.features.slice(0, 1) : []).map(featureToPlace).filter((place) => place !== null) }
  }, true, true)
  handle('route', async ({ connectionId, coordinates: input, profile }, request) => {
    const points = coordinates(input, 2, 50)
    const mode = travelMode(profile)
    const { account, credential } = await connection(connectionId, 'geo.route', request)
    if (account.provider === 'mapbox') {
      const json = responseJson(await request.fetch({ url: `https://api.mapbox.com/directions/v5/mapbox/${mode}/${points.map((point) => point.join(',')).join(';')}?geometries=geojson&overview=full`, credential }))
      const route = object(Array.isArray(json.routes) ? json.routes[0] : null)
      return { coordinates: object(route.geometry).coordinates, distanceMeters: route.distance, durationSeconds: route.duration }
    }
    const response = await request.fetch({ url: `https://api.heigit.org/openrouteservice/v2/directions/${orsProfile(mode)}/geojson`, method: 'POST', headers: { 'Content-Type': 'application/json' }, bodyBase64: encode({ coordinates: points }), credential })
    captureUsage(account.id, 'routing', response)
    const json = responseJson(response)
    const route = object(Array.isArray(json.features) ? json.features[0] : null)
    const summary = object(object(route.properties).summary)
    return { coordinates: object(route.geometry).coordinates, distanceMeters: summary.distance, durationSeconds: summary.duration }
  }, true, true)
  handle('elevation', async ({ connectionId, coordinates: input }, request) => {
    const points = coordinates(input)
    const { account, credential } = await connection(connectionId, 'geo.elevation', request)
    const elevations: number[] = []
    for (const point of points) {
      const response = await request.fetch({ url: 'https://api.heigit.org/openelevationservice/v0/point', method: 'POST', headers: { 'Content-Type': 'application/json' }, bodyBase64: encode({ format_in: 'point', format_out: 'point', geometry: point }), credential })
      captureUsage(account.id, 'elevation', response)
      const json = responseJson(response)
      const position = object(json.geometry).coordinates
      elevations.push(Number(Array.isArray(position) ? position[2] ?? 0 : 0))
    }
    return { elevations }
  }, true, true)
  handle('tile', async ({ connectionId, style, z, x, y }) => {
    if (typeof style !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(style) || ![z, x, y].every((value) => typeof value === 'number' && Number.isInteger(value) && value >= 0) || Number(z) > 22 || Number(x) >= 2 ** Number(z) || Number(y) >= 2 ** Number(z)) throw new Error(uiText('backend.tileCoordinates'))
    const { credential } = await connection(connectionId, 'map.style')
    const response = await api.network.fetch({ url: `https://api.mapbox.com/styles/v1/mapbox/${style}/tiles/256/${z}/${x}/${y}@2x`, credential })
    if (response.status !== 200) throw new Error(uiText('backend.tile', { status: response.status }))
    return { bodyBase64: response.bodyBase64 }
  }, false)
  handle('resource', async ({ url: value }) => {
    const url = new URL(text(value))
    if (url.protocol !== 'https:' || !['basemaps.cartocdn.com', 'tiles.basemaps.cartocdn.com', 'tiles-a.basemaps.cartocdn.com', 'tiles-b.basemaps.cartocdn.com', 'tiles-c.basemaps.cartocdn.com', 'tiles-d.basemaps.cartocdn.com', 'a.basemaps.cartocdn.com', 'b.basemaps.cartocdn.com', 'c.basemaps.cartocdn.com', 'd.basemaps.cartocdn.com', 'server.arcgisonline.com'].includes(url.hostname)) throw new Error(uiText('backend.resourceHost'))
    const response = await api.network.fetch({ url: url.toString() })
    if (response.status !== 200) throw new Error(uiText('backend.resource', { status: response.status }))
    return { bodyBase64: response.bodyBase64 }
  }, false)
  handle('offlineRange', async ({ path: input, offset, length }) => {
    const path = text(input)
    if (!path.endsWith('.pmtiles') || typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || typeof length !== 'number' || !Number.isSafeInteger(length) || length < 1 || length > 4 * 1024 * 1024) throw new Error(uiText('backend.archiveRange'))
    let pending = offlineFiles.get(path)
    if (!pending) {
      if (offlineFiles.size >= 16) throw new Error(uiText('backend.archives'))
      pending = api.files.openVault(path)
      offlineFiles.set(path, pending)
      void pending.catch(() => offlineFiles.delete(path))
    }
    const file = await pending
    const chunks: Uint8Array[] = []
    let read = 0
    while (read < length) {
      const result = await api.files.read(file.handle, { offset: offset + read, maxBytes: Math.min(length - read, 1024 * 1024) })
      const bytes = Uint8Array.from(atob(result.base64), (character) => character.charCodeAt(0))
      chunks.push(bytes)
      read += bytes.length
      if (result.done || !bytes.length) break
    }
    const bytes = new Uint8Array(read)
    let index = 0
    for (const chunk of chunks) { bytes.set(chunk, index); index += chunk.length }
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
    return { bodyBase64: btoa(binary), etag: file.sha1 }
  }, false)
  handle('publicJson', async (payload, scope) => {
    let request: PluginFetchRequest
    if (payload.service === 'search') {
      // A preferred (not bounding) area around the map: ambiguous names such as
      // a station abbreviation resolve near where the user is looking.
      const near = payload.near === undefined ? null : coordinates([payload.near])[0]
      const bias = near ? `&viewbox=${[near[0] - 0.5, near[1] + 0.5, near[0] + 0.5, near[1] - 0.5].map(value => value.toFixed(5)).join(',')}` : ''
      request = { url: `${PUBLIC_SEARCH_URL}?format=jsonv2&limit=${GEOCODE_SEARCH_LIMIT}&q=${encodeURIComponent(text(payload.query))}${bias}` }
    }
    else if (payload.service === 'reverse') {
      const [[lng, lat]] = coordinates([[payload.longitude, payload.latitude]])
      request = { url: `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lon=${lng}&lat=${lat}` }
    } else if (payload.service === 'route') {
      if (!Array.isArray(payload.waypoints)) throw new Error(uiText('backend.waypoints'))
      const points = coordinates(payload.waypoints.map((value) => { const point = object(value); return [point.lng, point.lat] }), 2, 50)
      const waypoints: Waypoint[] = points.map(([lng, lat]) => ({ lng, lat, label: '' }))
      request = { url: payload.demo === true ? osrmDemoUrl(waypoints) : osrmUrl(waypoints, travelMode(payload.mode)), timeoutMs: 20000 }
    } else if (payload.service === 'elevation') request = { url: 'https://api.open-elevation.com/api/v1/lookup', method: 'POST', headers: { 'Content-Type': 'application/json' }, bodyBase64: encode({ locations: coordinates(payload.coordinates).map(([longitude, latitude]) => ({ longitude, latitude })) }), timeoutMs: 15000 }
    else throw new Error(uiText('backend.service'))
    const response = await scope.fetch({ headers: { Accept: 'application/json' }, ...request })
    const json = decode(response.bodyBase64)
    if (payload.service === 'search') {
      if (response.status >= 200 && response.status < 300 && !Array.isArray(json)) throw new Error(uiText('backend.request'))
      const places = (Array.isArray(json) ? json.slice(0, GEOCODE_SEARCH_LIMIT) : []).filter(value => value && typeof value === 'object').map(value => ({
        lat: Number(value.lat), lon: Number(value.lon),
        name: String(value.name ?? '').slice(0, 500), display_name: String(value.display_name ?? '').slice(0, 500)
      })).filter(place => isValidLngLat(place.lon, place.lat))
      if (Array.isArray(json) && json.length && !places.length) throw new Error(uiText('backend.coordinate'))
      return { status: response.status, json: places }
    }
    return { status: response.status, json }
  }, false, true)
  return () => { void requests.dispose(); for (const dispose of disposers.reverse()) dispose(); usage.clear(); if (offlineFiles.size) void Promise.allSettled([...offlineFiles.values()]).then((entries) => api.files.release(entries.flatMap((entry) => entry.status === 'fulfilled' ? [entry.value.handle] : []))); offlineFiles.clear() }
}
