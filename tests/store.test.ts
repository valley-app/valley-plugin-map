import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { IndexEntry } from '@valley/plugin-sdk/types'
import { createMockValleyApi } from './harness'
import { createStore, disposeStore, type MapStore } from '../src/store'
import type { MapEngine } from '../src/mapEngine'
import type { LngLat, Place, Route } from '../src/types'
import { accountProviderChoice } from '../src/settings'
import { defaultPinSource } from '../src/pinSources'
import { PUBLIC_SEARCH_ID, searchProviderIdentity } from '../src/geocodeProviders'
import { resolveSettings } from '../src/settings'
import { captureMapRenderOwner } from '../src/runtime'

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
const geoNotes: IndexEntry[] = [
  { relPath: 'migration.md', title: 'Migration Survey', kind: 'note', frontmatter: { lat: 11.95, lng: 7.44 }, mtimeMs: 0 },
  { relPath: 'plain.md', title: 'Plain', kind: 'note', frontmatter: {}, mtimeMs: 0 }
]

const createMapApi = (options: Parameters<typeof createMockValleyApi>[0] = {}) => createMockValleyApi({
  ...options,
  manifest: { id: 'map', ...options.manifest }
})

describe('MapStore request cancellation', () => {
  let store: MapStore
  let complete: (json: unknown) => void
  let signal: AbortSignal

  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise(resolve => {
      signal = init!.signal as AbortSignal
      complete = json => resolve({ ok: true, json: async () => json })
    })))
    store = createStore(createMapApi().api)
    await store.ready
  })

  afterEach(() => { disposeStore(store); vi.unstubAllGlobals() })

  async function started(): Promise<void> { await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)) }
  const oldSearch = [{ lat: '12.4', lon: '8.5', display_name: 'Old forest' }]
  const oldRoute = { routes: [{ geometry: { coordinates: [[8, 12], [8.1, 12.1]] }, distance: 900, duration: 200 }] }

  it('cancels a previous nonempty query immediately, before the replacement debounce fires', async () => {
    store.setSearchQuery('Old forest')
    const searching = store.runSearch()
    await started()
    store.setSearchQuery('New meadow')
    await vi.waitFor(() => expect(signal.aborted).toBe(true))
    complete(oldSearch)
    await searching
    expect(store.getSnapshot()).toMatchObject({ searchQuery: 'New meadow', searchResults: [], searchError: null })
    expect(fetch).toHaveBeenCalledTimes(1)
    store.clearSearch()
  })

  it('aborts an active route when the planner is cleared and never starts elevation or fallback work', async () => {
    const planning = store.planWaypoints(seededRoute.waypoints, 'walking')
    await started()
    store.clearPlanner()
    await vi.waitFor(() => expect(signal.aborted).toBe(true))
    complete(oldRoute)
    await planning
    expect(store.getSnapshot()).toMatchObject({ plan: null, planning: false, planError: null, plannerWaypoints: [] })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps saved route geometry when an older plan finishes after the route is opened', async () => {
    const planning = store.planWaypoints(seededRoute.waypoints, 'walking')
    await started()
    const geometry: LngLat[] = [[9, 13], [9.1, 13.1]]
    store.showRoute({ ...seededRoute, geometry, distanceM: 1234, durationS: 456 })
    await vi.waitFor(() => expect(signal.aborted).toBe(true))
    complete(oldRoute)
    await planning
    expect(store.getSnapshot()).toMatchObject({ plan: { geometry, distanceM: 1234 }, planning: false, planError: null, savedRouteId: seededRoute.id })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps restored surface search state when the former query finishes', async () => {
    store.setSearchQuery('Old forest')
    const searching = store.runSearch()
    await started()
    await store.restoreSurfaceState({ ...store.buildSurfaceState(), searchQuery: 'Saved meadow' })
    await vi.waitFor(() => expect(signal.aborted).toBe(true))
    complete(oldSearch)
    await searching
    expect(store.getSnapshot()).toMatchObject({ searchQuery: 'Saved meadow', searchResults: [], searchBusy: false, searchError: null })
  })

  it('invalidates only the search request when its selected provider changes', async () => {
    disposeStore(store)
    const mock = createMapApi({ settings: { mapboxEnabled: true } })
    store = createStore(mock.api)
    await store.ready
    store.setSearchQuery('Old forest')
    const searching = store.runSearch()
    await started()
    await mock.api.settings.set('searchProvider', accountProviderChoice('mapbox', 'another-account'))
    await vi.waitFor(() => expect(signal.aborted).toBe(true))
    complete(oldSearch)
    await searching
    expect(store.getSnapshot().searchResults).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(1)
    store.clearSearch()
  })

  it('awaits in-flight work during unload without publishing a cancellation error', async () => {
    disposeStore(store)
    const mock = createMapApi()
    let prepare!: () => Promise<void> | void
    vi.spyOn(mock.api.runtime, 'onBeforeUnload').mockImplementation(callback => { prepare = callback; return () => {} })
    store = createStore(mock.api)
    await store.ready
    store.setSearchQuery('Old forest')
    const searching = store.runSearch()
    await started()
    let prepared = false
    const preparing = Promise.resolve(prepare()).then(() => { prepared = true })
    await vi.waitFor(() => expect(signal.aborted).toBe(true))
    expect(prepared).toBe(false)
    complete(oldSearch)
    await searching
    await preparing
    expect(store.getSnapshot().searchError).toBeNull()
    expect(store.getSnapshot().searchResults).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retries an interrupted background address with the new provider without replacing resolved cache entries', async () => {
    disposeStore(store)
    const source = { ...defaultPinSource(), id: 'source', matchKey: 'type', matchValue: 'habitat' }
    const cache = [
      { id: 'saved grove', address: 'Saved Grove', lng: 9, lat: 13, unresolved: false },
      { id: 'unknown grove', address: 'Unknown Grove', lng: null, lat: null, unresolved: true }
    ]
    const replacement = accountProviderChoice('mapbox', 'replacement')
    const answers = [PUBLIC_SEARCH_ID, searchProviderIdentity(resolveSettings({ mapboxEnabled: true, searchProvider: replacement }))].map(provider => ({
      id: JSON.stringify([provider, 'saved grove']), address: 'Saved Grove', provider,
      observedAt: Date.now() - 1000, expiresAt: Date.now() + 60000, lng: 9, lat: 13, unresolved: false
    }))
    const mock = createMapApi({
      settings: { mapboxEnabled: true },
      indexEntries: ['Pending Grove', 'Saved Grove'].map((address, index) => ({
        relPath: `${index}.md`, title: address, kind: 'note', mtimeMs: 0, frontmatter: { type: 'habitat', address }
      })),
      datasets: { 'map.pin_sources': [{ id: 'source', position: 0, definition: source }], 'map.geocode_cache': cache, 'map.geocode_answers': answers }
    })
    store = createStore(mock.api)
    await store.ready
    await started()
    expect(store.getSnapshot().sourcePins).toHaveLength(1)
    await mock.api.settings.set('searchProvider', replacement)
    await vi.waitFor(() => expect(signal.aborted).toBe(true))
    complete([{ lat: '12', lon: '8', display_name: 'Obsolete provider' }])
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect((await mock.api.data.dataset('geocode_cache').query()).rows).toEqual(cache)
    complete([{ lat: '14', lon: '10', display_name: 'Pending Grove' }])
    await vi.waitFor(() => expect(store.getSnapshot().sourcePins).toHaveLength(2))
    const rows = (await mock.api.data.dataset('geocode_cache').query()).rows
    expect(rows).toEqual([...cache, { id: 'pending grove', address: 'Pending Grove', lng: 10, lat: 14, unresolved: false }])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not dispatch queued background geocoding after unload starts during the provider delay', async () => {
    disposeStore(store)
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => oldSearch })))
      const source = { ...defaultPinSource(), id: 'source', matchKey: 'type', matchValue: 'habitat' }
      const mock = createMapApi({
        indexEntries: ['First grove', 'Second grove'].map((address, index) => ({
          relPath: `${index}.md`, title: address, kind: 'note', mtimeMs: 0, frontmatter: { type: 'habitat', address }
        })),
        datasets: { 'map.pin_sources': [{ id: 'source', position: 0, definition: source }] }
      })
      let prepare!: () => Promise<void> | void
      vi.spyOn(mock.api.runtime, 'onBeforeUnload').mockImplementation(callback => { prepare = callback; return () => {} })
      store = createStore(mock.api)
      await store.ready
      await vi.advanceTimersByTimeAsync(0)
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(store.getSnapshot().sourcePins).toHaveLength(1)
      await prepare()
      await vi.advanceTimersByTimeAsync(2000)
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(store.getSnapshot().sourcePins).toHaveLength(1)
    } finally { vi.useRealTimers() }
  })
})

