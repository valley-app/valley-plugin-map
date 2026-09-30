import type { MapRenderOwner } from './runtime'
import type { MapFileData } from './mapFile'
import { mapServices } from './serviceClient'
import {
  Map as MlMap,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
  addProtocol,
  removeProtocol,
  type GeoJSONSource,
  type LayerSpecification,
  type SourceSpecification,
  type StyleSpecification
} from 'maplibre-gl'
import { Protocol, PMTiles } from 'pmtiles'
import type {
  GeoPin,
  LiveLocation,
  LngLat,
  MapSettings,
  MapStyleId,
  NotePin,
  Place,
  Waypoint
} from './types'
import { pinMarkerSvg } from './icons'
import { boundsOf, circleRing } from './geo'
import {
  emptyCollection,
  lineFeature,
  pinsToFeatureCollection,
  placesToFeatureCollection,
  pointFeature,
  polygonFeature,
  type GeoJsonFeatureCollection
} from './geojson'
import { needsPmtiles, styleFor, type ThemeMode } from './mapStyle'
import type { ValleyUnits } from '@valley/plugin-sdk/units'
import { paletteCssValue } from '@valley/plugin-sdk/palette'

const ROUTE_SOURCE = 'sig-route'
const PLACES_SOURCE = 'sig-places'
const PINS_SOURCE = 'sig-pins'
const LOCATION_SOURCE = 'sig-location'
const FILE_SOURCE = 'sig-file'
type FileNumber = Extract<NonNullable<Extract<LayerSpecification, { type: 'line' }>['paint']>['line-width'], unknown[]>
const FILE_LAYERS = ['sig-file-point', 'sig-file-line', 'sig-file-fill']
const CLICKABLE_LAYERS = [...FILE_LAYERS, 'sig-places-dot', 'sig-pins-dot']

/** The blue every map uses for "you are here" — deliberately not the app accent,
 *  which the route already owns (two accent-coloured things on one map read as
 *  related, and a route is not your position). */
const LOCATION_COLOR = '#1a73e8'

/**
 * The route width must scale with zoom or it stops being a road.
 *
 * A flat width (this was 7px, cased at 12px, at every zoom) covers ~40 m of
 * ground at city zoom but two to three *kilometres* at country zoom — the band
 * swallows the motorway it is tracing, and the route reads as a blob wandering
 * near the road rather than lying on it.
 *
 * `exponential 1.5` rather than `linear`, because zoom is logarithmic in ground
 * scale: a linear ramp looks like the line is shrinking as you zoom in. 1.5 is
 * the base the OSM/Mapbox road layers use, so the route thickens in step with
 * the streets underneath it.
 */
const ROUTE_LINE_WIDTH = ['interpolate', ['exponential', 1.5], ['zoom'], 5, 4, 10, 6, 14, 9, 18, 16, 22, 26]
/** Casing = line + a constant 4…8px, not a constant ratio: a ratio makes the
 *  halo vanish exactly where the line is thinnest, which is where a route over
 *  satellite imagery needs it most. */
const ROUTE_CASING_WIDTH = ['interpolate', ['exponential', 1.5], ['zoom'], 5, 8, 10, 10.5, 14, 14, 18, 22, 22, 34]

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** MapLibre's scale-bar unit for the app's distance preference. */
function scaleUnit(units: ValleyUnits | undefined): 'metric' | 'imperial' {
  return units?.distance === 'mi' ? 'imperial' : 'metric'
}

/** The app's live accent, so the route matches the rest of the UI in both themes. */
function routeColor(): string {
  if (typeof document === 'undefined') return '#2563eb'
  const value = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim()
  return value || '#2563eb'
}

