import { METADATA_PANEL_SEGMENT_V1, provideBookmarkSurface, type PluginInspectionSubject, type PluginProperty, type ValleyPluginApi } from '@valley/plugin-sdk'
import type { WorkspaceViewStateValue } from '@valley/plugin-sdk/types'
import { React, api } from './runtime'
import { getStore } from './store'
import { useMap } from './hooks'
import { MapProviderField, MapColorModeField, MapLayerField, MetadataSegment } from './MetadataSegment'
import { ProviderPanel } from './ProviderPanel'
import { FileInfo, mapFileBookmark, restoreMapFileBookmark, subscribeMapFileBookmarks } from './FileView'
import { mapPanelSegment, mapServiceFacts } from './metadata'
import { Copy, Settings } from './icons'
import { formatLatLng } from './format'
import { isValidLngLat } from './geo'
import { sanitizePinSource } from './pinSources'
import type { PinSource, Place, Route, Waypoint } from './types'
import { MODES } from './modes'
import { uiText } from './localization'
import { effectiveBasemapProvider, effectiveElevationProvider, effectiveRoutingProvider, effectiveSearchProvider } from './settings'
import type { InteropValueSchema } from '@valley/plugin-sdk'

const bookmarkStateSchema: InteropValueSchema = {
  "type": "union",
  "anyOf": [
    {
      "type": "object",
      "properties": {
        "v": {
          "type": "literal",
          "value": 1
        },
        "camera": {
          "type": "union",
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "object",
              "properties": {
                "lng": {
                  "type": "number"
                },
                "lat": {
                  "type": "number"
                },
                "zoom": {
                  "type": "number"
                },
                "bearing": {
                  "type": "number"
                },
                "pitch": {
                  "type": "number"
                }
              },
              "required": [
                "lng",
                "lat",
                "zoom",
                "bearing",
                "pitch"
              ],
              "additionalProperties": false
            }
          ]
        },
        "style": {
          "type": "string"
        },
        "colorMode": {
          "type": "union",
          "anyOf": [
            {
              "type": "literal",
              "value": "system"
            },
            {
              "type": "literal",
              "value": "light"
            },
            {
              "type": "literal",
              "value": "dark"
            }
          ]
        },
        "searchQuery": {
          "type": "string"
        },
        "selectedPlaceId": {
          "type": "union",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "selectedResult": {
          "type": "union",
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "object",
              "properties": {
                "name": {
                  "type": "string"
                },
                "lng": {
                  "type": "number"
                },
                "lat": {
                  "type": "number"
                },
                "context": {
                  "type": "string"
                }
              },
              "required": [
                "name",
                "lng",
                "lat"
              ],
              "additionalProperties": true
            }
          ]
        },
        "panelTab": {
          "type": "string"
        },
        "plannerMode": {
          "type": "string"
        },
        "savedRouteId": {
          "type": "union",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "selectedSourceId": {
          "type": "union",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "clickMode": {
          "type": "union",
          "anyOf": [
            {
              "type": "literal",
              "value": "place"
            },
            {
              "type": "literal",
              "value": "route"
            }
          ]
        },
        "directionsOpen": {
          "type": "boolean"
        }
      },
      "required": [
        "v",
        "camera",
        "style",
        "colorMode",
        "searchQuery",
        "selectedPlaceId",
        "selectedResult",
        "panelTab",
        "plannerMode",
        "savedRouteId",
        "selectedSourceId",
        "clickMode",
        "directionsOpen"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "v": {
          "type": "literal",
          "value": 1
        },
        "path": {
          "type": "string"
        },
        "camera": {
          "type": "union",
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "object",
              "properties": {
                "lng": {
                  "type": "number"
                },
                "lat": {
                  "type": "number"
                },
                "zoom": {
                  "type": "number"
                },
                "bearing": {
                  "type": "number"
                },
                "pitch": {
                  "type": "number"
                }
              },
              "required": [
                "lng",
                "lat",
                "zoom",
                "bearing",
                "pitch"
              ],
              "additionalProperties": false
            }
          ]
        },
        "style": {
          "type": "union",
          "anyOf": [
            {
              "type": "literal",
              "value": "streets"
            },
            {
              "type": "literal",
              "value": "satellite"
            },
            {
              "type": "literal",
              "value": "navigation"
            },
            {
              "type": "literal",
              "value": "outdoors"
            }
          ]
        },
        "colorMode": {
          "type": "union",
          "anyOf": [
            {
              "type": "literal",
              "value": "light"
            },
            {
              "type": "literal",
              "value": "dark"
            }
          ]
        }
      },
      "required": [
        "v",
        "path",
        "camera",
        "style",
        "colorMode"
      ],
      "additionalProperties": false
    }
  ]
}



