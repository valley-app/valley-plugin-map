import de from '../locales/de.json'
import config from '../config.json'
import { describe, expect, it, vi } from 'vitest'
import type { PluginBackendApi } from '@valley/plugin-sdk'
import type { PluginAccountConnection, PluginFetchRequest, PluginFetchResponse } from '@valley/plugin-sdk/pluginNetwork'
import { register } from '../src/backend'

const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64')
const jsonResponse = (value: unknown, headers: Record<string, string> = {}, status = 200): PluginFetchResponse => ({ status, headers, bodyBase64: encoded(value) })
const account = (id: string, provider = 'openrouteservice'): PluginAccountConnection => ({ id, provider, displayName: id, capabilities: provider === 'mapbox' ? ['geo.search', 'geo.reverse', 'geo.route', 'map.style'] : ['geo.route', 'geo.elevation'], credentialState: 'ok' })
const points = [[8, 12], [8.1, 12.1]]
const routeBody = { features: [{ geometry: { coordinates: points }, properties: { summary: { distance: 1000, duration: 600 } } }] }

function setup(accounts: PluginAccountConnection[] = [], storage?: PluginBackendApi['storage']) {
  const i18n = { t: (key: string) => key }
  const handlers = new Map<string, (payload: unknown) => unknown>()
  const fetch = vi.fn<(request: PluginFetchRequest) => Promise<PluginFetchResponse>>()
  const cancel = vi.fn(async (_requestId: string) => true)
  const authorize = vi.fn(async (id: string) => `opaque:${id}`)
  const files = { openVault: vi.fn(async () => ({ handle: 'archive', sha1: 'unchanged' })), read: vi.fn(async (_handle: string, options: { offset: number; maxBytes: number }) => ({ base64: Buffer.from('archive-bytes').subarray(options.offset, options.offset + options.maxBytes).toString('base64'), done: true })), release: vi.fn(async () => {}) }
  const dispose = register({ storage, i18n, rpc: { handle: (method: string, handler: (payload: unknown) => unknown) => { handlers.set(method, handler); return () => { handlers.delete(method) } }, emit: () => {} }, accounts: { subscribe: () => () => {}, list: async () => accounts, authorize }, network: { fetch, cancel }, files } as unknown as PluginBackendApi)
  const rawCall = async (method: string, payload: unknown = {}) => await handlers.get(method)!(payload)
  const call = async (method: string, payload: unknown = {}) => {
    if (!['geocode', 'reverseGeocode', 'route', 'elevation', 'publicJson'].includes(method)) return rawCall(method, payload)
    const requestId = await rawCall('beginRequest')
    try { return await rawCall(method, { ...payload as Record<string, unknown>, requestId }) }
    finally { await rawCall('finishRequest', { requestId }) }
  }
  return { fetch, cancel, authorize, call, rawCall, handlers, dispose, files, i18n }
}