export interface MapEngineOptions {
  container: HTMLElement
  settings: MapSettings
  theme: ThemeMode
  style: MapStyleId
  /** App measurement units — drives the scale bar (defaults to metric). */
  units?: ValleyUnits
  interactive?: boolean
  scrollZoom?: boolean
  retainSnapshot?: boolean
  showControls?: boolean
  /** Set false to drop MapLibre's own +/− box (the page draws round ones itself). */
  showZoom?: boolean
  onReady?: () => void
  onError?: (error: unknown) => void
  onClick?: (lngLat: LngLat) => void
  onPlaceClick?: (id: string) => void
  onPinClick?: (relPath: string) => void
  onFileFeatureClick?: (index: number) => void
  /** Live camera — fired on every move and once the map loads. An object, not
   *  four positional numbers, so a caller can't silently swap bearing and pitch. */
  onCameraChange?: (camera: { center: LngLat; zoom: number; bearing: number; pitch: number }) => void
  /**
   * Where the map's **first frame** sits. Pass the remembered camera here rather
   * than jumping to it after construction: a `jumpTo` one tick later paints the
   * settings default first, and the user sees the map snap across the world.
   * Omitted → the configured default centre/zoom.
   */
  camera?: { center: LngLat; zoom: number; bearing: number; pitch: number }
}

/** Casts that bridge our plain GeoJSON to MapLibre's style-spec types (the
 *  global `GeoJSON` namespace isn't in scope under `types: ["node"]`). */
type SetDataArg = Parameters<GeoJSONSource['setData']>[0]
const asSource = (s: { type: 'geojson'; data: GeoJsonFeatureCollection }): SourceSpecification =>
  s as unknown as SourceSpecification

/**
 * Thin wrapper around a MapLibre map: owns the GL instance, the overlay sources
 * (route line, place + pin circles) and the waypoint HTML markers, and
 * re-applies them after every style swap (a `setStyle` wipes custom sources, but
 * not DOM markers). Lives outside React; the views drive it imperatively.
 */
export class MapEngine {
  private map: MlMap | null = null
  private snapshot: HTMLDivElement | null = null
  private opts: MapEngineOptions
  private ready = false
  private notifiedReady = false
  private destroyed = false
  private offVisibility: () => void = () => {}
  private offOwner: () => void = () => {}
  private visible: () => boolean = () => false
  private camera: { center: LngLat; zoom: number; bearing: number; pitch: number }
  private readonly protocolId = `map-${crypto.randomUUID()}`
  private readonly pmtiles = new Protocol()
  private readonly protocols: string[] = []
  private sourcePins: NotePin[] = []
  private waypoints: Waypoint[] = []
  private snapped: LngLat[] | undefined
  private searched: LngLat | null = null

  private route: LngLat[] = []
  private places: Place[] = []
  private pins: GeoPin[] = []
  private location: LiveLocation | null = null
  private fileData: MapFileData['collection'] = { type: 'FeatureCollection', features: [] }
  private waypointMarkers: Marker[] = []
  private sourceMarkers: Marker[] = []
  private hoverPopup: Popup | null = null
  private searchMarker: Marker | null = null
  private scaleControl: ScaleControl | null = null
  /** Camera move requested before the style finished loading — replayed on `load`. */
  private pendingCamera: (() => void) | null = null

