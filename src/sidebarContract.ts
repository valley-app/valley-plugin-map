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
  /** A reported delay (`+1′`), drawn in its own column on a departure board. */
  delay?: string
  /** The departure leaves from another platform than planned. */
  platformChanged?: boolean
}
export type MapSidebarCall = { time: MapSidebarTime; name: string; platform?: string }
/** An occupancy forecast per class, 1 (low) to 3 (high); only the classes the provider supplies. */
export type MapSidebarOccupancy = { first?: number; second?: number }
/**
 * A ride leg; `action` opens the ride's run (`ride` on the snapshot), `occupancy` is the provider's forecast
 * for the whole leg.
 */
export type MapSidebarLeg =
  | { kind: 'ride'; badge: MapSidebarBadge; direction: string; from: MapSidebarCall; to: MapSidebarCall; note?: string; action?: string; occupancy?: MapSidebarOccupancy }
  | { kind: 'walk'; text: string; duration?: string }
/** Notes under a detail: a title, one line per item (`level` 1 to 3 draws that occupancy before the text) and a closing note. */
export type MapSidebarLegend = { title: string; items: { level?: number; text: string }[]; note?: string }
/** An opened connection: header plus its legs as a timeline. `back` returns to the list. */
export type MapSidebarJourneyDetail = { title: string; departure: MapSidebarTime; arrival: MapSidebarTime; summary: string; legs: MapSidebarLeg[]; back: string; stops?: number[]; legend?: MapSidebarLegend }
/**
 * One stop of a ride's run: where the traveller boards, alights, rides past (`pass`) or a stop after
 * alighting (`after`); a stop without a role lies outside the traveller's part too. Only one time at the
 * first and last stop; `occupancy` only when the provider supplies it for that stop.
 */
export type MapSidebarRideStop = { name: string; arrival?: MapSidebarTime; departure?: MapSidebarTime; platform?: string; role?: 'board' | 'alight' | 'pass' | 'after'; occupancy?: MapSidebarOccupancy }
/**
 * A ride's run, opened from a ride leg's `action`, shown instead of the opened connection: `title` in the
 * back bar, a header (badge, the train `number` when it differs from the line, `direction`, the leg's
 * `occupancy`) and every stop the provider supplies. `back` returns to the connection.
 */
export type MapSidebarRide = { title: string; back: string; badge: MapSidebarBadge; number?: string; direction?: string; occupancy?: MapSidebarOccupancy; stops: MapSidebarRideStop[]; legend?: MapSidebarLegend }
export type MapSidebarTile = {
  id: string; label: string; detail?: string; action: string; icon?: 'location' | 'origin' | 'destination' | 'station'; active?: boolean; wide?: boolean
  /** A quieter first line above `label` (`Baden` above `Bahnhof West`). */
  place?: string
  /** Mosaic size: one cell, two cells side by side, or two by two. */
  size?: 'small' | 'wide' | 'large'
  /** An explicit place on a four-column grid (1-based column and row, span in cells); placed tiles may leave empty cells and win over `size`. */
  column?: number; row?: number; columns?: number; rows?: number
}
/** The travel date and time of a search. `run(action, { date, time, arrival })` sets it, `run(now)` resets it. */
export type MapSidebarWhen = {
  action: string; now?: string
  /** `YYYY-MM-DD`, `HH:MM` and whether `time` is the arrival. */
  date: string; time: string; arrival: boolean
  /** The date as shown (`So. 15.11.`) and the days a plugin-drawn picker offered; hosts with date fields ignore them. */
  label?: string; days?: { value: string; label: string }[]
  /** The picker design the provider wants for its date and time fields; hosts without that choice ignore it. */
  picker?: 'grid' | 'wheel'
  /** Without `departure` and `arrival` texts the host offers no departure/arrival choice. */
  text: { departure?: string; arrival?: string; now: string; date: string; time?: string; title?: string; apply?: string; departureShort?: string; arrivalShort?: string; close?: string }
}
/** A WGS84 position as `[lng, lat]`. */
export type MapSidebarPoint = [number, number]
/** One line on the map: straight segments through `points` in order, with a stop mark at each of `stops`; `stopNames[i]` names `stops[i]`. */
export type MapSidebarPath = { points: MapSidebarPoint[]; color?: string; stops?: MapSidebarPoint[]; stopNames?: string[] }
/** A point the map marks: the start or end of a path, a change between two paths, or a single station. */
export type MapSidebarMarker = { lng: number; lat: number; label?: string; kind?: 'origin' | 'destination' | 'station' | 'change' }
/**
 * What the map shows for the tab while it is open, drawn under the host's own
 * route plan and never saved. `color` is a `#rrggbb` colour for the markers and
 * for paths without their own. The map fits everything shown whenever `fit`
 * changes. Hosts draw at most 8 paths of 2000 points (500 stops) and 64 markers,
 * and show stop and marker names on hover or click. `attribution` credits the
 * data a path is drawn from (`© OpenStreetMap contributors`) in the map's attribution.
 */
export type MapSidebarOverlay = { paths?: MapSidebarPath[]; markers?: MapSidebarMarker[]; color?: string; fit?: string; attribution?: string }

/**
 * What a sidebar tab shows. `fields`, `actions` and `rows` are the original
 * plain form; everything after them is optional and newer, and a tab that sets
 * `segments`, `route`, `journeys`, `journey`, `ride` or `tiles` is drawn as a journey
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
  /** `reorder`: stops can be dragged; `run('<reorder>:<stopId>:<index>')`, the index counted over the stops that are not an empty via row. */
  route?: { stops: MapSidebarRouteStop[]; submit?: { action: string; label: string; disabled?: boolean }; swap?: string; caption?: string; when?: MapSidebarWhen; reorder?: string }
  rowsTitle?: string
  journeys?: MapSidebarJourney[]
  journey?: MapSidebarJourneyDetail
  /** A ride's run, drawn instead of `journey` while set. */
  ride?: MapSidebarRide
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
  /** The glyph of the result rows (station suggestions), drawn in the look's icon colour; the host's pin otherwise. */
  rowIcon?: { viewBox: string; path: string; fillRule?: 'evenodd' | 'nonzero' }
  /** Lines and markers the map draws while the tab is open; leave it out when there is nothing to show. */
  overlay?: MapSidebarOverlay
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