function setup(): MapStore {
  const { api } = createMapApi({
    indexEntries: geoNotes,
    datasets: {
      'map.places': [seededPlace as unknown as Record<string, unknown>],
      'map.routes': [{ ...seededRoute, waypoints: undefined } as unknown as Record<string, unknown>],
      'map.route_waypoints': seededRoute.waypoints.map((waypoint, position) => ({
        routeId: seededRoute.id,
        position,
        ...waypoint
      }))
    }
  })
  return createStore(api)
}

describe('MapStore', () => {
  let store: MapStore

  beforeEach(() => {
    // No real network during debounced route computation.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')))
    store = setup()
  })

  afterEach(() => {
    disposeStore(store)
    vi.unstubAllGlobals()
  })

  it('loads seeded places + routes and derives geo-pins', async () => {
    await store.load()
    const snap = store.getSnapshot()
    expect(snap.places).toHaveLength(1)
    expect(snap.places[0].name).toBe('Fox Den')
    expect(snap.routes).toHaveLength(1)
    expect(snap.pins).toHaveLength(1)
    expect(snap.pins[0]).toMatchObject({ relPath: 'migration.md', lat: 11.95, lng: 7.44 })
  })

  it('restores place and route insertion order independently of record IDs', async () => {
    disposeStore(store)
    const mock = createMapApi({ datasets: {
      'map.places': [{ ...seededPlace, id: 'z-first', position: 0 }, { ...seededPlace, id: 'a-second', position: 1 }],
      'map.routes': [{ ...seededRoute, id: 'z-route', position: 0 }, { ...seededRoute, id: 'a-route', position: 1 }]
    } })
    store = createStore(mock.api)
    await store.load()
    expect(store.getSnapshot().places.map((place) => place.id)).toEqual(['z-first', 'a-second'])
    expect(store.getSnapshot().routes.map((route) => route.id)).toEqual(['z-route', 'a-route'])
    await store.restorePlaceRaw({ ...seededPlace, id: 'b-third' })
    await store.restoreRouteRaw({ ...seededRoute, id: 'b-third-route' })
    disposeStore(store)
    store = createStore(mock.api)
    await store.load()
    expect(store.getSnapshot().places.map((place) => place.id)).toEqual(['z-first', 'a-second', 'b-third'])
    expect(store.getSnapshot().routes.map((route) => route.id)).toEqual(['z-route', 'a-route', 'b-third-route'])
  })

  it('adds, updates and deletes a place', async () => {
    await store.load()
    const place = await store.addPlace({ name: 'Fern Station', lng: 8.55, lat: 12.371 })
    expect(store.getSnapshot().places).toHaveLength(2)

    await store.updatePlace(place.id, { name: 'Fern Station Renamed' })
    expect(store.getSnapshot().places.find((p) => p.id === place.id)?.name).toBe('Fern Station Renamed')

    await store.deletePlace(place.id)
    expect(store.getSnapshot().places).toHaveLength(1)
  })

  it('saves the planner state as a favourite route', async () => {
    await store.load()
    store.setWaypoints([
      { lng: 8.54, lat: 12.37, label: 'A' },
      { lng: 8.6, lat: 12.4, label: 'B' }
    ])
    const route = await store.saveRoute('Pollinator Survey')
    expect(route).not.toBeNull()
    expect(route?.mode).toBe('driving')
    expect(store.getSnapshot().routes.some((r) => r.name === 'Pollinator Survey')).toBe(true)
  })

  it('saveRouteRaw / removeRouteRaw / restoreRouteRaw round-trip without core undo', async () => {
    await store.load()
    store.setWaypoints([
      { lng: 8.54, lat: 12.37, label: 'A' },
      { lng: 8.6, lat: 12.4, label: 'B' }
    ])
    const route = await store.saveRouteRaw('Archived Route')
    expect(route).not.toBeNull()
    expect(store.getSnapshot().routes.some((r) => r.id === route!.id)).toBe(true)

    await store.removeRouteRaw(route!.id)
    expect(store.getSnapshot().routes.some((r) => r.id === route!.id)).toBe(false)

    await store.restoreRouteRaw(route!)
    expect(store.getSnapshot().routes.some((r) => r.id === route!.id)).toBe(true)
  })

  it('saveRouteRaw returns null with fewer than two waypoints', async () => {
    await store.load()
    store.setWaypoints([{ lng: 8.54, lat: 12.37, label: 'only' }])
    expect(await store.saveRouteRaw('nope')).toBeNull()
  })

  it('restorePlaceRaw re-adds a deleted place (bus delete revert)', async () => {
    await store.load()
    const place = store.getSnapshot().places[0]
    await store.removePlaceRaw(place.id)
    expect(store.getSnapshot().places).toHaveLength(0)
    await store.restorePlaceRaw(place)
    expect(store.getSnapshot().places.some((p) => p.id === place.id)).toBe(true)
  })

  it('surfaces turn-by-turn steps on the computed plan', async () => {
    await store.load()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          routes: [
            {
              distance: 1200,
              duration: 300,
              geometry: { coordinates: [[8.54, 12.37], [8.6, 12.4]] },
              legs: [
                {
                  steps: [
                    { maneuver: { type: 'depart' }, name: 'A St', distance: 200, duration: 50 },
                    { maneuver: { type: 'arrive' }, name: '', distance: 0, duration: 0 }
                  ]
                }
              ]
            }
          ]
        })
      })
    )
    const plan = await store.planWaypoints(
      [
        { lng: 8.54, lat: 12.37, label: 'A' },
        { lng: 8.6, lat: 12.4, label: 'B' }
      ],
      'driving'
    )
    expect(plan?.steps).toHaveLength(2)
    expect(plan?.steps?.[0].instruction).toContain('Head out')
  })

  it('imports a route without a saved geometry', async () => {
    await store.load()
    const route = await store.importRoute('Imported', [
      { lng: 8.5, lat: 12.3, label: 'Start' },
      { lng: 8.7, lat: 12.5, label: 'End' }
    ])
    expect(route.waypoints).toHaveLength(2)
    expect(store.getSnapshot().routes.some((r) => r.id === route.id)).toBe(true)
  })

  it('does not plan a route with fewer than two waypoints', () => {
    store.setWaypoints([{ lng: 8.54, lat: 12.37, label: 'only' }])
    expect(store.getSnapshot().plan).toBeNull()
  })

  it('replays the searched-address marker + camera, surviving a StrictMode double-mount', async () => {
    await store.load()
    // Click an address before any map view is mounted (the contact-address path).
    store.showAddress([8.278, 12.498])

    const fakeEngine = (): { engine: MapEngine; flyTo: LngLat[]; markers: Array<LngLat | null> } => {
      const flyTo: LngLat[] = []
      const markers: Array<LngLat | null> = []
      const engine = {
        setPlaces() {},
        setPins() {},
        setSourcePins() {},
        setWaypoints() {},
        setRoute() {},
        setUnits() {},
        setLiveLocation() {},
        setSearchMarker: (c: LngLat | null) => markers.push(c),
        flyTo: (center: LngLat) => flyTo.push(center)
      } as unknown as MapEngine
      return { engine, flyTo, markers }
    }

    // StrictMode: the first engine attaches then is destroyed before its style loads.
    const a = fakeEngine()
    store.attachMap(a.engine)
    expect(a.flyTo).toEqual([[8.278, 12.498]])
    store.detachMap(a.engine)

    // The surviving engine must still receive the focus + marker (pendingFocus not consumed).
    const b = fakeEngine()
    store.attachMap(b.engine)
    expect(b.markers).toEqual([[8.278, 12.498]])
    expect(b.flyTo).toEqual([[8.278, 12.498]])

    // Once a ready engine reports in, the one-shot focus clears — a later remount only re-pins.
    store.onMapReady()
    const c = fakeEngine()
    store.attachMap(c.engine)
    expect(c.markers).toEqual([[8.278, 12.498]])
    expect(c.flyTo).toEqual([])
  })

  it('fills stops top-down, keeps vias, and reorders them', async () => {
    await store.load()
    store.pickSearchResult({ name: 'Canopy Station', lng: 8.24, lat: 12.46 })
    store.openDirections()
    // The picked result is the destination, so the first typed stop lands in A.
    expect(store.getSnapshot().plannerStops).toEqual([null, { lng: 8.24, lat: 12.46, label: 'Canopy Station' }])

    store.setStop(0, { lng: 7.35, lat: 11.23, label: 'Alpine Meadow' })
    expect(store.getSnapshot().plannerWaypoints.map((w) => w.label)).toEqual(['Alpine Meadow', 'Canopy Station'])

    // "Add via" inserts *before* the destination — the destination stays put.
    store.addStop()
    expect(store.getSnapshot().plannerStops.map((s) => s?.label ?? null)).toEqual(['Alpine Meadow', null, 'Canopy Station'])
    store.setStop(1, { lng: 8.0, lat: 12.0, label: 'Moss Basin' })
    expect(store.getSnapshot().plannerWaypoints.map((w) => w.label)).toEqual(['Alpine Meadow', 'Moss Basin', 'Canopy Station'])

    // Editing an endpoint must not wipe the via (the old From/To form did).
    store.setStop(0, { lng: 6.63, lat: 11.52, label: 'Pollinator Field' })
    expect(store.getSnapshot().plannerWaypoints.map((w) => w.label)).toEqual(['Pollinator Field', 'Moss Basin', 'Canopy Station'])

    store.reorderStops(2, 1)
    expect(store.getSnapshot().plannerWaypoints.map((w) => w.label)).toEqual(['Pollinator Field', 'Canopy Station', 'Moss Basin'])

    store.swapDirections()
    expect(store.getSnapshot().plannerWaypoints.map((w) => w.label)).toEqual(['Moss Basin', 'Canopy Station', 'Pollinator Field'])

    store.removeStop(1)
    expect(store.getSnapshot().plannerWaypoints.map((w) => w.label)).toEqual(['Moss Basin', 'Pollinator Field'])
  })

  it('keeps an empty via slot through a reorder', async () => {
    await store.load()
    store.setStops([
      { lng: 7.35, lat: 11.23, label: 'Alpine Meadow' },
      null,
      { lng: 8.24, lat: 12.46, label: 'Canopy Station' }
    ])
    // The old waypoint-level reorder edited the *filled subset* and back-filled,
    // which silently deleted whichever slot the user was about to type into.
    store.reorderStops(0, 2)
    expect(store.getSnapshot().plannerStops.map((s) => s?.label ?? null)).toEqual([null, 'Canopy Station', 'Alpine Meadow'])
    expect(store.getSnapshot().plannerWaypoints.map((w) => w.label)).toEqual(['Canopy Station', 'Alpine Meadow'])
  })

  it('edits a fresh planner through the padded two-slot skeleton', async () => {
    await store.load()
    // A right-sidebar store nobody has opened the form on holds no stops at all,
    // but the card still shows two rows — typing into either must land.
    expect(store.getSnapshot().plannerStops).toEqual([])
    store.setStop(1, { lng: 8.24, lat: 12.46, label: 'Canopy Station' })
    expect(store.getSnapshot().plannerStops.map((s) => s?.label ?? null)).toEqual([null, 'Canopy Station'])
  })

  it('names an unnamed route after its endpoints', async () => {
    await store.load()
    store.setStops([
      { lng: 7.35, lat: 11.23, label: 'Alpine Meadow' },
      { lng: 8.0, lat: 12.0, label: 'Moss Basin' },
      { lng: 8.24, lat: 12.46, label: 'Canopy Station' }
    ])
    // The card has no name field, so an empty name must still produce a route
    // that reads as itself in the list — endpoints only, vias omitted.
    const route = await store.saveRoute('')
    expect(route?.name).toBe('Alpine Meadow \u2192 Canopy Station')
    // An explicit name (CLI, assistant) still wins.
    const named = await store.saveRoute('  Alpine loop  ')
    expect(named?.name).toBe('Alpine loop')
  })

  it('saves and un-saves the open route from one star', async () => {
    await store.load()
    store.setStops([
      { lng: 7.35, lat: 11.23, label: 'Alpine Meadow' },
      { lng: 8.24, lat: 12.46, label: 'Canopy Station' }
    ])
    expect(store.getSnapshot().savedRouteId).toBeNull()

    const route = await store.saveRoute('Mycelium Trail')
    expect(route).not.toBeNull()
    expect(store.getSnapshot().savedRouteId).toBe(route?.id)
    expect(store.getSnapshot().routes.some((r) => r.name === 'Mycelium Trail')).toBe(true)

    await store.unsaveRoute()
    expect(store.getSnapshot().savedRouteId).toBeNull()
    expect(store.getSnapshot().routes.some((r) => r.name === 'Mycelium Trail')).toBe(false)

    // Loading a saved route marks it saved again, so the star can remove it.
    store.showRoute(seededRoute)
    expect(store.getSnapshot().savedRouteId).toBe('route-seed')
    // Any edit to the plan drops the link.
    store.setPlannerMode('walking')
    expect(store.getSnapshot().savedRouteId).toBeNull()
  })
})

