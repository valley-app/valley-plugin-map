import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockValleyApi } from './harness'
import { initRuntime } from '../src/runtime'
import { initLocalization } from '../src/localization'
import { createStore, disposeStore, type MapStore } from '../src/store'
import { resolveSettings } from '../src/settings'
import { planRoute, RouteProblem, routeProblemReason } from '../src/routing'
import type { MapRequest } from '../src/requests'
import type { GeoResult, Waypoint } from '../src/types'
import { createDirectionsTab, formStops, routeProblemText, type DirectionsTab } from '../src/tabs/search/directions/directionsTab'

const BERN: Waypoint = { lng: 7.44, lat: 46.95, label: 'Bern' }
const BASEL: Waypoint = { lng: 7.59, lat: 47.56, label: 'Basel' }
const OLTEN: Waypoint = { lng: 7.9, lat: 47.35, label: 'Olten' }
const HITS: GeoResult[] = [{ name: 'Olten', context: 'Solothurn, Switzerland', lng: 7.9, lat: 47.35 }, { name: 'Olten Hammer', lng: 7.89, lat: 47.34 }]

let store: MapStore
let tab: DirectionsTab
afterEach(async () => { tab?.dispose(); if (store) await disposeStore(store) })

async function setup(hits: GeoResult[] | Error = HITS) {
  const mock = createMockValleyApi({ manifest: { id: 'map' } })
  initLocalization(mock.api)
  initRuntime(mock.api)
  store = createStore(mock.api)
  await store.ready
  // The form is under test, not the router: no plan is computed here.
  vi.spyOn(store, 'computePlan').mockResolvedValue()
  const lookup = vi.spyOn(store, 'lookupPlaces').mockImplementation(async () => { if (hits instanceof Error) throw hits; return hits })
  tab = createDirectionsTab(store)
  return { mock, lookup }
}
const stops = () => tab.getSnapshot().route!.stops.map(stop => [stop.id, stop.role, stop.value])

describe('Map directions form', () => {
  it('always shows start, one empty via row and destination', async () => {
    await setup()
    expect(stops()).toEqual([['origin', 'origin', ''], ['via:1', 'via', ''], ['destination', 'destination', '']])
    expect(tab.getSnapshot().route).toMatchObject({ swap: 'swap', reorder: 'reorder' })
    store.setStops([BERN, BASEL])
    expect(stops()).toEqual([['origin', 'origin', 'Bern'], ['via:1', 'via', ''], ['destination', 'destination', 'Basel']])
    // A filled via gets a fresh empty row under it; emptying it takes the row away again.
    store.setStops([BERN, OLTEN, BASEL])
    expect(stops().map(stop => stop[0])).toEqual(['origin', 'via:1', 'via:2', 'destination'])
    await tab.run('input:via:1', { 'via:1': '' })
    expect(formStops(store.getSnapshot().plannerStops)).toEqual({ origin: BERN, vias: [], destination: BASEL })
    expect(stops().map(stop => stop[0])).toEqual(['origin', 'via:1', 'destination'])
  })

  it('marks the live position as a location stop named Current location', async () => {
    await setup()
    store.setStops([{ lng: 8.3, lat: 47.47, label: 'Your location', fromLiveLocation: true }, BASEL])
    expect(tab.getSnapshot().route!.stops[0]).toMatchObject({ value: 'Current location', location: true })
  })

  it('searches what is typed in a stop and fills it from the picked suggestion', async () => {
    const { lookup } = await setup()
    store.setStops([BERN, BASEL])
    await tab.run('focus:via:1', {})
    await tab.run('input:via:1', { 'via:1': 'olt' })
    expect(lookup).toHaveBeenCalledWith('olt', expect.any(AbortSignal))
    await vi.waitFor(() => expect(tab.getSnapshot().rows.map(row => row.title)).toEqual(['Olten', 'Olten Hammer']))
    expect(tab.suggesting()).toBe(true)
    // The typed text stays in the field while the suggestions show.
    expect(stops()[1]).toEqual(['via:1', 'via', 'olt'])
    await tab.run('pick:0', {})
    expect(formStops(store.getSnapshot().plannerStops).vias).toEqual([{ lng: 7.9, lat: 47.35, label: 'Olten' }])
    expect(tab.getSnapshot().rows).toEqual([])
    expect(tab.suggesting()).toBe(false)
  })

  it('takes the first hit on Enter, even before the search has come back', async () => {
    await setup()
    tab.enter('destination', 'olten')
    await vi.waitFor(() => expect(formStops(store.getSnapshot().plannerStops).destination).toEqual({ lng: 7.9, lat: 47.35, label: 'Olten' }))
    expect(tab.getSnapshot().rows).toEqual([])
  })

  it('drops unpicked text when the field is left, and says so when nothing is found', async () => {
    await setup([])
    store.setStops([BERN, BASEL])
    await tab.run('input:destination', { destination: 'zzzz' })
    await vi.waitFor(() => expect(tab.getSnapshot().message).toContain('No matches'))
    tab.blur('destination')
    expect(stops()[2]).toEqual(['destination', 'destination', 'Basel'])
    expect(tab.getSnapshot().message).toBeUndefined()
  })

  it('swaps and reorders the stops, roles following the order', async () => {
    await setup()
    store.setStops([BERN, OLTEN, BASEL])
    await tab.run('swap', {})
    expect(formStops(store.getSnapshot().plannerStops)).toEqual({ origin: BASEL, vias: [OLTEN], destination: BERN })
    // Drag the via to the front: it becomes the start, the old start a via.
    await tab.run('reorder:via:1:0', {})
    expect(formStops(store.getSnapshot().plannerStops)).toEqual({ origin: OLTEN, vias: [BASEL], destination: BERN })
  })

  it('offers the favourite places for an empty field and names the missing end', async () => {
    const mock = createMockValleyApi({ manifest: { id: 'map' }, datasets: { 'map.places': [{ id: 'place-den', name: 'Fox Den', lng: 8.5, lat: 47.3, createdAt: '2026-11-17T08:00:00.000Z', position: 0 }] } })
    initLocalization(mock.api); initRuntime(mock.api)
    store = createStore(mock.api); await store.ready
    vi.spyOn(store, 'computePlan').mockResolvedValue()
    tab = createDirectionsTab(store)
    store.setStops([null, BASEL])
    expect(tab.getSnapshot().message).toBe('Enter a start to see the route.')
    await tab.run('focus:origin', {})
    expect(tab.getSnapshot().rows.map(row => row.title)).toEqual(['Fox Den'])
    await tab.run('pick:0', {})
    expect(formStops(store.getSnapshot().plannerStops).origin).toMatchObject({ label: 'Fox Den', placeId: 'place-den' })
  })
})