  constructor(opts: MapEngineOptions, private owner: MapRenderOwner) {
    this.opts = opts
    this.camera = opts.camera ?? { center: opts.settings.defaultCenter, zoom: opts.settings.defaultZoom, bearing: 0, pitch: 0 }
    this.registerProtocols()
    const document = opts.container.ownerDocument
    const view = document.defaultView
    const Intersection = view?.IntersectionObserver
    let intersecting = !Intersection
    this.visible = () => {
      const rect = opts.container.getBoundingClientRect()
      return !this.destroyed && owner.isActive() && intersecting && document.visibilityState !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const update = (): void => this.updateVisibility()
    const intersection = Intersection ? new Intersection(entries => {
      const entry = entries.find(value => value.target === opts.container)
      if (entry) intersecting = entry.isIntersecting
      update()
    }) : null
    const Resize = view?.ResizeObserver
    const resize = Resize ? new Resize(update) : null
    intersection?.observe(opts.container)
    resize?.observe(opts.container)
    document.addEventListener('visibilitychange', update)
    this.offVisibility = () => { intersection?.disconnect(); resize?.disconnect(); document.removeEventListener('visibilitychange', update) }
    this.offOwner = owner.onDispose(() => this.destroy())
    update()
  }

  private updateVisibility(): void {
    try { this.resize() } catch (error) {
      this.destroy()
      if (this.opts.onError) this.opts.onError(error)
      else this.opts.container.textContent = error instanceof Error ? error.message : String(error)
    }
  }

  private registerProtocols(): void {
    const add = (name: string, handler: Parameters<typeof addProtocol>[1]): void => { addProtocol(name, handler); this.protocols.push(name) }
    const run = <T,>(work: () => Promise<T>): Promise<T> => this.owner.run(async () => {
      if (this.destroyed || !this.visible()) throw new Error('The map is no longer active.')
      const result = await work()
      this.owner.assertActive()
      if (this.destroyed) throw new Error('The map is no longer active.')
      return result
    })
    add(`${this.protocolId}-tile`, async ({ url }) => {
      const [connectionId, style, z, x, y] = new URL(url).pathname.slice(1).split('/').map(decodeURIComponent)
      const result = await run(() => mapServices(this.owner.api).tile({ connectionId, style, z: Number(z), x: Number(x), y: Number(y) }))
      return { data: Uint8Array.from(atob(result.bodyBase64), character => character.charCodeAt(0)).buffer }
    })
    add(`${this.protocolId}-resource`, async ({ url, type }) => run(async () => {
      const target = decodeURIComponent(new URL(url).pathname.slice(1))
      const result = await mapServices(this.owner.api).resource(target)
      let bytes = Uint8Array.from(atob(result.bodyBase64), character => character.charCodeAt(0))
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
        bytes = new Uint8Array(await new Response(stream).arrayBuffer())
      }
      if (type === 'json') return { data: JSON.parse(new TextDecoder().decode(bytes)) }
      if (type === 'string') return { data: new TextDecoder().decode(bytes) }
      return { data: bytes.buffer }
    }))
    add(`${this.protocolId}-pmtiles`, (params, controller) => run(() => this.pmtiles.tile({ ...params, url: params.url.replace(`${this.protocolId}-pmtiles://`, 'pmtiles://') }, controller)))
  }

  private style(): StyleSpecification {
    if (needsPmtiles(this.opts.settings)) {
      const path = this.opts.settings.offlineBasemapPath
      const key = `plugin-map-offline://archive/${encodeURIComponent(path)}`
      if (!this.pmtiles.get(key)) this.pmtiles.add(new PMTiles({
        getKey: () => key,
        getBytes: (offset, length) => this.owner.run(async () => {
          if (this.destroyed || !this.visible()) throw new Error('The map is no longer active.')
          const result = await mapServices(this.owner.api).offlineRange({ path, offset, length })
          this.owner.assertActive()
          if (this.destroyed) throw new Error('The map is no longer active.')
          return { data: Uint8Array.from(atob(result.bodyBase64), character => character.charCodeAt(0)).buffer, etag: result.etag }
        })
      }))
    }
    return JSON.parse(JSON.stringify(styleFor(this.opts.style, this.opts.theme, this.opts.settings))
      .replaceAll('plugin-map://', `${this.protocolId}-tile://`)
      .replaceAll('pmtiles://', `${this.protocolId}-pmtiles://`)) as StyleSpecification
  }

  private mount(): void {
    if (this.map || !this.visible()) return
    const opts = this.opts
    const map = new MlMap({
      container: opts.container,
      style: this.style(),
      ...this.camera,
      interactive: opts.interactive ?? true,
      scrollZoom: opts.scrollZoom ?? true,
      canvasContextAttributes: { preserveDrawingBuffer: opts.retainSnapshot ?? false },
      attributionControl: { compact: true },
      transformRequest: url => ({ url: /^https?:/.test(url) ? `${this.protocolId}-resource://fetch/${encodeURIComponent(url)}` : url })
    })
    this.map = map
    if (opts.showControls ?? true) {
      if (opts.showZoom ?? true) map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
      this.scaleControl = new ScaleControl({ unit: scaleUnit(opts.units) })
      map.addControl(this.scaleControl, 'bottom-left')
    }
    map.on('load', () => {
      if (this.map !== map) return
      if (!this.visible()) { this.suspend(); queueMicrotask(() => this.updateVisibility()); return }
      this.ready = true
      this.applyOverlays()
      this.setSourcePins(this.sourcePins)
      this.setWaypoints(this.waypoints, this.snapped)
      this.setSearchMarker(this.searched)
      if (this.pendingCamera) { const run = this.pendingCamera; this.pendingCamera = null; run() }
      if (!this.notifiedReady) { this.notifiedReady = true; opts.onReady?.() }
      this.emitCamera()
    })
    map.on('move', () => { if (this.map === map) this.emitCamera() })
    map.on('error', event => { if (this.map === map && this.owner.isActive()) this.opts.onError?.(event.error) })
    map.on('styledata', () => { if (this.map === map && this.ready) this.applyOverlays() })
    if (opts.retainSnapshot) map.on('idle', () => {
      if (this.map !== map || !this.ready) return
      this.captureSnapshot()
      if (this.snapshot) this.snapshot.hidden = true
    })
    this.wireInteractions()
  }