// ---- reload persistence -----------------------------------------------------
// The map reopens on the camera, basemap, search card and directions form it was
// left on. Two settings values have independent hydration gates: one for the
// camera and one for the sidebar.

type Recorder = {
  engine: MapEngine
  jumps: Array<[LngLat, number, number, number]>
  flyTo: LngLat[]
  fits: LngLat[][]
  markers: Array<LngLat | null>
}

function recordingEngine(): Recorder {
  const jumps: Recorder['jumps'] = []
  const flyTo: LngLat[] = []
  const fits: LngLat[][] = []
  const markers: Array<LngLat | null> = []
  const engine = {
    setPlaces() {},
    setPins() {},
    setSourcePins() {},
    setWaypoints() {},
    setRoute() {},
    setUnits() {},
    setLiveLocation() {},
    setSearchMarker: (c: LngLat | null) => markers.push(c),
    flyTo: (center: LngLat) => flyTo.push(center),
    fitTo: (coords: LngLat[]) => fits.push(coords),
    jumpTo: (center: LngLat, zoom: number, bearing = 0, pitch = 0) => jumps.push([center, zoom, bearing, pitch])
  } as unknown as MapEngine
  return { engine, jumps, flyTo, fits, markers }
}

function seeded(view?: Record<string, unknown>, session?: Record<string, unknown>): {
  store: MapStore
  settings: () => Record<string, unknown>
} {
  const mock = createMapApi({
    indexEntries: geoNotes,
    settings: {
      ...(view ? { mapViewState: view } : {}),
      ...(session ? { mapSessionState: session } : {})
    },
    datasets: {
      'map.places': [seededPlace as unknown as Record<string, unknown>],
      'map.routes': [{ ...seededRoute, waypoints: undefined } as unknown as Record<string, unknown>],
      'map.route_waypoints': seededRoute.waypoints.map((waypoint, position) => ({
        routeId: seededRoute.id,
        position,
        ...waypoint
      }))
    }
  })
  return { store: createStore(mock.api), settings: () => mock.api.settings.get() }
}

