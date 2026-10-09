import { parseMapFence } from '../src/mapEmbed'
import codeBlockExamples from '../src/codeBlockExamples.json'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
vi.mock('../src/mapEngine', () => ({ MapEngine: vi.fn() }))
import { createMockValleyApi, type MockValleyApi } from './harness'
import { createStore, disposeStore, type MapStore } from '../src/store'
import { openOnMap, registerMapboxCommands } from '../src/commands'
import type { Place, Route } from '../src/types'
import { initRuntime } from '../src/runtime'
import { initLocalization } from '../src/localization'
import { registerMapAutomation } from '../src/automation'
import { registerMapSurfaces } from '../src/surfaces'
import { METADATA_PANEL_SEGMENT_V1, PLUGIN_SURFACE_V1 } from '@valley/plugin-sdk'

const seededPlace: Place = {
  id: 'place-seed',
  name: 'Fox Den',
  lng: 8.54,
  lat: 12.37,
  createdAt: '2026-01-01T00:00:00Z'
}
const seededRoute: Route = {
  id: 'route-seed',
  name: 'Canopy Route',
  mode: 'cycling',
  waypoints: [
    { lng: 8.54, lat: 12.37, label: 'A' },
    { lng: 8.56, lat: 12.38, label: 'B' }
  ],
  createdAt: '2026-01-01T00:00:00Z'
}

// Nominatim/OSRM responses keyed off the request URL (no mapbox token in settings).
function stubNetwork(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/search')) {
        return { ok: true, json: async () => [{ lat: '48.8584', lon: '2.2945', display_name: 'Rainforest Observatory, Canopy Reserve' }] }
      }
      if (url.includes('/reverse')) {
        return { ok: true, json: async () => ({ display_name: 'Forest Trail 1, Example Grove' }) }
      }
      if (url.includes('/route/v1')) {
        return {
          ok: true,
          json: async () => ({
            routes: [
              {
                distance: 1200,
                duration: 300,
                geometry: { coordinates: [[8.54, 12.37], [2.2945, 48.8584]] },
                legs: [{ steps: [{ maneuver: { type: 'depart' }, name: 'A St', distance: 200, duration: 50 }, { maneuver: { type: 'arrive' }, name: '', distance: 0, duration: 0 }] }]
              }
            ]
          })
        }
      }
      throw new Error(`unexpected fetch ${url}`)
    })
  )
}

interface Harness {
  api: MockValleyApi['api']
  busUndo: MockValleyApi['busUndo']
  store: MapStore
}

async function setup(): Promise<Harness> {
  const mock = createMockValleyApi({
    manifest: { id: 'map' },
    datasets: {
      'map.places': [{ ...seededPlace, category: null, color: null, note: null, position: 0 }],
      'map.routes': [{
        id: seededRoute.id,
        name: seededRoute.name,
        mode: seededRoute.mode,
        geometry: null,
        distanceM: null,
        durationS: null,
        note: null,
        position: 0,
        createdAt: seededRoute.createdAt
      }],
      'map.route_waypoints': seededRoute.waypoints.map((waypoint, position) => ({
        routeId: seededRoute.id,
        position,
        ...waypoint
      }))
    }
  })
  const store = createStore(mock.api)
  initRuntime(mock.api)
  initLocalization(mock.api)
  registerMapboxCommands(mock.api)
  registerMapAutomation(mock.api)
  registerMapSurfaces(mock.api)
  await store.ready
  return { api: mock.api, busUndo: mock.busUndo, store }
}

