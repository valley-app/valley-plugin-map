import { mapIconSvg, subscribeMapIcons } from './pinIcons'
import { mapServices } from './serviceClient'
import type { DataRecord, IndexEntry } from '@valley/plugin-sdk/types'
import { createIndexObserver } from '@valley/plugin-sdk'
import type { DatasetBatchOperation, DatasetRecord, DatasetTransactionOperation, DatasetWhere } from '@valley/plugin-sdk'
import type { ValleyPluginApi, ValleyReadonlyState } from '@valley/plugin-sdk'
import type { MapConnectionInfo } from './serviceClient'
import type { MapEngine } from './mapEngine'
import type { ThemeMode } from './mapStyle'
import type {
  ClickMode,
  GeoPin,
  GeoResult,
  LiveLocation,
  LngLat,
  LocationStatus,
  MapColorMode,
  MapSettings,
  MapStyleId,
  NotePin,
  PanelTab,
  PinSource,
  Place,
  Route,
  RoutePlan,
  TravelMode,
  Waypoint
} from './types'
import { METRIC_UNITS, normalizeUnits, type ValleyUnits } from '@valley/plugin-sdk/units'
import { resolveSettings } from './settings'
import { effectiveBasemapProvider, effectiveSearchProvider, effectiveRoutingProvider, effectiveElevationProvider, effectiveStyle, mapColorMode, mapLayer, parseAccountProviderChoice } from './settings'
import { parseGeoPins } from './pins'
import {
  buildSourcePins,
  matchSignature,
  normalizeAddress,
  sanitizePinSource,
  type GeoCache
} from './pinSources'
import { GeocodeError, searchPlaces, searchPlacesWithProvider, reverseGeocode } from './geocode'
import { createMapRequests } from './requests'
import { createBackgroundGeocoding } from './backgroundGeocoding'
import { uiText } from './localization'
import { setFormatUnits } from './format'
import { planRoute } from './routing'
import { computeElevationProfile } from './elevation'
import { api as runtimeApi, initRuntime, captureMapRenderOwner, type MapRenderOwner } from './runtime'
import { isValidLngLat } from './geo'

const PLACES_DATASET = 'places'
const ROUTES_DATASET = 'routes'
const WAYPOINTS_DATASET = 'route_waypoints'
const PIN_SOURCES_DATASET = 'pin_sources'
const GEOCACHE_DATASET = 'geocode_cache'
/** One record: the camera + basemap the map was last left on. */
const VIEW_SETTING = 'mapViewState'
/** One record: the sidebar the map was last left showing (card, form, tab). */
const SESSION_SETTING = 'mapSessionState'

/** MapLibre refuses a pitch past this — a corrupt file must not wedge the map. */
const MAX_PITCH = 85

/** The host's lifecycle vocabulary, narrowed to what the map draws. */
function mapLocationStatus(state: ValleyReadonlyState['liveLocationState']): LocationStatus {
  switch (state) {
    case 'active':
      return 'active'
    case 'pending':
      return 'locating'
    case 'denied':
      return 'denied'
    case 'unavailable':
    case 'error':
      return 'error'
    default:
      return 'off'
  }
}

