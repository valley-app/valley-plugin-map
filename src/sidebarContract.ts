import { resolveInteropContract, type InteropContract } from '@valley/plugin-sdk'

/** A transport line as a small badge: `IR 36`, `S12`, `B 80`. `kind` picks its look. */
export type MapSidebarBadge = {
  text: string; kind: 'train' | 'regional' | 'bus' | 'tram' | 'ship' | 'cableway' | 'walk' | 'other'
  /** The `IR` and `36` of `IR 36`, so a host can set the category apart (the SBB look draws it italic). */
  category?: string; number?: string
}
/** A preformatted clock time; `expected` and `late` mark a delay the provider reported. */
export type MapSidebarTime = { time: string; expected?: string; late?: boolean }
/** One stop of the journey form. A `location` stop stands for the device's position. */
export type MapSidebarRouteStop = { id: string; role: 'origin' | 'via' | 'destination'; label: string; value: string; placeholder?: string; location?: boolean }
/** One connection card; `run(action)` opens it. A departure-board entry has no arrival. */
export type MapSidebarJourney = {
  id: string; action?: string; badge: MapSidebarBadge; direction: string
  departure: MapSidebarTime; arrival?: MapSidebarTime; changes?: number; duration?: string; platform?: string; note?: string; warn?: boolean
  /** The day it leaves on (`Sonntag, 15.11.2026`); a host puts a day header wherever it changes. */
  day?: string
  /** Where each change sits on the track, as fractions of the trip (0 to 1). */
  stops?: number[]
  /** The provider's occupancy forecast, 1 (low) to 3 (high), per class. Only when the provider supplies it. */
  occupancy?: { first?: number; second?: number }
}
export type MapSidebarCall = { time: MapSidebarTime; name: string; platform?: string }
export type MapSidebarLeg =
  | { kind: 'ride'; badge: MapSidebarBadge; direction: string; from: MapSidebarCall; to: MapSidebarCall; note?: string }
  | { kind: 'walk'; text: string; duration?: string }
/** An opened connection: header plus its legs as a timeline. `back` returns to the list. */
export type MapSidebarJourneyDetail = { title: string; departure: MapSidebarTime; arrival: MapSidebarTime; summary: string; legs: MapSidebarLeg[]; back: string; stops?: number[] }
export type MapSidebarTile = {
  id: string; label: string; detail?: string; action: string; icon?: 'location' | 'origin' | 'destination' | 'station'; active?: boolean; wide?: boolean
  /** A quieter first line above `label` (`Baden` above `Bahnhof West`). */
  place?: string
  /** Mosaic size: one cell, two cells side by side, or two by two. */
  size?: 'small' | 'wide' | 'large'
}
/** The travel date and time of a search. `run(action, { date, time, arrival })` sets it, `run(now)` resets it. */
export type MapSidebarWhen = {
  action: string; now?: string
  /** `YYYY-MM-DD`, `HH:MM` and whether `time` is the arrival. */
  date: string; time: string; arrival: boolean
  /** The date as shown (`So. 15.11.`) and the days the picker offers. */
  label: string; days: { value: string; label: string }[]
  text: { title: string; departure: string; arrival: string; apply: string; now: string; departureShort: string; arrivalShort: string; date: string; close: string }
}

/**
 * What a sidebar tab shows. `fields`, `actions` and `rows` are the original
 * plain form; everything after them is optional and newer, and a tab that sets
 * `segments`, `route`, `journeys`, `journey` or `tiles` is drawn as a journey
 * planner instead. Hosts that predate those keys keep showing the plain form.
 *
 * Planner events arrive through `run`: `segment:<id>`, `input:<stopId>` (with
 * every stop's text in `values`, debounced while typing), `focus:<stopId>`,
 * the route's `submit` and `swap` actions, row, journey and tile actions,
 * `earlier` / `later`, the `when` picker and tile swipes.
 */
export interface MapSidebarSnapshot {
  fields: { id: string; label: string; value: string; placeholder?: string }[]
  actions: { id: string; label: string; disabled?: boolean }[]
  rows: { id: string; title: string; detail?: string; action?: string }[]
  message?: string
  error?: string
  busy?: boolean
  segments?: { id: string; label: string; disabled?: boolean }[]
  segment?: string
  route?: { stops: MapSidebarRouteStop[]; submit?: { action: string; label: string; disabled?: boolean }; swap?: string; caption?: string; when?: MapSidebarWhen }
  rowsTitle?: string
  journeys?: MapSidebarJourney[]
  journey?: MapSidebarJourneyDetail
  tiles?: MapSidebarTile[]
  /** Draw the planner in the provider's own colours and badges; `sbb` is the Swiss timetable look. */
  look?: 'sbb'
  /** Load connections before the first or after the last card. */
  earlier?: { action: string; label: string }
  later?: { action: string; label: string }
  /**
   * Tiles can be swiped from one to another: `run('<tileSwipe>:<fromId>:<toId>')`,
   * with `:<viaId>` added when the pointer rested on a third tile on the way.
   */
  tileSwipe?: string
}

export interface MapSidebarTab {
  id: string
  label: string
  icon: { viewBox: string; path: string }
  getSnapshot(): MapSidebarSnapshot
  subscribe(listener: () => void): () => void
  setActive?(active: boolean): void
  run(action: string, values: Record<string, string>): Promise<void>
}

export const MAP_SIDEBAR_TAB_V1 = resolveInteropContract({
  id: 'map.sidebarTab', kind: 'extension', version: '1.0.0', cardinality: 'many',
  wire: {
    identityKeys: ['id'],
    value: { type: 'object', required: ['id', 'label', 'icon', 'getSnapshot', 'subscribe', 'run'], properties: {
      id: { type: 'string' }, label: { type: 'string' },
      icon: { type: 'object', required: ['viewBox', 'path'], properties: { viewBox: { type: 'string' }, path: { type: 'string' } } },
      setActive: { type: 'function' }, getSnapshot: { type: 'function' }, subscribe: { type: 'function' }, run: { type: 'function' }
    } }
  }
}) as InteropContract<MapSidebarTab, 'extension'>
