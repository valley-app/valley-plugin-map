import { afterEach, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { gzipSync } from 'node:zlib'
import { createMockValleyApi } from '@valley/plugin-testkit'
import { act, renderHook } from '@testing-library/react'
import { MapEngine, type MapEngineOptions } from '../src/mapEngine'
import { createMapEngine } from '../src/island'
import { initRuntime, type MapRenderOwner } from '../src/runtime'
import { resolveSettings } from '../src/settings'
import { createStore, disposeStore } from '../src/store'
import { useMap } from '../src/hooks'

type Camera = { center: [number, number]; zoom: number; bearing: number; pitch: number }
type PhysicalMap = {
  camera: Camera
  options: Camera & { transformRequest(url: string): { url: string } }
  sources: Map<string, { data: unknown; setData(data: unknown): void }>
  layers: Map<string, { type: string }>
  removed: boolean
  fire(event: string, value?: unknown): void
}
const state = vi.hoisted(() => ({ maps: [] as PhysicalMap[], markers: [] as HTMLElement[], popups: [] as { removed: boolean }[], protocols: new Map<string, (input: { url: string; type?: string }, controller: AbortController) => Promise<{ data: unknown }>>() }))

vi.mock('maplibre-gl', () => {
  class Map {
    camera: Camera
    removed = false
    sources = new globalThis.Map<string, { data: unknown; setData(data: unknown): void }>()
    layers = new globalThis.Map<string, { type: string }>()
    events = new globalThis.Map<string, (value?: unknown) => void>()
    constructor(public options: PhysicalMap['options']) { this.camera = { ...options }; state.maps.push(this) }
    on(event: string, listener: (() => void) | string) { if (typeof listener === 'function') this.events.set(event, listener); return this }
    fire(event: string, value?: unknown) { this.events.get(event)?.(value) }
    isStyleLoaded() { return true }
    getStyle() { return { layers: [] } }
    getLayer(id: string) { return this.layers.get(id) }
    addLayer(value: { id: string; type: string }) { this.layers.set(value.id, value) }
    queryRenderedFeatures() { return [{ source: 'sig-file', id: 0 }] }
    getSource(id: string) { return this.sources.get(id) }
    addSource(id: string, value: { data: unknown }) {
      const source = { data: value.data, setData(data: unknown) { source.data = data } }
      this.sources.set(id, source)
    }
    setStyle() {}
    getCenter() { return { lng: this.camera.center[0], lat: this.camera.center[1] } }
    getZoom() { return this.camera.zoom }
    getBearing() { return this.camera.bearing }
    getPitch() { return this.camera.pitch }
    flyTo(value: Partial<Camera>) { this.camera = { ...this.camera, ...value }; this.fire('move') }
    jumpTo(value: Partial<Camera>) { this.flyTo(value) }
    easeTo(value: Partial<Camera>) { this.flyTo(value) }
    resize() {}
    remove() { this.removed = true }
  }
  class Marker {
    constructor(private options?: { element?: HTMLElement }) { if (options?.element) state.markers.push(options.element) }
    getElement() { return this.options!.element! }
    setLngLat() { return this }
    addTo() { return this }
    remove() {}
  }
  class Popup extends Marker {
    removed = false
    constructor() { super(); state.popups.push(this) }
    setHTML() { return this }
    remove() { this.removed = true }
  }
  return { Map, Marker, Popup, NavigationControl: class {}, ScaleControl: class {},
    addProtocol: (name: string, handler: typeof state.protocols extends globalThis.Map<string, infer H> ? H : never) => state.protocols.set(name, handler),
    removeProtocol: (name: string) => state.protocols.delete(name) }
})

const owners: MapRenderOwner[] = []
const releases: (() => void)[] = []
const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const release of releases.splice(0)) release()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  await Promise.all(owners.splice(0).map(owner => owner.dispose()))
  state.maps.length = 0
  state.markers.length = 0
  state.popups.length = 0
  state.protocols.clear()
  document.querySelectorAll('script[src]').forEach(script => script.remove())
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

it('keeps a mounted view bound to the store that owns its rendering lifetime', async () => {
  const first = createMockValleyApi({ manifest: { id: 'map' } })
  vi.spyOn(first.api.backend, 'call').mockResolvedValue({ ok: true, data: { connections: [] } })
  const oldStore = createStore(first.api)
  cleanups.push(() => disposeStore(oldStore))
  await oldStore.ready
  const oldView = renderHook(useMap)
  cleanups.push(oldView.unmount)
  const replacement = createMockValleyApi({ manifest: { id: 'map' } })
  vi.spyOn(replacement.api.backend, 'call').mockResolvedValue({ ok: true, data: { connections: [] } })
  replacement.api.runtime = first.api.runtime
  let nextStore!: ReturnType<typeof createStore>
  await act(async () => { nextStore = createStore(replacement.api); await nextStore.ready })
  cleanups.push(() => disposeStore(nextStore))
  oldView.rerender()
  expect(oldView.result.current.store).toBe(oldStore)
  const nextView = renderHook(useMap)
  cleanups.push(nextView.unmount)
  expect(nextView.result.current.store).toBe(nextStore)
})