const sourceFields = ['title', 'matchKey', 'matchValue', 'folder', 'locationMode', 'locationField', 'labelMode', 'labelField', 'hoverFields', 'color', 'borderColor', 'icon', 'visible', 'hidden']
const placeFields = ['name', 'lng', 'lat', 'category', 'color', 'note']
const routeFields = ['name', 'mode', 'waypoints', 'note']
interface EditInput { subject: PluginInspectionSubject; values: Record<string, unknown> }
function current(subject?: PluginInspectionSubject): Record<string, unknown> { return subject?.item?.state ?? subject?.view ?? getStore()?.buildSurfaceState() ?? {} }
function selectedRecord(subject?: PluginInspectionSubject): { kind: 'place' | 'route' | 'source' | 'view'; record: Record<string, unknown>; fields: string[] } {
  const raw = current(subject)
  const snap = getStore()!.getSnapshot()
  const place = typeof raw.selectedPlaceId === 'string' ? snap.places.find((entry) => entry.id === raw.selectedPlaceId) : null
  const route = typeof raw.savedRouteId === 'string' ? snap.routes.find((entry) => entry.id === raw.savedRouteId) : null
  const source = typeof raw.selectedSourceId === 'string' ? snap.pinSources.find((entry) => entry.id === raw.selectedSourceId) : null
  if ((raw.selectedPlaceId && !place) || (raw.savedRouteId && !route) || (raw.selectedSourceId && !source)) throw new Error(uiText('surface.unavailable'))
  if (place) return { kind: 'place', record: place as unknown as Record<string, unknown>, fields: placeFields }
  if (route) return { kind: 'route', record: route as unknown as Record<string, unknown>, fields: routeFields }
  if (source) return { kind: 'source', record: source as unknown as Record<string, unknown>, fields: sourceFields }
  return { kind: 'view', record: getStore()!.buildSurfaceState(), fields: ['camera', 'colorMode', 'style', 'panelTab', 'plannerMode', 'clickMode'] }
}

export function mapPropertyFields(subject?: PluginInspectionSubject): PluginProperty[] {
  const selected = selectedRecord(subject)
  const fields: PluginProperty[] = selected.fields.map((id) => {
    const value = selected.record[id] ?? ''
    return { id, label: uiText(`surface.${id}`), value: value as WorkspaceViewStateValue, readOnly: true, type: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : typeof value === 'object' ? 'json' : 'text' }
  })
  const store = getStore()!
  return [...fields, ...mapServiceFacts(store.settings(), store.getSnapshot().style).map((fact) => ({
    id: fact.id, label: uiText(fact.labelKey), value: fact.value, readOnly: true, type: 'text' as const
  }))]
}