describe('MapStore — reload persistence', () => {
  let store: MapStore

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')))
  })

  afterEach(() => {
    disposeStore(store)
    vi.unstubAllGlobals()
  })

  it('restores the camera with bearing and pitch, and the saved basemap', async () => {
    const s = seeded({ id: 'view', lng: 8.5, lat: 12.4, zoom: 11, bearing: 42, pitch: 55, style: 'satellite' })
    store = s.store
    await store.load()
    const rec = recordingEngine()
    store.attachMap(rec.engine)
    expect(rec.jumps).toEqual([[[8.5, 12.4], 11, 42, 55]])
    expect(store.getSnapshot().style).toBe('satellite')
  })

  it.each(['light', 'dark'] as const)('restores the former %s layer as a separate mode', async (mode) => {
    store = seeded({ style: mode }).store
    await store.ready
    expect(store.getSnapshot()).toMatchObject({ style: 'streets', colorMode: mode })
  })

  it.each(['streets', 'satellite', 'light', 'dark'])('defaults to System with the %s default basemap', async (defaultStyle) => {
    const media = Object.assign(new EventTarget(), { matches: false })
    vi.stubGlobal('matchMedia', vi.fn(() => media))
    store = createStore(createMapApi({ settings: { defaultStyle } }).api)
    await store.ready
    expect(store.getSnapshot().colorMode).toBe('system')
    expect(store.resolvedColorMode()).toBe('light')
  })

  it('follows device appearance only in System mode and restores System across reloads and links', async () => {
    const media = Object.assign(new EventTarget(), { matches: false })
    const removeListener = vi.spyOn(media, 'removeEventListener')
    vi.stubGlobal('matchMedia', vi.fn(() => media))
    const mock = createMapApi()
    store = createStore(mock.api)
    await store.ready
    store.setStyle('satellite')
    const { engine } = recordingEngine()
    const setStyle = vi.fn()
    engine.setStyle = setStyle
    store.attachMap(engine)

    media.matches = true
    media.dispatchEvent(new Event('change'))
    expect(setStyle).toHaveBeenLastCalledWith('satellite', 'dark', store.settings())
    expect(store.getSnapshot()).toMatchObject({ style: 'satellite', colorMode: 'system' })
    const link = store.buildLinkState()
    store.setColorMode('light')
    setStyle.mockClear()
    media.matches = false
    media.dispatchEvent(new Event('change'))
    media.matches = true
    media.dispatchEvent(new Event('change'))
    expect(setStyle).not.toHaveBeenCalled()
    expect(store.resolvedColorMode()).toBe('light')

    expect(store.applyLinkState(link)).toBe(true)
    expect(store.resolvedColorMode()).toBe('dark')
    expect(setStyle).toHaveBeenLastCalledWith('satellite', 'dark', store.settings())
    store.flushView()
    expect(mock.api.settings.get().mapViewState).toMatchObject({ style: 'satellite', colorMode: 'system' })
    store = createStore(mock.api)
    await store.ready
    expect(removeListener).toHaveBeenCalledWith('change', expect.any(Function))
    expect(store.getSnapshot()).toMatchObject({ style: 'satellite', colorMode: 'system' })
    expect(store.resolvedColorMode()).toBe('dark')
    media.matches = false
    media.dispatchEvent(new Event('change'))
    expect(store.resolvedColorMode()).toBe('light')
  })

  it('resolves System from Valley appearance and publishes the mode the map toggle shows', async () => {
    const media = Object.assign(new EventTarget(), { matches: false })
    vi.stubGlobal('matchMedia', vi.fn(() => media))
    const mock = createMapApi()
    let appearance: unknown = 'dark'
    const appearanceListeners = new Set<() => void>()
    mock.api.settings.core.get = (key: string) => key === 'appearanceTheme' ? appearance : undefined
    mock.api.settings.core.subscribe = (listener: () => void) => { appearanceListeners.add(listener); return () => { appearanceListeners.delete(listener) } }
    store = createStore(mock.api)
    await store.ready
    const { engine } = recordingEngine()
    const setStyle = vi.fn()
    engine.setStyle = setStyle
    store.attachMap(engine)
    const renders = vi.fn()
    store.subscribe(renders)

    expect(store.getSnapshot()).toMatchObject({ colorMode: 'system', resolvedColorMode: 'dark' })
    media.matches = true
    media.dispatchEvent(new Event('change'))
    expect(setStyle).not.toHaveBeenCalled()
    expect(renders).not.toHaveBeenCalled()

    appearance = 'system'
    appearanceListeners.forEach((listener) => listener())
    expect(store.getSnapshot().resolvedColorMode).toBe('dark')
    expect(setStyle).not.toHaveBeenCalled()
    media.matches = false
    media.dispatchEvent(new Event('change'))
    expect(store.getSnapshot().resolvedColorMode).toBe('light')
    expect(setStyle).toHaveBeenLastCalledWith('streets', 'light', store.settings())

    // The map toggle writes an explicit mode, which the sidebar's Map mode shows.
    store.setColorMode('dark')
    expect(store.getSnapshot()).toMatchObject({ colorMode: 'dark', resolvedColorMode: 'dark' })
    appearance = 'light'
    appearanceListeners.forEach((listener) => listener())
    expect(store.getSnapshot().resolvedColorMode).toBe('dark')

    // A view's document carries Valley's effective appearance, footer override included.
    store.setColorMode('system')
    expect(store.getSnapshot().resolvedColorMode).toBe('light')
    setStyle.mockClear()
    store.setHostAppearance('dark')
    expect(store.getSnapshot().resolvedColorMode).toBe('dark')
    expect(setStyle).toHaveBeenLastCalledWith('streets', 'dark', store.settings())
    store.setHostAppearance('dark')
    expect(setStyle).toHaveBeenCalledTimes(1)
    disposeStore(store)
    expect(appearanceListeners.size).toBe(0)
  })

  it('persists map mode without a camera and keeps it independent of the app theme', async () => {
    const mock = createMapApi()
    store = createStore(mock.api)
    await store.ready
    store.setStyle('satellite')
    store.setColorMode('light')
    store.flushView()
    expect(mock.api.settings.get().mapViewState).toMatchObject({ style: 'satellite', colorMode: 'light' })
    document.documentElement.setAttribute('data-theme', 'dark')
    await Promise.resolve()
    expect(store.getSnapshot()).toMatchObject({ style: 'satellite', colorMode: 'light' })
    store = createStore(mock.api)
    await store.ready
    expect(store.getSnapshot()).toMatchObject({ style: 'satellite', colorMode: 'light' })
    document.documentElement.removeAttribute('data-theme')
  })

  it('validates, applies, persists, and rebuilds shareable map state', async () => {
    const s = seeded()
    store = s.store
    await store.load()
    const rec = recordingEngine()
    store.attachMap(rec.engine)

    expect(store.applyLinkState({
      v: 1,
      camera: { lng: -62.2517, lat: -3.1469, zoom: 14, bearing: 22, pitch: 35 },
      style: 'satellite',
      searchQuery: 'Canopy Station',
      selectedPlaceId: 'place-seed',
      selectedResult: { name: 'Canopy Station', lng: -62.2502, lat: -3.1482, context: 'Rainforest reserve' }
    })).toBe(true)

    expect(store.getSnapshot()).toMatchObject({
      style: 'satellite',
      searchQuery: 'Canopy Station',
      selectedPlaceId: 'place-seed',
      selectedResult: { name: 'Canopy Station', lng: -62.2502, lat: -3.1482 }
    })
    expect(rec.jumps.at(-1)).toEqual([[-62.2517, -3.1469], 14, 22, 35])
    expect(s.settings().mapViewState).toMatchObject({ lng: -62.2517, lat: -3.1469, zoom: 14, bearing: 22, pitch: 35, style: 'satellite' })
    expect(s.settings().mapSessionState).toMatchObject({ searchQuery: 'Canopy Station', selectedPlaceId: 'place-seed' })
    expect(store.buildLinkState()).toMatchObject({ v: 1, style: 'satellite', searchQuery: 'Canopy Station' })

    expect(store.applyLinkState({
      v: 1,
      camera: { lng: 8, lat: 100, zoom: 14, bearing: 0, pitch: 0 },
      style: 'streets',
      searchQuery: '',
      selectedPlaceId: null,
      selectedResult: null
    })).toBe(false)
    expect(store.getSnapshot().searchQuery).toBe('Canopy Station')
  })

  it('offers the saved camera for the map’s first frame', async () => {
    // The view builds its engine with this, so the opening frame is already the
    // remembered camera — restoring via a later jumpTo paints the default first.
    const s = seeded({ id: 'view', lng: 8.5, lat: 12.4, zoom: 11, bearing: 42, pitch: 55 })
    store = s.store
    expect(store.savedCamera()).toBeNull()
    await store.load()
    expect(store.savedCamera()).toEqual({ center: [8.5, 12.4], zoom: 11, bearing: 42, pitch: 55 })
  })

  it('clears `loading` even when a dataset fails to read', async () => {
    // Views gate their map on `loading`; a stuck flag would mean no map at all.
    const mock = createMapApi({ indexEntries: geoNotes })
    const dataset = mock.api.data.dataset
    mock.api.data.dataset = ((globalId: string) => ({
      ...dataset(globalId),
      query: async () => { throw new Error('disk is on fire') }
    })) as typeof mock.api.data.dataset
    // The constructor's fire-and-forget load logs this failure — expected here.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    store = createStore(mock.api)
    await expect(store.load()).rejects.toThrow('disk is on fire')
    expect(store.getSnapshot().loading).toBe(false)
    logged.mockRestore()
  })

  it('drops delayed hydration and pending link state after disposal', async () => {
    const mock = createMapApi({ datasets: { 'map.places': [{ ...seededPlace }] } })
    const dataset = mock.api.data.dataset
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    mock.api.data.dataset = ((globalId: string) => {
      const handle = dataset(globalId)
      return { ...handle, query: async (request) => { await pending; return handle.query(request) } }
    }) as typeof dataset
    const write = vi.spyOn(mock.api.settings, 'set')
    store = createStore(mock.api)
    store.applyLinkState({
      v: 1, camera: null, style: 'street', searchQuery: 'Fern station',
      selectedPlaceId: 'place-seed', selectedResult: null
    })
    const readiness = expect(store.ready).rejects.toThrow('no longer active')
    const ended = vi.fn()
    const closing = disposeStore(store).then(ended)
    const previous = store.getSnapshot()
    await readiness
    expect(ended).not.toHaveBeenCalled()
    finish()
    await closing
    expect(store.getSnapshot()).toBe(previous)
    expect(store.getSnapshot().places).toEqual([])
    expect(write).not.toHaveBeenCalled()
  })

  it('flushes a disposed store once and prevents later camera writes', async () => {
    const mock = createMapApi()
    store = createStore(mock.api)
    await store.ready
    const write = vi.spyOn(mock.api.settings, 'set')
    store.rememberView([8.5, 12.4], 11)
    store.setPanelTab('pins')
    store.dispose()
    expect(write.mock.calls.map(([key]) => key)).toEqual(['mapViewState', 'mapSessionState'])
    expect(mock.api.settings.get().mapViewState).toMatchObject({ lng: 8.5, lat: 12.4, zoom: 11 })
    expect(mock.api.settings.get().mapSessionState).toMatchObject({ panelTab: 'pins' })
    store.dispose()
    store.rememberView([1, 2], 4)
    store.flushView()
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('waits for pending view and session saves before unloading without repeating them on disposal', async () => {
    const mock = createMapApi()
    let prepare!: () => void | Promise<void>
    const off = vi.fn()
    vi.spyOn(mock.api.runtime, 'onBeforeUnload').mockImplementation((flush) => { prepare = flush; return off })
    store = createStore(mock.api)
    await store.ready
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    const set = mock.api.settings.set
    const write = vi.spyOn(mock.api.settings, 'set').mockImplementation(async (key, value) => {
      await pending
      return set(key, value)
    })
    store.rememberView([8.5, 12.4], 11)
    store.setPanelTab('pins')
    let prepared = false
    const saving = Promise.resolve(prepare()).then(() => { prepared = true })
    await Promise.resolve()
    expect(prepared).toBe(false)
    expect(off).not.toHaveBeenCalled()
    store.rememberView([9.5, 13.4], 12)
    store.setPanelTab('routes')
    finish()
    await saving
    expect(mock.api.settings.get().mapViewState).toMatchObject({ lng: 9.5, lat: 13.4, zoom: 12 })
    expect(mock.api.settings.get().mapSessionState).toMatchObject({ panelTab: 'routes' })
    store.dispose()
    expect(write).toHaveBeenCalledTimes(4)
    expect(off).toHaveBeenCalledOnce()
  })

  it('retains editable view state when unload preparation cannot save and retries it', async () => {
    const mock = createMapApi()
    let prepare!: () => void | Promise<void>
    const off = vi.fn()
    vi.spyOn(mock.api.runtime, 'onBeforeUnload').mockImplementation((flush) => { prepare = flush; return off })
    store = createStore(mock.api)
    await store.ready
    const write = vi.spyOn(mock.api.settings, 'set').mockResolvedValue({ ok: false, error: 'disk full' })
    store.rememberView([8.5, 12.4], 11)
    await expect(prepare()).rejects.toThrow()
    expect(captureMapRenderOwner(mock.api).isActive()).toBe(true)
    expect(store.savedCamera()).toMatchObject({ center: [8.5, 12.4], zoom: 11 })
    expect(off).not.toHaveBeenCalled()
    write.mockRestore()
    store.rememberView([9.5, 13.4], 12)
    store.setPanelTab('routes')
    await prepare()
    expect(mock.api.settings.get().mapViewState).toMatchObject({ lng: 9.5, lat: 13.4, zoom: 12 })
    expect(mock.api.settings.get().mapSessionState).toMatchObject({ panelTab: 'routes' })
    expect(captureMapRenderOwner(mock.api).isActive()).toBe(false)
  })

  it('cancels a debounced search when the store is disposed', async () => {
    vi.useFakeTimers()
    try {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      store = createStore(createMapApi().api)
      await store.ready
      store.setSearchQuery('Fern station')
      disposeStore(store)
      await vi.runAllTimersAsync()
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('discards a search reply from the disposed store', async () => {
    let finish!: (response: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve })))
    store = createStore(createMapApi().api)
    await store.ready
    store.setSearchQuery('Fern station')
    const searching = store.runSearch()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    disposeStore(store)
    const previous = store.getSnapshot()
    finish({ ok: true, json: async () => [{ lat: '12.4', lon: '8.5', display_name: 'Fern station' }] })
    await searching
    expect(store.getSnapshot()).toBe(previous)
    expect(store.getSnapshot().searchResults).toEqual([])
  })

  it('clamps a corrupt pitch and defaults a missing bearing', async () => {
    const s = seeded({ id: 'view', lng: 8.5, lat: 12.4, zoom: 11, pitch: 900 })
    store = s.store
    await store.load()
    const rec = recordingEngine()
    store.attachMap(rec.engine)
    expect(rec.jumps).toEqual([[[8.5, 12.4], 11, 0, 85]])
  })

  it('restores to the surviving engine across a StrictMode double-mount', async () => {
    const s = seeded({ id: 'view', lng: 8.5, lat: 12.4, zoom: 11, bearing: 0, pitch: 0 })
    store = s.store
    await store.load()

    // Engine A attaches and is destroyed before its style loads.
    const a = recordingEngine()
    store.attachMap(a.engine)
    store.detachMap(a.engine)
    // B must still get the restore — the latch lives in `rememberView`, not here.
    const b = recordingEngine()
    store.attachMap(b.engine)
    expect(b.jumps).toEqual([[[8.5, 12.4], 11, 0, 0]])
  })

  it('does not persist or adopt a camera before the saved view is read', async () => {
    const s = seeded({ id: 'view', lng: 8.5, lat: 12.4, zoom: 11, bearing: 0, pitch: 0 })
    store = s.store
    // A `move` before `load()` resolves — the default centre must not win, and
    // the persisted setting must be exactly as seeded (untouched).
    store.rememberView([0, 0], 2)
    expect(s.settings().mapViewState).toEqual({ id: 'view', lng: 8.5, lat: 12.4, zoom: 11, bearing: 0, pitch: 0 })

    await store.load()
    const rec = recordingEngine()
    store.attachMap(rec.engine)
    expect(rec.jumps).toEqual([[[8.5, 12.4], 11, 0, 0]])
  })

  it('restores the picked card and the stop list without geocoding', async () => {
    const s = seeded(
      { id: 'view', lng: 8.5, lat: 12.4, zoom: 11 },
      {
        id: 'session',
        panelTab: 'search',
        searchQuery: 'Alpine Meadow',
        selectedResult: { name: 'Alpine Meadow', lng: 7.35, lat: 11.23, context: 'Alpine Habitat' },
        directionsOpen: true,
        plannerMode: 'walking',
        // Exactly the `Waypoint` shape the store writes — `label`, no `name`.
        stops: [
          { label: 'Canopy Station', lng: 8.24, lat: 12.46 },
          { label: 'Alpine Meadow', lng: 7.35, lat: 11.23 }
        ]
      }
    )
    store = s.store
    await store.load()

    const snap = store.getSnapshot()
    expect(snap.selectedResult).toEqual({ name: 'Alpine Meadow', lng: 7.35, lat: 11.23, context: 'Alpine Habitat' })
    expect(snap.directionsOpen).toBe(true)
    expect(snap.plannerMode).toBe('walking')
    expect(snap.plannerWaypoints.map((w) => w.label)).toEqual(['Canopy Station', 'Alpine Meadow'])
    // The labels came off disk — restoring a route costs a routing call, never a geocode.
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.every(([url]) => !String(url).includes('/search')))
      .toBe(true)

    // The card's marker is re-pinned, and the camera is the saved one — not the route's.
    const rec = recordingEngine()
    store.attachMap(rec.engine)
    expect(rec.markers).toEqual([[7.35, 11.23]])
    expect(rec.flyTo).toEqual([])
    expect(rec.fits).toEqual([])
    expect(rec.jumps).toEqual([[[8.5, 12.4], 11, 0, 0]])
  })

  it('drops a directions form whose card did not survive, and a dead selectedPlaceId', async () => {
    const s = seeded(undefined, {
      id: 'session',
      selectedPlaceId: 'place-gone',
      directionsOpen: true,
      selectedResult: null,
      stops: [{ label: 'A', lng: 8.24, lat: 12.46 }]
    })
    store = s.store
    await store.load()
    expect(store.getSnapshot().directionsOpen).toBe(false)
    expect(store.getSnapshot().selectedPlaceId).toBeNull()
  })

  it('keeps a selectedPlaceId that still names a real place', async () => {
    const s = seeded(undefined, { id: 'session', panelTab: 'places', selectedPlaceId: 'place-seed' })
    store = s.store
    await store.load()
    expect(store.getSnapshot().selectedPlaceId).toBe('place-seed')
    expect(store.getSnapshot().panelTab).toBe('places')
  })

  it('ignores a session record with junk in every field', async () => {
    const s = seeded(undefined, {
      id: 'session',
      panelTab: 'nope',
      plannerMode: 'teleport',
      searchQuery: 42,
      searchResults: [{ name: 'no coords' }, { lng: 1, lat: 2 }],
      selectedResult: { name: 'bad', lng: 'x', lat: 'y' }
    })
    store = s.store
    await store.load()
    const snap = store.getSnapshot()
    expect(snap.panelTab).toBe('search')
    expect(snap.plannerMode).toBe('driving')
    expect(snap.searchQuery).toBe('')
    expect(snap.searchResults).toEqual([])
    expect(snap.selectedResult).toBeNull()
  })

  it('round-trips a session through its own write path', async () => {
    // The narrowing must accept exactly what `flushSession` emits. Hand-written
    // fixtures once carried a `name` on each stop that the store never writes,
    // which hid a narrower that rejected every real stop.
    const first = seeded({ id: 'view', lng: 8.5, lat: 12.4, zoom: 11 })
    const a = first.store
    await a.load()
    a.pickSearchResult({ name: 'Alpine Meadow', lng: 7.35, lat: 11.23, context: 'Alpine Habitat' })
    a.openDirections()
    a.setStop(0, { lng: 8.24, lat: 12.46, label: 'Canopy Station' })
    a.setPanelTab('routes')
    a.flushSession()
    const written = first.settings().mapSessionState as Record<string, unknown>
    disposeStore(a)

    // Reopen on exactly those bytes.
    const second = seeded({ id: 'view', lng: 8.5, lat: 12.4, zoom: 11 }, written)
    store = second.store
    await store.load()
    const snap = store.getSnapshot()
    expect(snap.panelTab).toBe('routes')
    expect(snap.directionsOpen).toBe(true)
    expect(snap.selectedResult?.name).toBe('Alpine Meadow')
    expect(snap.plannerStops.map((s) => s?.label)).toEqual(['Canopy Station', 'Alpine Meadow'])
    expect(snap.plannerWaypoints).toHaveLength(2)
  })

  it('gates session writes until the saved session is read, then writes on demand', async () => {
    const s = seeded(undefined, { id: 'session', panelTab: 'routes' })
    store = s.store
    // Pre-hydration edits must not clobber the record we have not read yet.
    store.setPanelTab('pins')
    expect(s.settings().mapSessionState).toEqual({ id: 'session', panelTab: 'routes' })

    await store.load()
    store.setPanelTab('pins')
    store.flushSession()
    expect(s.settings().mapSessionState).toMatchObject({ id: 'session', panelTab: 'pins' })
  })

  it('suppresses the fit for a restored route exactly once, then fits again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/route/v1')) {
          return {
            ok: true,
            json: async () => ({
              routes: [
                {
                  distance: 1200,
                  duration: 300,
                  geometry: { coordinates: [[8.24, 12.46], [7.35, 11.23]] },
                  legs: [{ steps: [] }]
                }
              ]
            })
          }
        }
        throw new Error(`unexpected fetch ${url}`)
      })
    )
    const s = seeded(
      { id: 'view', lng: 8.5, lat: 12.4, zoom: 11 },
      {
        id: 'session',
        selectedResult: { name: 'Alpine Meadow', lng: 7.35, lat: 11.23 },
        directionsOpen: true,
        // Exactly the `Waypoint` shape the store writes — `label`, no `name`.
        stops: [
          { label: 'Canopy Station', lng: 8.24, lat: 12.46 },
          { label: 'Alpine Meadow', lng: 7.35, lat: 11.23 }
        ]
      }
    )
    store = s.store
    await store.load()
    const rec = recordingEngine()
    store.attachMap(rec.engine)

    // The restored route redraws but must leave the restored camera alone.
    await store.computePlan()
    expect(rec.fits).toEqual([])

    // The suppression is one-shot: the first genuine edit hands the camera back.
    store.setStop(0, { lng: 6.63, lat: 11.52, label: 'Pollinator Field' })
    await store.computePlan()
    expect(rec.fits).toHaveLength(1)
  })
})