function setup() {
  const mock = createMockValleyApi({ manifest: { id: 'map' } })
  const owner = initRuntime(mock.api); owners.push(owner)
  const container = document.createElement('div')
  let width = 800
  let visibility: DocumentVisibilityState = 'visible'
  let intersect!: (value: boolean) => void
  let resize!: () => void
  const disconnected = vi.fn()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) { intersect = value => this.callback([{ target, isIntersecting: value } as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
    disconnect() { disconnected() }
  })
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe() {} disconnect() { disconnected() } })
  vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, width, height: 500, left: 0, top: 0, right: width, bottom: 500, toJSON: () => ({}) }))
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  const onReady = vi.fn()
  const options: MapEngineOptions = { container, settings: resolveSettings({}), style: 'streets', theme: 'light', showControls: false, onReady }
  return { mock, owner, options, onReady, disconnected, intersect: (value: boolean) => intersect(value), rawWidth: (value: number) => { width = value },
    width: (value: number) => { width = value; resize() },
    visibility: (value: DocumentVisibilityState) => { visibility = value; document.dispatchEvent(new Event('visibilitychange')) } }
}

it('releases offscreen GL and restores camera and latest overlays without resetting user state', async () => {
  const fixture = setup()
  const engine = new MapEngine(fixture.options, fixture.owner)
  expect(state.maps).toHaveLength(0)
  fixture.intersect(true)
  expect(state.maps).toHaveLength(1)
  state.maps[0].fire('load')
  engine.jumpTo([8, 47], 12, 30, 15)
  engine.setRoute([[8, 47], [9, 48]])
  fixture.intersect(false)
  expect(state.maps[0].removed).toBe(true)
  engine.setRoute([[10, 49], [11, 50]])
  engine.setPlaces([{ id: 'one', name: 'One', lng: 8, lat: 47, createdAt: '' }])
  fixture.intersect(true)
  expect(state.maps[1].options).toMatchObject({ center: [8, 47], zoom: 12, bearing: 30, pitch: 15 })
  state.maps[1].fire('load')
  expect(state.maps[1].sources.get('sig-route')?.data).toMatchObject({ features: [{ geometry: { coordinates: [[10, 49], [11, 50]] } }] })
  expect(state.maps[1].sources.get('sig-places')?.data).toMatchObject({ features: [{ properties: { id: 'one' } }] })
  expect(fixture.onReady).toHaveBeenCalledOnce()
  fixture.visibility('hidden')
  expect(state.maps[1].removed).toBe(true)
  fixture.visibility('visible')
  expect(state.maps).toHaveLength(3)
  fixture.width(0)
  expect(state.maps[2].removed).toBe(true)
  fixture.width(800)
  expect(state.maps[3].options).toMatchObject({ center: [8, 47], zoom: 12, bearing: 30, pitch: 15 })
  await fixture.owner.dispose()
  expect(state.maps[3].removed).toBe(true)
  expect(state.protocols.size).toBe(0)
  expect(fixture.disconnected).toHaveBeenCalledTimes(2)
  engine.destroy()
  expect(fixture.disconnected).toHaveBeenCalledTimes(2)
})

it('retains file layers across style reloads and suspension and ignores clicks from retired maps', async () => {
  const fixture = setup()
  const click = vi.fn()
  const engine = new MapEngine({ ...fixture.options, onFileFeatureClick: click }, fixture.owner)
  const data = { type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const, id: 'source-id', properties: { name: 'File' }, geometry: { type: 'Point' as const, coordinates: [8, 47] } }] }
  engine.setFileData(data)
  fixture.intersect(true); state.maps[0].fire('load')
  expect(state.maps[0].sources.get('sig-file')?.data).toMatchObject({ features: [{ id: 0, properties: { name: 'File' } }] })
  expect(data.features[0].id).toBe('source-id')
  // The map gets its own copy, never the objects the plugin parsed in its realm.
  const drawn = state.maps[0].sources.get('sig-file')?.data as typeof data
  expect(drawn.features[0].geometry).not.toBe(data.features[0].geometry)
  expect(drawn.features[0].properties).not.toBe(data.features[0].properties)
  expect(['sig-file-point', 'sig-file-line', 'sig-file-fill'].map(id => state.maps[0].layers.get(id)?.type)).toEqual(['circle', 'line', 'fill'])
  state.maps[0].sources.clear(); state.maps[0].layers.clear(); state.maps[0].fire('styledata')
  expect(state.maps[0].sources.get('sig-file')?.data).toMatchObject({ features: [{ id: 0 }] })
  state.maps[0].fire('click', { point: {}, lngLat: { lng: 8, lat: 47 } })
  expect(click).toHaveBeenCalledWith(0)
  fixture.intersect(false); fixture.intersect(true); state.maps[1].fire('load')
  expect(state.maps[1].sources.get('sig-file')?.data).toMatchObject({ features: [{ id: 0 }] })
  state.maps[0].fire('click', { point: {}, lngLat: { lng: 8, lat: 47 } })
  expect(click).toHaveBeenCalledTimes(1)
  engine.setFileData({ type: 'FeatureCollection', features: [] })
  expect(state.maps[1].sources.get('sig-file')?.data).toMatchObject({ features: [] })
  engine.destroy()
})