describe('mapbox commands', () => {
  let h: Harness

  beforeEach(async () => {
    stubNetwork()
    h = await setup()
  })

  afterEach(() => {
    disposeStore(h.store)
    vi.unstubAllGlobals()
  })

  it('search geocodes and centres the map', async () => {
    const res = await h.api.commands.execute('map:search', { query: 'Rainforest Observatory' })
    expect(res.ok).toBe(true)
    expect(res.ok && res.value).toMatchObject({ name: 'Rainforest Observatory, Canopy Reserve', lat: 48.8584 })
  })

  it('declares map-session and persisted style mutations as writes and waits for saved owner state', async () => {
    const writes = ['open', 'describe', 'search', 'plan-route', 'goto', 'set-style', 'clear-route', 'show-place', 'show-route']
    for (const id of writes) expect(h.api.commands.list().find(command => command.id === `map:${id}`)?.sideEffect, id).toBe('write')
    expect(await h.api.commands.executeOwn('set-style', { style: 'satellite' })).toMatchObject({ ok: true, value: { style: 'satellite' } })
    expect(h.api.settings.get().mapViewState).toMatchObject({ style: 'satellite' })
    expect(await h.api.commands.executeOwn('show-route', { id: seededRoute.id })).toMatchObject({ ok: true, value: { id: seededRoute.id } })
    expect(h.api.settings.get().mapSessionState).toMatchObject({ savedRouteId: seededRoute.id })
    expect(await h.api.commands.executeOwn('clear-route')).toMatchObject({ ok: true, value: null })
    expect(h.api.settings.get().mapSessionState).toMatchObject({ savedRouteId: null })
  })

  it('refuses retained cancelled, disposed and replaced command owners before changing the store', async () => {
    const registrations = vi.spyOn(h.api.commands, 'register')
    const off = registerMapboxCommands(h.api)
    const command = registrations.mock.calls.find(([item]) => item.id === 'set-style')![0]
    const controller = new AbortController(); controller.abort()
    await expect(command.run({ style: 'satellite' }, { caller: 'agent', cancellation: controller.signal })).rejects.toThrow()
    expect(h.store.getSnapshot().style).toBe('streets')
    off()
    await expect(command.run({ style: 'satellite' }, { caller: 'agent' })).rejects.toThrow()
    expect(h.store.getSnapshot().style).toBe('streets')
    const next = createStore(h.api)
    await next.ready
    await expect(command.run({ style: 'satellite' }, { caller: 'agent' })).rejects.toThrow()
    expect(next.getSnapshot().style).toBe('streets')
    await disposeStore(next)
  })

  it('publishes separate saved-item and view targets and restores after load without opening the map', async () => {
    const surface = h.api.interop.extensions.providers(PLUGIN_SURFACE_V1).find(({ extension }) => extension.surface === 'left_sidebar')!.extension
    await surface.restore({ panelTab: 'places', selectedPlaceId: seededPlace.id }, undefined, { background: true })
    const snapshot = surface.getSnapshot()
    expect(snapshot.item).toMatchObject({ id: seededPlace.id, title: seededPlace.name })
    expect(snapshot.view.selectedPlaceId).toBeNull()
    expect(snapshot.view).not.toHaveProperty('plannerStops')
    expect(h.api.workspace.openMainTab).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    const before = h.store.getSnapshot()
    surface.getSnapshot()
    expect(h.store.getSnapshot()).toBe(before)
    await expect(surface.restore({ selectedPlaceId: 'removed' })).rejects.toThrow('unavailable')
    expect(h.store.getSnapshot().selectedPlaceId).toBe(seededPlace.id)
  })

  it('restores a saved route without requesting routing or opening another panel', async () => {
    const surface = h.api.interop.extensions.providers(PLUGIN_SURFACE_V1).find(({ extension }) => extension.surface === 'right_sidebar')!.extension
    await surface.restore({ savedRouteId: seededRoute.id }, undefined, { background: true })
    expect(surface.getSnapshot().item?.id).toBe(seededRoute.id)
    expect(h.store.getSnapshot().plannerStops).toMatchObject(seededRoute.waypoints)
    expect(fetch).not.toHaveBeenCalled()
    expect(h.api.workspace.openMainTab).not.toHaveBeenCalled()
  })

  it('inspects and updates the exact saved place and supports undo', async () => {
    const subject = { pluginId: 'map', surface: 'main_workspace' as const, view: {}, item: { id: seededPlace.id, title: seededPlace.name, state: { selectedPlaceId: seededPlace.id } } }
    const segment = h.api.interop.extensions.providers(METADATA_PANEL_SEGMENT_V1)[0].extension
    expect(await segment.inspect!({ relPath: '', kind: 'unsupported', subject })).toContainEqual(expect.objectContaining({ id: 'name', value: seededPlace.name }))
    const result = await h.api.commands.execute('map:properties-edit', { subject, values: { name: 'New den', color: '#ff0000' } })
    expect(result.ok).toBe(true)
    expect(h.store.getSnapshot().places[0]).toMatchObject({ id: seededPlace.id, name: 'New den', color: '#ff0000' })
    await h.busUndo.at(-1)!.undo()
    expect(h.store.getSnapshot().places[0].name).toBe(seededPlace.name)
    expect((await h.api.commands.execute('map:properties-edit', { subject, values: { lng: 181 } })).ok).toBe(false)
    expect(h.store.getSnapshot().places[0].lng).toBe(seededPlace.lng)
  })

  it('creates, reorders and deletes pin sources with persisted undo', async () => {
    const previous = h.store.getSnapshot().pinSources
    const added = await h.api.commands.execute('map:save-pin-source', { source: { title: 'Research', matchKey: 'topic', matchValue: 'forest' } })
    expect(added.ok).toBe(true)
    const id = added.ok ? (added.value as { id: string }).id : ''
    expect(h.store.getSnapshot().pinSources.some((source) => source.id === id)).toBe(true)
    const ids = h.store.getSnapshot().pinSources.map((source) => source.id).reverse()
    expect((await h.api.commands.execute('map:reorder-pin-sources', { ids })).ok).toBe(true)
    expect(h.store.getSnapshot().pinSources.map((source) => source.id)).toEqual(ids)
    expect((await h.api.commands.execute('map:delete-pin-source', { id })).ok).toBe(true)
    await h.busUndo.at(-1)!.undo()
    expect(h.store.getSnapshot().pinSources.some((source) => source.id === id)).toBe(true)
    expect(h.store.getSnapshot().pinSources).toHaveLength(previous.length + 1)
  })

  it('refuses unknown or mismatched pin sources as known no-effect outcomes', async () => {
    const registrations = vi.spyOn(h.api.commands, 'register')
    const off = registerMapAutomation(h.api)
    const command = (id: string) => registrations.mock.calls.find(([item]) => item.id === id)![0]
    const before = structuredClone(h.store.getSnapshot().pinSources)
    const save = vi.spyOn(h.store, 'savePinSources')
    const cases: [string, Record<string, unknown>, string][] = [
      ['save-pin-source', { source: { id: 'ghost', title: 'Ghost' } }, 'NOT_FOUND'],
      ['save-pin-source', { source: { title: '' } }, 'INVALID_INPUT'],
      ['delete-pin-source', { id: 'ghost' }, 'NOT_FOUND'],
      ['reorder-pin-sources', { ids: ['ghost'] }, 'INVALID_INPUT']
    ]
    for (const [id, input, code] of cases) {
      let error: unknown
      try { await command(id).run(input, { caller: 'agent' }) } catch (caught) { error = caught }
      expect(error, id).toMatchObject({ code, outcome: 'not-applied' })
    }
    expect(save).not.toHaveBeenCalled()
    save.mockReturnValueOnce(false)
    await expect(command('save-pin-source').run({ source: { title: 'Research' } }, { caller: 'agent' })).rejects.toMatchObject({ code: 'PIN_SOURCES_UNAVAILABLE', outcome: 'not-applied' })
    expect(h.store.getSnapshot().pinSources).toEqual(before)
    off()
  })

  it('exports route data and imports it as a new reversible saved route', async () => {
    const exported = await h.api.commands.execute('map:export-route', { id: seededRoute.id, format: 'geojson' })
    expect(exported.ok).toBe(true)
    const content = exported.ok ? (exported.value as { content: string }).content : ''
    expect(JSON.parse(content).type).toBe('FeatureCollection')
    const imported = await h.api.commands.execute('map:import-route', { name: 'Copied route', format: 'geojson', content, mode: 'cycling' })
    expect(imported.ok).toBe(true)
    expect(h.store.getSnapshot().routes).toHaveLength(2)
    await h.busUndo.at(-1)!.undo()
    expect(h.store.getSnapshot().routes.map((route) => route.id)).toEqual([seededRoute.id])
    expect((await h.api.commands.execute('map:import-route', { name: 'Bad path', path: '../outside.gpx' })).ok).toBe(false)
  })

  it('refuses unreadable or unusable route data before importing anything', async () => {
    const registrations = vi.spyOn(h.api.commands, 'register')
    const off = registerMapAutomation(h.api)
    const run = registrations.mock.calls.find(([item]) => item.id === 'import-route')![0].run
    const importRoute = vi.spyOn(h.store, 'importRoute')
    const readFile = vi.spyOn(h.api.drivers.files, 'readFile')
    const base = { name: 'Imported', path: '', content: '', format: 'gpx' as const, mode: 'driving' as const }
    readFile.mockResolvedValueOnce({ ok: false, error: 'denied' })
    await expect(run({ ...base, path: 'routes/a.gpx' }, { caller: 'agent' })).rejects.toMatchObject({ code: 'FILE_UNAVAILABLE', outcome: 'not-applied' })
    readFile.mockRejectedValueOnce(new Error('io'))
    await expect(run({ ...base, path: 'routes/a.gpx' }, { caller: 'agent' })).rejects.toMatchObject({ code: 'FILE_UNAVAILABLE', outcome: 'not-applied' })
    readFile.mockResolvedValueOnce({ ok: true, data: { content: '' } })
    await expect(run({ ...base, path: 'routes/missing.gpx' }, { caller: 'agent' })).rejects.toMatchObject({ code: 'INVALID_INPUT', outcome: 'not-applied' })
    await expect(run({ ...base, format: 'geojson', content: '{not json' }, { caller: 'agent' })).rejects.toMatchObject({ code: 'INVALID_INPUT', outcome: 'not-applied' })
    await expect(run({ ...base, content: '<gpx><wpt lat="1" lon="2"></wpt></gpx>' }, { caller: 'agent' })).rejects.toMatchObject({ code: 'INVALID_INPUT', outcome: 'not-applied' })
    const tooMany = JSON.stringify({ type: 'FeatureCollection', features: Array.from({ length: 101 }, (_, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [i / 10, 1] } })) })
    await expect(run({ ...base, format: 'geojson', content: tooMany }, { caller: 'agent' })).rejects.toMatchObject({ code: 'INVALID_INPUT', outcome: 'not-applied' })
    expect(importRoute).not.toHaveBeenCalled()
    expect(h.store.getSnapshot().routes.map((route) => route.id)).toEqual([seededRoute.id])
    off()
  })

  it('opens the map even when the label geocodes to nothing', async () => {
    // A todo's location can be a room inside a building — a label with no fix.
    // The map still has to open: a click that resolves to nothing visible reads
    // as the app ignoring it.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })))
    await openOnMap(h.api)({ query: 'Screening room, second floor' })
    expect(h.api.workspace.openMainTab).toHaveBeenCalled()
  })

  it('geocodes a label that does resolve, on top of opening the map', async () => {
    await openOnMap(h.api)({ query: 'Rainforest Observatory' })
    expect(h.api.workspace.openMainTab).toHaveBeenCalled()
    const requested = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls
      .map(([url]) => url)
      .filter((url) => url.includes('/search'))
    expect(requested).toHaveLength(1)
    expect(requested[0]).toContain(encodeURIComponent('Rainforest Observatory'))
  })

  it('describe reverse-geocodes a coordinate', async () => {
    const res = await h.api.commands.execute('map:describe', { lat: 12.3769, lng: 8.5417 })
    expect(res.ok && (res.value as { address: string }).address).toBe('Forest Trail 1, Example Grove')
  })

  it('declares opening the map and pinning a described coordinate as non-replayable writes', async () => {
    const registrations = vi.spyOn(h.api.commands, 'register')
    const off = registerMapboxCommands(h.api)
    for (const id of ['open', 'describe']) expect(registrations.mock.calls.find(([item]) => item.id === id)![0], id).toMatchObject({ sideEffect: 'write', recovery: 'non-replayable' })
    expect(await h.api.commands.executeOwn('open')).toEqual({ ok: true, value: null })
    expect(h.api.workspace.openMainTab).toHaveBeenCalledTimes(1)
    const res = await h.api.commands.execute('map:describe', { lat: 12.3769, lng: 8.5417 })
    expect(res).toEqual({ ok: true, value: { lat: 12.3769, lng: 8.5417, address: 'Forest Trail 1, Example Grove' } })
    expect(h.api.workspace.openMainTab).toHaveBeenCalledTimes(2)
    off()
  })

  it('geocodes an address to coordinates without moving the map', async () => {
    const before = h.store.getSnapshot()
    const res = await h.api.commands.execute('map:geocode', { address: 'Rainforest Observatory' })
    expect(res.ok && res.value).toMatchObject({ address: 'Rainforest Observatory', name: 'Rainforest Observatory, Canopy Reserve', lat: 48.8584, lng: 2.2945, results: [{ lat: 48.8584, lng: 2.2945 }] })
    expect(h.store.getSnapshot().selectedResult).toBe(before.selectedResult)
    expect(h.api.workspace.openMainTab).not.toHaveBeenCalled()
    const missing = await h.api.commands.execute('map:geocode', { address: '' })
    expect(missing.ok).toBe(false)
  })

  it('reverse-geocodes coordinates to an address and rejects impossible ones', async () => {
    const res = await h.api.commands.execute('map:reverse-geocode', { lat: 47.3779, lng: 8.5403 })
    expect(res.ok && res.value).toEqual({ lat: 47.3779, lng: 8.5403, address: 'Forest Trail 1, Example Grove' })
    expect((await h.api.commands.execute('map:reverse-geocode', { lat: 95, lng: 8 })).ok).toBe(false)
  })

  it('measures straight-line and travel distance between coordinates, saved places and addresses', async () => {
    const straight = await h.api.commands.execute('map:distance', { from: '47.3779, 8.5403', to: '47.3548, 8.5527' })
    expect(straight.ok && straight.value).toMatchObject({ from: { lat: 47.3779, lng: 8.5403 }, to: { lat: 47.3548, lng: 8.5527 } })
    expect(straight.ok && (straight.value as { straightLineM: number }).straightLineM).toBeGreaterThan(2600)
    expect(straight.ok && (straight.value as { straightLineM: number }).straightLineM).toBeLessThan(2800)
    expect(straight.ok && straight.value).not.toHaveProperty('route')
    const travel = await h.api.commands.execute('map:distance', { from: 'Fox Den', to: 'Rainforest Observatory', mode: 'walking' })
    expect(travel.ok && travel.value).toMatchObject({ from: { name: 'Fox Den', lat: 12.37 }, to: { lat: 48.8584 }, route: { mode: 'walking', distanceM: 1200, durationS: 300 } })
    expect(h.store.getSnapshot().plan).toBeNull()
    expect(h.api.workspace.openMainTab).not.toHaveBeenCalled()
    expect((await h.api.commands.execute('map:distance', { from: '95, 8', to: 'Fox Den' })).ok).toBe(false)
  })

  it('goto returns the centred coordinate', async () => {
    const res = await h.api.commands.execute('map:goto', { lat: 12.37, lng: 8.54, zoom: 14 })
    expect(res.ok && res.value).toMatchObject({ lat: 12.37, lng: 8.54, zoom: 14 })
  })

  it('plan-route returns distance, duration and steps', async () => {
    const res = await h.api.commands.execute('map:plan-route', { to: 'Rainforest Observatory', from: 'Alpine Meadow Station' })
    expect(res.ok).toBe(true)
    const v = res.ok ? (res.value as { distanceM: number; steps?: unknown[] }) : null
    expect(v?.distanceM).toBe(1200)
    expect(v?.steps).toHaveLength(2)
  })

  it('list-places and show-place', async () => {
    const list = await h.api.commands.execute('map:list-places')
    expect(list.ok && (list.value as Place[])).toHaveLength(1)
    const show = await h.api.commands.execute('map:show-place', { name: 'fox den' })
    expect(show.ok && (show.value as Place).id).toBe('place-seed')
  })

  it('show-place throws for an unknown place', async () => {
    const res = await h.api.commands.execute('map:show-place', { name: 'Nowhere' })
    expect(res.ok).toBe(false)
    expect(!res.ok && res.error.message).toContain('Nowhere')
  })

  it('refuses a missing saved place or route as a known no-effect NOT_FOUND', async () => {
    const registrations = vi.spyOn(h.api.commands, 'register')
    const offs = [registerMapboxCommands(h.api), registerMapAutomation(h.api)]
    const command = (id: string) => registrations.mock.calls.find(([item]) => item.id === id)![0]
    const before = h.store.getSnapshot()
    const cases: [string, Record<string, unknown>][] = [
      ['show-place', { name: 'Nowhere' }],
      ['delete-place', { name: 'Nowhere' }],
      ['update-place', { name: 'Nowhere', newName: 'Somewhere' }],
      ['delete-route', { name: 'Nowhere' }],
      ['show-route', { id: 'Nowhere' }],
      ['export-route', { id: 'Nowhere', format: 'gpx' }]
    ]
    for (const [id, input] of cases) {
      let error: unknown
      try { await command(id).run(input, { caller: 'agent' }) } catch (caught) { error = caught }
      expect(error, id).toMatchObject({ code: 'NOT_FOUND', outcome: 'not-applied', message: expect.stringContaining('Nowhere') })
    }
    for (const id of ['delete-place', 'update-place', 'delete-route']) {
      await expect(command(id).revision!({ name: 'Nowhere' }), id).rejects.toMatchObject({ code: 'NOT_FOUND', outcome: 'not-applied' })
    }
    expect(h.store.getSnapshot().places).toEqual(before.places)
    expect(h.store.getSnapshot().routes).toEqual(before.routes)
    expect(h.store.getSnapshot().selectedPlaceId).toBe(before.selectedPlaceId)
    let parseError: unknown
    try { command('describe').input!.parse({ lat: 'x' }) } catch (caught) { parseError = caught }
    expect(parseError).toMatchObject({ code: 'INVALID_INPUT', outcome: 'not-applied' })
    await expect(command('distance').run({ from: '95, 8', to: 'Fox Den' }, { caller: 'agent' })).rejects.toMatchObject({ code: 'INVALID_INPUT', outcome: 'not-applied' })
    vi.spyOn(h.store, 'lookupPlaces').mockResolvedValueOnce([])
    await expect(command('distance').run({ from: 'Atlantis', to: 'Fox Den' }, { caller: 'agent' })).rejects.toMatchObject({ code: 'NOT_FOUND', outcome: 'not-applied' })
    for (const off of offs) off()
  })

  it('delete-place is a write with a working revert', async () => {
    const res = await h.api.commands.execute('map:delete-place', { name: 'Fox Den' })
    expect(res.ok).toBe(true)
    expect(h.store.getSnapshot().places).toHaveLength(0)
    expect(h.busUndo).toHaveLength(1)
    await h.busUndo[0].undo()
    expect(h.store.getSnapshot().places.some((p) => p.name === 'Fox Den')).toBe(true)
  })

  it('update-place edits then reverts', async () => {
    const res = await h.api.commands.execute('map:update-place', { name: 'Fox Den', newName: 'Fern Grove' })
    expect(res.ok).toBe(true)
    expect(h.store.getSnapshot().places.find((p) => p.id === 'place-seed')?.name).toBe('Fern Grove')
    await h.busUndo[0].undo()
    expect(h.store.getSnapshot().places.find((p) => p.id === 'place-seed')?.name).toBe('Fox Den')
  })

  it('sends only host-serialisable dataset values when saving and clearing an optional place field', async () => {
    const dataset = h.api.data.dataset.bind(h.api.data)
    const sent: unknown[] = []
    vi.spyOn(h.api.data, 'dataset').mockImplementation(((id: string) => {
      const handle = dataset(id)
      return { ...handle,
        upsert: (values: never, options?: never) => { sent.push(values); return handle.upsert(values, options) },
        update: (key: never, values: never, options?: never) => { sent.push(values); return handle.update(key, values, options) }
      }
    }) as typeof h.api.data.dataset)
    const undefinedField = (values: unknown) => Object.entries(values as Record<string, unknown>).find(([, value]) => value === undefined)?.[0]
    const saved = await h.api.commands.execute('map:save-place', { name: 'Moss Gate', lat: 12.4, lng: 8.6 })
    expect(saved.ok).toBe(true)
    const cleared = await h.api.commands.execute('map:update-place', { name: 'Moss Gate', note: '' })
    expect(cleared.ok).toBe(true)
    expect(sent).toHaveLength(2)
    expect(sent.map(undefinedField)).toEqual([undefined, undefined])
    const rows = (await dataset('map.places').query({})).rows
    expect(rows.find((row) => row.name === 'Moss Gate')).toMatchObject({ note: null })
  })

  it('save-route saves the current planner and reverts', async () => {
    h.store.setWaypoints([
      { lng: 8.54, lat: 12.37, label: 'A' },
      { lng: 8.6, lat: 12.4, label: 'B' }
    ])
    const res = await h.api.commands.execute('map:save-route', { name: 'Mushroom Trail' })
    expect(res.ok).toBe(true)
    expect(h.store.getSnapshot().routes.some((r) => r.name === 'Mushroom Trail')).toBe(true)
    await h.busUndo[0].undo()
    expect(h.store.getSnapshot().routes.some((r) => r.name === 'Mushroom Trail')).toBe(false)
  })

  it('save-route fails when nothing is planned', async () => {
    const res = await h.api.commands.execute('map:save-route', { name: 'Empty' })
    expect(res.ok).toBe(false)
    expect(!res.ok && res.error.message).toContain('No route to save')
  })

  it('delete-route removes a saved route and reverts', async () => {
    const res = await h.api.commands.execute('map:delete-route', { name: 'Canopy Route' })
    expect(res.ok).toBe(true)
    expect(h.store.getSnapshot().routes).toHaveLength(0)
    await h.busUndo[0].undo()
    expect(h.store.getSnapshot().routes.some((r) => r.name === 'Canopy Route')).toBe(true)
  })

  it('set-style validates the style id', async () => {
    const res = await h.api.commands.execute('map:set-style', { style: 'satellite' })
    expect(res.ok && (res.value as { style: string }).style).toBe('satellite')
    expect(h.store.getSnapshot().style).toBe('satellite')
  })

  it('set-style refuses an unknown or unavailable style before changing the map', async () => {
    const viewBefore = h.api.settings.get().mapViewState
    const registrations = vi.spyOn(h.api.commands, 'register')
    const off = registerMapboxCommands(h.api)
    const registered = registrations.mock.calls.find(([item]) => item.id === 'set-style')![0]
    let parseError: unknown
    try { registered.input!.parse({ style: 'satelite' }) } catch (error) { parseError = error }
    expect(parseError).toMatchObject({ code: 'INVALID_INPUT', outcome: 'not-applied' })
    expect(registered.input!.parse({ style: ' Satellite ' })).toEqual({ style: 'satellite' })
    expect(registered.input!.fromCli!(['Outdoors'], {})).toEqual({ style: 'outdoors' })
    const unknown = await h.api.commands.execute('map:set-style', { style: 'satelite' })
    expect(unknown.ok).toBe(false)
    expect(h.store.getSnapshot().style).toBe('streets')
    expect(h.api.settings.get().mapViewState).toEqual(viewBefore)
    let runError: unknown
    try { await registered.run({ style: 'navigation' }, { caller: 'agent' }) } catch (error) { runError = error }
    expect(runError).toMatchObject({ code: 'STYLE_UNAVAILABLE', outcome: 'not-applied' })
    expect(h.store.getSnapshot().style).toBe('streets')
    expect(h.api.settings.get().mapViewState).toEqual(viewBefore)
    off()
  })
})


describe('registered map code block examples', () => {
  it('covers coordinates, zoom, saved places and the overview with valid inputs', () => {
    expect(codeBlockExamples.map.map((example) => example.id)).toEqual(['coordinates', 'zoom', 'savedPlace', 'allPlaces'])
    for (const example of codeBlockExamples.map.filter((entry) => entry.id !== 'allPlaces')) {
      const parsed = parseMapFence(example.code, (name) => name === 'Apple Park, Cupertino' ? [-122.009, 37.3349] : null)
      expect(parsed?.center).toEqual([-122.009, 37.3349])
      expect(parsed?.zoom).toBe(example.id === 'zoom' ? 15 : example.id === 'savedPlace' ? 14 : 13)
    }
    expect(codeBlockExamples.map.find((entry) => entry.id === 'allPlaces')?.code).toBe('places: all')
  })
})

it('parses map coordinate pipes without losing later zoom or place lines', () => {
  expect(parseMapFence('48, 12|satellite|mapbox\nzoom: 16')).toMatchObject({ center: [12, 48], zoom: 16 })
  expect(parseMapFence('place: Forest|satellite|mapbox', () => [12, 48])).toMatchObject({ center: [12, 48], label: 'Forest' })
})
