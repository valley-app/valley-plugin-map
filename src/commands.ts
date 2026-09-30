/**
 * The map plugin's command-bus surface: typed `map:*` commands surfaced in
 * ⌘P, the terminal CLI (`valley mapbox …`) and the assistant agent. Handlers read
 * the live store via `getStore()` (hot-reload-safe). `save-place` is a `write`
 * and returns a bus revert for ⌘Z; the rest are `read`.
 */
import type { PluginCommand, ValleyPluginApi } from '@valley/plugin-sdk'
import { getStore, type MapStore } from './store'
import { fullName } from './geocode'
import { formatDistance, formatDuration } from './format'
import type { MapStyleId, Place, Route, RouteStep, TravelMode, Waypoint } from './types'
import { mapLayer } from './settings'
import { uiText } from './localization'
import { haversineMeters, isValidLngLat } from './geo'
import { planRoute } from './routing'

function live(): MapStore {
  const store = getStore()
  if (!store) throw new Error(uiText('surface.unavailable'))
  return store
}

const asStr = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const asNum = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : undefined
}
const asMode = (v: unknown): TravelMode => {
  const s = asStr(v).toLowerCase()
  if (s === 'walking' || s === 'walk' || s === 'foot') return 'walking'
  if (s === 'cycling' || s === 'cycle' || s === 'bike') return 'cycling'
  return 'driving'
}
const asStyle = (v: unknown): MapStyleId => mapLayer(asStr(v).toLowerCase())
const asStrList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(asStr).map((s) => s.trim()).filter(Boolean)
  const s = asStr(v).trim()
  return s ? s.split(/\s*[;|]\s*/).filter(Boolean) : []
}

/** Find a saved place/route by case-insensitive name; throws a helpful error if absent. */
function findPlace(name: string): Place {
  const q = name.trim().toLowerCase()
  const place = live().getSnapshot().places.find((p) => p.id === name || p.name.toLowerCase() === q)
  if (!place) throw new Error(uiText('surface.unavailable'))
  return place
}
function findRoute(name: string): Route {
  const q = name.trim().toLowerCase()
  const route = live().getSnapshot().routes.find((r) => r.id === name || r.name.toLowerCase() === q)
  if (!route) throw new Error(uiText('surface.unavailable'))
  return route
}

/** One resolved point of a lookup: what it is called and where. */
interface LookupPoint { name: string; lat: number; lng: number }

const COORDINATE_PAIR = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/

/** `lat, lng`, a saved place's name, or an address — in that order, so a
 *  coordinate or a saved place never costs a geocoder request. */
async function resolvePoint(value: string): Promise<LookupPoint> {
  const text = value.trim()
  const pair = COORDINATE_PAIR.exec(text)
  if (pair) {
    const lat = Number(pair[1]), lng = Number(pair[2])
    if (!isValidLngLat(lng, lat)) throw new Error(`Invalid coordinates "${text}". Use "lat, lng".`)
    return { name: `${lat}, ${lng}`, lat, lng }
  }
  const store = live()
  const place = store.getSnapshot().places.find((p) => p.name.toLowerCase() === text.toLowerCase())
  if (place) return { name: place.name, lat: place.lat, lng: place.lng }
  const hits = await store.lookupPlaces(text)
  if (hits.length === 0) throw new Error(`No results for "${text}".`)
  return { name: fullName(hits[0]), lat: hits[0].lat, lng: hits[0].lng }
}

const coordinateText = (lat: number, lng: number): string => `${lat.toFixed(5)}, ${lng.toFixed(5)}`

/** Render a numbered step list for CLI/agent output. */
function formatSteps(steps: RouteStep[] | undefined): string {
  if (!steps || steps.length === 0) return ''
  return (
    '\n' +
    steps
      .map((s, i) => `${i + 1}. ${s.instruction} (${formatDistance(s.distanceM)})`)
      .join('\n')
  )
}