  private captureSnapshot(): void {
    if (!this.opts.retainSnapshot || !this.map || !this.ready) return
    const source = this.map.getCanvas()
    if (!source.width || !source.height) return
    const document = this.opts.container.ownerDocument
    const canvas = document.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height
    const context = canvas.getContext('2d')
    if (!context) return
    context.drawImage(source, 0, 0)
    Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' })
    const snapshot = document.createElement('div')
    snapshot.className = 'map-static-snapshot'
    snapshot.setAttribute('aria-hidden', 'true')
    snapshot.inert = true
    Object.assign(snapshot.style, { position: 'absolute', inset: '0', zIndex: '2', pointerEvents: 'none' })
    snapshot.appendChild(canvas)
    for (const overlay of this.opts.container.querySelectorAll('.maplibregl-marker, .maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right')) {
      if (!this.snapshot?.contains(overlay)) snapshot.appendChild(overlay.cloneNode(true))
    }
    this.snapshot?.remove()
    this.snapshot = snapshot
    this.opts.container.appendChild(snapshot)
  }

  private suspend(): void {
    const map = this.map
    if (!map) return
    if (!this.destroyed) this.captureSnapshot()
    if (this.snapshot) this.snapshot.hidden = false
    this.emitCamera()
    this.map = null
    this.ready = false
    this.scaleControl = null
    for (const marker of [...this.waypointMarkers, ...this.sourceMarkers]) marker.remove()
    this.waypointMarkers = []
    this.sourceMarkers = []
    this.hoverPopup?.remove(); this.hoverPopup = null
    this.searchMarker?.remove(); this.searchMarker = null
    map.remove()
  }

  // ---- Interactions ---------------------------------------------------------

