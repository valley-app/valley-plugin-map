import type { MapSidebarRouteStop, MapSidebarSnapshot, MapSidebarTab } from '../../../sidebarContract'
import { paddedStops, type MapStore } from '../../../store'
import { withoutNearDuplicates } from '../../../geocode'
import type { RouteProblemReason } from '../../../routing'
import type { Waypoint } from '../../../types'
import { uiText } from '../../../localization'

/** A router plans far more, but a form with more rows than this stops being a form. */
export const MAX_VIAS = 8

type Suggestion = { title: string; detail?: string; waypoint: Waypoint }

/** The stop list as the form shows it: start, every via that holds a place, destination. */
export function formStops(stops: readonly (Waypoint | null)[]): { origin: Waypoint | null; vias: Waypoint[]; destination: Waypoint | null } {
  const padded = paddedStops([...stops])
  return {
    origin: padded[0],
    vias: padded.slice(1, -1).filter((stop): stop is Waypoint => stop !== null),
    destination: padded[padded.length - 1]
  }
}

/** Why there is no route, in words a traveller can act on. */
export function routeProblemText(reason: RouteProblemReason): string {
  switch (reason) {
    case 'no-route': return uiText('directions.problem.noRoute')
    case 'off-road': return uiText('directions.problem.offRoad')
    case 'too-far': return uiText('directions.problem.tooFar')
    case 'same-place': return uiText('directions.problem.samePlace')
    case 'offline': return uiText('directions.problem.offline')
    case 'busy': return uiText('directions.problem.busy')
    default: return uiText('directions.problem.service')
  }
}

export interface DirectionsTab extends MapSidebarTab {
  /** Enter in a stop field: take the first suggestion for what is typed there. */
  enter(stopId: string, text: string): void
  /** A stop field lost focus: its unpicked text goes and the suggestions close. */
  blur(stopId: string): void
  /** True while suggestions (or their search) are on screen, so the result steps aside. */
  suggesting(): boolean
  dispose(): void
}

/**
 * Map's own A-to-B planner as a sidebar-tab provider, so it is drawn by the
 * same journey form a timetable plugin gets: start, one via row that is always
 * there to fill, destination, swap and drag to reorder. The stops live in the
 * store; this adds what the form needs around them: what is being typed, the
 * place suggestions for it, and the reason when no route comes back.
 */
