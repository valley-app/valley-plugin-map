import { describe, expect, it, vi } from 'vitest'
import { createMockValleyApi } from '@valley/plugin-testkit'
import { createMapRequests, MapRequestCancelled, withMapRequest } from '../src/requests'
import { planRoute } from '../src/routing'
import { initRuntime } from '../src/runtime'
import { resolveSettings } from '../src/settings'
import { accountProviderChoice } from '../src/settings'
import { searchPlacesWithProvider } from '../src/geocode'
import { PUBLIC_SEARCH_ID, searchProviderIdentity } from '../src/geocodeProviders'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fixture(handle: (method: string, payload?: unknown) => Promise<unknown>) {
  const { api } = createMockValleyApi()
  const calls = vi.fn(handle)
  api.backend.call = async <T>(method: string, payload?: unknown) => await calls(method, payload) as T
  return { api, calls }
}

const waypoints = [{ lng: 8, lat: 12, label: 'Start' }, { lng: 8.1, lat: 12.1, label: 'End' }]
const route = { routes: [{ geometry: { coordinates: [[8, 12], [8.1, 12.1]] }, distance: 1000, duration: 300 }] }

describe('Map request lifetimes', () => {
  it('reports the provider actually used by account success and public fallback', async () => {
    let accountWorks = false
    const mock = fixture(async method => {
      if (method === 'beginRequest') return 'scope'
      if (method === 'geocode') return accountWorks ? { ok: true, data: { places: [{ id: '1', name: 'Account', longitude: 8, latitude: 12 }] } } : { ok: false, error: 'Account unavailable' }
      if (method === 'publicJson') return { status: 200, json: [{ lat: 12, lon: 8, display_name: 'Public' }] }
    })
    const selected = resolveSettings({ mapboxEnabled: true, searchProvider: accountProviderChoice('mapbox', 'field') })
    const lookup = () => withMapRequest(mock.api, undefined, request => searchPlacesWithProvider('Grove', selected, request))
    expect(await lookup()).toMatchObject({ provider: PUBLIC_SEARCH_ID, places: [{ name: 'Public' }] })
    accountWorks = true
    expect(await lookup()).toMatchObject({ provider: searchProviderIdentity(selected), places: [{ name: 'Account' }] })
    expect(mock.calls.mock.calls.filter(([method]) => method === 'publicJson')).toHaveLength(1)
  })

  it('remembers abort during begin delivery and awaits cancel and finish without dispatching a service', async () => {
    const begin = deferred<string>()
    const cancel = deferred<boolean>()
    const finish = deferred<void>()
    const mock = fixture(async method => {
      if (method === 'beginRequest') return begin.promise
      if (method === 'cancelRequest') return cancel.promise
      if (method === 'finishRequest') return finish.promise
      throw new Error(`Unexpected service ${method}`)
    })
    const controller = new AbortController()
    const run = vi.fn(async () => 'unused')
    let settled = false
    const result = withMapRequest(mock.api, controller.signal, run).catch(error => { settled = true; return error })
    controller.abort()
    begin.resolve('scope-one')
    await vi.waitFor(() => expect(mock.calls).toHaveBeenCalledWith('cancelRequest', { requestId: 'scope-one' }))
    expect(run).not.toHaveBeenCalled()
    expect(settled).toBe(false)
    expect(mock.calls.mock.calls.map(([method]) => method)).toEqual(['beginRequest', 'cancelRequest'])
    cancel.resolve(true)
    await vi.waitFor(() => expect(mock.calls).toHaveBeenCalledWith('finishRequest', { requestId: 'scope-one' }))
    expect(settled).toBe(false)
    finish.resolve()
    expect(await result).toBeInstanceOf(MapRequestCancelled)
  })

  it('disposes only after the active service and finish settle, rejecting work during the drain', async () => {
    const service = deferred<{ status: number; json: unknown }>()
    const finish = deferred<void>()
    const mock = fixture(async method => {
      if (method === 'beginRequest') return 'scope'
      if (method === 'publicJson') return service.promise
      if (method === 'finishRequest') return finish.promise
      return true
    })
    const requests = createMapRequests(mock.api)
    const result = requests.run(undefined, request => request.services.publicJson({ service: 'search', query: 'Forest' })).catch(error => error)
    await vi.waitFor(() => expect(mock.calls).toHaveBeenCalledWith('publicJson', expect.anything()))
    let disposed = false
    const disposing = requests.dispose().then(() => { disposed = true })
    await expect(requests.run(undefined, async () => 'new')).rejects.toBeInstanceOf(MapRequestCancelled)
    await vi.waitFor(() => expect(mock.calls).toHaveBeenCalledWith('cancelRequest', { requestId: 'scope' }))
    expect(disposed).toBe(false)
    service.resolve({ status: 200, json: [] })
    await vi.waitFor(() => expect(mock.calls).toHaveBeenCalledWith('finishRequest', { requestId: 'scope' }))
    expect(disposed).toBe(false)
    finish.resolve()
    expect(await result).toBeInstanceOf(MapRequestCancelled)
    await disposing
    expect(disposed).toBe(true)
    expect(mock.calls.mock.calls.filter(([method]) => method === 'cancelRequest')).toHaveLength(1)
  })

  it('keeps fallback routing on its originating API after another runtime is bound', async () => {
    const first = deferred<unknown>()
    let fetches = 0
    const origin = fixture(async method => {
      if (method === 'beginRequest') return 'origin'
      if (method === 'publicJson') return ++fetches === 1 ? first.promise : { status: 200, json: route }
    })
    const replacement = fixture(async () => { throw new Error('Wrong API') })
    initRuntime(origin.api)
    const planning = planRoute(waypoints, 'walking', resolveSettings({}))
    await vi.waitFor(() => expect(fetches).toBe(1))
    initRuntime(replacement.api)
    first.reject(new Error('Provider unavailable'))
    expect(await planning).toMatchObject({ geometry: [[8, 12], [8.1, 12.1]], modeApproximated: true })
    expect(origin.calls.mock.calls.filter(([method]) => method === 'publicJson').map(([, payload]) => payload)).toEqual([
      expect.objectContaining({ demo: false, requestId: 'origin' }),
      expect.objectContaining({ demo: true, requestId: 'origin' })
    ])
    expect(replacement.calls).not.toHaveBeenCalled()
    expect(origin.calls).toHaveBeenLastCalledWith('finishRequest', { requestId: 'origin' })
  })

  it('does not start the route fallback when cancellation and a provider failure settle together', async () => {
    const first = deferred<unknown>()
    const mock = fixture(async method => {
      if (method === 'beginRequest') return 'scope'
      if (method === 'publicJson') return first.promise
      return true
    })
    const controller = new AbortController()
    const result = withMapRequest(mock.api, controller.signal, request => planRoute(waypoints, 'walking', resolveSettings({}), request)).catch(error => error)
    await vi.waitFor(() => expect(mock.calls).toHaveBeenCalledWith('publicJson', expect.anything()))
    controller.abort()
    first.reject(new Error('Connection aborted'))
    expect(await result).toBeInstanceOf(MapRequestCancelled)
    expect(mock.calls.mock.calls.filter(([method]) => method === 'publicJson')).toHaveLength(1)
    expect(mock.calls).toHaveBeenLastCalledWith('finishRequest', { requestId: 'scope' })
  })

  it('bounds pending scopes and reopens the owner after a temporary cancellation drain', async () => {
    const begin = deferred<string>()
    let sequence = 0
    const mock = fixture(async method => method === 'beginRequest' ? `${await begin.promise}-${++sequence}` : true)
    const owner = createMapRequests(mock.api)
    const run = vi.fn(async () => 'new')
    const results = Array.from({ length: 32 }, () => owner.run(undefined, run).catch(error => error))
    await expect(owner.run(undefined, run)).rejects.toThrow('limit reached')
    const draining = owner.cancelAll()
    await expect(owner.run(undefined, run)).rejects.toBeInstanceOf(MapRequestCancelled)
    begin.resolve('scope')
    expect((await Promise.all(results)).every(error => error instanceof MapRequestCancelled)).toBe(true)
    await draining
    expect(run).not.toHaveBeenCalled()
    expect(await owner.run(undefined, run)).toBe('new')
    await owner.dispose()
  })

  it('preserves the original failure when the captured API is revoked during cleanup', async () => {
    const mock = fixture(async method => {
      if (method === 'beginRequest') return 'scope'
      throw new Error('Revoked API')
    })
    const error = new Error('Original failure')
    await expect(withMapRequest(mock.api, undefined, async () => { throw error })).rejects.toBe(error)
    expect(mock.calls).toHaveBeenLastCalledWith('finishRequest', { requestId: 'scope' })
  })

  it('rejects a completed service result when its owner is disposed during finish delivery', async () => {
    const finish = deferred<void>()
    const mock = fixture(async method => method === 'beginRequest' ? 'scope' : finish.promise)
    const requests = createMapRequests(mock.api)
    const result = requests.run(undefined, async () => 'obsolete result').catch(error => error)
    await vi.waitFor(() => expect(mock.calls).toHaveBeenCalledWith('finishRequest', { requestId: 'scope' }))
    const disposing = requests.dispose()
    finish.resolve()
    expect(await result).toBeInstanceOf(MapRequestCancelled)
    await disposing
  })
})