it('rejects callbacks from replaced markers and disposed physical maps', async () => {
  const fixture = setup()
  const click = vi.fn()
  const engine = new MapEngine({ ...fixture.options, onPinClick: click }, fixture.owner)
  fixture.intersect(true); state.maps[0].fire('load')
  const pin = { relPath: 'Fern.md', sourceId: 'notes', title: 'Fern', lng: 8, lat: 47, color: 'green', borderColor: 'white', icon: 'map-pin', fields: [] }
  engine.setSourcePins([pin])
  const first = state.markers.at(-1)!
  engine.setSourcePins([{ ...pin }])
  expect(state.markers.at(-1)).toBe(first)
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
  expect(click).toHaveBeenCalledWith('Fern.md')
  click.mockClear()
  engine.setSourcePins([{ ...pin, title: 'Changed' }])
  first.dispatchEvent(new MouseEvent('click'))
  first.dispatchEvent(new MouseEvent('mouseenter'))
  expect(click).not.toHaveBeenCalled()
  expect(state.popups).toHaveLength(0)
  const second = state.markers.at(-1)!
  fixture.intersect(false); fixture.intersect(true); state.maps[1].fire('load')
  const latest = state.markers.at(-1)!
  latest.dispatchEvent(new MouseEvent('mouseenter'))
  expect(state.popups).toHaveLength(1)
  second.dispatchEvent(new MouseEvent('mouseleave'))
  second.dispatchEvent(new MouseEvent('mouseenter'))
  second.dispatchEvent(new MouseEvent('click'))
  expect(state.popups).toHaveLength(1)
  expect(state.popups[0].removed).toBe(false)
  latest.dispatchEvent(new MouseEvent('click'))
  expect(click).toHaveBeenCalledOnce()
  await fixture.owner.dispose()
  latest.dispatchEvent(new MouseEvent('click'))
  expect(click).toHaveBeenCalledOnce()
})

it('recreates a map whose first load arrived while its size was temporarily zero', async () => {
  const fixture = setup()
  new MapEngine(fixture.options, fixture.owner)
  fixture.intersect(true)
  fixture.rawWidth(0)
  state.maps[0].fire('load')
  expect(state.maps[0].removed).toBe(true)
  fixture.rawWidth(800)
  await Promise.resolve()
  expect(state.maps).toHaveLength(2)
  state.maps[1].fire('load')
  expect(fixture.onReady).toHaveBeenCalledOnce()
})

it.each([false, true])('decodes map resources before handing them to MapLibre (gzip: %s)', async (compressed) => {
  vi.stubGlobal('Blob', NodeBlob)
  const fixture = setup()
  const engine = new MapEngine(fixture.options, fixture.owner)
  fixture.intersect(true)
  const backend = vi.spyOn(fixture.mock.api.backend, 'call')
  const url = state.maps[0].options.transformRequest('https://tiles-a.basemaps.cartocdn.com/vectortiles/carto.streets/v1/0/0/0.mvt').url
  const handler = state.protocols.get(new URL(url).protocol.slice(0, -1))!
  for (const type of ['arrayBuffer', 'json', 'string']) {
    const raw = Buffer.from(type === 'arrayBuffer' ? [0x1a, 0x03, 0x0a, 0x01, 0x61] : '{"version":8}')
    backend.mockResolvedValue({ bodyBase64: (compressed ? gzipSync(raw) : raw).toString('base64') })
    const result = await handler({ url, type }, new AbortController())
    if (type === 'arrayBuffer') expect(new Uint8Array(result.data as ArrayBuffer)).toEqual(new Uint8Array(raw))
    else expect(result.data).toEqual(type === 'json' ? { version: 8 } : raw.toString())
  }
  engine.destroy()
})