function providerFields(routing: boolean): PluginProperty[] {
  const settings = getStore()!.settings()
  return routing ? [
    { id: 'routingProvider', label: uiText('auto.d411677e5e97'), value: effectiveRoutingProvider(settings), readOnly: true, type: 'text' },
    { id: 'elevationProvider', label: uiText('auto.91fed541a689'), value: effectiveElevationProvider(settings), readOnly: true, type: 'text' }
  ] : [
    { id: 'basemapProvider', label: uiText('surface.provider'), value: effectiveBasemapProvider(settings), readOnly: true, type: 'text' },
    { id: 'searchProvider', label: uiText('auto.a9855411ca93'), value: effectiveSearchProvider(settings), readOnly: true, type: 'text' }
  ]
}

export function validateMapWaypoints(value: unknown): Waypoint[] {
  if (!Array.isArray(value) || value.length > 100 || value.some((entry) => !entry || typeof entry !== 'object' || typeof entry.label !== 'string' || !isValidLngLat(entry.lng, entry.lat))) throw new Error(uiText('surface.invalid'))
  return value.map((entry) => ({ label: entry.label, lng: entry.lng, lat: entry.lat, ...(typeof entry.placeId === 'string' ? { placeId: entry.placeId } : {}) }))
}

async function editProperties({ subject, values }: EditInput) {
  const store = getStore()!
  await store.ready
  const { kind, record, fields } = selectedRecord(subject)
  if (Object.keys(values).some((key) => !fields.includes(key))) throw new Error(uiText('surface.invalid'))
  const prior = structuredClone(record)
  const next = { ...record, ...values }
  for (const [key, value] of Object.entries(values)) {
    if (!['lng', 'lat', 'waypoints', 'camera', 'hoverFields', 'visible', 'hidden'].includes(key) && typeof value !== 'string') throw new Error(uiText('surface.invalid'))
  }
  if (kind === 'place') {
    if (typeof next.name !== 'string' || !next.name.trim() || typeof next.lng !== 'number' || typeof next.lat !== 'number' || !isValidLngLat(next.lng, next.lat)) throw new Error(uiText('surface.invalid'))
    await store.updatePlaceRaw(String(record.id), values as Partial<Place>)
  } else if (kind === 'route') {
    if (typeof next.name !== 'string' || !next.name.trim() || !['driving', 'walking', 'cycling'].includes(String(next.mode))) throw new Error(uiText('surface.invalid'))
    const waypoints = validateMapWaypoints(next.waypoints)
    if (waypoints.length < 2) throw new Error(uiText('surface.invalid'))
    await store.updateRouteRaw(String(record.id), { ...values, waypoints, ...(values.waypoints || values.mode ? { geometry: undefined, distanceM: undefined, durationS: undefined } : {}) } as Partial<Route>)
  } else if (kind === 'source') {
    if (!['address', 'coordinate'].includes(String(next.locationMode)) || !['filename', 'property'].includes(String(next.labelMode)) || typeof next.visible !== 'boolean' || typeof next.hidden !== 'boolean' || !Array.isArray(next.hoverFields) || next.hoverFields.some((field) => typeof field !== 'string')) throw new Error(uiText('surface.invalid'))
    const updated = sanitizePinSource(next)
    if (!store.savePinSources(store.getSnapshot().pinSources.map((entry) => entry.id === updated.id ? updated : entry))) throw new Error(uiText('surface.invalid'))
    await store.flushPinSources()
  } else await store.restoreSurfaceState({ ...store.buildSurfaceState(), ...current(subject), ...values }, true)
  return { value: { updated: Object.keys(values) }, revert: { label: uiText('surface.edit'), run: async () => {
    if (kind === 'place') await store.updatePlaceRaw(String(prior.id), prior as unknown as Place)
    else if (kind === 'route') await store.updateRouteRaw(String(prior.id), prior as unknown as Route)
    else if (kind === 'source') { store.savePinSources(store.getSnapshot().pinSources.map((entry) => entry.id === prior.id ? prior as unknown as PinSource : entry)); await store.flushPinSources() }
    else await store.restoreSurfaceState(prior, true)
  } } }
}