function sameFix(a: LiveLocation | null, b: LiveLocation | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.lng === b.lng && a.lat === b.lat && a.accuracy === b.accuracy && a.ts === b.ts
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function sameUnits(a: ValleyUnits, b: ValleyUnits): boolean {
  return (
    a.distance === b.distance &&
    a.length === b.length &&
    a.temperature === b.temperature &&
    a.weight === b.weight &&
    a.speed === b.speed
  )
}

/** Literal unions a restored session record is narrowed against. */
const PANEL_TABS: PanelTab[] = ['search', 'places', 'routes', 'pins']
const isPanelTab = (value: unknown): value is PanelTab => typeof value === 'string' && (PANEL_TABS.includes(value as PanelTab) || /^extension:[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+$/.test(value))
const TRAVEL_MODES: TravelMode[] = ['driving', 'walking', 'cycling']

/** The filled stops of a stop list, in order. */
export function filledStops(stops: (Waypoint | null)[]): Waypoint[] {
  return stops.filter((stop): stop is Waypoint => stop !== null)
}

/** A stop list padded to the two-slot skeleton the form always shows. A fresh
 *  store starts empty (only `openDirections` seeds it), so the right sidebar's
 *  card would otherwise have nothing to render rows for. */
export function paddedStops(stops: (Waypoint | null)[]): (Waypoint | null)[] {
  if (stops.length >= 2) return stops
  return [...stops, ...Array<Waypoint | null>(2 - stops.length).fill(null)]
}

function sameWaypoints(a: Waypoint[], b: Waypoint[]): boolean {
  return a.length === b.length && a.every((w, i) => w.lng === b[i].lng && w.lat === b[i].lat && w.label === b[i].label)
}

interface RecordStore {
  read(): Promise<DataRecord[]>
  append(record: DataRecord): Promise<boolean>
  update(idField: string, idValue: string, record: DataRecord): Promise<boolean>
  delete(idField: string, idValue: string): Promise<boolean>
  replace(records: DataRecord[]): Promise<boolean>
  subscribe(listener: () => void): () => void
}

async function datasetRows(api: ValleyPluginApi, dataset: string, where?: DatasetWhere): Promise<DatasetRecord[]> {
  const rows: DatasetRecord[] = []
  let cursor: string | undefined
  do {
    const orderBy = dataset === PLACES_DATASET || dataset === ROUTES_DATASET ? [{ field: 'position', direction: 'asc' as const }] : undefined
    const page = await api.data.dataset(dataset).query({ where, orderBy, limit: 1000, cursor })
    rows.push(...page.rows)
    cursor = page.cursor
  } while (cursor)
  return rows
}

function rowStore(api: ValleyPluginApi, dataset: string): RecordStore {
  return {
    read: async () => (await datasetRows(api, dataset)) as DataRecord[],
    append: async (record) => {
      const values = { ...record } as DatasetRecord
      if (dataset === PLACES_DATASET) {
        const page = await api.data.dataset(dataset).query({ orderBy: [{ field: 'position', direction: 'desc' }], limit: 1 })
        values.position = page.rows.length ? Number(page.rows[0].position ?? 0) + 1 : 0
      }
      return (await api.data.dataset(dataset).upsert(values)).affected > 0
    },
    update: async (idField, idValue, record) => {
      const values = { ...record } as DatasetRecord
      delete values[idField]
      return (await api.data.dataset(dataset).update({ [idField]: idValue }, values)).affected > 0
    },
    delete: async (idField, idValue) => (await api.data.dataset(dataset).delete({ [idField]: idValue })).affected > 0,
    replace: async (records) => {
      const existing = await datasetRows(api, dataset)
      const operations: DatasetBatchOperation[] = [
        ...existing.map((row) => ({ operation: 'delete' as const, key: { id: String(row.id) } })),
        ...records.map((record, position) => ({ operation: 'insert' as const, values: { ...record, ...(dataset === PLACES_DATASET ? { position } : {}) } as DatasetRecord }))
      ]
      if (operations.length) await api.data.dataset(dataset).batch(operations)
      return true
    },
    subscribe: (listener) => api.data.dataset(dataset).subscribe(listener)
  }
}

function pinSourceStore(api: ValleyPluginApi): RecordStore {
  const dataset = api.data.dataset(PIN_SOURCES_DATASET)
  return {
    read: async () => (await datasetRows(api, PIN_SOURCES_DATASET))
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map((row) => row.definition as unknown as DataRecord),
    append: async (record) => (await dataset.upsert({ id: String(record.id), position: 0, definition: JSON.parse(JSON.stringify(record)) as DatasetRecord })).affected > 0,
    update: async (_idField, idValue, record) => (await dataset.update({ id: idValue }, { definition: JSON.parse(JSON.stringify(record)) as DatasetRecord })).affected > 0,
    delete: async (_idField, idValue) => (await dataset.delete({ id: idValue })).affected > 0,
    replace: async (records) => {
      const existing = await datasetRows(api, PIN_SOURCES_DATASET)
      const operations: DatasetBatchOperation[] = [
        ...existing.map((row) => ({ operation: 'delete' as const, key: { id: String(row.id) } })),
        ...records.map((record, position) => ({
          operation: 'insert' as const,
          values: { id: String(record.id), position, definition: JSON.parse(JSON.stringify(record)) as DatasetRecord }
        }))
      ]
      if (operations.length) await dataset.batch(operations)
      return true
    },
    subscribe: (listener) => dataset.subscribe(listener)
  }
}

function routeRow(route: Route): DatasetRecord {
  return {
    id: route.id,
    name: route.name,
    mode: route.mode,
    geometry: route.geometry ?? null,
    distanceM: route.distanceM ?? null,
    durationS: route.durationS ?? null,
    note: route.note ?? null,
    createdAt: route.createdAt
  }
}

function waypointWrites(route: Route): DatasetTransactionOperation[] {
  return route.waypoints.map((waypoint, position) => ({
    dataset: WAYPOINTS_DATASET,
    operation: 'insert',
    values: {
      routeId: route.id,
      position,
      lng: waypoint.lng,
      lat: waypoint.lat,
      label: waypoint.label,
      placeId: waypoint.placeId ?? null,
      fromLiveLocation: waypoint.fromLiveLocation ?? null
    }
  }))
}

function routeStore(api: ValleyPluginApi): RecordStore {
  const routes = api.data.dataset(ROUTES_DATASET)
  return {
    read: async () => {
      const [base, waypoints] = await Promise.all([
        datasetRows(api, ROUTES_DATASET),
        datasetRows(api, WAYPOINTS_DATASET)
      ])
      const byRoute = new Map<unknown, DatasetRecord[]>()
      for (const waypoint of waypoints) {
        const entries = byRoute.get(waypoint.routeId)
        if (entries) entries.push(waypoint)
        else byRoute.set(waypoint.routeId, [waypoint])
      }
      for (const entries of byRoute.values()) entries.sort((a, b) => Number(a.position) - Number(b.position))
      return base.map((row) => ({
        ...row,
        waypoints: (byRoute.get(row.id) ?? [])
          .map((entry) => ({
            lng: Number(entry.lng), lat: Number(entry.lat), label: String(entry.label),
            ...(typeof entry.placeId === 'string' ? { placeId: entry.placeId } : {}),
            ...(entry.fromLiveLocation === true ? { fromLiveLocation: true } : {})
          }))
      } as DataRecord))
    },
    append: async (record) => {
      const route = record as unknown as Route
      const page = await routes.query({ orderBy: [{ field: 'position', direction: 'desc' }], limit: 1 })
      const position = page.rows.length ? Number(page.rows[0].position ?? 0) + 1 : 0
      await api.data.transaction([{ dataset: ROUTES_DATASET, operation: 'insert', values: { ...routeRow(route), position } }, ...waypointWrites(route)])
      return true
    },
    update: async (_idField, idValue, record) => {
      const route = { ...(record as unknown as Route), id: idValue }
      const old = await datasetRows(api, WAYPOINTS_DATASET, { routeId: idValue })
      const row = routeRow(route)
      delete row.id
      await api.data.transaction([
        { dataset: ROUTES_DATASET, operation: 'update', key: { id: idValue }, values: row },
        ...old.map((entry) => ({ dataset: WAYPOINTS_DATASET, operation: 'delete' as const, key: { routeId: idValue, position: Number(entry.position) } })),
        ...waypointWrites(route)
      ])
      return true
    },
    delete: async (_idField, idValue) => (await routes.delete({ id: idValue })).affected > 0,
    replace: async (records) => {
      const existing = await datasetRows(api, ROUTES_DATASET)
      await api.data.transaction([
        ...existing.map((row) => ({ dataset: ROUTES_DATASET, operation: 'delete' as const, key: { id: String(row.id) } })),
        ...records.flatMap((record, position) => {
          const route = record as unknown as Route
          return [{ dataset: ROUTES_DATASET, operation: 'insert' as const, values: { ...routeRow(route), position } }, ...waypointWrites(route)]
        })
      ])
      return true
    },
    subscribe: (listener) => {
      const offRoutes = routes.subscribe(listener)
      const offWaypoints = api.data.dataset(WAYPOINTS_DATASET).subscribe(listener)
      return () => { offRoutes(); offWaypoints() }
    }
  }
}

function settingStore(api: ValleyPluginApi, key: string): RecordStore {
  return {
    read: async () => {
      const value = api.settings.get()[key]
      return value && typeof value === 'object' && !Array.isArray(value) ? [value as DataRecord] : []
    },
    append: async (record) => (await api.settings.set(key, record)).ok,
    update: async (_idField, _idValue, record) => (await api.settings.set(key, record)).ok,
    delete: async () => (await api.settings.set(key, null)).ok,
    replace: async (records) => (await api.settings.set(key, records[0] ?? null)).ok,
    subscribe: (listener) => api.settings.subscribe(listener)
  }
}

/** Everything the views render — rebuilt (with stable identity) on every change. */
export interface MapSnapshot {
  indexEntries: IndexEntry[]
  loading: boolean
  places: Place[]
  routes: Route[]
  pins: GeoPin[]
  pinSources: PinSource[]
  sourcePins: NotePin[]
  /** How many pins each source holds — independent of its eye toggle. */
  sourcePinCounts: Record<string, number>
  plannerWaypoints: Waypoint[]
  plannerMode: TravelMode
  plan: RoutePlan | null
  planning: boolean
  planError: string | null
  style: MapStyleId
  colorMode: MapColorMode
  /** The appearance the map is drawn in — `colorMode` with System resolved. */
  resolvedColorMode: ThemeMode
  selectedPlaceId: string | null
  /** True while a map view (the page) is mounted and driving the engine. */
  hasMap: boolean
  mapboxAvailable: boolean
  mapStyleConnections: MapConnectionInfo[]
  /** What a map click does — shared by the page overlay and the sidebar chip. */
  clickMode: ClickMode
  /** The left-sidebar panel's active icon tab. */
  panelTab: PanelTab
  /** Live geocoder search, shared by the map capsule and the sidebar tab. */
  searchQuery: string
  searchResults: GeoResult[]
  searchBusy: boolean
  searchError: string | null
  /** Keyboard cursor over the hit list; −1 = nothing active (Enter re-runs the query). */
  searchActiveIndex: number
  /** The result the user picked — the sidebar keeps showing it (Google-style). */
  selectedResult: GeoResult | null
  /** True while the sidebar shows the From → To route form. */
  directionsOpen: boolean
  /** The route's stop list, empty slots included — A, B, then any vias. */
  plannerStops: (Waypoint | null)[]
  /** Id of the saved route the current plan came from (drives save ⇄ un-save). */
  savedRouteId: string | null
  /** The app's measurement units, so every readout formats from one source. */
  units: ValleyUnits
  /** The device's last known position, or null when there is no fix. */
  liveLocation: LiveLocation | null
  /** Where live location stands — the views render their own copy from this. */
  locationStatus: LocationStatus
  /**
   * Where the map is pointed, or null before a camera has been remembered.
   *
   * Updated on the **debounced** camera write, never per move frame: a pan fires
   * `rememberView` on every frame, and emitting there would re-render every
   * subscriber at 60 Hz for a readout nobody can read mid-gesture.
   */
  camera: { lng: number; lat: number; zoom: number; bearing: number; pitch: number } | null
}

export interface MapLinkState extends Record<string, unknown> {
  v: 1
  camera: { lng: number; lat: number; zoom: number; bearing: number; pitch: number } | null
  style: MapStyleId
  colorMode?: MapColorMode
  searchQuery: string
  selectedPlaceId: string | null
  selectedResult: GeoResult | null
}

export class MapStore {
  readonly ready: Promise<void>
  private readonly renderOwner: MapRenderOwner
  private readonly hydration: Promise<void>
  private readonly index
  private readonly root
  private indexEntries: IndexEntry[] = []
  private offIndex: (() => void) | null = null
  private rejectIndexReady: ((reason: Error) => void) | undefined
  private disposal: Promise<void> | undefined
  private viewWrite: Promise<boolean> = Promise.resolve(true)
  private sessionWrite: Promise<boolean> = Promise.resolve(true)
  private settingsWrites = new Map<string, { value: string; result: Promise<boolean> }>()
  private savedSettings = new Map<string, string>()
  private pinSourcesWrite: Promise<boolean> = Promise.resolve(true)
  private selectedSourceId: string | null = null
  private api: ValleyPluginApi
  private listeners = new Set<() => void>()
  private disposed = false
  private requests: ReturnType<typeof createMapRequests>
  private searchRequest: AbortController | null = null
  private planRequest: AbortController | null = null
  private requestProviders: string[]

  private engine: MapEngine | null = null
  private places: Place[] = []
  private routes: Route[] = []
  private pins: GeoPin[] = []
  private pinSources: PinSource[] = []
  private sourcePins: NotePin[] = []
  /** Per-source pin totals, counted before the visibility filter. */
  private sourcePinCounts: Record<string, number> = {}
  private geocache: GeoCache = new Map()
  private geocoding: ReturnType<typeof createBackgroundGeocoding>
  private matchSig = ''
  private offSourcesChanged: (() => void) | null = null
  /** Whether the first pin-source dataset query completed before writes begin. */
  private sourcesLoaded = false
  private loading = true

  private plannerWaypoints: Waypoint[] = []
  private plannerMode: TravelMode = 'driving'
  private plan: RoutePlan | null = null
  private planning = false
  private planError: string | null = null
  private planToken = 0
  private planTimer: number | null = null

  private style: MapStyleId
  private selectedPlaceId: string | null = null
  private pendingFocus: { center: LngLat; zoom?: number } | null = null
  private searchMarker: LngLat | null = null
  private clickMode: ClickMode = 'place'
  private panelTab: PanelTab = 'search'
  private savedView: { lng: number; lat: number; zoom: number; bearing: number; pitch: number } | null = null
  private viewApplied = false
  private viewLoaded = false
  private viewTimer: number | null = null
  private sessionLoaded = false
  private sessionTimer: number | null = null
  /** A restored route must not fit the map — the restored camera wins. Cleared
   *  by the first genuine planner edit, which then fits normally again. */
  private suppressPlanFit = false
  private offUnload: (() => void) | null = null
  private offBeforeUnload: (() => void) | null = null

  private searchQuery = ''
  private searchResults: GeoResult[] = []
  private searchBusy = false
  private searchError: string | null = null
  private searchActiveIndex = -1
  private selectedResult: GeoResult | null = null
  private directionsOpen = false
  /** The stop list the directions form edits; `plannerWaypoints` is its filled subset. */
  private plannerStops: (Waypoint | null)[] = []
  private savedRouteId: string | null = null
  private units: ValleyUnits = METRIC_UNITS
  private liveLocation: LiveLocation | null = null
  /** One-shot latch behind {@link seedOriginFromLocation}. */
  private originSeeded = false
  private locationStatus: LocationStatus = 'off'
  /** Set by "locate me" while no fix has landed — the next one recentres once. */
  private pendingRecenter = false
  private searchTimer: number | null = null
  private searchToken = 0
  private pendingLinkState: Record<string, unknown> | null = null

  private colorMode: MapColorMode = 'system'
  private readonly systemColorScheme: MediaQueryList | null
  /** Valley's appearance as a map view's document reports it; see `setHostAppearance`. */
  private hostAppearance: ThemeMode | null = null
  private offIcons: (() => void) | null = null
  private offState: (() => void) | null = null
  private offSettings: (() => void) | null = null
  private offAppearance: (() => void) | null = null
  private mapboxAvailable = false
  private mapStyleConnections: MapConnectionInfo[] = []
  private mapProvidersLoaded = false
  private preferredStyle: MapStyleId
  private snapshot!: MapSnapshot

  constructor(api: ValleyPluginApi) {
    this.api = api
    this.renderOwner = captureMapRenderOwner(api)
    this.root = api.getState().vault?.path
    this.index = createIndexObserver(api, { kinds: ['note'], fields: ['title', 'aliases', 'kind', 'excluded', 'frontmatter'] })
    this.requests = createMapRequests(api)
    this.geocoding = createBackgroundGeocoding({
      answers: api.data.dataset('geocode_answers'),
      lookup: (address, settings, signal) => this.requests.run(signal, request => searchPlacesWithProvider(address, settings, request)),
      publish: async (address, coordinate, signal) => {
        if (this.disposed || signal.aborted) return false
        const key = normalizeAddress(address)
        const previous = this.geocache.get(key)
        if (previous?.lng === coordinate.lng && previous.lat === coordinate.lat) return true
        const saved = await this.records(GEOCACHE_DATASET).append({ id: key, address, ...coordinate, unresolved: false })
        if (this.disposed || signal.aborted || !saved) return false
        this.geocache.set(key, coordinate)
        this.refreshDerived()
        this.emit()
        return true
      },
      onError: (error, address) => console.error('[mapbox] geocode failed', address, error)
    })
    const initialSettings = this.settings()
    this.requestProviders = [effectiveSearchProvider(initialSettings), effectiveRoutingProvider(initialSettings), effectiveElevationProvider(initialSettings)]
    this.style = effectiveStyle(initialSettings)
    this.preferredStyle = mapLayer(initialSettings.defaultStyle)
    this.units = normalizeUnits(api.getState().units, METRIC_UNITS)
    setFormatUnits(this.units)
    this.systemColorScheme = window.matchMedia?.('(prefers-color-scheme: dark)') ?? null
    this.systemColorScheme?.addEventListener('change', this.onSystemColorMode)
    this.offAppearance = this.api.settings.core.subscribe(this.onSystemColorMode)
    this.rebuild()
    this.syncLiveLocation(api.getState())
    this.offState = this.api.subscribeState(['vault', 'units', 'liveLocationState', 'liveLocation', 'allowLiveLocation'], () => this.onCoreState())
    const indexReady = new Promise<void>((resolve, reject) => {
      this.rejectIndexReady = reject
      this.offIndex = this.index.subscribe(() => {
        if (this.disposed) return
        const snapshot = this.index.getSnapshot()
        if (snapshot.status === 'error') { reject(new Error(snapshot.error ?? 'The map index is unavailable.')); return }
        if (snapshot.status !== 'ready') return
        this.indexEntries = snapshot.entries.map(entry => ({ ...entry, title: entry.title ?? '', kind: entry.kind ?? 'note', mtimeMs: 0 }))
        const changed = matchSignature(this.indexEntries, this.pinSources) !== this.matchSig
        this.refreshDerived()
        if (changed) this.enqueueGeocoding()
        this.emit()
        resolve()
      })
    })
    this.offIcons = subscribeMapIcons(() => { this.refreshDerived(); this.emit() }, api)
    this.offSettings = this.api.settings.subscribe(() => { this.refreshRequestProviders(); void this.refreshMapProviders() })
    void this.refreshMapProviders()
    try {
      this.watchSourcesChanged()
    } catch (err) {
      console.error('[mapbox] source subscription failed', err)
    }
    this.watchUnload()
    this.offBeforeUnload = api.runtime.onBeforeUnload(async () => {
      const geocoding = this.geocoding.stop()
      this.cancelSearchRequest()
      this.cancelPlanRequest()
      if (this.searchBusy || this.planning) {
        this.searchBusy = false
        this.planning = false
        this.emit()
      }
      for (;;) {
        this.flushView()
        this.flushSession()
        const pending = [this.viewWrite, this.sessionWrite, this.pinSourcesWrite]
        const results = await Promise.all(pending)
        if (results.some((saved) => saved === false)) throw new Error(uiText('surface.invalid'))
        if (this.viewTimer === null && this.sessionTimer === null &&
          pending[0] === this.viewWrite && pending[1] === this.sessionWrite && pending[2] === this.pinSourcesWrite) {
          await Promise.all([geocoding, this.requests.cancelAll(), this.renderOwner.dispose()])
          return
        }
      }
    })
    // Fire-and-forget, so a failed read cannot surface as an unhandled rejection.
    // `load` clears `loading` in a finally, so the map still mounts — on the
    // configured default camera, which is the right answer when there is no
    // remembered one to be had.
    this.hydration = this.load()
    this.ready = Promise.all([this.hydration, indexReady]).then(() => {})
    void this.ready.catch((err) => { if (!this.disposed) console.error('[mapbox] initial load failed', err) })
  }

  /**
   * A renderer reload (⌘R) tears the frame down without ever calling
   * {@link dispose} — the plugin disposer only runs on unload/hot-reload — so
   * the debounced writes get one best-effort flush here. Best-effort is the
   * operative word: a write queued at `pagehide` may not land. The short
   * debounce delays are the real guarantee, not this.
   */
  private watchUnload(): void {
    const flush = (): void => {
      this.flushView()
      this.flushSession()
    }
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHidden)
    this.offUnload = () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }

  private watchSourcesChanged(): void {
    const handler = (): void => void this.reloadSources()
    this.offSourcesChanged = this.records(PIN_SOURCES_DATASET).subscribe(handler)
  }

  // ---- subscription ---------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): MapSnapshot => this.snapshot

  private emit(): void {
    this.rebuild()
    this.listeners.forEach((l) => l())
  }

  private rebuild(): void {
    this.snapshot = {
      indexEntries: this.indexEntries,
      loading: this.loading,
      places: this.places,
      routes: this.routes,
      pins: this.pins,
      pinSources: this.pinSources,
      sourcePins: this.sourcePins,
      sourcePinCounts: this.sourcePinCounts,
      plannerWaypoints: this.plannerWaypoints,
      plannerMode: this.plannerMode,
      plan: this.plan,
      planning: this.planning,
      planError: this.planError,
      style: this.style,
      colorMode: this.colorMode,
      resolvedColorMode: this.resolvedColorMode(),
      selectedPlaceId: this.selectedPlaceId,
      hasMap: this.engine !== null,
      mapboxAvailable: this.mapboxAvailable,
      mapStyleConnections: this.mapStyleConnections,
      clickMode: this.clickMode,
      panelTab: this.panelTab,
      searchQuery: this.searchQuery,
      searchResults: this.searchResults,
      searchBusy: this.searchBusy,
      searchError: this.searchError,
      searchActiveIndex: this.searchActiveIndex,
      selectedResult: this.selectedResult,
      directionsOpen: this.directionsOpen,
      plannerStops: this.plannerStops,
      savedRouteId: this.savedRouteId,
      units: this.units,
      liveLocation: this.liveLocation,
      locationStatus: this.locationStatus,
      camera: this.savedView
    }
  }

  settings(): MapSettings {
    const settings = resolveSettings(this.api.settings.get())
    const account = parseAccountProviderChoice(effectiveBasemapProvider(settings))
    if (this.mapProvidersLoaded && account && !this.mapStyleConnections.some((connection) => connection.id === account.connectionId)) {
      return { ...settings, basemapProvider: 'free' }
    }
    return settings
  }

  private async refreshMapProviders(): Promise<void> {
    const result = await mapServices(this.api).listConnections('map.style')
    if (this.disposed) return
    const settings = resolveSettings(this.api.settings.get())
    this.mapStyleConnections = (result.ok ? result.data?.connections ?? [] : []).filter((connection) =>
      connection.secretState === 'ok' &&
      (connection.provider !== 'mapbox' || settings.mapboxEnabled) &&
      (connection.provider !== 'openrouteservice' || settings.openRouteServiceEnabled)
    )
    this.mapboxAvailable = this.mapStyleConnections.some((connection) => connection.provider === 'mapbox')
    this.mapProvidersLoaded = true
    const previousStyle = this.style
    const preferredStyle = mapLayer(settings.defaultStyle)
    if (preferredStyle !== this.preferredStyle) this.style = preferredStyle
    this.preferredStyle = preferredStyle
    this.style = mapLayer(this.style, this.settings())
    if (this.style !== previousStyle) this.scheduleViewWrite()
    this.engine?.setStyle?.(this.style, this.resolvedColorMode(), this.settings())
    this.emit()
  }

  private refreshRequestProviders(): void {
    if (this.disposed) return
    const settings = this.settings()
    const next = [effectiveSearchProvider(settings), effectiveRoutingProvider(settings), effectiveElevationProvider(settings)]
    const previous = this.requestProviders
    this.requestProviders = next
    if (next[0] !== previous[0]) {
      this.enqueueGeocoding()
      this.setSearchQuery(this.searchQuery)
    }
    if (next[1] !== previous[1] || next[2] !== previous[2]) this.scheduleCompute()
  }

  /** Geocode biased toward where the map is pointed, so ambiguous names resolve nearby. */
  lookupPlaces(query: string, signal?: AbortSignal, settings = this.settings()): Promise<GeoResult[]> {
    const near: LngLat | undefined = this.savedView ? [this.savedView.lng, this.savedView.lat] : undefined
    return this.requests.run(signal, request => searchPlaces(query, settings, request, near))
  }

  lookupAddress(lng: number, lat: number, signal?: AbortSignal): Promise<string | null> {
    const settings = this.settings()
    return this.requests.run(signal, request => reverseGeocode(lng, lat, settings, request))
  }

  // ---- loading --------------------------------------------------------------

  private records(name: string): RecordStore {
    if (name === ROUTES_DATASET) return routeStore(this.api)
    if (name === PIN_SOURCES_DATASET) return pinSourceStore(this.api)
    if (name === VIEW_SETTING || name === SESSION_SETTING) return settingStore(this.api, name)
    return rowStore(this.api, name)
  }

  private persistSetting(key: string, record: DataRecord): Promise<boolean> {
    const value = JSON.stringify(record)
    const snapshot = JSON.parse(value) as DataRecord
    const previous = this.settingsWrites.get(key)
    if (previous?.value === value) return previous.result
    if (!previous && this.savedSettings.get(key) === value) return Promise.resolve(true)
    const write = (): Promise<boolean> => this.records(key).replace([snapshot])
    const result = (previous ? previous.result.catch(() => undefined).then(write) : write()).then((saved) => {
      if (saved) this.savedSettings.set(key, value)
      return saved
    }).finally(() => {
      if (this.settingsWrites.get(key)?.result === result) this.settingsWrites.delete(key)
    })
    this.settingsWrites.set(key, { value, result })
    return result
  }

  async load(): Promise<void> {
    if (this.disposed) return
    this.loading = true
    this.emit()
    try {
      await this.readAll()
    } finally {
      // Views gate their map on `loading`, so it must clear even when a read
      // rejects — otherwise one bad file means the map never mounts at all.
      this.loading = false
      if (!this.disposed && this.pendingLinkState) {
        const state = this.pendingLinkState
        this.pendingLinkState = null
        this.applyReadyLinkState(state)
      }
      if (!this.disposed) this.emit()
    }
  }

  private async readAll(): Promise<void> {
    const [places, routes, sources, cache, view, session] = await Promise.all([
      this.records(PLACES_DATASET).read() as Promise<unknown> as Promise<Place[]>,
      this.records(ROUTES_DATASET).read() as Promise<unknown> as Promise<Route[]>,
      this.records(PIN_SOURCES_DATASET).read(),
      this.records(GEOCACHE_DATASET).read(),
      this.records(VIEW_SETTING).read(),
      this.records(SESSION_SETTING).read()
    ])
    if (this.disposed) return
    this.adoptSavedView(view[0] as Record<string, unknown> | undefined)
    // Opened right here so a camera event landing later in this tick is honoured.
    this.viewLoaded = true
    this.places = places.filter((p) => p && typeof p.id === 'string' && Number.isFinite(p.lng))
    this.routes = routes.filter((r) => r && typeof r.id === 'string' && Array.isArray(r.waypoints))
    this.pinSources = sources.map((r) => sanitizePinSource(r as Record<string, unknown>))
    this.sourcesLoaded = true
    this.geocache = new Map(
      cache.flatMap((r) => {
        if (typeof r.id !== 'string') return []
        if (r.unresolved === true) return []
        if (!Number.isFinite(r.lng) || !Number.isFinite(r.lat)) return []
        return [[String(r.id), { lng: Number(r.lng), lat: Number(r.lat) }] as const]
      })
    )
    // After `places`, so a `selectedPlaceId` naming a deleted place can be dropped.
    this.adoptSavedSession(session[0] as Record<string, unknown> | undefined)
    this.sessionLoaded = true
    this.pushPlaces()
    this.refreshDerived()
    this.enqueueGeocoding()
    this.applySavedView()
    this.emit()
  }

  // ---- remembered camera + style -------------------------------------------

  /** Adopt the persisted `{lng, lat, zoom, bearing, pitch, style}` record written
   *  by `rememberView`. Records predating the rotation axes narrow them to 0. */
  private adoptSavedView(record: Record<string, unknown> | undefined): void {
    if (!record) return
    const lng = Number(record.lng)
    const lat = Number(record.lat)
    const zoom = Number(record.zoom)
    const bearing = Number(record.bearing)
    const pitch = Number(record.pitch)
    if (Number.isFinite(lng) && Number.isFinite(lat) && Number.isFinite(zoom)) {
      this.savedView = {
        lng,
        lat,
        zoom,
        bearing: Number.isFinite(bearing) ? bearing : 0,
        pitch: Number.isFinite(pitch) ? Math.min(Math.max(pitch, 0), MAX_PITCH) : 0
      }
    }
    const style = record.style
    if (typeof style === 'string') this.style = mapLayer(style, this.settings())
    this.colorMode = mapColorMode(record.colorMode) ?? mapColorMode(style) ?? this.colorMode
  }

  /**
   * Put a freshly attached map back exactly where the user left it — never over
   * a queued focus (a search/place jump wins). Deliberately does NOT latch
   * `viewApplied`: that flag means "the user has moved the camera themselves"
   * and is set by `rememberView` alone. Latching here would reproduce the
   * StrictMode trap the `attachMap` comment documents — engine A latches, queues
   * a `pendingCamera` and dies, and surviving engine B gets refused the restore.
   */
  private applySavedView(): void {
    if (this.viewApplied || this.pendingFocus || !this.engine || !this.savedView) return
    const { lng, lat, zoom, bearing, pitch } = this.savedView
    this.engine.jumpTo([lng, lat], zoom, bearing, pitch)
  }

  /**
   * The remembered camera, for a view that is about to build its map. Handing
   * this to `MapEngine`'s constructor is what keeps the first frame correct —
   * restoring with a post-construction `jumpTo` paints the default centre for a
   * frame first, which reads as the map snapping across the world on every open.
   */
  savedCamera(): { center: LngLat; zoom: number; bearing: number; pitch: number } | null {
    if (!this.savedView) return null
    const { lng, lat, zoom, bearing, pitch } = this.savedView
    return { center: [lng, lat], zoom, bearing, pitch }
  }

  /** The camera moved — remember where, debounced (a pan fires this per frame).
   *  Gated on {@link viewLoaded} with a complete no-op: a `move` arriving before
   *  the saved record was read would otherwise replace it with the default
   *  centre, and `applySavedView` would then restore to nowhere. */
  rememberView(center: LngLat, zoom: number, bearing = 0, pitch = 0): void {
    if (!this.viewLoaded || this.disposed) return
    this.savedView = { lng: center[0], lat: center[1], zoom, bearing, pitch }
    this.viewApplied = true
    this.scheduleViewWrite()
  }

  private viewRecord(): DataRecord | null {
    if (!this.viewLoaded) return null
    return { id: 'view', ...this.savedView, style: this.style, colorMode: this.colorMode }
  }

  private scheduleViewWrite(): void {
    if (!this.viewLoaded || this.disposed) return
    if (this.viewTimer !== null) window.clearTimeout(this.viewTimer)
    this.viewTimer = window.setTimeout(() => {
      this.viewTimer = null
      this.flushView()
    }, 600)
  }

  /** Write a debounce-pending camera now (teardown / page unload ordering). */
  flushView(): void {
    if (this.viewTimer !== null) {
      window.clearTimeout(this.viewTimer)
      this.viewTimer = null
    }
    if (this.disposed) return
    const record = this.viewRecord()
    if (record) {
      this.viewWrite = this.persistSetting(VIEW_SETTING, record)
      void this.viewWrite.catch(() => {})
    }
    // The one point where a settled camera reaches the snapshot — see the
    // `camera` field's note on why this is not `rememberView`.
    this.emit()
  }

  // ---- remembered sidebar session ------------------------------------------

  /**
   * Adopt the persisted sidebar session. Every field is narrowed against the
   * live state; anything that fails falls back to the fresh-store default rather
   * than throwing the whole record out.
   *
   * Three rules this must not break:
   *  1. Hits are restored verbatim — never through `setSearchQuery`, which would
   *     schedule a geocode for a query whose answer we already have.
   *  2. The directions form renders inside the place card, so `directionsOpen`
   *     is only honoured when a card survived narrowing.
   *  3. The restored camera outranks the restored route — hence `suppressPlanFit`
   *     and the direct field assignment instead of `setStops`.
   */
  private adoptSavedSession(record: Record<string, unknown> | undefined): void {
    if (!record) return
    const hit = (value: unknown): GeoResult | null => {
      const r = value as { name?: unknown; lng?: unknown; lat?: unknown; context?: unknown } | null
      if (!r || typeof r.name !== 'string' || !r.name) return null
      const lng = Number(r.lng)
      const lat = Number(r.lat)
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
      return { name: r.name, lng, lat, context: typeof r.context === 'string' ? r.context : undefined }
    }
    // A stop is a `Waypoint`, not a `GeoResult` — it carries `label`, never
    // `name`, so it gets its own narrowing (routing through `hit` rejected
    // every persisted stop and silently dropped the restored form).
    const stop = (value: unknown): Waypoint | null => {
      const w = value as {
        label?: unknown
        lng?: unknown
        lat?: unknown
        placeId?: unknown
        fromLiveLocation?: unknown
      } | null
      if (!w || typeof w.label !== 'string' || !w.label) return null
      const lng = Number(w.lng)
      const lat = Number(w.lat)
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
      return {
        lng,
        lat,
        label: w.label,
        ...(typeof w.placeId === 'string' ? { placeId: w.placeId } : {}),
        ...(w.fromLiveLocation === true ? { fromLiveLocation: true as const } : {})
      }
    }

    if (isPanelTab(record.panelTab)) this.panelTab = record.panelTab as PanelTab
    if (TRAVEL_MODES.includes(record.plannerMode as TravelMode)) this.plannerMode = record.plannerMode as TravelMode
    if (typeof record.selectedPlaceId === 'string' && this.places.some((p) => p.id === record.selectedPlaceId)) {
      this.selectedPlaceId = record.selectedPlaceId
    }
    if (typeof record.searchQuery === 'string') this.searchQuery = record.searchQuery.slice(0, 200)
    if (Array.isArray(record.searchResults)) {
      this.searchResults = record.searchResults
        .slice(0, 12)
        .map(hit)
        .filter((r): r is GeoResult => r !== null)
    }
    this.selectedResult = hit(record.selectedResult)
    if (typeof record.savedRouteId === 'string' && this.routes.some((route) => route.id === record.savedRouteId)) this.savedRouteId = record.savedRouteId
    // Re-pin the card's marker directly — `showAddress` would call `focus` and
    // fly the camera away from the view we are about to restore.
    if (this.selectedResult) {
      this.searchMarker = [this.selectedResult.lng, this.selectedResult.lat]
      this.engine?.setSearchMarker(this.searchMarker)
    }

    const stops = Array.isArray(record.stops) ? record.stops.map(stop) : []
    if (this.selectedResult && record.directionsOpen === true && stops.some((s) => s !== null)) {
      this.directionsOpen = true
      this.plannerStops = paddedStops(stops)
      this.plannerWaypoints = filledStops(this.plannerStops)
      if (this.plannerWaypoints.length >= 2) {
        this.suppressPlanFit = true
        this.engine?.setWaypoints(this.plannerWaypoints)
        this.scheduleCompute()
      }
    }
  }

  /** Mirror the sidebar session so a reload reopens on the same card and form.
   *  Debounced and gated on {@link sessionLoaded} — never persist before the
   *  saved session has been restored, or hydration races the empty default. */
  private markSession(): void {
    if (!this.sessionLoaded || this.disposed) return
    if (this.sessionTimer !== null) window.clearTimeout(this.sessionTimer)
    this.sessionTimer = window.setTimeout(() => {
      this.sessionTimer = null
      this.flushSession()
    }, 400)
  }

  /** Write a debounce-pending session now (teardown / page unload ordering). */
  flushSession(): void {
    if (this.sessionTimer !== null) {
      window.clearTimeout(this.sessionTimer)
      this.sessionTimer = null
    }
    if (!this.sessionLoaded || this.disposed) return
    this.sessionWrite = this.persistSetting(SESSION_SETTING,
      {
        id: 'session',
        panelTab: this.panelTab,
        selectedPlaceId: this.selectedPlaceId,
        searchQuery: this.searchQuery,
        searchResults: this.searchResults.slice(0, 12),
        selectedResult: this.selectedResult,
        directionsOpen: this.directionsOpen,
        // `plannerWaypoints` is derived (`filledStops`) — persisting both invites drift.
        stops: this.plannerStops,
        plannerMode: this.plannerMode,
        savedRouteId: this.savedRouteId
      } as unknown as DataRecord
    )
    void this.sessionWrite.catch(() => {})
  }

  async flushSessionAsync(): Promise<void> {
    this.flushSession()
    if (!await this.sessionWrite) throw new Error(uiText('surface.invalid'))
  }

  buildLinkState(): MapLinkState {
    return {
      v: 1,
      camera: this.savedView ? { ...this.savedView } : null,
      style: this.style,
      colorMode: this.colorMode,
      searchQuery: this.searchQuery,
      selectedPlaceId: this.selectedPlaceId,
      selectedResult: this.selectedResult ? JSON.parse(JSON.stringify(this.selectedResult)) : null
    }
  }

  buildSurfaceState(): Record<string, unknown> {
    return { ...this.buildLinkState(), panelTab: this.panelTab, plannerMode: this.plannerMode, savedRouteId: this.savedRouteId, selectedSourceId: this.selectedSourceId, clickMode: this.clickMode, directionsOpen: this.directionsOpen }
  }

  async restoreSurfaceState(raw: Record<string, unknown>, background = false): Promise<void> {
    await this.ready
    const state = { ...this.buildLinkState(), selectedPlaceId: null, selectedResult: null, ...raw }
    if (state.v !== 1 || (state.selectedPlaceId && !this.places.some((place) => place.id === state.selectedPlaceId))) throw new Error(uiText('surface.unavailable'))
    const route = typeof raw.savedRouteId === 'string' ? this.routes.find((entry) => entry.id === raw.savedRouteId) : null
    const source = typeof raw.selectedSourceId === 'string' ? this.pinSources.find((entry) => entry.id === raw.selectedSourceId) : null
    if ((raw.savedRouteId && !route) || (raw.selectedSourceId && !source)) throw new Error(uiText('surface.unavailable'))
    if ((raw.panelTab !== undefined && !isPanelTab(raw.panelTab)) || (raw.plannerMode !== undefined && !TRAVEL_MODES.includes(raw.plannerMode as TravelMode)) || (raw.clickMode !== undefined && raw.clickMode !== 'place' && raw.clickMode !== 'route')) throw new Error(uiText('surface.invalid'))
    if (!this.applyReadyLinkState(state, false)) throw new Error(uiText('surface.invalid'))
    if (raw.panelTab !== undefined) this.panelTab = raw.panelTab as PanelTab
    if (raw.plannerMode !== undefined) this.plannerMode = raw.plannerMode as TravelMode
    if (raw.clickMode !== undefined) this.clickMode = raw.clickMode as ClickMode
    if (typeof raw.directionsOpen === 'boolean') this.directionsOpen = raw.directionsOpen
    this.selectedSourceId = source?.id ?? null
    this.savedRouteId = route?.id ?? null
    if (route) {
      this.cancelPlanRequest()
      this.planning = false
      this.planError = null
      this.plannerMode = route.mode
      this.plannerWaypoints = route.waypoints
      this.plannerStops = [...route.waypoints]
      this.engine?.setWaypoints(route.waypoints)
      this.plan = route.geometry?.length ? { geometry: route.geometry, distanceM: route.distanceM ?? 0, durationS: route.durationS ?? 0 } : null
      this.engine?.setRoute(this.plan?.geometry ?? null)
      if (!this.plan && !background) { this.suppressPlanFit = true; void this.computePlan() }
    }
    this.emit()
    this.flushView()
    this.markSession()
  }

  applyLinkState(state: Record<string, unknown>): boolean {
    if (state.v !== 1) return false
    if (this.loading) {
      this.pendingLinkState = state
      return true
    }
    return this.applyReadyLinkState(state)
  }

  private applyReadyLinkState(state: Record<string, unknown>, publish = true): boolean {
    const cameraRecord = state.camera
    let camera: MapLinkState['camera'] = null
    if (cameraRecord !== null) {
      if (!cameraRecord || typeof cameraRecord !== 'object' || Array.isArray(cameraRecord)) return false
      const raw = cameraRecord as Record<string, unknown>
      const lng = Number(raw.lng)
      const lat = Number(raw.lat)
      const zoom = Number(raw.zoom)
      const bearing = Number(raw.bearing)
      const pitch = Number(raw.pitch)
      if (!isValidLngLat(lng, lat) || !Number.isFinite(zoom) || zoom < 0 || zoom > 22 ||
        !Number.isFinite(bearing) || !Number.isFinite(pitch) || pitch < 0 || pitch > MAX_PITCH) return false
      camera = { lng, lat, zoom, bearing, pitch }
    }
    if (typeof state.style !== 'string' ||
      (mapLayer(state.style) !== state.style && !mapColorMode(state.style) && !parseAccountProviderChoice(state.style))) return false
    if (state.colorMode !== undefined && !mapColorMode(state.colorMode)) return false
    if (typeof state.searchQuery !== 'string' || state.searchQuery.length > 200) return false
    if (state.selectedPlaceId !== null && typeof state.selectedPlaceId !== 'string') return false
    const selected = state.selectedResult
    let selectedResult: GeoResult | null = null
    if (selected !== null) {
      if (!selected || typeof selected !== 'object' || Array.isArray(selected)) return false
      const raw = selected as Record<string, unknown>
      const lng = Number(raw.lng)
      const lat = Number(raw.lat)
      if (typeof raw.name !== 'string' || !raw.name || raw.name.length > 300 || !isValidLngLat(lng, lat)) return false
      selectedResult = {
        name: raw.name,
        lng,
        lat,
        ...(typeof raw.context === 'string' ? { context: raw.context.slice(0, 500) } : {})
      }
    }

    this.cancelSearchRequest()
    this.searchBusy = false
    this.style = mapLayer(state.style, this.settings())
    this.colorMode = mapColorMode(state.colorMode) ?? mapColorMode(state.style) ?? this.colorMode
    this.searchQuery = state.searchQuery
    this.searchResults = []
    this.searchActiveIndex = -1
    this.searchError = null
    this.selectedPlaceId = typeof state.selectedPlaceId === 'string' && this.places.some((place) => place.id === state.selectedPlaceId)
      ? state.selectedPlaceId
      : null
    this.selectedResult = selectedResult
    this.searchMarker = selectedResult ? [selectedResult.lng, selectedResult.lat] : null
    this.engine?.setSearchMarker(this.searchMarker)
    if (camera) {
      this.savedView = camera
      this.viewApplied = true
      this.engine?.jumpTo([camera.lng, camera.lat], camera.zoom, camera.bearing, camera.pitch)
    }
    this.engine?.setStyle?.(this.style, this.resolvedColorMode(), this.settings())
    if (publish) {
      this.emit()
      this.flushView()
      this.flushSession()
    }
    return true
  }

  /** Re-read the pin-source config (after a save from settings or the panel). */
  private async reloadSources(): Promise<void> {
    if (this.disposed) return
    const records = await this.records(PIN_SOURCES_DATASET).read()
    if (this.disposed) return
    this.pinSources = records.map((r) => sanitizePinSource(r as Record<string, unknown>))
    this.sourcesLoaded = true
    this.refreshDerived()
    this.enqueueGeocoding()
    this.emit()
  }

  private onCoreState(): void {
    if (this.disposed) return
    const state = this.api.getState()
    if (state.vault?.path !== this.root) { void this.dispose().catch(() => {}); return }
    this.syncLiveLocation(state)
    const units = normalizeUnits(state.units, METRIC_UNITS)
    if (!sameUnits(units, this.units)) {
      this.units = units
      setFormatUnits(units)
      this.engine?.setUnits(units)
      this.emit()
    }
  }

  // ---- live location --------------------------------------------------------

  /**
   * Adopt the host's position.
   *
   * The plugin does not call `navigator.geolocation` — that API never answers in
   * an Electron renderer (no platform backend, no API key for the network
   * fallback), which is why the position comes from the main-process
   * CoreLocation helper instead. All this does is mirror what the host reports.
   */
  private syncLiveLocation(state: ValleyReadonlyState): void {
    const status = mapLocationStatus(state.liveLocationState)
    const fix = state.allowLiveLocation ? state.liveLocation : null
    const next: LiveLocation | null = fix
      ? { lng: fix.lng, lat: fix.lat, accuracy: Math.max(0, fix.accuracy), ts: fix.ts }
      : null
    if (status === this.locationStatus && sameFix(next, this.liveLocation)) return
    this.locationStatus = status
    this.liveLocation = next
    this.engine?.setLiveLocation(next)
    if (next && this.pendingRecenter) {
      this.pendingRecenter = false
      this.focusLiveLocation()
    }
    // The first fix fills an origin nobody has typed into yet — the form is
    // usually opened before the CoreLocation helper has answered.
    this.seedOriginFromLocation()
    this.emit()
  }

  /** The live position as a stop. English label: it is a stored record field
   *  (see {@link Waypoint.fromLiveLocation}), and the row translates it. */
  private liveLocationStop(): Waypoint | null {
    const fix = this.liveLocation
    if (!fix) return null
    return { lng: fix.lng, lat: fix.lat, label: uiText('map.place.yourLocation'), fromLiveLocation: true }
  }

  /**
   * Default the start of a route to where the user actually is.
   *
   * Fires once per form: the fix stream updates continuously, so re-seeding on
   * every update would put the origin back seconds after the user cleared it.
   * Opening a fresh form (or clearing the planner) re-arms it.
   */
  private seedOriginFromLocation(): void {
    if (this.originSeeded) return
    const stop = this.liveLocationStop()
    if (!stop) return
    if (paddedStops(this.plannerStops)[0] !== null) return
    this.originSeeded = true
    this.setStop(0, stop)
  }

  /** Bring the camera to the current fix, keeping the user's zoom when it is
   *  already closer in than street level. */
  private focusLiveLocation(): void {
    const fix = this.liveLocation
    if (!fix) return
    this.focus([fix.lng, fix.lat], Math.max(this.engine?.getZoom() ?? 0, 15))
  }

  /**
   * The "locate me" button. With a fix in hand it recentres immediately;
   * without one it arms {@link pendingRecenter} so the first fix to arrive does
   * it — the helper can take a few seconds to produce its first reading.
   */
  locateMe(): void {
    if (this.locationStatus === 'off' || this.locationStatus === 'denied') return
    if (this.liveLocation) {
      this.focusLiveLocation()
      return
    }
    this.pendingRecenter = true
    this.emit()
  }

  // ---- note-pin sources -----------------------------------------------------

  /** Rebuild source pins + generic coordinate pins from the index + geocode cache
   *  and push both to the engine. Does not geocode (see `enqueueGeocoding`). */
  private refreshDerived(): void {
    const entries = this.indexEntries
    this.matchSig = matchSignature(entries, this.pinSources)
    // Built once including the hidden sources, so the panel can state what a
    // source holds while the map draws only what is switched on. Closing an eye
    // must not read as the source having lost its notes.
    const all = this.pinSources.flatMap((s) => buildSourcePins(entries, s, this.geocache, { ignoreVisibility: true }))
    const counts: Record<string, number> = {}
    for (const pin of all) counts[pin.sourceId] = (counts[pin.sourceId] ?? 0) + 1
    this.sourcePinCounts = counts
    const shown = new Set(this.pinSources.filter((s) => s.visible).map((s) => s.id))
    this.sourcePins = all.filter((p) => shown.has(p.sourceId)).map(pin => ({ ...pin, iconSvg: mapIconSvg(pin.icon, this.api) }))
    // A note claimed by a source shows as its styled marker — drop it from the
    // generic purple-dot layer so it isn't pinned twice.
    const claimed = new Set(this.sourcePins.map((p) => p.relPath))
    this.pins = parseGeoPins(entries).filter((p) => !claimed.has(p.relPath))
    this.engine?.setSourcePins(this.sourcePins)
    this.engine?.setPins(this.pins)
  }

  private enqueueGeocoding(): void {
    if (this.sourcesLoaded && !this.disposed) this.geocoding.update(this.indexEntries, this.pinSources, this.settings())
  }

  /** Fit the map to a source's pins (opening the map tab if needed), making the
   *  source visible first so clicking its title in the sidebar always reveals it. */
  focusSource(id: string): void {
    const source = this.pinSources.find((s) => s.id === id)
    if (!source) return
    this.selectedSourceId = id
    this.emit()
    if (!source.visible) this.setSourceVisible(id, true)
    const coords = this.sourcePins.filter((p) => p.sourceId === id).map((p) => [p.lng, p.lat] as LngLat)
    if (coords.length === 0) {
      if (!this.engine) this.api.workspace.openMainTab()
      return
    }
    if (this.engine) this.engine.fitTo(coords)
    else {
      this.pendingFocus = { center: coords[0] }
      this.api.workspace.openMainTab()
    }
  }

  toggleSourceVisible(id: string): void {
    const source = this.pinSources.find((s) => s.id === id)
    this.setSourceVisible(id, !(source?.visible ?? true))
  }

  private setSourceVisible(id: string, visible: boolean): void {
    this.savePinSources(this.pinSources.map((s) => (s.id === id ? { ...s, visible } : s)))
  }

  /**
   * The one write path for pin sources — the settings pane and the sidebar eye
   * both come through here, so neither can hold a copy that drifts from what the
   * map draws. Refused before the first successful read: see `sourcesLoaded`.
   */
  savePinSources(next: PinSource[]): boolean {
    if (!this.sourcesLoaded) return false
    const previous = this.pinSources
    this.pinSources = next
    this.refreshDerived()
    this.enqueueGeocoding()
    this.emit()
    this.pinSourcesWrite = this.records(PIN_SOURCES_DATASET).replace(this.pinSources as unknown as DataRecord[]).then((ok) => {
      if (!ok) throw new Error(uiText('surface.invalid'))
      return true
    }).catch((error) => {
      if (this.pinSources === next) { this.pinSources = previous; this.refreshDerived(); this.emit() }
      throw error
    })
    void this.pinSourcesWrite.catch(() => {})
    return true
  }

  async flushPinSources(): Promise<void> { if (!await this.pinSourcesWrite) throw new Error(uiText('surface.invalid')) }

  // ---- map engine attach ----------------------------------------------------

  attachMap(engine: MapEngine): void {
    this.engine = engine
    engine.setPlaces(this.places)
    engine.setPins(this.pins)
    engine.setSourcePins(this.sourcePins)
    engine.setWaypoints(this.plannerWaypoints)
    if (this.plan) engine.setRoute(this.plan.geometry)
    engine.setSearchMarker(this.searchMarker)
    engine.setUnits(this.units)
    engine.setLiveLocation(this.liveLocation)
    // Keep `pendingFocus` set until a *ready* engine applies it (`onMapReady`): React
    // StrictMode mounts the map view twice, destroying the first engine before its style
    // loads — nulling here would let that doomed engine swallow the focus and leave the
    // surviving one parked at the default center.
    if (this.pendingFocus) engine.flyTo(this.pendingFocus.center, this.pendingFocus.zoom)
    // A route planned from the sidebar before the map opened must be on screen when
    // it does — the saved view would park the camera somewhere else entirely. The
    // exception is a route restored from disk: there the saved view IS the answer.
    else if (!this.suppressPlanFit && this.plan && this.plan.geometry.length > 1) {
      engine.fitTo(this.plan.geometry)
    }
    else this.applySavedView()
    this.emit()
  }

  detachMap(engine: MapEngine): void {
    if (this.engine === engine) {
      this.engine = null
      this.emit()
    }
  }

  private pushPlaces(): void {
    this.engine?.setPlaces(this.places)
  }

  // ---- focus / navigation ---------------------------------------------------

  /** Bring the map to a coordinate, opening the map tab first if it isn't open. */
  focus(center: LngLat, zoom?: number): void {
    if (this.engine) {
      this.engine.flyTo(center, zoom)
    } else {
      this.pendingFocus = { center, zoom }
      this.api.workspace.openMainTab()
    }
  }

  /** A mounted map view finished loading and has applied the queued focus — drop it so
   *  reopening the map later doesn't snap back to the last searched address. */
  onMapReady(): void {
    this.pendingFocus = null
  }

  /** Pin an address on the map and bring it into view, opening the map tab if needed. */
  showAddress(center: LngLat, zoom = 16): void {
    this.searchMarker = center
    this.engine?.setSearchMarker(center)
    this.focus(center, zoom)
  }

  selectPlace(id: string | null): void {
    this.selectedPlaceId = id
    this.selectedSourceId = null
    this.emit()
    this.markSession()
  }

  focusPlace(place: Place): void {
    this.selectedPlaceId = place.id
    this.focus([place.lng, place.lat], 15)
    this.emit()
    this.markSession()
  }

  openNote(ref: string): void {
    if (this.disposed) return
    if (this.index.getSnapshot().status !== 'ready') { void this.ready.then(() => this.openNote(ref)).catch(() => {}); return }
    const wanted = ref.replace(/^\[\[|\]\]$/g, '').trim().toLowerCase()
    const entry = this.indexEntries.find(entry => [entry.relPath, entry.title, entry.relPath.split('/').at(-1)!, ...(entry.aliases ?? [])]
      .some(value => value.toLowerCase() === wanted || value.replace(/\.[^./]+$/, '').toLowerCase() === wanted))
    const path = entry?.relPath ?? ref
    if (path) this.api.workspace.openFile(path)
  }

  // ---- layer toggles --------------------------------------------------------

  setStyle(style: MapStyleId): void {
    const settings = this.settings()
    this.style = mapLayer(style, settings)
    this.colorMode = mapColorMode(style) ?? this.colorMode
    this.engine?.setStyle(this.style, this.resolvedColorMode(), settings)
    this.scheduleViewWrite()
    this.emit()
  }

  setColorMode(mode: MapColorMode): void {
    this.colorMode = mode
    this.engine?.setStyle(this.style, this.resolvedColorMode(), this.settings())
    this.scheduleViewWrite()
    this.emit()
  }

  /** A map view reports the appearance Valley gives its document, so System
   *  follows Valley — including a footer override — rather than the device. */
  setHostAppearance(mode: ThemeMode | null): void {
    if (mode === this.hostAppearance) return
    this.hostAppearance = mode
    this.onSystemColorMode()
  }

  /** System follows Valley's own appearance; only Valley's System defers to the device. */
  resolvedColorMode(): ThemeMode {
    if (this.colorMode !== 'system') return this.colorMode
    if (this.hostAppearance) return this.hostAppearance
    const appearance = this.api.settings.core.get('appearanceTheme')
    if (appearance === 'light' || appearance === 'dark') return appearance
    return this.systemColorScheme?.matches ? 'dark' : 'light'
  }

  private onSystemColorMode = (): void => {
    const next = this.resolvedColorMode()
    if (next === this.snapshot.resolvedColorMode) return
    this.engine?.setStyle?.(this.style, next, this.settings())
    this.emit()
  }

  // ---- view state (shared by the page overlay and the sidebar panel) --------

  /** What the next map click does. Read by the page when a click arrives, so it
   *  can be set from the sidebar before any map view is mounted. */
  setClickMode(mode: ClickMode): void {
    this.clickMode = mode
    this.emit()
  }

  setPanelTab(tab: PanelTab): void {
    this.panelTab = tab
    this.emit()
    this.markSession()
  }

  // ---- shared geocoder search ----------------------------------------------
  // One query for the map capsule and the sidebar tab: a search started on the
  // map is still there (with its result) when the sidebar is opened, and it
  // survives every view unmount because it lives here, not in the input.

  setSearchQuery(query: string): void {
    if (this.disposed) return
    this.cancelSearchRequest()
    this.searchQuery = query
    this.searchActiveIndex = -1
    this.emit()
    this.markSession()
    if (!query.trim()) {
      this.searchResults = []
      this.searchBusy = false
      this.searchError = null
      this.emit()
      return
    }
    this.searchTimer = window.setTimeout(() => {
      this.searchTimer = null
      void this.runSearch()
    }, 350)
  }

  /** Run the current query now (Enter) — later replies for an older query are dropped. */
  async runSearch(): Promise<void> {
    if (this.disposed) return
    const query = this.searchQuery.trim()
    if (!query) return
    this.cancelSearchRequest()
    const mine = this.searchToken
    const controller = new AbortController()
    this.searchRequest = controller
    this.searchBusy = true
    this.searchError = null
    this.emit()
    try {
      const hits = await this.lookupPlaces(query, controller.signal)
      if (mine !== this.searchToken) return
      this.searchResults = hits
      this.searchError = null
    } catch (err) {
      if (mine !== this.searchToken) return
      this.searchResults = []
      // A rate-limit is not a broken search, and the difference matters: it
      // clears on its own, and a Mapbox token avoids the shared endpoint that
      // imposes it. A flat "Search failed" sent the user looking for a fault.
      this.searchError =
        err instanceof GeocodeError && err.status === 429
          ? uiText('auto.41155237208d')
          : uiText('auto.e2e904ac10fc')
    } finally {
      if (this.searchRequest === controller) this.searchRequest = null
      if (mine === this.searchToken) {
        this.searchBusy = false
        this.searchActiveIndex = -1
        this.emit()
        this.markSession()
      }
    }
  }

  /** Move the keyboard cursor over the hit list, wrapping through −1 ("no hit
   *  active") so ↑ from the top and ↓ off the bottom both return to the input. */
  moveSearchActive(delta: 1 | -1): void {
    const n = this.searchResults.length
    if (n === 0) return
    const next = this.searchActiveIndex + delta
    this.searchActiveIndex = next < -1 ? n - 1 : next >= n ? -1 : next
    this.emit()
  }

  /** The hit ↑/↓ landed on, if any — what Enter picks instead of re-running the query. */
  activeSearchResult(): GeoResult | null {
    return this.searchResults[this.searchActiveIndex] ?? null
  }

  /** Keep the picked result on screen (sidebar card) and pin it on the map. */
  pickSearchResult(result: GeoResult): void {
    this.cancelSearchRequest()
    this.searchBusy = false
    this.selectedResult = result
    this.searchQuery = result.name
    this.searchResults = []
    this.searchActiveIndex = -1
    this.showAddress([result.lng, result.lat], 16)
    this.emit()
    this.markSession()
  }

  clearSearch(): void {
    this.cancelSearchRequest()
    this.searchQuery = ''
    this.searchResults = []
    this.searchBusy = false
    this.searchError = null
    this.searchActiveIndex = -1
    this.selectedResult = null
    this.directionsOpen = false
    this.searchMarker = null
    this.engine?.setSearchMarker(null)
    this.emit()
    this.markSession()
  }

  private cancelSearchRequest(): void {
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer)
    this.searchTimer = null
    this.searchToken++
    this.searchRequest?.abort()
    this.searchRequest = null
  }

  // ---- directions (the sidebar's stop list) ---------------------------------
  // One array of stops — A, B and any number of vias — with empty slots the user
  // fills by typing. The planner and the map read the filled subset, so the two
  // surfaces can never disagree about the route.

  /** Open the form on the picked result — it becomes the destination (B). */
  openDirections(): void {
    if (!this.selectedResult) return
    this.directionsOpen = true
    const destination: Waypoint = {
      lng: this.selectedResult.lng,
      lat: this.selectedResult.lat,
      label: this.selectedResult.name
    }
    // Start from where the user is, which is what they wanted nine times out of
    // ten; an empty slot above the destination when there is no fix yet, so the
    // first thing typed lands in A and the second in B.
    this.originSeeded = false
    this.setStops([this.liveLocationStop(), destination])
    if (this.liveLocation) this.originSeeded = true
    this.markSession()
  }

  /**
   * Fill (or clear) one stop. Indices are against the padded list the card
   * renders, not the raw field: a fresh store (right sidebar, nothing planned)
   * holds `[]` but shows two empty rows, and typing into either must land.
   */
  setStop(index: number, waypoint: Waypoint | null): void {
    const base = paddedStops(this.plannerStops)
    if (index < 0 || index >= base.length) return
    const next = [...base]
    next[index] = waypoint
    this.setStops(next)
  }

  /** Fill the first empty stop, appending one when the list is full. */
  fillNextStop(waypoint: Waypoint): void {
    const index = this.plannerStops.indexOf(null)
    if (index === -1) this.setStops([...this.plannerStops, waypoint])
    else this.setStop(index, waypoint)
  }

  /**
   * Insert an empty via *before the destination* — what every maps app's "add
   * stop" does. Appending instead (which this used to do) demoted the
   * destination to a via and made the new empty slot the destination, so the
   * route the user had already set silently changed meaning.
   */
  addStop(): void {
    const base = paddedStops(this.plannerStops)
    this.setStops([...base.slice(0, -1), null, base[base.length - 1]])
  }

  removeStop(index: number): void {
    const base = paddedStops(this.plannerStops)
    if (index < 0 || index >= base.length) return
    const next = base.filter((_, i) => i !== index)
    // Keep a two-slot skeleton so the form never collapses to nothing.
    this.setStops(next.length >= 2 ? next : [...next, ...Array(2 - next.length).fill(null)])
  }

  /** Drag-and-drop / ⌥↑↓ reorder of the stop list. Empty slots move like any
   *  other row — reordering must never silently drop the via the user is about
   *  to fill (which is exactly what the old waypoint-level reorder did). */
  reorderStops(from: number, to: number): void {
    const base = paddedStops(this.plannerStops)
    if (from === to || from < 0 || from >= base.length) return
    const next = [...base]
    const [moved] = next.splice(from, 1)
    next.splice(Math.max(0, Math.min(to, next.length)), 0, moved ?? null)
    this.setStops(next)
  }

  /** Reverse the whole list — the classic ⇅ between start and destination. */
  swapDirections(): void {
    this.setStops([...paddedStops(this.plannerStops)].reverse())
  }

  closeDirections(): void {
    this.directionsOpen = false
    this.clearPlanner()
    this.emit()
    this.markSession()
  }

  /** Replace the stop list and re-plan from its filled subset. */
  setStops(stops: (Waypoint | null)[]): void {
    this.plannerStops = stops
    this.setWaypoints(filledStops(stops))
    this.markSession()
  }

  // ---- places ---------------------------------------------------------------

  async addPlace(input: { name: string; lng: number; lat: number; note?: string; color?: string }): Promise<Place> {
    const place: Place = {
      id: genId('place'),
      name: input.name.trim() || 'Untitled place',
      lng: input.lng,
      lat: input.lat,
      note: input.note?.trim() || undefined,
      color: input.color,
      createdAt: new Date().toISOString()
    }
    if (!await this.rawAddPlace(place)) throw new Error(uiText('surface.invalid'))
    this.api.undo.push({
      label: uiText('map.undo.addPlace', { name: place.name }),
      undo: async () => ({ ok: await this.rawDeletePlace(place.id) }),
      redo: async () => ({ ok: await this.rawAddPlace(place) })
    })
    return place
  }

  async updatePlace(id: string, patch: Partial<Place>): Promise<void> {
    const place = this.places.find((p) => p.id === id)
    if (!place) throw new Error(uiText('surface.unavailable'))
    const updated = { ...place, ...patch, id }
    if (!await this.rawUpdatePlace(updated)) throw new Error(uiText('surface.invalid'))
    this.api.undo.push({
      label: uiText('map.undo.editPlace', { name: updated.name }),
      undo: async () => ({ ok: await this.rawUpdatePlace(place) }),
      redo: async () => ({ ok: await this.rawUpdatePlace(updated) })
    })
  }

  private async rawUpdatePlace(place: Place): Promise<boolean> {
    const saved = await this.records(PLACES_DATASET).update('id', place.id, place as unknown as DataRecord)
    if (!saved) return false
    this.places = this.places.map((p) => (p.id === place.id ? place : p))
    this.pushPlaces()
    this.emit()
    return true
  }

  async deletePlace(id: string): Promise<void> {
    const place = this.places.find((p) => p.id === id)
    if (!place) return
    await this.rawDeletePlace(id)
    this.api.undo.push({
      label: uiText('map.undo.deletePlace', { name: place.name }),
      undo: async () => ({ ok: await this.rawAddPlace(place) }),
      redo: async () => ({ ok: await this.rawDeletePlace(id) })
    })
  }

  private async rawAddPlace(place: Place): Promise<boolean> {
    if (!await this.records(PLACES_DATASET).append(place as unknown as DataRecord)) return false
    this.places = [...this.places.filter((p) => p.id !== place.id), place]
    this.pushPlaces()
    this.emit()
    return true
  }

  private async rawDeletePlace(id: string): Promise<boolean> {
    if (!await this.records(PLACES_DATASET).delete('id', id)) return false
    this.places = this.places.filter((p) => p.id !== id)
    if (this.selectedPlaceId === id) {
      this.selectedPlaceId = null
      // Persist the clearing too, or a reload restores a highlight on a dead place.
      this.markSession()
    }
    this.pushPlaces()
    this.emit()
    return true
  }

  /** Add a place without registering a core ⌘Z action — for the command bus,
   *  which owns its own revert. Returns the created place. */
  async createPlaceRaw(input: { name: string; lng: number; lat: number; note?: string }): Promise<Place> {
    const place: Place = {
      id: genId('place'),
      name: input.name.trim() || 'Untitled place',
      lng: input.lng,
      lat: input.lat,
      note: input.note?.trim() || undefined,
      createdAt: new Date().toISOString()
    }
    if (!await this.rawAddPlace(place)) throw new Error(uiText('surface.invalid'))
    return place
  }

  removePlaceRaw(id: string): Promise<boolean> {
    return this.rawDeletePlace(id)
  }

  /** Re-add a previously captured place (no core ⌘Z) — for a bus delete's revert. */
  restorePlaceRaw(place: Place): Promise<boolean> {
    return this.rawAddPlace(place)
  }

  /** Patch a place without registering a core ⌘Z action — for the command bus. */
  async updatePlaceRaw(id: string, patch: Partial<Place>): Promise<void> {
    const place = this.places.find((p) => p.id === id)
    if (!place) throw new Error(uiText('surface.unavailable'))
    if (!await this.rawUpdatePlace({ ...place, ...patch, id })) throw new Error(uiText('surface.invalid'))
  }

  // ---- planner --------------------------------------------------------------

  setPlannerMode(mode: TravelMode): void {
    this.suppressPlanFit = false
    this.plannerMode = mode
    this.savedRouteId = null
    this.emit()
    this.markSession()
    this.scheduleCompute()
  }

  setWaypoints(waypoints: Waypoint[]): void {
    this.suppressPlanFit = false
    this.plannerWaypoints = waypoints
    // Adopt the stop list whenever a caller (right-sidebar planner, CLI, import)
    // sets waypoints directly — `setStops` already matches, so it is a no-op there.
    if (!sameWaypoints(filledStops(this.plannerStops), waypoints)) {
      this.plannerStops = paddedStops([...waypoints])
    }
    this.savedRouteId = null
    this.engine?.setWaypoints(waypoints)
    this.emit()
    this.markSession()
    this.scheduleCompute()
  }

  addWaypoint(waypoint: Waypoint): void {
    // A map click in route mode fills the first empty stop before appending.
    this.fillNextStop(waypoint)
  }

  // There is deliberately no waypoint-level remove/reorder: `plannerWaypoints`
  // is the *filled subset*, so editing it and back-filling the stop list dropped
  // whatever empty via slot the form was holding. Every UI edit goes through the
  // stop mutators above; `setWaypoints` stays for import/CLI/session restore.

  clearPlanner(): void {
    this.cancelPlanRequest()
    this.suppressPlanFit = false
    this.plannerWaypoints = []
    this.plannerStops = []
    this.originSeeded = false
    this.savedRouteId = null
    this.planning = false
    this.plan = null
    this.planError = null
    this.engine?.setWaypoints([])
    this.engine?.setRoute(null)
    this.emit()
    this.markSession()
  }

  private scheduleCompute(): void {
    this.cancelPlanRequest()
    if (this.disposed) return
    if (this.plannerWaypoints.length < 2) {
      this.planning = false
      this.plan = null
      this.planError = null
      this.engine?.setRoute(null)
      this.emit()
      return
    }
    // Pending from the edit, not from the request. The card hides its summary
    // while this is set, and the debounce is long enough that flipping it in
    // `computePlan` left the *previous* mode's time and distance sitting there
    // for a third of a second after every switch.
    this.planning = true
    this.planTimer = window.setTimeout(() => {
      this.planTimer = null
      void this.computePlan()
    }, 350)
    this.emit()
  }

  /** Set waypoints + mode and compute immediately (no debounce) — for commands. */
  async planWaypoints(waypoints: Waypoint[], mode: TravelMode): Promise<RoutePlan | null> {
    this.suppressPlanFit = false
    this.plannerMode = mode
    this.plannerWaypoints = waypoints
    this.plannerStops = [...waypoints]
    this.savedRouteId = null
    this.engine?.setWaypoints(waypoints)
    if (this.planTimer !== null) window.clearTimeout(this.planTimer)
    this.emit()
    await this.computePlan()
    return this.plan
  }

  async computePlan(): Promise<void> {
    this.cancelPlanRequest()
    if (this.disposed) return
    if (this.plannerWaypoints.length < 2) {
      // Never leave the pending flag set on a path that computes nothing — the
      // card would hide its summary for good.
      if (this.planning) {
        this.planning = false
        this.emit()
      }
      return
    }
    const token = this.planToken
    const controller = new AbortController()
    this.planRequest = controller
    const waypoints = this.plannerWaypoints.map(waypoint => ({ ...waypoint }))
    const mode = this.plannerMode
    this.planning = true
    this.planError = null
    this.emit()
    try {
      await this.requests.run(controller.signal, async request => {
        const settings = this.settings()
        const raw = await planRoute(waypoints, mode, settings, request)
        if (this.disposed || token !== this.planToken) return
        // Draw first: the elevation service is a free third party, and the line must
        // never wait on it.
        const snapped = raw.snapped?.length === this.plannerWaypoints.length ? raw.snapped : undefined
        this.plan = {
          geometry: raw.geometry,
          distanceM: raw.distanceM,
          durationS: raw.durationS,
          steps: raw.steps,
          snapped,
          modeApproximated: raw.modeApproximated
        }
        this.engine?.setRoute(raw.geometry)
        // Re-place the markers: they went down on the typed coordinate when the
        // stop was filled, before the router had told us where it would snap.
        if (snapped) this.engine?.setWaypoints(this.plannerWaypoints, snapped)
        // A route re-planned from a restored session must not steal the camera the
        // same reload just put back — one plan's worth of suppression, then normal.
        if (this.suppressPlanFit) this.suppressPlanFit = false
        else this.engine?.fitTo(raw.geometry)
        this.planning = false
        this.emit()

        const elevation = await computeElevationProfile(raw.geometry, settings, raw.elevations, request)
        if (this.disposed || token !== this.planToken || !this.plan) return
        this.plan = {
          ...this.plan,
          profile: elevation?.profile,
          ascentM: elevation?.ascentM,
          descentM: elevation?.descentM
        }
      })
    } catch (err) {
      if (token === this.planToken) {
        this.plan = null
        this.planError = err instanceof Error ? err.message : 'Could not compute route'
      }
    } finally {
      if (this.planRequest === controller) this.planRequest = null
      if (token === this.planToken) {
        this.planning = false
        this.emit()
      }
    }
  }

  private cancelPlanRequest(): void {
    if (this.planTimer !== null) window.clearTimeout(this.planTimer)
    this.planTimer = null
    this.planToken++
    this.planRequest?.abort()
    this.planRequest = null
  }

  // ---- routes (favorites) ---------------------------------------------------

  /** "Zürich → Sion". The card has no name field, so a saved route still has to
   *  read as itself in the list. Record data, never translated. */
  private endpointName(): string {
    const w = this.plannerWaypoints
    if (w.length < 2) return 'Untitled route'
    return `${w[0].label} → ${w[w.length - 1].label}`
  }

  async saveRoute(name: string): Promise<Route | null> {
    if (this.plannerWaypoints.length < 2) return null
    const route: Route = {
      id: genId('route'),
      name: name.trim() || this.endpointName(),
      mode: this.plannerMode,
      waypoints: this.plannerWaypoints,
      geometry: this.plan?.geometry,
      distanceM: this.plan?.distanceM,
      durationS: this.plan?.durationS,
      createdAt: new Date().toISOString()
    }
    this.routes = [...this.routes, route]
    // Remember which saved route the open plan is, so the star can un-save it.
    this.savedRouteId = route.id
    this.emit()
    await this.records(ROUTES_DATASET).append(route as unknown as DataRecord)
    this.api.undo.push({
      label: uiText('auto.88ac9df62113', { p0: route.name }),
      undo: async () => ({ ok: await this.rawDeleteRoute(route.id) }),
      redo: async () => ({ ok: await this.rawAddRoute(route) })
    })
    return route
  }

  /** Un-save the route the current plan came from, keeping the plan on screen. */
  async unsaveRoute(): Promise<void> {
    const id = this.savedRouteId
    if (!id) return
    this.savedRouteId = null
    await this.deleteRoute(id)
  }

  /** Save the current planner/plan as a named route without a core ⌘Z action — for the
   *  command bus, which owns its own revert. Returns null if there's nothing to save. */
  async saveRouteRaw(name: string): Promise<Route | null> {
    if (this.plannerWaypoints.length < 2) return null
    const route: Route = {
      id: genId('route'),
      name: name.trim() || 'Untitled route',
      mode: this.plannerMode,
      waypoints: this.plannerWaypoints,
      geometry: this.plan?.geometry,
      distanceM: this.plan?.distanceM,
      durationS: this.plan?.durationS,
      createdAt: new Date().toISOString()
    }
    if (!await this.rawAddRoute(route)) throw new Error(uiText('surface.invalid'))
    return route
  }

  /** Remove a route by id (no core ⌘Z) — for a bus delete and its revert pairing. */
  removeRouteRaw(id: string): Promise<boolean> {
    return this.rawDeleteRoute(id)
  }

  /** Re-add a previously captured route (no core ⌘Z) — for a bus delete's revert. */
  restoreRouteRaw(route: Route): Promise<boolean> {
    return this.rawAddRoute(route)
  }

  /** Load a saved route into the planner and draw it. */
  showRoute(route: Route): void {
    this.cancelPlanRequest()
    this.planning = false
    this.planError = null
    this.suppressPlanFit = false
    this.plannerMode = route.mode
    this.plannerWaypoints = route.waypoints
    this.plannerStops = [...route.waypoints]
    this.savedRouteId = route.id
    this.engine?.setWaypoints(route.waypoints)
    if (route.geometry && route.geometry.length > 1) {
      this.plan = {
        geometry: route.geometry,
        distanceM: route.distanceM ?? 0,
        durationS: route.durationS ?? 0
      }
      this.engine?.setRoute(route.geometry)
      this.focusGeometry(route.geometry)
      this.emit()
    } else {
      this.emit()
      void this.computePlan()
    }
  }

  /** Frame the whole plan — what the card's Start button does. With no engine
   *  attached this opens the map tab and frames it there, so Start works from
   *  the sidebar with no map on screen. */
  fitPlan(): void {
    if (this.plan && this.plan.geometry.length > 1) this.focusGeometry(this.plan.geometry)
  }

  private focusGeometry(geometry: LngLat[]): void {
    if (this.engine) this.engine.fitTo(geometry)
    else {
      this.pendingFocus = { center: geometry[0] }
      this.api.workspace.openMainTab()
    }
  }

  async deleteRoute(id: string): Promise<void> {
    const route = this.routes.find((r) => r.id === id)
    if (!route) return
    await this.rawDeleteRoute(id)
    this.api.undo.push({
      label: uiText('auto.6d0872d5ac1a', { p0: route.name }),
      undo: async () => ({ ok: await this.rawAddRoute(route) }),
      redo: async () => ({ ok: await this.rawDeleteRoute(id) })
    })
  }

  async importRoute(name: string, waypoints: Waypoint[], geometry?: LngLat[], mode: TravelMode = 'driving'): Promise<Route> {
    const route: Route = {
      id: genId('route'),
      name: name.trim() || 'Imported route',
      mode,
      waypoints,
      geometry,
      createdAt: new Date().toISOString()
    }
    if (!await this.rawAddRoute(route)) throw new Error(uiText('surface.invalid'))
    return route
  }

  private async rawAddRoute(route: Route): Promise<boolean> {
    if (!await this.records(ROUTES_DATASET).append(route as unknown as DataRecord)) return false
    this.routes = [...this.routes.filter((r) => r.id !== route.id), route]
    // An undone un-save restores the star on the open plan.
    if (sameWaypoints(route.waypoints, this.plannerWaypoints) && route.mode === this.plannerMode) {
      this.savedRouteId = route.id
    }
    this.emit()
    return true
  }

  private async rawDeleteRoute(id: string): Promise<boolean> {
    if (!await this.records(ROUTES_DATASET).delete('id', id)) return false
    this.routes = this.routes.filter((r) => r.id !== id)
    if (this.savedRouteId === id) this.savedRouteId = null
    this.emit()
    return true
  }

  async updateRouteRaw(id: string, patch: Partial<Route>): Promise<void> {
    const current = this.routes.find((route) => route.id === id)
    if (!current) throw new Error(uiText('surface.unavailable'))
    const next = { ...current, ...patch, id }
    const ok = await this.records(ROUTES_DATASET).update('id', id, next as unknown as DataRecord)
    if (!ok) throw new Error(uiText('surface.invalid'))
    this.routes = this.routes.map((route) => route.id === id ? next : route)
    if (this.savedRouteId === id) await this.restoreSurfaceState({ ...this.buildSurfaceState(), savedRouteId: id }, true)
    this.emit()
  }

  renameRoute(id: string, name: string): Promise<void> {
    const route = this.routes.find((r) => r.id === id)
    if (!route) return Promise.resolve()
    const updated = { ...route, name: name.trim() || route.name }
    this.routes = this.routes.map((r) => (r.id === id ? updated : r))
    this.emit()
    return this.records(ROUTES_DATASET).update('id', id, updated as unknown as DataRecord).then(() => undefined)
  }

  // ---- teardown -------------------------------------------------------------

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal
    this.cancelPlanRequest()
    this.cancelSearchRequest()
    const geocoding = this.geocoding.dispose()
    const requests = this.requests.dispose()
    this.pendingLinkState = null
    // Land the last camera + sidebar before the store goes away (a reload
    // mid-debounce would otherwise reopen on the previous view). Both flushes
    // bail on `disposed`, so the flag is set *after* them — one write path.
    this.flushView()
    this.flushSession()
    this.disposed = true
    this.offIndex?.()
    this.rejectIndexReady?.(new Error('The map index session is no longer active.'))
    this.rejectIndexReady = undefined
    this.offBeforeUnload?.()
    this.systemColorScheme?.removeEventListener('change', this.onSystemColorMode)
    this.offAppearance?.()
    this.offUnload?.()
    this.offSettings?.()
    this.offIcons?.()
    this.offState?.()
    this.offSourcesChanged?.()
    this.listeners.clear()
    this.engine = null
    this.disposal = Promise.allSettled([this.index.dispose(), geocoding, requests, this.hydration, this.viewWrite, this.sessionWrite, this.pinSourcesWrite, this.renderOwner.dispose()]).then(results => {
      const failed = results.find((result, index) => index !== 3 && result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    })
    void this.disposal.catch(() => {})
    return this.disposal
  }
}

const STORE_KEY = 'map.store'

interface MapRuntime {
  current: MapStore | null
}

const holders = new WeakMap<MapStore, MapRuntime>()

function runtime(api: ValleyPluginApi): MapRuntime {
  return api.runtime.getOrCreate(STORE_KEY, () => ({ current: null }))
}

export function createStore(api: ValleyPluginApi): MapStore {
  initRuntime(api)
  const holder = runtime(api)
  void holder.current?.dispose()
  const store = new MapStore(api)
  holder.current = store
  holders.set(store, holder)
  return store
}

export function getStore(source: ValleyPluginApi = runtimeApi): MapStore | null {
  return runtime(source).current
}

export function disposeStore(store: MapStore): Promise<void> {
  const holder = holders.get(store)
  if (holder?.current === store) {
    holder.current = null
  }
  holders.delete(store)
  return store.dispose()
}