it('keeps protocol requests bound to their API and joins accepted reads on replacement', async () => {
  const fixture = setup()
  const engine = new MapEngine(fixture.options, fixture.owner)
  fixture.intersect(true)
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve }); releases.push(release)
  vi.spyOn(fixture.mock.api.backend, 'call').mockImplementation((async () => { await held; return { bodyBase64: 'e30=' } }) as typeof fixture.mock.api.backend.call)
  const url = state.maps[0].options.transformRequest('https://tiles.example/one.json').url
  const handler = state.protocols.get(new URL(url).protocol.slice(0, -1))!
  const reading = expect(handler({ url, type: 'json' }, new AbortController())).rejects.toThrow('no longer active')
  const replacement = createMockValleyApi({ manifest: { id: 'map' } })
  owners.push(initRuntime(replacement.api))
  const finished = vi.fn()
  const draining = fixture.owner.dispose().then(finished)
  await Promise.resolve()
  expect(finished).not.toHaveBeenCalled()
  expect(state.maps[0].removed).toBe(true)
  expect(replacement.api.backend.call).not.toHaveBeenCalled()
  release(); await draining; await reading
  expect(fixture.mock.api.backend.call).toHaveBeenCalledOnce()
  engine.destroy()
})

it('joins a delayed island load and never constructs it with a replacement API', async () => {
  const fixture = setup()
  const document = window.document.implementation.createHTMLDocument('isolated island')
  const container = document.createElement('div')
  const creating = expect(createMapEngine({ ...fixture.options, container }, fixture.mock.api)).rejects.toThrow('no longer active')
  const script = document.querySelector('script')!
  const replacement = createMockValleyApi({ manifest: { id: 'map' } })
  owners.push(initRuntime(replacement.api))
  const ended = vi.fn()
  const draining = fixture.owner.dispose().then(ended)
  await Promise.resolve()
  expect(ended).not.toHaveBeenCalled()
  const construct = vi.fn()
  Object.defineProperty(document, 'defaultView', { configurable: true, value: { valleyMapIsland: { createMapEngine: construct } } })
  script.dispatchEvent(new Event('load'))
  await creating; await draining
  expect(construct).not.toHaveBeenCalled()
})

it('keeps joining a started island load after the view closes without creating a map', async () => {
  const fixture = setup()
  const document = window.document.implementation.createHTMLDocument('closed island')
  const container = document.createElement('div')
  const lifetime = new AbortController()
  const creating = expect(createMapEngine({ ...fixture.options, container }, fixture.mock.api, lifetime.signal)).rejects.toMatchObject({ name: 'AbortError' })
  lifetime.abort()
  const construct = vi.fn()
  Object.defineProperty(document, 'defaultView', { configurable: true, value: { valleyMapIsland: { createMapEngine: construct } } })
  document.querySelector('script')!.dispatchEvent(new Event('load'))
  await creating
  expect(construct).not.toHaveBeenCalled()
})

it('disables wheel zoom for embedded maps and retains it for standalone maps', async () => {
  const fixture = setup()
  const embedded = new MapEngine({ ...fixture.options, scrollZoom: false }, fixture.owner)
  fixture.intersect(true)
  expect(state.maps.at(-1)?.options).toMatchObject({ scrollZoom: false })
  embedded.destroy()
  const standalone = new MapEngine(fixture.options, fixture.owner)
  fixture.intersect(true)
  expect(state.maps.at(-1)?.options).toMatchObject({ scrollZoom: true })
  standalone.destroy()
})

it('keeps the last map image and attribution until the returning map has rendered, then disposes it', () => {
  const fixture = setup()
  const canvas = document.createElement('canvas')
  canvas.width = 800; canvas.height = 500
  const drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
  const engine = new MapEngine({ ...fixture.options, retainSnapshot: true }, fixture.owner)
  fixture.intersect(true)
  Object.assign(state.maps[0], { getCanvas: () => canvas })
  state.maps[0].fire('load')
  const attribution = document.createElement('div')
  attribution.className = 'maplibregl-ctrl-bottom-right'
  attribution.textContent = '© Map provider'
  fixture.options.container.appendChild(attribution)
  state.maps[0].fire('idle')
  expect(fixture.options.container.querySelector<HTMLElement>('.map-static-snapshot')?.hidden).toBe(true)
  fixture.intersect(false)
  expect(drawImage).toHaveBeenCalledWith(canvas, 0, 0)
  expect(state.maps[0].removed).toBe(true)
  const snapshot = fixture.options.container.querySelector<HTMLElement>('.map-static-snapshot')!
  expect(snapshot.hidden).toBe(false)
  expect(snapshot.textContent).toContain('© Map provider')
  fixture.intersect(true)
  Object.assign(state.maps[1], { getCanvas: () => canvas })
  expect(snapshot.hidden).toBe(false)
  state.maps[1].fire('load')
  state.maps[1].fire('idle')
  expect(fixture.options.container.querySelector<HTMLElement>('.map-static-snapshot')?.hidden).toBe(true)
  engine.destroy()
  expect(fixture.options.container.querySelector('.map-static-snapshot')).toBeNull()
})
