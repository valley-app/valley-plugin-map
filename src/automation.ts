import type { PluginCommand, ValleyPluginApi } from '@valley/plugin-sdk'
import { getStore } from './store'
import { defaultPinSource, sanitizePinSource } from './pinSources'
import { gpxToRoute, routeToGpx } from './gpx'
import { parseRouteFromGeoJson, routeToGeoJsonText } from './geojson'
import { validateMapWaypoints } from './surfaces'
import type { PinSource, Route, TravelMode, Waypoint } from './types'
import { uiText } from './localization'

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(uiText('surface.invalid'))
  return value as Record<string, unknown>
}
const str = (value: unknown): string => typeof value === 'string' ? value.trim() : ''
const mode = (value: unknown): TravelMode => {
  if (value !== undefined && !['driving', 'walking', 'cycling'].includes(String(value))) throw new Error(uiText('surface.invalid'))
  return value as TravelMode ?? 'driving'
}
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
const string = { type: 'string', minLength: 1 }
const json = (value: unknown): unknown => typeof value === 'string' ? JSON.parse(value) : value

export function registerMapAutomation(api: ValleyPluginApi): () => void {
  const store = getStore()!
  const offs: (() => void)[] = []
  const register = <I, O, E extends 'read' | 'write'>(command: PluginCommand<I, O, E>): void => {
    offs.push(api.commands.register({ ...command, run: async (input: I, ctx) => { await store.ready; return command.run(input, ctx) } }))
  }
  const sourcesRevision = async () => { await store.ready; return store.getSnapshot().pinSources }
  const saveSources = async (sources: PinSource[]): Promise<void> => {
    if (!store.savePinSources(sources)) throw new Error(uiText('surface.invalid'))
    await store.flushPinSources()
  }
  const routeById = (id: string): Route => {
    const route = store.getSnapshot().routes.find((entry) => entry.id === id || entry.name === id)
    if (!route) throw new Error(uiText('surface.unavailable'))
    return route
  }
  register({ id: 'list-pin-sources', label: 'Map: List pin sources', labelKey: 'surface.listSources', sideEffect: 'read', run: () => structuredClone(store.getSnapshot().pinSources) })
  register<{ source: Record<string, unknown> }, PinSource, 'write'>({
    id: 'save-pin-source', label: 'Map: Save pin source', labelKey: 'surface.saveSource', paletteSafe: false, sideEffect: 'write',
    input: { schema: schema({ source: { type: 'object' } }, ['source']), parse: (raw) => ({ source: object(object(raw).source) }), fromCli: (_args, flags) => ({ source: json(flags.source) }) },
    revision: sourcesRevision, preview: ({ source }) => ({ source }),
    run: async ({ source }) => {
      const previous = structuredClone(store.getSnapshot().pinSources)
      const existing = typeof source.id === 'string' ? previous.find((entry) => entry.id === source.id) : undefined
      if (source.id && !existing) throw new Error(uiText('surface.unavailable'))
      const merged = { ...(existing ?? defaultPinSource(previous)), ...source }
      if (!str(merged.title) || !['address', 'coordinate'].includes(String(merged.locationMode)) || !['filename', 'property'].includes(String(merged.labelMode)) || typeof merged.visible !== 'boolean' || typeof merged.hidden !== 'boolean' || !Array.isArray(merged.hoverFields) || merged.hoverFields.some((value) => typeof value !== 'string')) throw new Error(uiText('surface.invalid'))
      const next = sanitizePinSource(merged)
      await saveSources(existing ? previous.map((entry) => entry.id === next.id ? next : entry) : [...previous, next])
      return { value: next, revert: { label: uiText('surface.saveSource'), run: () => saveSources(previous) } }
    }
  })
  register<{ id: string }, { id: string }, 'write'>({
    id: 'delete-pin-source', label: 'Map: Delete pin source', labelKey: 'surface.deleteSource', paletteSafe: false, sideEffect: 'write',
    input: { schema: schema({ id: string }, ['id']), parse: (raw) => { const id = str(object(raw).id); if (!id) throw new Error(uiText('surface.invalid')); return { id } }, fromCli: (args, flags) => ({ id: flags.id ?? args[0] }) },
    revision: sourcesRevision, preview: ({ id }) => ({ deletedSourceId: id }),
    run: async ({ id }) => {
      const previous = structuredClone(store.getSnapshot().pinSources)
      if (!previous.some((entry) => entry.id === id)) throw new Error(uiText('surface.unavailable'))
      await saveSources(previous.filter((entry) => entry.id !== id))
      return { value: { id }, revert: { label: uiText('surface.deleteSource'), run: () => saveSources(previous) } }
    }
  })
  register<{ ids: string[] }, string[], 'write'>({
    id: 'reorder-pin-sources', label: 'Map: Reorder pin sources', labelKey: 'surface.reorderSources', paletteSafe: false, sideEffect: 'write',
    input: { schema: schema({ ids: { type: 'array', items: string, uniqueItems: true } }, ['ids']), parse: (raw) => { const ids = object(raw).ids; if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error(uiText('surface.invalid')); return { ids } }, fromCli: (args) => ({ ids: args }) },
    revision: sourcesRevision, run: async ({ ids }) => {
      const previous = structuredClone(store.getSnapshot().pinSources)
      if (ids.length !== previous.length || ids.some((id) => !previous.some((entry) => entry.id === id))) throw new Error(uiText('surface.invalid'))
      await saveSources(ids.map((id) => previous.find((entry) => entry.id === id)!))
      return { value: ids, revert: { label: uiText('surface.reorderSources'), run: () => saveSources(previous) } }
    }
  })
  register<{ stops: Waypoint[]; mode: TravelMode }, { stops: Waypoint[]; mode: TravelMode }, 'write'>({
    id: 'set-planner', label: 'Map: Set planner stops', labelKey: 'surface.setPlanner', paletteSafe: false, sideEffect: 'write',
    input: { schema: schema({ stops: { type: 'array', maxItems: 100, items: { type: 'object', required: ['label', 'lng', 'lat'], properties: { label: { type: 'string' }, lng: { type: 'number', minimum: -180, maximum: 180 }, lat: { type: 'number', minimum: -90, maximum: 90 }, placeId: { type: 'string' } }, additionalProperties: false } }, mode: { enum: ['driving', 'walking', 'cycling'] } }, ['stops']), parse: (raw) => { const input = object(raw); return { stops: validateMapWaypoints(input.stops), mode: mode(input.mode) } }, fromCli: (_args, flags) => ({ stops: json(flags.stops), mode: flags.mode }) },
    revision: () => ({ stops: store.getSnapshot().plannerStops, mode: store.getSnapshot().plannerMode }), preview: (input) => input,
    run: async ({ stops, mode }) => {
      const previous = store.getSnapshot()
      store.setPlannerMode(mode)
      store.setStops(stops)
      await store.flushSessionAsync()
      return { value: { stops, mode }, revert: { label: uiText('surface.setPlanner'), run: async () => { store.setPlannerMode(previous.plannerMode); store.setStops(previous.plannerStops); await store.flushSessionAsync() } } }
    }
  })
  register<{ id: string }, { id: string }, 'read'>({
    id: 'show-route', label: 'Map: Show saved route', labelKey: 'surface.showRoute', paletteSafe: false, sideEffect: 'read',
    input: { schema: schema({ id: string }, ['id']), parse: (raw) => { const id = str(object(raw).id); if (!id) throw new Error(uiText('surface.invalid')); return { id } }, fromCli: (args, flags) => ({ id: flags.id ?? args.join(' ') }) },
    run: ({ id }) => { const route = routeById(id); store.showRoute(route); return { id: route.id } }
  })
  register<{ id: string; format: 'gpx' | 'geojson' }, { format: string; content: string }, 'read'>({
    id: 'export-route', label: 'Map: Export route data', labelKey: 'surface.exportRoute', paletteSafe: false, sideEffect: 'read',
    input: { schema: schema({ id: string, format: { enum: ['gpx', 'geojson'] } }, ['id']), parse: (raw) => { const input = object(raw); if (!str(input.id) || (input.format !== undefined && input.format !== 'gpx' && input.format !== 'geojson')) throw new Error(uiText('surface.invalid')); return { id: str(input.id), format: input.format === 'geojson' ? 'geojson' : 'gpx' } }, fromCli: (args, flags) => ({ id: flags.id ?? args.join(' '), format: flags.format }) },
    run: ({ id, format }) => { const route = routeById(id); return { format, content: format === 'gpx' ? routeToGpx(route) : routeToGeoJsonText(route) } }, formatCli: ({ content }) => content
  })
  register<{ name: string; path: string; content: string; format: 'gpx' | 'geojson'; mode: TravelMode }, Route, 'write'>({
    id: 'import-route', label: 'Map: Import route data', labelKey: 'surface.importRoute', paletteSafe: false, sideEffect: 'write',
    input: { schema: schema({ name: string, path: string, content: { type: 'string', maxLength: 2000000 }, format: { enum: ['gpx', 'geojson'] }, mode: { enum: ['driving', 'walking', 'cycling'] } }, ['name']), parse: (raw) => {
      const input = object(raw)
      const path = str(input.path); const content = typeof input.content === 'string' ? input.content : ''
      if (!str(input.name) || Boolean(path) === Boolean(content) || content.length > 2000000 || path.startsWith('/') || path.split(/[\\/]/).includes('..') || (input.format !== undefined && input.format !== 'gpx' && input.format !== 'geojson')) throw new Error(uiText('surface.invalid'))
      return { name: str(input.name), path, content, format: input.format === 'geojson' || path.endsWith('.geojson') ? 'geojson' : 'gpx', mode: mode(input.mode) }
    }, fromCli: (args, flags) => ({ name: flags.name ?? args.join(' '), path: flags.path, content: flags.content, format: flags.format, mode: flags.mode }) },
    preview: ({ name, path, format }) => ({ name, path: path || undefined, format }),
    run: async ({ name, path, content, format, mode }) => {
      let text = content
      if (path) { const result = await api.drivers.files.readFile(path); if (!result.ok) throw new Error(uiText('surface.invalid')); text = result.data?.content ?? '' }
      if (text.length > 2000000) throw new Error(uiText('surface.invalid'))
      const parsed = format === 'gpx' ? gpxToRoute(text) : parseRouteFromGeoJson(text)
      if (!parsed || parsed.waypoints.length < 2) throw new Error(uiText('surface.invalid'))
      const waypoints = validateMapWaypoints(parsed.waypoints)
      const route = await store.importRoute(name, waypoints, parsed.geometry, mode)
      return { value: route, revert: { label: uiText('surface.importRoute'), run: async () => { if (!await store.removeRouteRaw(route.id)) throw new Error(uiText('surface.invalid')) } } }
    }
  })
  return () => offs.forEach((off) => off())
}