describe('Map package backend', () => {
  it('seeds only missing icons in its declared metadata folder and closes the grant', async () => {
    const custom = '<svg>custom artwork</svg>'
    const files = new Map([['pin.svg', custom], ['fern.svg', custom]])
    const storage = {
      open: vi.fn(async () => ({ handle: 'icons' })), close: vi.fn(async () => {}), mkdir: vi.fn(async () => {}),
      stat: vi.fn(async ({ path }) => files.has(path) ? { kind: 'file' } : null),
      write: vi.fn(async ({ path }, svg) => { files.set(path, svg) }),
      read: vi.fn(async ({ path }) => files.get(path)),
      list: vi.fn(async () => [...files].map(([name, svg]) => ({ name, kind: 'file', size: svg.length })))
    } as unknown as PluginBackendApi['storage']
    const mock = setup([], storage)
    const result = await mock.rawCall('pinIcons')
    expect(storage.open).toHaveBeenCalledWith({ area: 'metadata', path: 'assets/icon/map-icon', kind: 'directory', mode: 'write' })
    expect(config.permissions.storage.metadata).toEqual(['assets/icon/map-icon'])
    expect(files.get('pin.svg')).toBe(custom)
    expect(files.size).toBe(9)
    expect(result).toMatchObject({ icons: { pin: custom, fern: custom }, failed: [] })
    expect(storage.close).toHaveBeenCalledWith('icons')
    mock.dispose()
  })

  it('bounds provider search output before the RPC reply and rejects malformed success data', async () => {
    const mock = setup([account('field', 'mapbox')])
    mock.fetch.mockResolvedValueOnce(jsonResponse(Array.from({ length: 100 }, () => ({ lat: '12', lon: '8', name: 'n'.repeat(2000), display_name: 'd'.repeat(2000), unused: 'x'.repeat(2000) }))))
    const result = await mock.call('publicJson', { service: 'search', query: 'Grove' }) as { json: Array<Record<string, unknown>> }
    expect(result.json).toHaveLength(8)
    expect(JSON.stringify(result).length).toBeLessThan(9000)
    expect(result.json[0]).toEqual({ lat: 12, lon: 8, name: 'n'.repeat(500), display_name: 'd'.repeat(500) })
    mock.fetch.mockResolvedValueOnce(jsonResponse({ features: Array.from({ length: 100 }, () => ({ id: 'i'.repeat(2000), geometry: { coordinates: [8, 12] }, properties: { name: 'n'.repeat(2000), full_address: 'd'.repeat(2000) } })) }))
    const accountResult = await mock.call('geocode', { connectionId: 'field', query: 'Grove', limit: 2 }) as { data: { places: unknown[] } }
    expect(accountResult.data.places).toHaveLength(2)
    expect(JSON.stringify(accountResult).length).toBeLessThan(3300)
    mock.fetch.mockResolvedValueOnce(jsonResponse({ error: 'invalid success' }))
    await expect(mock.call('publicJson', { service: 'search', query: 'Grove' })).rejects.toThrow()
    mock.fetch.mockResolvedValueOnce(jsonResponse([{ lat: 'invalid', lon: '8' }]))
    await expect(mock.call('publicJson', { service: 'search', query: 'Grove' })).rejects.toThrow()
    mock.dispose()
  })

  it('cancels only its own transfer while another provider account completes normally', async () => {
    const mock = setup([account('first'), account('second')])
    let finish!: (value: PluginFetchResponse) => void
    mock.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    mock.fetch.mockResolvedValueOnce(jsonResponse(routeBody))
    const first = await mock.rawCall('beginRequest')
    const second = await mock.rawCall('beginRequest')
    const pending = mock.rawCall('route', { requestId: first, connectionId: 'first', coordinates: points })
    await vi.waitFor(() => expect(mock.fetch).toHaveBeenCalledTimes(1))
    const cancelling = mock.rawCall('cancelRequest', { requestId: first })
    expect(await mock.rawCall('route', { requestId: second, connectionId: 'second', coordinates: points })).toMatchObject({ ok: true, data: { distanceMeters: 1000 } })
    expect(mock.fetch.mock.calls.map(([request]) => request.credential?.handle)).toEqual(['opaque:first', 'opaque:second'])
    expect(mock.cancel.mock.calls).toEqual([[mock.fetch.mock.calls[0][0].requestId]])
    finish(jsonResponse(routeBody))
    expect(await pending).toEqual({ __mapRequestCancelled: true })
    await cancelling
    await mock.rawCall('finishRequest', { requestId: first })
    await mock.rawCall('finishRequest', { requestId: second })
    mock.dispose()
  })

  it('remembers cancellation before service delivery and never recreates finished scopes', async () => {
    const mock = setup([account('field', 'mapbox')])
    const requestId = await mock.rawCall('beginRequest')
    await mock.rawCall('cancelRequest', { requestId })
    const payload = { requestId, connectionId: 'field', query: 'Forest' }
    expect(await mock.rawCall('geocode', payload)).toEqual({ __mapRequestCancelled: true })
    await mock.rawCall('finishRequest', { requestId })
    expect(await mock.rawCall('geocode', payload)).toEqual({ __mapRequestCancelled: true })
    await expect(mock.rawCall('cancelRequest', { requestId })).rejects.toThrow('Unknown map request')
    expect(mock.authorize).not.toHaveBeenCalled()
    expect(mock.fetch).not.toHaveBeenCalled()
    const next = await mock.rawCall('beginRequest')
    expect(next).not.toBe(requestId)
    await mock.rawCall('finishRequest', { requestId: next })
    mock.dispose()
  })

  it('waits for pending authorization to settle and prevents subsequent network dispatch', async () => {
    const mock = setup([account('field', 'mapbox')])
    let authorize!: (value: string) => void
    mock.authorize.mockImplementationOnce(() => new Promise(resolve => { authorize = resolve }))
    const requestId = await mock.rawCall('beginRequest')
    const operation = mock.rawCall('route', { requestId, connectionId: 'field', coordinates: points })
    await vi.waitFor(() => expect(mock.authorize).toHaveBeenCalledTimes(1))
    let settled = false
    const cancellation = mock.rawCall('cancelRequest', { requestId }).then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    authorize('opaque:field')
    expect(await operation).toEqual({ __mapRequestCancelled: true })
    await cancellation
    expect(mock.fetch).not.toHaveBeenCalled()
    await mock.rawCall('finishRequest', { requestId })
    mock.dispose()
  })

  it('cancels the actual network transfer, awaits its settlement and stops the next elevation point', async () => {
    const mock = setup([account('field')])
    let finish!: (value: PluginFetchResponse) => void
    mock.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const requestId = await mock.rawCall('beginRequest')
    const operation = mock.rawCall('elevation', { requestId, connectionId: 'field', coordinates: points })
    await vi.waitFor(() => expect(mock.fetch).toHaveBeenCalledTimes(1))
    let settled = false
    const cancellation = mock.rawCall('cancelRequest', { requestId }).then(() => { settled = true })
    expect(mock.cancel).toHaveBeenCalledWith(mock.fetch.mock.calls[0][0].requestId)
    await Promise.resolve()
    expect(settled).toBe(false)
    finish(jsonResponse({ geometry: { coordinates: [8, 12, 450] } }))
    expect(await operation).toEqual({ __mapRequestCancelled: true })
    await cancellation
    expect(mock.fetch).toHaveBeenCalledTimes(1)
    await mock.rawCall('finishRequest', { requestId })
    mock.dispose()
  })

  it('bounds retained request scopes and frees capacity only after finishing their lifetime', async () => {
    const mock = setup()
    const ids = await Promise.all(Array.from({ length: 32 }, () => mock.rawCall('beginRequest')))
    await expect(mock.rawCall('beginRequest')).rejects.toThrow('limit reached')
    await mock.rawCall('cancelRequest', { requestId: ids[0] })
    await expect(mock.rawCall('beginRequest')).rejects.toThrow('limit reached')
    await mock.rawCall('finishRequest', { requestId: ids[0] })
    const replacement = await mock.rawCall('beginRequest')
    expect(ids).not.toContain(replacement)
    await Promise.all([...ids.slice(1), replacement].map(requestId => mock.rawCall('finishRequest', { requestId })))
    expect(mock.fetch).not.toHaveBeenCalled()
    mock.dispose()
  })

  it('searches and retrieves tiles through scoped opaque credentials', async () => {
    const mock = setup([account('field', 'mapbox')])
    mock.fetch.mockResolvedValueOnce(jsonResponse({ features: [{ id: 'place.1', geometry: { coordinates: [8, 12] }, properties: { name: 'Forest', full_address: 'Forest, Reserve' } }] }))
    expect(await mock.call('geocode', { connectionId: 'field', query: 'Forest', limit: 5 })).toMatchObject({ ok: true, data: { places: [{ name: 'Forest', longitude: 8, latitude: 12 }] } })
    expect(mock.authorize).toHaveBeenCalledWith('field', 'geo.search', { host: 'api.mapbox.com', port: 443, security: 'tls' })
    expect(mock.fetch.mock.calls[0][0]).toEqual({ url: 'https://api.mapbox.com/search/geocode/v6/forward?q=Forest&limit=5', credential: { handle: 'opaque:field', placement: 'query', name: 'access_token' }, requestId: expect.any(String) })
    mock.fetch.mockResolvedValueOnce({ status: 200, headers: {}, bodyBase64: 'dGlsZQ==' })
    expect(await mock.call('tile', { connectionId: 'field', style: 'streets-v12', z: 2, x: 1, y: 2 })).toEqual({ bodyBase64: 'dGlsZQ==' })
    expect(mock.fetch.mock.calls.at(-1)![0].url).toBe('https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/2/1/2@2x')
    expect(JSON.stringify(await mock.call('listConnections'))).not.toContain('opaque:')
  })

  it('biases account and public search toward a nearby point and rejects an invalid one before dispatch', async () => {
    const mock = setup([account('field', 'mapbox')])
    mock.fetch.mockResolvedValueOnce(jsonResponse({ features: [] }))
    await mock.call('geocode', { connectionId: 'field', query: 'Station', limit: 5, near: [8.54, 47.37] })
    expect(mock.fetch.mock.calls[0][0].url).toBe('https://api.mapbox.com/search/geocode/v6/forward?q=Station&limit=5&proximity=8.54,47.37')
    mock.fetch.mockResolvedValueOnce(jsonResponse([]))
    await mock.call('publicJson', { service: 'search', query: 'Station', near: [8.54, 47.37] })
    expect(mock.fetch.mock.calls[1][0].url).toContain('&viewbox=8.04000,47.87000,9.04000,46.87000')
    expect(mock.fetch.mock.calls[1][0].url).not.toContain('bounded=1')
    expect(await mock.call('geocode', { connectionId: 'field', query: 'Station', near: [8, 95] })).toMatchObject({ ok: false })
    expect(mock.fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps provider routing and account authorization inside the package', async () => {
    const mock = setup([account('field'), account('survey'), account('tiles', 'mapbox')])
    mock.fetch.mockResolvedValue(jsonResponse(routeBody))
    for (const [connectionId, profile, suffix] of [['field', 'walking', 'foot-walking'], ['survey', 'cycling', 'cycling-regular']]) {
      expect(await mock.call('route', { connectionId, coordinates: points, profile })).toEqual({ ok: true, data: { coordinates: points, distanceMeters: 1000, durationSeconds: 600 } })
      const request = mock.fetch.mock.calls.at(-1)![0]
      expect(request.url).toBe(`https://api.heigit.org/openrouteservice/v2/directions/${suffix}/geojson`)
      expect(request.credential).toEqual({ handle: `opaque:${connectionId}`, placement: 'header', name: 'Authorization' })
      expect(JSON.parse(Buffer.from(request.bodyBase64!, 'base64').toString())).toEqual({ coordinates: points })
    }
    mock.fetch.mockResolvedValueOnce(jsonResponse({ routes: [{ geometry: { coordinates: points }, distance: 1000, duration: 600 }] }))
    await mock.call('route', { connectionId: 'tiles', coordinates: points, profile: 'driving' })
    expect(mock.fetch.mock.calls.at(-1)![0].url).toContain('/mapbox/driving/8,12;8.1,12.1?')
  })

  it('reports observed quotas independently per connection without extra requests', async () => {
    const mock = setup([account('field'), account('survey')])
    expect(await mock.call('listConnections')).toMatchObject({ data: { connections: [expect.objectContaining({ usage: [] }), expect.objectContaining({ usage: [] })] } })
    expect(mock.fetch).not.toHaveBeenCalled()
    for (const [id, remaining] of [['field', '1980'], ['survey', '1750']]) {
      mock.fetch.mockResolvedValueOnce(jsonResponse(routeBody, { 'x-ratelimit-limit': '2000', 'x-ratelimit-remaining': remaining, 'x-ratelimit-reset': '1800000000' }))
      await mock.call('route', { connectionId: id, coordinates: points, profile: 'walking' })
    }
    mock.fetch.mockResolvedValue(jsonResponse({ geometry: { coordinates: [8, 12, 450] } }, { 'x-ratelimit-limit': '1000', 'x-ratelimit-remaining': '998' }))
    expect(await mock.call('elevation', { connectionId: 'field', coordinates: points })).toMatchObject({ data: { elevations: [450, 450] } })
    expect(await mock.call('listConnections')).toMatchObject({ data: { connections: [
      { id: 'field', usage: [{ service: 'routing', remaining: 1980, observedAt: expect.any(Number), resetAt: 1800000000000 }, { service: 'elevation', remaining: 998 }] },
      { id: 'survey', usage: [{ service: 'routing', remaining: 1750 }] }
    ] } })
    expect(mock.fetch).toHaveBeenCalledTimes(4)
  })

  it('ignores invalid quota headers and records exhausted quota from failed requests', async () => {
    const mock = setup([account('field')])
    for (const headers of ([{}, { 'x-ratelimit-limit': '2000', 'x-ratelimit-remaining': '' }, { 'x-ratelimit-limit': '2000', 'x-ratelimit-remaining': '-1' }, { 'x-ratelimit-limit': '10', 'x-ratelimit-remaining': '20' }] as Array<Record<string, string>>)) {
      mock.fetch.mockResolvedValueOnce(jsonResponse(routeBody, headers))
      await mock.call('route', { connectionId: 'field', coordinates: points })
      expect(await mock.call('listConnections')).toMatchObject({ data: { connections: [{ usage: [] }] } })
    }
    mock.fetch.mockResolvedValueOnce(jsonResponse({ error: 'Daily quota reached' }, { 'x-ratelimit-limit': '2000', 'x-ratelimit-remaining': '0' }, 403))
    expect(await mock.call('route', { connectionId: 'field', coordinates: points })).toMatchObject({ ok: false })
    expect(await mock.call('listConnections')).toMatchObject({ data: { connections: [{ usage: [{ remaining: 0, limit: 2000 }] }] } })
  })

  it('reports a failed service that answers with an HTML page as a failed request, not a JSON error', async () => {
    const mock = setup([account('field')])
    mock.fetch.mockResolvedValueOnce({ status: 502, headers: {}, bodyBase64: Buffer.from('<html><h1>Bad gateway</h1></html>').toString('base64') })
    const failed = await mock.call('route', { connectionId: 'field', coordinates: points }) as { ok: boolean; error?: { message: string } }
    expect(failed).toMatchObject({ ok: false })
    expect(JSON.stringify(failed)).toContain('Map service request failed (502)')
    expect(JSON.stringify(failed)).not.toContain('Unexpected token')
  })

  it('validates requests before network dispatch and unregisters on disposal', async () => {
    const mock = setup([account('field')])
    expect(await mock.call('route', { connectionId: 'field', coordinates: [[200, 90], [0, 0]] })).toMatchObject({ ok: false })
    expect(await mock.call('geocode', { connectionId: 'field', query: 'Forest' })).toMatchObject({ ok: false })
    await expect(mock.call('tile', { connectionId: 'field', style: '../bad', z: 0, x: 0, y: 0 })).rejects.toThrow('Invalid tile')
    await expect(mock.call('publicJson', { service: 'https://example.com' })).rejects.toThrow('Unknown map service')
    expect(mock.fetch).not.toHaveBeenCalled()
    mock.dispose()
    expect(mock.handlers.size).toBe(0)
  })

  it('uses only package-selected public service endpoints', async () => {
    const mock = setup()
    mock.fetch.mockResolvedValue(jsonResponse([]))
    await mock.call('publicJson', { service: 'search', query: 'Forest & river' })
    expect(mock.fetch.mock.calls[0][0].url).toBe('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&q=Forest%20%26%20river')
    await mock.call('publicJson', { service: 'route', waypoints: points.map(([lng, lat]) => ({ lng, lat })), mode: 'walking' })
    expect(mock.fetch.mock.calls.at(-1)![0]).toMatchObject({ url: expect.stringContaining('routing.openstreetmap.de/routed-foot/'), timeoutMs: 20000 })
    expect(mock.authorize).not.toHaveBeenCalled()
  })
  it.each(['a', 'b', 'c', 'd'])('loads CARTO vector tiles from shard %s through declared network permissions', async (shard) => {
    const mock = setup()
    const url = `https://tiles-${shard}.basemaps.cartocdn.com/vectortiles/carto.streets/v1/0/0/0.mvt`
    mock.fetch.mockResolvedValue({ status: 200, headers: {}, bodyBase64: 'dGlsZQ==' })
    try {
      expect(await mock.call('resource', { url })).toEqual({ bodyBase64: 'dGlsZQ==' })
      expect(mock.fetch).toHaveBeenCalledTimes(1)
      expect(mock.fetch).toHaveBeenCalledWith({ url })
      expect(config.permissions.network.hosts).toContain(new URL(url).hostname)
      expect(mock.authorize).not.toHaveBeenCalled()
    } finally { mock.dispose() }
  })

  it.each([
    'http://tiles-a.basemaps.cartocdn.com/vectortiles/carto.streets/v1/0/0/0.mvt',
    'https://tiles-a.basemaps.cartocdn.com.unrelated.example.test/tile.mvt',
    'https://tiles-e.basemaps.cartocdn.com/tile.mvt'
  ])('rejects unsupported map resource URLs before network dispatch: %s', async (url) => {
    const mock = setup()
    try {
      await expect(mock.call('resource', { url })).rejects.toThrow('Unknown map resource host')
      expect(mock.fetch).not.toHaveBeenCalled()
    } finally { mock.dispose() }
  })

  it('loads style assets and bounded offline archive ranges only through package backend capabilities', async () => {
    const mock = setup()
    mock.fetch.mockResolvedValue({ status: 200, headers: {}, bodyBase64: 'dGlsZQ==' })
    expect(await mock.call('resource', { url: 'https://basemaps.cartocdn.com/gl/style.json' })).toEqual({ bodyBase64: 'dGlsZQ==' })
    await expect(mock.call('resource', { url: 'https://unrelated.example.test/private' })).rejects.toThrow('Unknown map resource host')
    expect(mock.fetch).toHaveBeenCalledTimes(1)
    expect(await mock.call('offlineRange', { path: 'Maps/local.pmtiles', offset: 2, length: 5 })).toEqual({ bodyBase64: Buffer.from('chive').toString('base64'), etag: 'unchanged' })
    expect(mock.files.read).toHaveBeenCalledWith('archive', { offset: 2, maxBytes: 5 })
    await expect(mock.call('offlineRange', { path: 'Maps/local.pmtiles', offset: -1, length: 1 })).rejects.toThrow('range')
    await expect(mock.call('offlineRange', { path: 'Notes/document.md', offset: 0, length: 1 })).rejects.toThrow('range')
    mock.dispose()
  })

})

  it('uses the package locale for backend errors and follows language changes', async () => {
    const mock = setup([])
    mock.i18n.t = (key: string) => (de as Record<string, string>)[key] ?? key
    expect(await mock.call('route', { connectionId: 'account', coordinates: [[999, 90], [2, 3]] })).toMatchObject({ ok: false, error: de['backend.coordinate'] })
    mock.i18n.t = (key: string) => key
    expect((await mock.call('route', { connectionId: 'account', coordinates: [[999, 90], [2, 3]] }) as { error: string }).error).not.toBe(de['backend.coordinate'])
    mock.dispose()
  })
