import { WORKSPACE_DETAILS_V1, type ValleyPluginApi, type WorkspaceDetailsContext, type WorkspaceDetailItem, type WorkspaceDetailsSnapshot } from '@valley/plugin-sdk'
import type { MapSnapshot, MapStore } from './store'
import { formatDistance, formatDuration, formatLatLng, formatLength } from './format'
import { mapServiceFacts } from './metadata'
import { uiText } from './localization'

type Camera = NonNullable<MapSnapshot['camera']>
type Position = { lng: number; lat: number; name?: string; context?: string; elevation?: number }
type Source = { camera: Camera | null; file: boolean; position?: Position }
type Runtime = { sources: Map<string, Source>; emit(): void }
const runtimes = new WeakMap<ValleyPluginApi, Runtime>()
const keyFor = (context: Pick<WorkspaceDetailsContext, 'instanceId' | 'filePath'>) => JSON.stringify([context.instanceId ?? '__single', context.filePath])

export function publishMapDetails(api: ValleyPluginApi, context: Pick<WorkspaceDetailsContext, 'instanceId' | 'filePath'>, camera: Camera | null, position?: Position): () => void {
  const runtime = runtimes.get(api)
  if (!runtime) return () => {}
  const key = keyFor(context)
  const source = { camera, file: !!context.filePath, position }
  runtime.sources.set(key, source)
  runtime.emit()
  return () => { if (runtime.sources.get(key) === source) { runtime.sources.delete(key); runtime.emit() } }
}

export function registerMapDetails(api: ValleyPluginApi, store: MapStore): () => void {
  const listeners = new Set<() => void>()
  const runtime: Runtime = { sources: new Map(), emit: () => listeners.forEach(listener => listener()) }
  runtimes.set(api, runtime)
  const addresses = new Map<string, string | null>()
  const pending = new Map<string, { point: string; timer?: ReturnType<typeof setTimeout>; controller: AbortController }>()
  let disposed = false
  const cancel = (key: string): void => { const request = pending.get(key); if (request) { clearTimeout(request.timer); request.controller.abort(); pending.delete(key) } }
  const labels: [string, string][] = [['coordinates', 'Coordinates'], ['address', 'Address'], ['zoom', 'Zoom'], ['place', 'Place'], ['provider', 'Provider'], ['style', 'Style'], ['distance', 'Route distance'], ['duration', 'Route time'], ['bearing', 'Bearing'], ['pitch', 'Pitch'], ['elevation', 'Elevation'], ['accuracy', 'Location accuracy']]
  const items: WorkspaceDetailItem[] = labels.map(([id, label]) => ({ id, label, labelKey: `details.${id}`, kind: 'text' }))
  const snapshot = (context: WorkspaceDetailsContext): WorkspaceDetailsSnapshot => {
    if (disposed || !context) return { items: {} }
    const key = keyFor(context)
    const source = runtime.sources.get(key)
    if (!source) { cancel(key); return { items: {} } }
    const state = store.getSnapshot()
    const selected: Position | null | undefined = source.position ?? (source.file ? null : state.selectedResult ?? state.places.find(place => place.id === state.selectedPlaceId))
    // The map page's header names the camera centre, so its coordinates and
    // address describe that same point; a file view's selected feature is the
    // subject of its own details.
    const located = source.file ? source.position : undefined
    const position = located ?? source.camera
    const point = position ? `${position.lng.toFixed(5)},${position.lat.toFixed(5)}` : ''
    const cachedAddress = located?.context ? [located.name, located.context].filter(Boolean).join(', ') : addresses.get(point)
    if ((!context.selectedItemIds.includes('address') || !api.workspace.details.getSelection().includes('address')) || !position || cachedAddress !== undefined) cancel(key)
    else if (pending.get(key)?.point !== point) {
      cancel(key)
      const request = { point, controller: new AbortController(), timer: undefined as ReturnType<typeof setTimeout> | undefined }
      pending.set(key, request)
      request.timer = setTimeout(() => {
        request.timer = undefined
        void store.lookupAddress(position.lng, position.lat, request.controller.signal).then(address => {
          if (disposed || request.controller.signal.aborted || pending.get(key) !== request) return
          if (addresses.size >= 128) addresses.delete(addresses.keys().next().value!)
          addresses.set(point, address)
          pending.delete(key)
          runtime.emit()
        }).catch(() => { if (pending.get(key) === request) pending.delete(key) })
      }, 450)
    }
    const values: WorkspaceDetailsSnapshot['items'] = {}
    const add = (id: string, value: string | number | undefined | null): void => { if (value !== undefined && value !== null && value !== '') values[id] = { text: String(value) } }
    if (position) add('coordinates', formatLatLng(position.lat, position.lng))
    add('address', cachedAddress)
    add('place', selected?.name)
    if (located?.elevation !== undefined) add('elevation', formatLength(located.elevation, state.units))
    add('zoom', source.camera?.zoom.toFixed(1))
    add('bearing', source.camera ? `${source.camera.bearing.toFixed(0)}°` : null)
    add('pitch', source.camera ? `${source.camera.pitch.toFixed(0)}°` : null)
    add('provider', mapServiceFacts(store.settings(), state.style).find(fact => fact.id === 'map.provider')?.value)
    add('style', uiText(`style.${state.style}`))
    if (!source.file && state.plan) {
      add('distance', formatDistance(state.plan.distanceM, state.units))
      add('duration', formatDuration(state.plan.durationS))
    }
    if (position && state.liveLocation && Math.abs(position.lat - state.liveLocation.lat) < 0.00001 && Math.abs(position.lng - state.liveLocation.lng) < 0.00001) add('accuracy', formatLength(state.liveLocation.accuracy, state.units))
    return { items: values }
  }
  const offProvider = api.interop.extensions.provide(WORKSPACE_DETAILS_V1, {
    id: 'map.details', label: 'Map', labelKey: 'manifest.name', pluginViews: true,
    fileExtensions: ['.geojson', '.gpx', '.kml'], items,
    defaultItems: ['coordinates', 'address', 'zoom'], getSnapshot: snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); if (!listeners.size) for (const key of pending.keys()) cancel(key) } }
  })
  const offStore = store.subscribe(runtime.emit)
  const offSelection = api.workspace.details.subscribe(() => {
    if (!api.workspace.details.getSelection().includes('address')) for (const key of pending.keys()) cancel(key)
    runtime.emit()
  })
  return () => { disposed = true; offSelection(); offStore(); offProvider(); for (const key of pending.keys()) cancel(key); listeners.clear(); runtime.sources.clear(); if (runtimes.get(api) === runtime) runtimes.delete(api) }
}
