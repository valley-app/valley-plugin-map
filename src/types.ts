/** Plugin data types. Persisted shapes are plain JSON (DataRecord-compatible). */

export type TravelMode = 'driving' | 'walking' | 'cycling'

export type AccountMapProvider = `account:${string}:${string}`

export type MapColorMode = 'system' | 'light' | 'dark'

export type MapLayerId = 'streets' | 'satellite' | 'navigation' | 'outdoors'

export type MapStyleId = MapLayerId

export type RoutingProvider = 'osrm' | AccountMapProvider

export type SearchProvider = 'nominatim' | AccountMapProvider

export type ElevationProvider = 'open-elevation' | 'none' | AccountMapProvider

/** How a pin source resolves each matched note's location. */
export type LocationMode = 'address' | 'coordinate'

/** Where a pin's title comes from: the note's filename, or a frontmatter property. */
export type LabelMode = 'filename' | 'property'

/** A `[lng, lat]` pair — the order MapLibre/GeoJSON use everywhere. */
export type LngLat = [number, number]

/** What a click on the map does: save a place, or append a route stop. */
export type ClickMode = 'place' | 'route'

/**
 * The device's own position.
 *
 * Comes from the host (`api.getState().liveLocation`), which gets it from the
 * macOS CoreLocation helper the main process supervises. Purely in-memory: a fix
 * is never written to `data`, so nothing about where the user has been
 * survives the session, and turning the preference off drops the last fix.
 */
export interface LiveLocation {
  lng: number
  lat: number
  /** 68%-confidence radius in metres — drawn as the ring around the dot. */
  accuracy: number
  /** Epoch ms of the fix. */
  ts: number
}

/**
 * Live-location lifecycle. `off` = the preference is off; `denied` = macOS
 * refused, which is a dead end until the user changes Location Services, so the
 * UI must stop asking.
 */
export type LocationStatus = 'off' | 'locating' | 'active' | 'denied' | 'error'

/** Which icon tab the left-sidebar panel shows. */
export type PanelTab = 'search' | 'places' | 'routes' | 'pins' | `extension:${string}:${string}`

/** A saved point of interest. */
export interface Place {
  id: string
  name: string
  lng: number
  lat: number
  /** Optional category tag (e.g. "home", "food"). */
  category?: string
  /** Optional color (CSS string) for the marker. */
  color?: string
  /** Optional `[[wikilink]]` (or vault path) to a related note. */
  note?: string
  createdAt: string
}

/** One stop on a planned route. */
export interface Waypoint {
  lng: number
  lat: number
  /** Human label (place name or geocoded address). */
  label: string
  /** Set when this waypoint came from a saved place. */
  placeId?: string
  /**
   * Set when the stop is the live position rather than something searched for.
   * The stop row renders the translated "Your location" for it — `label` itself
   * stays English, because a waypoint is a stored record and stored fields are
   * never translated.
   */
  fromLiveLocation?: boolean
}

/** A saved, named route. */
export interface Route {
  id: string
  name: string
  mode: TravelMode
  waypoints: Waypoint[]
  /** Route geometry as `[lng,lat]` coordinates (the road-snapped line). */
  geometry?: LngLat[]
  /** Total distance in metres. */
  distanceM?: number
  /** Total duration in seconds. */
  durationS?: number
  /** Optional `[[wikilink]]` to a related note. */
  note?: string
  createdAt: string
}

/** One turn-by-turn maneuver along a route. */
export interface RouteStep {
  /** Human-readable instruction, e.g. "Turn left onto Bahnhofstrasse". */
  instruction: string
  /** Length of this step in metres. */
  distanceM: number
  /** Duration of this step in seconds. */
  durationS: number
  /** Road/street name for this step, when the provider supplies one. */
  name?: string
}

/** One sampled point of an elevation profile. */
export interface ElevationPoint {
  /** Cumulative distance along the route in metres. */
  distanceM: number
  /** Elevation in metres. */
  elevationM: number
}

/** A computed route plan (geometry + metrics + optional elevation). */
export interface RoutePlan {
  geometry: LngLat[]
  distanceM: number
  durationS: number
  profile?: ElevationPoint[]
  /** Cumulative ascent / descent in metres, when a profile is present. */
  ascentM?: number
  descentM?: number
  /** Turn-by-turn maneuvers, when the routing provider returns them. */
  steps?: RouteStep[]
  /** Where the router snapped each waypoint — where the A/B markers belong. */
  snapped?: LngLat[]
  /** True when the profile server was unreachable and a car route stood in. */
  modeApproximated?: boolean
}

/** A pin derived from a vault note's frontmatter coordinates. */
export interface GeoPin {
  relPath: string
  title: string
  lng: number
  lat: number
}

/**
 * A user-configured "pin source": scrape every note whose frontmatter
 * `matchKey` equals `matchValue` (e.g. `type: contact`), resolve a location
 * (per `locationMode`: geocode `locationField`, or read `lat,lng` from it) and
 * drop a styled pin. Persisted in the plugin's `pin_sources` dataset and written
 * only through `MapStore.savePinSources`
 * so the settings pane, the sidebar and the map cannot hold different lists.
 */
export interface PinSource {
  id: string
  /** Display name — shown in the sidebar group and the settings row. */
  title: string
  /** Frontmatter key to match on (e.g. "type"). */
  matchKey: string
  /** Value `matchKey` must equal, compared case-insensitively (e.g. "contact"). */
  matchValue: string
  /** Optional vault-relative folder the notes must live under. */
  folder?: string
  /** Whether `locationField` holds an address to geocode or a "lat,lng" coordinate. */
  locationMode: LocationMode
  /** Frontmatter key holding the location — an address (geocoded) or a "lat,lng" coordinate. */
  locationField: string
  /** Whether the pin title is the note's filename or a frontmatter property. */
  labelMode: LabelMode
  /** Frontmatter key used as the pin title when `labelMode` is 'property'. */
  labelField?: string
  /** Frontmatter keys shown in the hover popup, in order. */
  hoverFields: string[]
  /** Marker fill color (CSS string). */
  color: string
  /** Marker outline color (CSS string). */
  borderColor: string
  /** Glyph id drawn inside the marker (see `glyphFor` in icons.tsx). */
  icon: string
  /** When false, the source's pins are hidden on the map (toggled by the sidebar eye). */
  visible: boolean
  /** When true, the source is hidden entirely from the map sidebar list. */
  hidden: boolean
}

/** A resolved, on-map pin for a note matched by a {@link PinSource}. */
export interface NotePin {
  relPath: string
  sourceId: string
  title: string
  lng: number
  lat: number
  color: string
  borderColor: string
  icon: string
  iconSvg?: string
  /** Resolved hover fields (present values only), in the source's order. */
  fields: { key: string; value: string }[]
}

/** Resolved plugin settings (parsed from the manifest `settingsSchema`). */
export interface MapSettings {
  defaultStyle: MapStyleId
  basemapProvider: 'free' | AccountMapProvider
  defaultCenter: LngLat
  defaultZoom: number
  mapboxEnabled: boolean
  openRouteServiceEnabled: boolean
  mapboxConnectionId: string
  openRouteServiceConnectionId: string
  searchProvider: SearchProvider
  routingProvider: RoutingProvider
  elevationProvider: ElevationProvider
  offlineBasemapPath: string
}

/** A geocoder search hit. */
export interface GeoResult {
  name: string
  lng: number
  lat: number
  /** Region/country under the name, split off by the geocoder parsers. May be absent. */
  context?: string
}