describe('route problems', () => {
  const request = (answers: { status: number; json: unknown }[] | Error): MapRequest => ({
    check: () => {},
    services: { publicJson: vi.fn(async () => { if (answers instanceof Error) throw answers; return answers.shift()! }) } as never
  })

  it('names why the router found no route', async () => {
    const noRoute = await planRoute([BERN, BASEL], 'walking', resolveSettings({}), request([{ status: 400, json: { code: 'NoRoute' } }, { status: 400, json: { code: 'NoRoute' } }])).catch(error => error)
    expect(noRoute).toBeInstanceOf(RouteProblem)
    expect(routeProblemReason(noRoute)).toBe('no-route')
    // The travel mode's own router knows best: its reason wins over the fallback server's failure.
    const offRoad = await planRoute([BERN, BASEL], 'cycling', resolveSettings({}), request([{ status: 400, json: { code: 'NoSegment' } }, { status: 503, json: null }])).catch(error => error)
    expect(routeProblemReason(offRoad)).toBe('off-road')
    const busy = await planRoute([BERN, BASEL], 'driving', resolveSettings({}), request([{ status: 429, json: null }, { status: 429, json: null }])).catch(error => error)
    expect(routeProblemReason(busy)).toBe('busy')
    const offline = await planRoute([BERN, BASEL], 'driving', resolveSettings({}), request(new Error('Error: Plugin network access is disabled in VALLEY_TEST_MODE'))).catch(error => error)
    expect(routeProblemReason(offline)).toBe('offline')
    expect(routeProblemReason(new Error('Routing failed (500)'))).toBe('service')
  })

  it('refuses a line that stops at the nearest coast instead of reaching the stop', async () => {
    const NEW_YORK: Waypoint = { lng: -74.006, lat: 40.7128, label: 'New York' }
    // The router answers Ok with a route to where the road ends, thousands of kilometres short.
    const osrm = { code: 'Ok', routes: [{ geometry: { coordinates: [[7.44, 46.95], [-9.5, 38.78]] }, distance: 2163910, duration: 82355 }], waypoints: [{ location: [7.44, 46.95] }, { location: [-9.5, 38.78] }] }
    const answers = [{ status: 200, json: osrm }]
    const problem = await planRoute([BERN, NEW_YORK], 'driving', resolveSettings({}), request(answers)).catch(error => error)
    expect(routeProblemReason(problem)).toBe('no-route')
    // One answer was enough: the fallback server is not asked.
    expect(answers).toHaveLength(0)
    const hut = { code: 'Ok', routes: [{ geometry: { coordinates: [[7.44, 46.95], [7.6, 47.0]] }, distance: 14000, duration: 900 }], waypoints: [{ location: [7.44, 46.95] }, { location: [7.6, 47.0] }] }
    const offRoad = await planRoute([BERN, { lng: 7.8, lat: 47.1, label: 'Hut' }], 'walking', resolveSettings({}), request([{ status: 200, json: hut }])).catch(error => error)
    expect(routeProblemReason(offRoad)).toBe('off-road')
  })

  it('still routes through the fallback server when the mode server is down', async () => {
    const osrm = { routes: [{ geometry: { coordinates: [[7.44, 46.95], [7.59, 47.56]] }, distance: 98000, duration: 4200 }] }
    const plan = await planRoute([BERN, BASEL], 'walking', resolveSettings({}), request([{ status: 503, json: null }, { status: 200, json: osrm }]))
    expect(plan).toMatchObject({ distanceM: 98000, modeApproximated: true })
  })

  it('says each problem in plain words', async () => {
    await setup()
    for (const reason of ['no-route', 'off-road', 'too-far', 'same-place', 'offline', 'busy', 'service'] as const) {
      expect(routeProblemText(reason)).not.toMatch(/^directions\./)
      expect(routeProblemText(reason).length).toBeGreaterThan(30)
    }
  })
})