/**
 * What `geo.navigator` does for a consumer that has a place: open the map, then
 * centre it on the query when the query resolves.
 *
 * The two halves are deliberately independent. Opening the map IS the contract;
 * centring is the best effort on top of it. A label with no fix — "Screening
 * room, second floor" on a todo — geocodes to nothing, and `search` fails; when
 * that failure was the whole call, the consumer's click did nothing visible.
 */
export function openOnMap(api: ValleyPluginApi): (request: { query: string }) => Promise<void> {
  return async ({ query }) => {
    await api.commands.executeOwn('open')
    await api.commands.executeOwn('search', { query })
  }
}

/** Register every `map:*` command; returns a combined disposer. */
export function registerMapboxCommands(api: ValleyPluginApi): () => void {
  const register = <I, O, E extends 'read' | 'write'>(command: PluginCommand<I, O, E>): (() => void) => api.commands.register({
    ...command,
    run: async (input: I, context) => { await live().ready; return command.run(input, context) }
  })
  const placeRevision = async ({ name }: { name: string }) => { await live().ready; return findPlace(name) }
  const routeRevision = async ({ name }: { name: string }) => { await live().ready; return findRoute(name) }
  const offs = [
    register({
      id: 'open',
      label: 'Map: Open map', labelKey: 'auto.d5f9cda6b0f7',
      sideEffect: 'read',
      run: () => {
        api.workspace.openMainTab()
        return undefined
      }
    }),

    register({
      id: 'search',
      label: 'Map: Search for a place', labelKey: 'auto.fb72cf76991a',
      paletteSafe: false,
      sideEffect: 'read',
      input: {
        schema: { type: 'object', properties: { query: { type: 'string', minLength: 1 } }, required: ['query'], additionalProperties: false },
        parse: (raw) => {
          const query = asStr((raw as Record<string, unknown> | undefined)?.query).trim()
          if (!query) throw new Error('Usage: map search "<query>"')
          return { query }
        },
        fromCli: (args, flags) => ({ query: (args.join(' ') || asStr(flags.query)).trim() })
      },
      run: async ({ query }) => {
        const store = live()
        const hits = await store.lookupPlaces(query)
        if (hits.length === 0) throw new Error(`No results for "${query}".`)
        const top = hits[0]
        store.showAddress([top.lng, top.lat])
        // The full address, not the short lead the sidebar rows show — a CLI line
        // has no second row to carry the region on.
        return { query, name: fullName(top), lng: top.lng, lat: top.lat, results: hits }
      },
      formatCli: (v) => `Centred on ${v.name} (${v.lat.toFixed(4)}, ${v.lng.toFixed(4)})`
    }),

    register({
      id: 'save-place',
      label: 'Map: Save a place', labelKey: 'auto.5c6ad12e9fa1',
      paletteSafe: false,
      sideEffect: 'write',
      input: {
        schema: { type: 'object', properties: { name: { type: 'string', minLength: 1 }, lat: { type: 'number', minimum: -90, maximum: 90 }, lng: { type: 'number', minimum: -180, maximum: 180 }, note: { type: 'string' } }, required: ['name', 'lat', 'lng'], additionalProperties: false },
        parse: (raw) => {
          const o = (raw ?? {}) as Record<string, unknown>
          const name = asStr(o.name).trim()
          const lat = asNum(o.lat)
          const lng = asNum(o.lng)
          if (!name) throw new Error('Usage: map save-place "<name>" --lat <lat> --lng <lng>')
          if (lat === undefined || lng === undefined || !isValidLngLat(lng, lat)) throw new Error('save-place needs --lat and --lng')
          return { name, lat, lng, note: asStr(o.note).trim() || undefined }
        },
        fromCli: (args, flags) => ({
          name: (args.join(' ') || asStr(flags.name)).trim(),
          lat: asNum(flags.lat) ?? NaN,
          lng: asNum(flags.lng) ?? NaN,
          note: asStr(flags.note).trim() || undefined
        })
      },
      run: async ({ name, lat, lng, note }) => {
        const place = await live().createPlaceRaw({ name, lat, lng, note })
        return {
          value: place,
          revert: {
            label: `Delete place “${place.name}”`,
            run: async () => {
              if (!await live().removePlaceRaw(place.id)) throw new Error(uiText('surface.invalid'))
            }
          }
        }
      },
      formatCli: (v) => `Saved place “${v.name}”.`
    }),

    register({
      id: 'plan-route',
      label: 'Map: Plan a route', labelKey: 'auto.afd03cf7e8c8',
      paletteSafe: false,
      sideEffect: 'read',
      input: {
        schema: { type: 'object', properties: { to: { type: 'string', minLength: 1 }, from: { type: 'string', minLength: 1 }, via: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 100 }, mode: { enum: ['driving', 'walking', 'cycling'] } }, required: ['to'], additionalProperties: false },
        parse: (raw) => {
          const o = (raw ?? {}) as Record<string, unknown>
          const to = asStr(o.to).trim()
          if (!to) {
            throw new Error(
              'Usage: map plan-route --to "<dest>" [--from "<origin>"] [--via "<stop>"] [--mode driving|walking|cycling]'
            )
          }
          return {
            to,
            from: asStr(o.from).trim() || undefined,
            via: asStrList(o.via),
            mode: asMode(o.mode)
          }
        },
        fromCli: (args, flags) => ({
          to: (asStr(flags.to) || args.join(' ')).trim(),
          from: asStr(flags.from).trim() || undefined,
          via: asStrList(flags.via),
          mode: asMode(flags.mode)
        })
      },
      run: async ({ to, from, via, mode }) => {
        const store = live()
        const settings = store.settings()
        const geocodeOne = async (label: string): Promise<Waypoint> => {
          const hits = await store.lookupPlaces(label, undefined, settings)
          if (hits.length === 0) throw new Error(`No results for "${label}".`)
          return { lng: hits[0].lng, lat: hits[0].lat, label: hits[0].name }
        }

        const dest = await geocodeOne(to)

        let origin: Waypoint
        if (from) {
          origin = await geocodeOne(from)
        } else {
          const fav = store.getSnapshot().places[0]
          if (!fav) throw new Error('Provide --from, or save a favourite place to use as the origin.')
          origin = { lng: fav.lng, lat: fav.lat, label: fav.name }
        }

        const stops: Waypoint[] = []
        for (const stop of via) stops.push(await geocodeOne(stop))

        api.workspace.openMainTab()
        const plan = await store.planWaypoints([origin, ...stops, dest], mode)
        return {
          from: origin.label,
          to: dest.label,
          via: stops.map((s) => s.label),
          mode,
          distanceM: plan?.distanceM,
          durationS: plan?.durationS,
          steps: plan?.steps?.map((s) => ({
            instruction: s.instruction,
            distanceM: s.distanceM,
            durationS: s.durationS
          }))
        }
      },
      formatCli: (v) =>
        v.distanceM != null
          ? `${v.from} → ${v.to} (${v.mode}): ${formatDistance(v.distanceM)}, ${formatDuration(v.durationS ?? 0)}${formatSteps(v.steps)}`
          : `Planned a route from ${v.from} to ${v.to}.`
    }),

    // ── Navigation ───────────────────────────────────────────────────────────
    register({
      id: 'goto',
      label: 'Map: Go to coordinates', labelKey: 'auto.3b138ea53cba',
      paletteSafe: false,
      sideEffect: 'read',
      input: {
        schema: { type: 'object', properties: { lat: { type: 'number', minimum: -90, maximum: 90 }, lng: { type: 'number', minimum: -180, maximum: 180 }, zoom: { type: 'number', minimum: 0, maximum: 24 } }, required: ['lat', 'lng'], additionalProperties: false },
        parse: (raw) => {
          const o = (raw ?? {}) as Record<string, unknown>
          const lat = asNum(o.lat)
          const lng = asNum(o.lng)
          if (lat === undefined || lng === undefined || !isValidLngLat(lng, lat)) throw new Error('goto needs --lat and --lng')
          return { lat, lng, zoom: asNum(o.zoom) }
        },
        fromCli: (args, flags) => ({ lat: asNum(flags.lat), lng: asNum(flags.lng), zoom: asNum(flags.zoom) })
      },
      run: ({ lat, lng, zoom }) => {
        live().showAddress([lng, lat], zoom ?? 16)
        return { lat, lng, zoom: zoom ?? 16 }
      },
      formatCli: (v) => `Centred on ${v.lat.toFixed(4)}, ${v.lng.toFixed(4)}.`
    }),

    register({
      id: 'describe',
      label: 'Map: Describe a coordinate', labelKey: 'auto.2fa167b34f2a',
      paletteSafe: false,
      sideEffect: 'read',
      input: {
        schema: { type: 'object', properties: { lat: { type: 'number', minimum: -90, maximum: 90 }, lng: { type: 'number', minimum: -180, maximum: 180 } }, required: ['lat', 'lng'], additionalProperties: false },
        parse: (raw) => {
          const o = (raw ?? {}) as Record<string, unknown>
          const lat = asNum(o.lat)
          const lng = asNum(o.lng)
          if (lat === undefined || lng === undefined || !isValidLngLat(lng, lat)) throw new Error('describe needs --lat and --lng')
          return { lat, lng }
        },
        fromCli: (args, flags) => ({ lat: asNum(flags.lat), lng: asNum(flags.lng) })
      },
      run: async ({ lat, lng }) => {
        const store = live()
        const address = await store.lookupAddress(lng, lat)
        store.showAddress([lng, lat])
        return { lat, lng, address }
      },
      formatCli: (v) =>
        v.address ? `${v.lat.toFixed(4)}, ${v.lng.toFixed(4)} — ${v.address}` : `No address found for ${v.lat.toFixed(4)}, ${v.lng.toFixed(4)}.`
    }),

    // ── Lookups: plain input → output, never moving the map ─────────────────
    register({
      id: 'geocode',
      label: 'Map: Address to coordinates', labelKey: 'command.geocode',
      paletteSafe: false,
      sideEffect: 'read',
      input: {
        schema: { type: 'object', properties: { address: { type: 'string', minLength: 1 }, limit: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['address'], additionalProperties: false },
        parse: (raw) => {
          const o = (raw ?? {}) as Record<string, unknown>
          const address = asStr(o.address).trim()
          if (!address) throw new Error('Usage: map geocode "<address>"')
          return { address, limit: Math.min(10, Math.max(1, Math.round(asNum(o.limit) ?? 5))) }
        },
        fromCli: (args, flags) => ({ address: (args.join(' ') || asStr(flags.address)).trim(), limit: asNum(flags.limit) })
      },
      run: async ({ address, limit }) => {
        const hits = await live().lookupPlaces(address)
        if (hits.length === 0) throw new Error(`No results for "${address}".`)
        const results = hits.slice(0, limit).map((hit) => ({ name: fullName(hit), lat: hit.lat, lng: hit.lng }))
        return { address, ...results[0], results }
      },
      formatCli: (v) => coordinateText(v.lat, v.lng)
    }),

    register({
      id: 'reverse-geocode',
      label: 'Map: Coordinates to address', labelKey: 'command.reverseGeocode',
      paletteSafe: false,
      sideEffect: 'read',
      input: {
        schema: { type: 'object', properties: { lat: { type: 'number', minimum: -90, maximum: 90 }, lng: { type: 'number', minimum: -180, maximum: 180 } }, required: ['lat', 'lng'], additionalProperties: false },
        parse: (raw) => {
          const o = (raw ?? {}) as Record<string, unknown>
          const lat = asNum(o.lat)
          const lng = asNum(o.lng)
          if (lat === undefined || lng === undefined || !isValidLngLat(lng, lat)) throw new Error('Usage: map reverse-geocode --lat <lat> --lng <lng>')
          return { lat, lng }
        },
        fromCli: (args, flags) => {
          const pair = COORDINATE_PAIR.exec(args.join(' '))
          return pair ? { lat: Number(pair[1]), lng: Number(pair[2]) } : { lat: asNum(flags.lat), lng: asNum(flags.lng) }
        }
      },
      run: async ({ lat, lng }) => {
        const address = await live().lookupAddress(lng, lat)
        if (!address) throw new Error(`No address found for ${coordinateText(lat, lng)}.`)
        return { lat, lng, address }
      },
      formatCli: (v) => v.address
    }),

    register({
      id: 'distance',
      label: 'Map: Distance between two points', labelKey: 'command.distance',
      paletteSafe: false,
      sideEffect: 'read',
      input: {
        schema: { type: 'object', properties: { from: { type: 'string', minLength: 1 }, to: { type: 'string', minLength: 1 }, mode: { enum: ['driving', 'walking', 'cycling'] } }, required: ['from', 'to'], additionalProperties: false },
        parse: (raw) => {
          const o = (raw ?? {}) as Record<string, unknown>
          const from = asStr(o.from).trim()
          const to = asStr(o.to).trim()
          if (!from || !to) throw new Error('Usage: map distance --from "<address | lat, lng | saved place>" --to "<…>" [--mode driving|walking|cycling]')
          return { from, to, mode: o.mode === undefined || o.mode === '' ? undefined : asMode(o.mode) }
        },
        fromCli: (_args, flags) => ({ from: asStr(flags.from).trim(), to: asStr(flags.to).trim(), mode: flags.mode === undefined ? undefined : asMode(flags.mode) })
      },
      run: async ({ from, to, mode }) => {
        const start = await resolvePoint(from)
        const end = await resolvePoint(to)
        const straightLineM = Math.round(haversineMeters([start.lng, start.lat], [end.lng, end.lat]))
        if (!mode) return { from: start, to: end, straightLineM }
        const route = await planRoute([
          { lng: start.lng, lat: start.lat, label: start.name },
          { lng: end.lng, lat: end.lat, label: end.name }
        ], mode, live().settings())
        return { from: start, to: end, straightLineM, route: { mode, distanceM: Math.round(route.distanceM), durationS: Math.round(route.durationS) } }
      },
      formatCli: (v) => v.route
        ? `${formatDistance(v.route.distanceM)} · ${formatDuration(v.route.durationS)} (${v.route.mode}), ${formatDistance(v.straightLineM)} straight`
        : formatDistance(v.straightLineM)
    }),

    register({
      id: 'set-style',
      label: 'Map: Set base style', labelKey: 'auto.ae3c9d1f9ac7',
      paletteSafe: false,
      sideEffect: 'read',
      input: {
        schema: { type: 'object', properties: { style: { type: 'string', minLength: 1 } }, required: ['style'], additionalProperties: false },
        parse: (raw) => ({ style: asStyle((raw as Record<string, unknown> | undefined)?.style) }),
        fromCli: (args, flags) => ({ style: asStyle(asStr(flags.style) || args[0]) })
      },
      run: ({ style }) => {
        live().setStyle(style)
        return { style }
      },
      formatCli: (v) => `Map style set to ${v.style}.`
    }),

    register({
      id: 'clear-route',
      label: 'Map: Clear the route', labelKey: 'auto.4c236fbd5136',
      sideEffect: 'read',
      run: () => {
        live().clearPlanner()
        return undefined
      }
    }),

    // ── Saved places ─────────────────────────────────────────────────────────
    register({
      id: 'list-places',
      label: 'Map: List saved places', labelKey: 'auto.a81b0ba2cd11',
      sideEffect: 'read',
      run: () => live().getSnapshot().places,
      formatCli: (places) =>
        places.length === 0
          ? 'No saved places.'
          : places.map((p) => `• ${p.name} (${p.lat.toFixed(4)}, ${p.lng.toFixed(4)})`).join('\n')
    }),

    register({
      id: 'show-place',
      label: 'Map: Show a saved place', labelKey: 'auto.d0a3b11e2e7b',
      paletteSafe: false,
      sideEffect: 'read',
      input: {
        schema: { type: 'object', properties: { name: { type: 'string', minLength: 1 } }, required: ['name'], additionalProperties: false },
        parse: (raw) => {
          const name = asStr((raw as Record<string, unknown> | undefined)?.name).trim()
          if (!name) throw new Error('Usage: map show-place "<name>"')
          return { name }
        },
        fromCli: (args, flags) => ({ name: (args.join(' ') || asStr(flags.name)).trim() })
      },
      run: ({ name }) => {
        const place = findPlace(name)
        live().focusPlace(place)
        return place
      },
      formatCli: (v) => `Showing “${v.name}”.`
    }),

    register({
      id: 'delete-place',
      label: 'Map: Delete a saved place', labelKey: 'auto.d02f2bd78f5a',
      paletteSafe: false,
      sideEffect: 'write',
      revision: placeRevision,
      preview: async (input) => ({ before: await placeRevision(input), changes: input }),
      input: {
        schema: { type: 'object', properties: { name: { type: 'string', minLength: 1 } }, required: ['name'], additionalProperties: false },
        parse: (raw) => {
          const name = asStr((raw as Record<string, unknown> | undefined)?.name).trim()
          if (!name) throw new Error('Usage: map delete-place "<name>"')
          return { name }
        },
        fromCli: (args, flags) => ({ name: (args.join(' ') || asStr(flags.name)).trim() })
      },
      run: async ({ name }) => {
        const place = findPlace(name)
        if (!await live().removePlaceRaw(place.id)) throw new Error(uiText('surface.invalid'))
        return {
          value: place,
          revert: {
            label: `Restore place “${place.name}”`,
            run: async () => {
              if (!await live().restorePlaceRaw(place)) throw new Error(uiText('surface.invalid'))
            }
          }
        }
      },
      formatCli: (v) => `Deleted place “${v.name}”.`
    }),

    register<{ name: string; newName?: string; lat?: number; lng?: number; note?: string }, Place, 'write'>({
      id: 'update-place',
      label: 'Map: Update a saved place', labelKey: 'auto.5f9f228ab569',
      paletteSafe: false,
      sideEffect: 'write',
      revision: placeRevision,
      preview: async (input) => ({ before: await placeRevision(input), changes: input }),
      input: {
        schema: { type: 'object', properties: { name: { type: 'string', minLength: 1 }, newName: { type: 'string', minLength: 1 }, lat: { type: 'number', minimum: -90, maximum: 90 }, lng: { type: 'number', minimum: -180, maximum: 180 }, note: { type: 'string' } }, required: ['name'], additionalProperties: false },
        parse: (raw) => {
          const o = (raw ?? {}) as Record<string, unknown>
          const name = asStr(o.name).trim()
          if (!name) throw new Error('Usage: map update-place "<name>" [--newName <name>] [--lat <lat>] [--lng <lng>] [--note <note>]')
          return {
            name,
            newName: asStr(o.newName).trim() || undefined,
            lat: asNum(o.lat),
            lng: asNum(o.lng),
            note: o.note === undefined ? undefined : asStr(o.note).trim()
          }
        },
        fromCli: (args, flags) => ({
          name: (args.join(' ') || asStr(flags.name)).trim(),
          newName: asStr(flags.newName).trim() || undefined,
          lat: asNum(flags.lat),
          lng: asNum(flags.lng),
          note: flags.note === undefined ? undefined : asStr(flags.note).trim()
        })
      },
      run: async ({ name, newName, lat, lng, note }) => {
        const before = findPlace(name)
        const patch: Partial<Place> = {}
        if (newName) patch.name = newName
        if (lat !== undefined) patch.lat = lat
        if (lng !== undefined) patch.lng = lng
        if (note !== undefined) patch.note = note || undefined
        if (Object.keys(patch).length === 0 || !isValidLngLat(patch.lng ?? before.lng, patch.lat ?? before.lat)) throw new Error(uiText('surface.invalid'))
        await live().updatePlaceRaw(before.id, patch)
        const after = live().getSnapshot().places.find((p) => p.id === before.id) ?? before
        return {
          value: after,
          revert: {
            label: `Revert place “${before.name}”`,
            run: async () => {
              await live().updatePlaceRaw(before.id, {
                name: before.name,
                lat: before.lat,
                lng: before.lng,
                note: before.note
              })
            }
          }
        }
      },
      formatCli: (v) => `Updated place “${v.name}”.`
    }),

    // ── Saved routes ─────────────────────────────────────────────────────────
    register({
      id: 'list-routes',
      label: 'Map: List saved routes', labelKey: 'auto.2a346d4c3018',
      sideEffect: 'read',
      run: () => live().getSnapshot().routes,
      formatCli: (routes) =>
        routes.length === 0
          ? 'No saved routes.'
          : routes
              .map((r) => `• ${r.name} (${r.mode}${r.distanceM != null ? `, ${formatDistance(r.distanceM)}` : ''})`)
              .join('\n')
    }),

    register({
      id: 'save-route',
      label: 'Map: Save the current route', labelKey: 'auto.363495081008',
      paletteSafe: false,
      sideEffect: 'write',
      revision: async () => { await live().ready; return { mode: live().getSnapshot().plannerMode, stops: live().getSnapshot().plannerStops, plan: live().getSnapshot().plan } },
      preview: (input) => input,
      input: {
        schema: { type: 'object', properties: { name: { type: 'string', minLength: 1 } }, required: ['name'], additionalProperties: false },
        parse: (raw) => {
          const name = asStr((raw as Record<string, unknown> | undefined)?.name).trim()
          if (!name) throw new Error('Usage: map save-route "<name>"')
          return { name }
        },
        fromCli: (args, flags) => ({ name: (args.join(' ') || asStr(flags.name)).trim() })
      },
      run: async ({ name }) => {
        const route = await live().saveRouteRaw(name)
        if (!route) throw new Error('No route to save — plan a route first.')
        return {
          value: route,
          revert: {
            label: `Delete route “${route.name}”`,
            run: async () => {
              if (!await live().removeRouteRaw(route.id)) throw new Error(uiText('surface.invalid'))
            }
          }
        }
      },
      formatCli: (v) => `Saved route “${v.name}”.`
    }),

    register({
      id: 'delete-route',
      label: 'Map: Delete a saved route', labelKey: 'auto.f0c7a8a46888',
      paletteSafe: false,
      sideEffect: 'write',
      revision: routeRevision,
      preview: async (input) => ({ before: await routeRevision(input), changes: input }),
      input: {
        schema: { type: 'object', properties: { name: { type: 'string', minLength: 1 } }, required: ['name'], additionalProperties: false },
        parse: (raw) => {
          const name = asStr((raw as Record<string, unknown> | undefined)?.name).trim()
          if (!name) throw new Error('Usage: map delete-route "<name>"')
          return { name }
        },
        fromCli: (args, flags) => ({ name: (args.join(' ') || asStr(flags.name)).trim() })
      },
      run: async ({ name }) => {
        const route = findRoute(name)
        if (!await live().removeRouteRaw(route.id)) throw new Error(uiText('surface.invalid'))
        return {
          value: route,
          revert: {
            label: `Restore route “${route.name}”`,
            run: async () => {
              if (!await live().restoreRouteRaw(route)) throw new Error(uiText('surface.invalid'))
            }
          }
        }
      },
      formatCli: (v) => `Deleted route “${v.name}”.`
    })
  ]
  return () => offs.forEach((off) => off())
}