/**
 * Live location. The position is not the plugin's to fetch — `navigator.geolocation`
 * never answers in an Electron renderer, so the main process runs a CoreLocation
 * helper and the plugin only mirrors what the host reports. These tests are about
 * that mirroring: consent gates it, a fix reaches the engine, and revoking consent
 * takes the dot away.
 */
describe('MapStore — live location', () => {
  let store: MapStore

  const fix = { lat: 12.4816, lng: 8.2112, accuracy: 35, ts: 1_700_000_000_000 }

  function recorder(): { engine: MapEngine; pushed: Array<{ lng: number; lat: number } | null>; flyTo: LngLat[] } {
    const pushed: Array<{ lng: number; lat: number } | null> = []
    const flyTo: LngLat[] = []
    const engine = {
      setPlaces() {},
      setPins() {},
      setSourcePins() {},
      setWaypoints() {},
      setRoute() {},
      setUnits() {},
      setLiveLocation: (l: { lng: number; lat: number } | null) => pushed.push(l),
      setSearchMarker() {},
      flyTo: (center: LngLat) => flyTo.push(center),
      getZoom: () => 9
    } as unknown as MapEngine
    return { engine, pushed, flyTo }
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')))
  })

  afterEach(() => {
    disposeStore(store)
    vi.unstubAllGlobals()
  })

  it('shows nothing while the preference is off, even if the host leaks a fix', () => {
    const mock = createMapApi({ indexEntries: geoNotes, allowLiveLocation: false, liveLocation: fix })
    store = createStore(mock.api)
    const snap = store.getSnapshot()
    expect(snap.liveLocation).toBeNull()
    expect(snap.locationStatus).toBe('active')
  })

  it('adopts the host fix and pushes it to the engine', () => {
    const mock = createMapApi({ indexEntries: geoNotes, allowLiveLocation: true, liveLocation: fix })
    store = createStore(mock.api)
    const rec = recorder()
    store.attachMap(rec.engine)
    expect(store.getSnapshot().liveLocation).toMatchObject({ lng: 8.2112, lat: 12.4816, accuracy: 35 })
    expect(rec.pushed[rec.pushed.length - 1]).toMatchObject({ lng: 8.2112, lat: 12.4816 })
  })

  it('drops the dot when consent is withdrawn', () => {
    const mock = createMapApi({ indexEntries: geoNotes, allowLiveLocation: true, liveLocation: fix })
    store = createStore(mock.api)
    const rec = recorder()
    store.attachMap(rec.engine)
    expect(store.getSnapshot().liveLocation).not.toBeNull()

    mock.emitState({ allowLiveLocation: false, liveLocationState: 'off', liveLocation: null })
    expect(store.getSnapshot().liveLocation).toBeNull()
    expect(store.getSnapshot().locationStatus).toBe('off')
    // A stale dot left on the map would still be telling everyone where the user is.
    expect(rec.pushed[rec.pushed.length - 1]).toBeNull()
  })

  it('picks the fix up when it arrives after the map is already open', () => {
    const mock = createMapApi({ indexEntries: geoNotes, allowLiveLocation: true })
    store = createStore(mock.api)
    const rec = recorder()
    store.attachMap(rec.engine)
    expect(store.getSnapshot().liveLocation).toBeNull()

    mock.emitState({ liveLocationState: 'active', liveLocation: fix })
    expect(store.getSnapshot().locationStatus).toBe('active')
    expect(rec.pushed[rec.pushed.length - 1]).toMatchObject({ lng: 8.2112, lat: 12.4816 })
  })

  it('recentres on the first fix when locate was pressed before one existed', () => {
    const mock = createMapApi({ indexEntries: geoNotes, allowLiveLocation: true })
    store = createStore(mock.api)
    const rec = recorder()
    store.attachMap(rec.engine)

    store.locateMe()
    expect(rec.flyTo).toEqual([])

    mock.emitState({ liveLocationState: 'active', liveLocation: fix })
    expect(rec.flyTo).toEqual([[8.2112, 12.4816]])
  })

  it('does not arm a recentre the user cannot be given', () => {
    const mock = createMapApi({ indexEntries: geoNotes, allowLiveLocation: true })
    store = createStore(mock.api)
    const rec = recorder()
    store.attachMap(rec.engine)

    mock.emitState({ liveLocationState: 'denied', liveLocation: null })
    store.locateMe()
    mock.emitState({ liveLocationState: 'active', liveLocation: fix })
    expect(rec.flyTo).toEqual([])
  })

  it('maps the host lifecycle onto what the map draws', () => {
    const mock = createMapApi({ indexEntries: geoNotes, allowLiveLocation: true })
    store = createStore(mock.api)
    for (const [host, drawn] of [
      ['pending', 'locating'],
      ['denied', 'denied'],
      ['unavailable', 'error'],
      ['error', 'error'],
      ['off', 'off']
    ] as const) {
      mock.emitState({ liveLocationState: host })
      expect(store.getSnapshot().locationStatus).toBe(drawn)
    }
  })
})