function propertyText({ id, value }: PluginProperty): string {
  if (value === '' || value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return api.ui.t(value ? 'common.yes' : 'common.no')
  if ((id === 'lng' || id === 'lat') && typeof value === 'number') return value.toFixed(5)
  if (id === 'mode') {
    const mode = MODES.find((entry) => entry.id === value)
    if (mode) return uiText(mode.labelKey)
  }
  if (id === 'locationMode') return uiText(value === 'coordinate' ? 'auto.8cde59838c57' : 'auto.d70f93df5e8f')
  if (id === 'labelMode') return uiText(value === 'property' ? 'auto.9ae33a7d0ecb' : 'auto.a3cbb98ddf5e')
  if (id === 'waypoints') return validateMapWaypoints(value).map((stop) => stop.label || formatLatLng(stop.lat, stop.lng)).join(' → ') || '—'
  if (Array.isArray(value)) return value.join(', ') || '—'
  return String(value)
}

const Properties = ({ subject }: { subject?: PluginInspectionSubject }): React.ReactElement | null => {
  const { store } = useMap()
  if (!store) return null
  let fields: PluginProperty[] | null
  try {
    fields = selectedRecord(subject).kind === 'view' ? null : mapPropertyFields(subject)
  } catch {
    return <p role="alert">{uiText('surface.unavailable')}</p>
  }
  return <div className="right-panel-body props-info">
    {fields ? <dl className="props-info-table"><MapProviderField /><MapColorModeField /><MapLayerField />{fields.filter(field => field.id !== 'map.provider').map((field) => <div className="props-info-row" key={field.id}>
      <dt className="props-info-key">{field.label}</dt>
      <dd className="props-info-value">{propertyText(field)}</dd>
    </div>)}</dl> : <MetadataSegment />}
  </div>
}

export function registerMapSurfaces(pluginApi: ValleyPluginApi): () => void {
  const store = getStore()!
  const surfaces = ['main_workspace', 'left_sidebar', 'right_sidebar'] as const
  const offs = surfaces.map((surface) => provideBookmarkSurface(pluginApi, {
    id: `map.${surface}`, surface, subscribe: listener => { const off = store.subscribe(listener); const offFiles = subscribeMapFileBookmarks(listener); return () => { off(); offFiles() } },
    getSnapshot: instanceId => {
      if (surface === 'main_workspace' && instanceId && /\.(gpx|kml|geojson)$/i.test(instanceId)) {
        const view = mapFileBookmark(instanceId)
        if (!view) throw new Error(uiText('surface.unavailable'))
        return { title: instanceId.split('/').pop()!, view: { ...view }, filePath: instanceId }
      }
      const state = store.buildSurfaceState()
      const snap = store.getSnapshot()
      const view = { ...state, selectedPlaceId: null, selectedResult: null, savedRouteId: null, selectedSourceId: null }
      const route = (surface === 'right_sidebar' || snap.panelTab === 'routes') ? snap.routes.find((entry) => entry.id === snap.savedRouteId) : null
      const source = snap.panelTab === 'pins' ? snap.pinSources.find((entry) => entry.id === state.selectedSourceId) : null
      const place = !route && !source ? snap.places.find((entry) => entry.id === snap.selectedPlaceId) : null
      const item = route ? { id: route.id, title: route.name, state: { ...view, savedRouteId: route.id } } : source ? { id: source.id, title: source.title, state: { ...view, selectedSourceId: source.id } } : place ? { id: place.id, title: place.name, state: { ...view, selectedPlaceId: place.id, selectedResult: state.selectedResult } } : snap.selectedResult ? { id: `${snap.selectedResult.lng},${snap.selectedResult.lat}`, title: snap.selectedResult.name, state: { ...view, selectedResult: state.selectedResult } } : undefined
      return { title: uiText('auto.ab478f3efc84'), view, ...(item ? { item } : {}), actions: [
        { label: uiText('map.copyCoordinates'), icon: <Copy />, enabled: Boolean(snap.camera), onSelect: () => navigator.clipboard.writeText(snap.camera ? formatLatLng(snap.camera.lat, snap.camera.lng) : '') },
        { label: uiText('auto.c7f73bb54d92'), icon: <Settings />, onSelect: () => pluginApi.workspace.openOwnSettings() }
      ] }
    },
    restore: async (raw, _instance, options) => {
      if (typeof raw.path === 'string') {
        if (!await pluginApi.vault.fileInfo(raw.path)) throw new Error(uiText('surface.unavailable'))
        restoreMapFileBookmark(raw)
        if (!options?.background) await pluginApi.workspace.openFile(raw.path)
      } else await store.restoreSurfaceState(raw, options?.background)
    }
  }, { stateSchema: bookmarkStateSchema, description: snapshot => typeof snapshot.view.path === 'string' ? snapshot.view.path : uiText('bookmark.view'), validate: state => { const camera = state.camera as { lng: number; lat: number; zoom: number; pitch: number } | null; return !camera || isValidLngLat(camera.lng, camera.lat) && camera.zoom >= 0 && camera.zoom <= 24 && camera.pitch >= 0 && camera.pitch <= 85 } }))
  offs.push(pluginApi.interop.extensions.provide(METADATA_PANEL_SEGMENT_V1, { ...mapPanelSegment(({ subject }) => <Properties subject={subject} />), pluginSurfaces: ['main_workspace'], inspect: async ({ subject }) => { await store.ready; return mapPropertyFields(subject) } }))
  offs.push(pluginApi.interop.extensions.provide(METADATA_PANEL_SEGMENT_V1, {
    id: 'map.providers', label: 'Mapbox', labelKey: 'auto.d983e02e49e4', icon: 'mapbox',
    pluginTabs: true, pluginSurfaces: ['main_workspace'], inspect: () => providerFields(false), render: () => <ProviderPanel />
  }))
  offs.push(pluginApi.interop.extensions.provide(METADATA_PANEL_SEGMENT_V1, {
    id: 'map.routing', label: 'OpenRouteService', labelKey: 'auto.0a6ca730cc23', icon: 'route',
    pluginTabs: true, pluginSurfaces: ['main_workspace'], inspect: () => providerFields(true), render: () => <ProviderPanel routing />
  }))
  offs.push(pluginApi.interop.extensions.provide(METADATA_PANEL_SEGMENT_V1, {
    id: 'map.fileInfo', label: 'Info', labelKey: 'inspector.info', icon: 'info', extensions: ['.gpx', '.kml', '.geojson'],
    inspect: ({ relPath }) => [{ id: 'path', label: pluginApi.ui.t('info.path'), value: relPath, readOnly: true }, { id: 'access', label: uiText('file.access'), value: uiText('file.readOnly'), readOnly: true }],
    render: ({ relPath }) => <FileInfo relPath={relPath} />
  }))
  offs.push(pluginApi.commands.register<EditInput, { updated: string[] }, 'write'>({
    id: 'properties-edit', label: 'Map: Edit properties', labelKey: 'surface.edit', paletteSafe: false, sideEffect: 'write',
    input: { schema: { type: 'object', required: ['subject', 'values'], properties: { subject: { type: 'object' }, values: { type: 'object' } }, additionalProperties: false }, parse: (raw) => {
      const input = raw as EditInput
      if (input?.subject?.pluginId !== 'map' || !surfaces.includes(input.subject.surface as typeof surfaces[number]) || !input.values || typeof input.values !== 'object' || Array.isArray(input.values)) throw new Error(uiText('surface.invalid'))
      return input
    } }, revision: async ({ subject }) => { await store.ready; return selectedRecord(subject).record }, preview: async ({ subject, values }) => { await store.ready; return { before: selectedRecord(subject).record, changes: values } }, run: editProperties
  }))
  return () => offs.forEach((off) => off())
}