  private wireInteractions(): void {
    const map = this.map
    if (!map) return
    map.on('click', (e) => {
      if (this.map !== map || !this.owner.isActive()) return
      const layers = CLICKABLE_LAYERS.filter((l) => map.getLayer(l))
      const hit = layers.length ? map.queryRenderedFeatures(e.point, { layers }) : []
      const feature = hit[0]
      if (feature?.source === FILE_SOURCE && typeof feature.id === 'number') {
        this.opts.onFileFeatureClick?.(feature.id)
        return
      }
      if (feature?.properties) {
        const props = feature.properties as Record<string, unknown>
        if (typeof props.id === 'string' && this.opts.onPlaceClick) {
          this.opts.onPlaceClick(props.id)
          return
        }
        if (typeof props.relPath === 'string' && this.opts.onPinClick) {
          this.opts.onPinClick(props.relPath)
          return
        }
      }
      this.opts.onClick?.([e.lngLat.lng, e.lngLat.lat])
    })
    for (const layer of CLICKABLE_LAYERS) {
      map.on('mouseenter', layer, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', layer, () => {
        map.getCanvas().style.cursor = ''
      })
    }
  }

  // ---- Overlays -------------------------------------------------------------

  private applyOverlays(): void {
    const map = this.map
    if (!map) return
    if (!map.isStyleLoaded()) return
    this.ensureSource(ROUTE_SOURCE)
    this.ensureSource(PLACES_SOURCE)
    this.ensureSource(PINS_SOURCE)
    this.ensureSource(LOCATION_SOURCE)
    if (this.opts.onFileFeatureClick || this.fileData.features.length) this.ensureFileLayers()

    // The route rides *under* the basemap's labels (street names stay readable)
    // and wears a casing, so it reads on satellite imagery as well as on paper
    // styles — the same two-layer treatment every road router uses.
    const labelLayer = this.routeInsertBeforeId()
    if (!map.getLayer('sig-route-casing')) {
      map.addLayer(
        {
          id: 'sig-route-casing',
          type: 'line',
          source: ROUTE_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': this.opts.theme === 'light' ? '#ffffff' : '#0b0b0d',
            'line-width': ROUTE_CASING_WIDTH,
            'line-opacity': 1
          }
        } as unknown as LayerSpecification,
        labelLayer
      )
    }
    if (!map.getLayer('sig-route-line')) {
      map.addLayer(
        {
          id: 'sig-route-line',
          type: 'line',
          source: ROUTE_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': routeColor(), 'line-width': ROUTE_LINE_WIDTH, 'line-opacity': 1 }
        } as unknown as LayerSpecification,
        labelLayer
      )
    }
    if (!map.getLayer('sig-pins-dot')) {
      map.addLayer({
        id: 'sig-pins-dot',
        type: 'circle',
        source: PINS_SOURCE,
        paint: {
          'circle-radius': 5,
          'circle-color': '#7c3aed',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5
        }
      } as unknown as LayerSpecification)
    }
    if (!map.getLayer('sig-places-dot')) {
      map.addLayer({
        id: 'sig-places-dot',
        type: 'circle',
        source: PLACES_SOURCE,
        paint: {
          'circle-radius': 7,
          'circle-color': ['coalesce', ['get', 'color'], '#ef4444'] as unknown as string,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2
        }
      } as unknown as LayerSpecification)
    }
    // The position dot goes on top of everything — a saved place or a note pin
    // sitting over it would hide the one thing that is actually moving. It is
    // deliberately absent from CLICKABLE_LAYERS: it is a readout, not a target.
    if (!map.getLayer('sig-location-accuracy')) {
      map.addLayer({
        id: 'sig-location-accuracy',
        type: 'fill',
        source: LOCATION_SOURCE,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': LOCATION_COLOR, 'fill-opacity': 0.15 }
      } as unknown as LayerSpecification)
    }
    if (!map.getLayer('sig-location-dot')) {
      map.addLayer({
        id: 'sig-location-dot',
        type: 'circle',
        source: LOCATION_SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 7,
          'circle-color': LOCATION_COLOR,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 3
        }
      } as unknown as LayerSpecification)
    }
    this.syncData()
  }

  /**
   * Where the route goes in the layer stack: above every layer that paints
   * ground (roads, landuse, water, imagery), below the first label above them.
   *
   * This used to be "before the style's *first* symbol layer", which is not the
   * label stack — OSM-derived styles put symbol layers (water names, landcover
   * labels, one-way arrows) low down, well before the road casings. The route
   * therefore went underneath the roads, and the roads widen with zoom: at
   * country zoom the thin roads left it visible, and zooming in painted a
   * motorway straight over it. Hence the route vanishing exactly when you
   * looked closer at it.
   */
  private routeInsertBeforeId(): string | undefined {
    const map = this.map
    if (!map) return undefined
    const layers = (map.getStyle()?.layers ?? []).filter((layer) => !layer.id.startsWith('sig-'))
    let lastGround = -1
    for (let i = 0; i < layers.length; i++) {
      const type = layers[i].type
      if (type !== 'symbol') lastGround = i
    }
    for (let i = lastGround + 1; i < layers.length; i++) {
      if (layers[i].type === 'symbol') return layers[i].id
    }
    // A style that ends in geometry (raster satellite tiles) has no label to sit
    // under — undefined means "on top", which is what we want there anyway.
    return undefined
  }

  private ensureSource(id: string): void {
    const map = this.map
    if (!map) return
    if (map.getSource(id)) return
    map.addSource(id, asSource({ type: 'geojson', data: emptyCollection() }))
  }

  private ensureFileLayers(): void {
    const map = this.map
    if (!map) return
    this.ensureSource(FILE_SOURCE)
    // A file's own simplestyle colours (KML styles arrive converted to them) are
    // its content and win; features without one use the route colour.
    // `to-number` turns a missing property into 0, so a number only counts when
    // the feature actually has it.
    const fallback = routeColor()
    const authored = (key: string, otherwise: number): FileNumber =>
      ['case', ['has', key], ['to-number', ['get', key], otherwise], otherwise]
    const layers: LayerSpecification[] = [
      { id: 'sig-file-fill', type: 'fill', source: FILE_SOURCE, filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': ['to-color', ['get', 'fill'], fallback], 'fill-opacity': authored('fill-opacity', 0.2) } },
      { id: 'sig-file-line', type: 'line', source: FILE_SOURCE, filter: ['!=', ['geometry-type'], 'Point'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['to-color', ['get', 'stroke'], fallback], 'line-width': authored('stroke-width', 3), 'line-opacity': authored('stroke-opacity', 1) } },
      { id: 'sig-file-point', type: 'circle', source: FILE_SOURCE, filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-color': ['to-color', ['get', 'marker-color'], ['get', 'icon-color'], fallback], 'circle-radius': 6, 'circle-stroke-color': this.opts.theme === 'light' ? '#ffffff' : '#0b0b0d', 'circle-stroke-width': 2 } }
    ]
    for (const layer of layers) if (!map.getLayer(layer.id)) map.addLayer(layer)
  }

  private setData(id: string, data: GeoJsonFeatureCollection): void {
    const map = this.map
    if (!map) return
    const source = map.getSource(id) as GeoJSONSource | undefined
    source?.setData(data as unknown as SetDataArg)
  }

  private syncData(): void {
    if (!this.ready || !this.map) return
    this.setData(
      ROUTE_SOURCE,
      this.route.length > 1
        ? { type: 'FeatureCollection', features: [lineFeature(this.route)] }
        : emptyCollection()
    )
    this.setData(PLACES_SOURCE, placesToFeatureCollection(this.places.map((place) => place.color ? { ...place, color: this.cssColor(place.color) } : place)))
    this.setData(PINS_SOURCE, pinsToFeatureCollection(this.pins))
    this.setData(LOCATION_SOURCE, this.locationCollection())
    const source = this.map.getSource(FILE_SOURCE) as GeoJSONSource | undefined
    source?.setData(this.fileData)
  }

  /** The dot plus its accuracy ring, or nothing when there is no fix. A ring is
   *  omitted below ~5 m: at that size it is smaller than the dot and adds only a
   *  smudge, while a huge one (a cell-tower fix) is the whole point of drawing it. */
  private locationCollection(): GeoJsonFeatureCollection {
    const fix = this.location
    if (!fix) return emptyCollection()
    const center: LngLat = [fix.lng, fix.lat]
    const features = [pointFeature(fix.lng, fix.lat, { kind: 'location' })]
    if (fix.accuracy > 5) {
      features.unshift(polygonFeature(circleRing(center, fix.accuracy), { kind: 'accuracy' }))
    }
    return { type: 'FeatureCollection', features }
  }

  // ---- Public API -----------------------------------------------------------

  setStyle(style: MapStyleId, theme: ThemeMode, settings: MapSettings): void {
    this.opts = { ...this.opts, style, theme, settings }
    this.map?.setStyle(this.style())
  }

  setRoute(coords: LngLat[] | null): void {
    this.route = coords ?? []
    this.syncData()
  }

  /**
   * A stored colour (`palette:<id>` or a literal) as a colour MapLibre can
   * parse, resolved against the map's own document so it follows the theme.
   */
  private cssColor(value: string): string | undefined {
    const doc = this.opts.container.ownerDocument
    const probe = doc.createElement('span')
    probe.style.display = 'none'
    probe.style.color = paletteCssValue(value)
    this.opts.container.appendChild(probe)
    const color = doc.defaultView?.getComputedStyle(probe).color ?? ''
    probe.remove()
    return color || undefined
  }

  setFileData(data: MapFileData['collection']): void {
    // Cloned into this map's realm: the plugin parses the file in its own
    // document, and MapLibre's worker transfer rejects objects whose
    // constructor belongs to another realm.
    const features = structuredClone(data.features)
    this.fileData = { type: 'FeatureCollection', features: features.map((feature, id) => ({ ...feature, id })) }
    if (this.ready && this.map?.isStyleLoaded()) this.ensureFileLayers()
    this.syncData()
  }

  /** Re-scale the scale bar after the distance preference changed. */
  setUnits(units: ValleyUnits): void {
    this.opts.units = units
    this.scaleControl?.setUnit(scaleUnit(units))
  }

  setPlaces(places: Place[]): void {
    this.places = places
    this.syncData()
  }

  setPins(pins: GeoPin[]): void {
    this.pins = pins
    this.syncData()
  }

  /** Show (or clear, with `null`) the device's own position. */
  setLiveLocation(location: LiveLocation | null): void {
    this.location = location
    this.syncData()
  }

  /**
   * Replace the styled note-pin markers (color + glyph per pin source). These
   * are DOM `Marker`s — like the waypoint markers, they survive style swaps and
   * carry their own hover popup + click-to-open.
   */
  setSourcePins(pins: NotePin[]): void {
    this.sourcePins = pins
    const map = this.map
    if (!map || !this.ready) return
    const previous = new Map(this.sourceMarkers.map(marker => [marker.getElement().dataset.pinKey, marker]))
    let changed = false
    const markers = pins.map((pin) => {
      const key = `${pin.sourceId}:${pin.relPath}`
      const svg = pinMarkerSvg(pin.color, pin.icon, pin.borderColor, pin.iconSvg)
      const signature = JSON.stringify([pin, svg])
      const existing = previous.get(key)
      previous.delete(key)
      if (existing?.getElement().dataset.pinSignature === signature) return existing
      changed = true
      existing?.remove()
      const el = this.opts.container.ownerDocument.createElement('div')
      let marker: Marker
      const current = (): boolean => this.map === map && this.owner.isActive() && this.sourceMarkers.includes(marker)
      el.className = 'map-note-marker'
      el.dataset.pinKey = key
      el.dataset.pinSignature = signature
      el.tabIndex = 0
      el.setAttribute('role', 'button')
      el.setAttribute('aria-label', pin.title)
      el.innerHTML = svg
      el.addEventListener('focus', () => { if (current()) this.showPinPopup(pin) })
      el.addEventListener('blur', () => { if (current()) { this.hoverPopup?.remove(); this.hoverPopup = null } })
      el.addEventListener('keydown', event => {
        if (current() && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); this.opts.onPinClick?.(pin.relPath) }
      })
      el.addEventListener('mouseenter', () => { if (current()) this.showPinPopup(pin) })
      el.addEventListener('mouseleave', () => {
        if (!current()) return
        this.hoverPopup?.remove()
        this.hoverPopup = null
      })
      el.addEventListener('click', (e) => {
        if (!current()) return
        e.stopPropagation()
        this.opts.onPinClick?.(pin.relPath)
      })
      marker = new Marker({ element: el, anchor: 'bottom' }).setLngLat([pin.lng, pin.lat]).addTo(map)
      return marker
    })
    for (const marker of previous.values()) marker.remove()
    this.sourceMarkers = markers
    if (changed || previous.size) { this.hoverPopup?.remove(); this.hoverPopup = null }
  }

  private showPinPopup(pin: NotePin): void {
    const map = this.map
    if (!map || !this.ready) return
    this.hoverPopup?.remove()
    const rows = pin.fields
      .map((f) => `<div class="map-pin-popup-row"><span>${escapeHtml(f.key)}</span><span>${escapeHtml(f.value)}</span></div>`)
      .join('')
    this.hoverPopup = new Popup({ closeButton: false, closeOnClick: false, offset: 30, className: 'map-pin-popup-wrap' })
      .setLngLat([pin.lng, pin.lat])
      .setHTML(`<div class="map-pin-popup"><div class="map-pin-popup-title">${escapeHtml(pin.title)}</div>${rows}</div>`)
      .addTo(map)
  }

  /**
   * Replace the lettered waypoint markers (A, B, C…) shown for the active plan.
   *
   * `snapped` (from the router, see {@link RawRoute.snapped}) wins over the typed
   * coordinate when it lines up 1:1, so a marker sits where the route actually
   * begins instead of on the building centroid the geocoder returned. A
   * mismatched length is ignored rather than zipped — half-snapped markers are
   * worse than none.
   */
  setWaypoints(waypoints: Waypoint[], snapped?: LngLat[]): void {
    this.waypoints = waypoints
    this.snapped = snapped
    const map = this.map
    if (!map || !this.ready) return
    const snap = snapped?.length === waypoints.length ? snapped : undefined
    for (const m of this.waypointMarkers) m.remove()
    this.waypointMarkers = waypoints.map((w, i) => {
      const el = this.opts.container.ownerDocument.createElement('div')
      el.className = 'map-wp-marker'
      el.textContent = String.fromCharCode(65 + (i % 26))
      // `anchor: 'center'` is MapLibre's default and the right one here — the
      // marker is a 24px disc centred on its point, not a bottom-tipped teardrop
      // like the note pins and the search marker.
      return new Marker({ element: el, anchor: 'center' })
        .setLngLat(snap?.[i] ?? [w.lng, w.lat])
        .addTo(map)
    })
  }

  /** Show (or clear, with `null`) a single transient marker pinning a searched address. */
  setSearchMarker(center: LngLat | null): void {
    this.searched = center
    const map = this.map
    if (!map || !this.ready) return
    this.searchMarker?.remove()
    this.searchMarker = null
    if (!center) return
    const el = this.opts.container.ownerDocument.createElement('div')
    el.className = 'map-search-marker'
    el.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>' +
      '<circle cx="12" cy="10" r="3"/>' +
      '</svg>'
    this.searchMarker = new Marker({ element: el, anchor: 'bottom' })
      .setLngLat(center)
      .addTo(map)
  }

  flyTo(center: LngLat, zoom?: number): void {
    if (!this.ready || !this.map) {
      this.pendingCamera = () => this.flyTo(center, zoom)
      return
    }
    this.map.flyTo({ center, zoom: zoom ?? Math.max(this.map.getZoom(), 13), speed: 1.4 })
  }

  /** Restore a camera with no animation — used to reopen on the remembered view.
   *  `flyTo` stays two-axis on purpose: MapLibre keeps the current bearing/pitch
   *  when they are omitted, so flying to a search hit must not level the map. */
  jumpTo(center: LngLat, zoom: number, bearing = 0, pitch = 0): void {
    if (!this.ready || !this.map) {
      this.pendingCamera = () => this.jumpTo(center, zoom, bearing, pitch)
      return
    }
    this.map.jumpTo({ center, zoom, bearing, pitch })
  }

  /** Back to north-up and flat — the page's compass button, since there is no
   *  MapLibre `NavigationControl` to carry one (`showZoom:false`). */
  resetNorth(): void {
    if (!this.map || !this.ready) { this.pendingCamera = () => this.resetNorth(); return }
    this.map.easeTo({ bearing: 0, pitch: 0, duration: 300 })
  }

  fitTo(coords: LngLat[], padding = 64): void {
    const bounds = boundsOf(coords)
    if (!bounds) return
    if (!this.ready || !this.map) {
      this.pendingCamera = () => this.fitTo(coords, padding)
      return
    }
    if (coords.length === 1) {
      this.flyTo(coords[0], 14)
      return
    }
    this.map.fitBounds(bounds, { padding, maxZoom: 16, duration: 700 })
  }

  resize(): void {
    if (this.destroyed) return
    if (!this.visible()) { this.suspend(); return }
    this.mount()
    this.map?.resize()
  }

  /** Step the zoom — the page draws its own controls, so it drives these. */
  zoomBy(delta: number): void {
    if (!this.map || !this.ready) {
      this.camera = { ...this.camera, zoom: this.camera.zoom + delta }
      this.pendingCamera = () => this.jumpTo(this.camera.center, this.camera.zoom, this.camera.bearing, this.camera.pitch)
      return
    }
    this.map.easeTo({ zoom: this.map.getZoom() + delta, duration: 220 })
  }

  getCenter(): LngLat {
    const c = this.map?.getCenter()
    return c ? [c.lng, c.lat] : this.camera.center
  }

  getZoom(): number {
    return this.map?.getZoom() ?? this.camera.zoom
  }

  private emitCamera(): void {
    if (!this.map) return
    this.camera = { center: this.getCenter(), zoom: this.getZoom(), bearing: this.map.getBearing(), pitch: this.map.getPitch() }
    if (!this.destroyed && this.owner.isActive()) this.opts.onCameraChange?.(this.camera)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.offVisibility()
    this.offOwner()
    this.suspend()
    this.snapshot?.remove()
    this.snapshot = null
    this.pendingCamera = null
    for (const protocol of this.protocols) removeProtocol(protocol)
  }
}