export function createDirectionsTab(store: MapStore): DirectionsTab {
  const listeners = new Set<() => void>()
  const drafts: Record<string, string> = {}
  let active: string | null = null
  let hits: Suggestion[] = []
  let defaults = false
  let searching = false
  let searched = false
  let searchError: string | null = null
  let lookup: AbortController | null = null
  let pickFirst = false
  let snapshot: MapSidebarSnapshot | null = null
  const notify = (): void => { snapshot = null; listeners.forEach(listener => listener()) }
  const offStore = store.subscribe(notify)

  const view = () => formStops(store.getSnapshot().plannerStops)
  const viaIds = (count: number): string[] => Array.from({ length: Math.min(count + 1, MAX_VIAS) }, (_, index) => `via:${index + 1}`)
  const stopAt = (id: string): Waypoint | null => {
    const { origin, vias, destination } = view()
    return id === 'origin' ? origin : id === 'destination' ? destination : vias[Number(id.slice(4)) - 1] ?? null
  }
  const label = (stop: Waypoint): string => stop.fromLiveLocation ? uiText('map.panel.currentLocation') : stop.label
  const write = (id: string, waypoint: Waypoint | null): void => {
    const { origin, vias, destination } = view()
    if (id === 'origin') store.setStops([waypoint, ...vias, destination])
    else if (id === 'destination') store.setStops([origin, ...vias, waypoint])
    else {
      const index = Number(id.slice(4)) - 1
      const next = [...vias]
      if (waypoint) next[Math.min(index, next.length)] = waypoint
      else next.splice(index, 1)
      // A row that moved up must not keep the text typed into the row it replaced.
      for (const key of Object.keys(drafts)) if (key.startsWith('via:')) delete drafts[key]
      store.setStops([origin, ...next, destination])
    }
  }
  const stopSearch = (): void => { lookup?.abort(); lookup = null; searching = false; pickFirst = false }
  const closeSuggestions = (): void => { stopSearch(); hits = []; defaults = false; searched = false; searchError = null }

  /** An empty field offers what needs no typing: the current location and the favourite places. */
  const offerDefaults = (): void => {
    stopSearch()
    const { origin, vias, destination } = view()
    const used = [origin, ...vias, destination].filter((stop): stop is Waypoint => stop !== null)
    const here = store.liveLocationStop()
    hits = [
      ...(here && !used.some(stop => stop.fromLiveLocation) ? [{ title: uiText('map.panel.currentLocation'), waypoint: here }] : []),
      ...store.getSnapshot().places.slice(0, 8).map(place => ({ title: place.name, detail: uiText('places.bar.title'), waypoint: { lng: place.lng, lat: place.lat, label: place.name, placeId: place.id } }))
    ]
    defaults = true
    searched = false
    searchError = null
  }

  const pick = (index: number): void => {
    const hit = hits[index]
    const id = active
    if (!hit || !id) return
    delete drafts[id]
    closeSuggestions()
    write(id, hit.waypoint)
    notify()
  }

  const search = (id: string, text: string): void => {
    lookup?.abort()
    const controller = new AbortController()
    lookup = controller
    searching = true
    searchError = null
    defaults = false
    notify()
    // Saved places need no network: they lead the list and stay when the geocoder cannot be reached.
    const saved = store.matchingSavedPlaces(text, 3)
    const favourites: Suggestion[] = saved.map(place => ({ title: place.name, detail: uiText('places.bar.title'), waypoint: { lng: place.lng, lat: place.lat, label: place.name, placeId: place.id } }))
    const settle = (found: Suggestion[], error: string | null): void => {
      lookup = null
      searching = false
      searched = true
      hits = found
      searchError = found.length ? null : error
      if (pickFirst && hits.length) { pick(0); return }
      pickFirst = false
      notify()
    }
    store.lookupPlaces(text, controller.signal).then((places) => {
      if (lookup !== controller || active !== id) return
      settle([...favourites, ...withoutNearDuplicates(places, saved).map(place => ({ title: place.name, detail: place.context, waypoint: { lng: place.lng, lat: place.lat, label: place.name } }))], null)
    }).catch((error) => {
      if (lookup !== controller || active !== id) return
      settle(favourites, store.searchProblemText(error))
    })
  }

  const build = (): MapSidebarSnapshot => {
    const snap = store.getSnapshot()
    const { origin, vias, destination } = view()
    const stop = (id: string, role: MapSidebarRouteStop['role'], waypoint: Waypoint | null): MapSidebarRouteStop => {
      const text = uiText(role === 'origin' ? 'directions.from' : role === 'via' ? 'directions.via' : 'directions.to')
      return {
        id, role, label: text, placeholder: text,
        value: drafts[id] ?? (waypoint ? label(waypoint) : ''),
        ...(waypoint?.fromLiveLocation && drafts[id] === undefined ? { location: true } : {})
      }
    }
    const stops = [stop('origin', 'origin', origin), ...viaIds(vias.length).map((id, index) => stop(id, 'via', vias[index] ?? null)), stop('destination', 'destination', destination)]
    const typing = active !== null && Boolean(drafts[active]?.trim())
    // One line under the form, in this order: what the field being typed in found, why there is
    // no route, or which end is still missing.
    const message = searching ? uiText('auto.1a6a5ba8c23d')
      : typing && searched && !hits.length && !searchError ? `${uiText('auto.cd0af6cfca75')}. ${uiText('auto.2629b9c60ccc')}`
      : hits.length || searchError || snap.planProblem || snap.plan || snap.planning ? undefined
      : destination && !origin ? uiText(snap.locationStatus === 'locating' ? 'directions.hint.locating' : 'directions.hint.start')
      : origin && !destination ? uiText('directions.hint.destination')
      : undefined
    return {
      fields: [], actions: [],
      rows: hits.map((hit, index) => ({ id: `hit-${index}`, title: hit.title, ...(hit.detail ? { detail: hit.detail } : {}), action: `pick:${index}` })),
      ...(defaults && hits.length ? { rowsTitle: uiText('directions.suggestions') } : {}),
      route: { stops, swap: 'swap', reorder: 'reorder' },
      ...(searchError ? { error: searchError } : snap.planProblem && !hits.length && !searching ? { error: routeProblemText(snap.planProblem) } : {}),
      ...(message ? { message } : {})
    }
  }

  return {
    id: 'directions',
    label: uiText('auto.f814a9fb4687'),
    icon: { viewBox: '0 0 24 24', path: '' },
    getSnapshot: () => snapshot ??= build(),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async run(action, values) {
      if (action.startsWith('focus:')) {
        const id = action.slice(6)
        if (active !== id) closeSuggestions()
        active = id
        if (!drafts[id] && !stopAt(id)) offerDefaults()
        notify()
        return
      }
      if (action.startsWith('input:')) {
        const id = action.slice(6)
        const text = values[id] ?? ''
        active = id
        if (!text.trim()) {
          delete drafts[id]
          // Emptying a field takes its place out of the route; an emptied via row goes with it.
          if (stopAt(id)) write(id, null)
          offerDefaults()
          notify()
          return
        }
        drafts[id] = text
        search(id, text.trim())
        return
      }
      if (action.startsWith('pick:')) { pick(Number(action.slice(5))); return }
      if (action === 'swap') {
        const { origin, vias, destination } = view()
        for (const key of Object.keys(drafts)) delete drafts[key]
        closeSuggestions()
        store.setStops([destination, ...[...vias].reverse(), origin])
        notify()
        return
      }
      if (action.startsWith('reorder:')) {
        // `reorder:<stopId>:<index>`; a via id holds a colon of its own.
        const at = action.lastIndexOf(':')
        const id = action.slice(8, at)
        const to = Number(action.slice(at + 1))
        const { origin, vias, destination } = view()
        const order: { id: string; stop: Waypoint | null }[] = [{ id: 'origin', stop: origin }, ...vias.map((stop, index) => ({ id: `via:${index + 1}`, stop })), { id: 'destination', stop: destination }]
        const from = order.findIndex(entry => entry.id === id)
        if (from === -1 || !Number.isInteger(to) || to < 0 || to >= order.length || to === from) return
        const [moved] = order.splice(from, 1)
        order.splice(to, 0, moved)
        for (const key of Object.keys(drafts)) delete drafts[key]
        closeSuggestions()
        // Roles follow the order: first is the start, last the destination, the rest are vias.
        store.setStops([order[0].stop, ...order.slice(1, -1).flatMap(entry => entry.stop ? [entry.stop] : []), order[order.length - 1].stop])
        notify()
      }
    },
    enter(stopId, text) {
      active = stopId
      if (hits.length && !defaults) { pick(0); return }
      const query = text.trim()
      if (!query || query === (stopAt(stopId) ? label(stopAt(stopId)!) : '')) return
      drafts[stopId] = text
      pickFirst = true
      search(stopId, query)
    },
    blur(stopId) {
      delete drafts[stopId]
      if (active === stopId) { active = null; closeSuggestions() }
      notify()
    },
    suggesting: () => hits.length > 0 || searching,
    dispose() { offStore(); stopSearch(); listeners.clear() }
  }
}
