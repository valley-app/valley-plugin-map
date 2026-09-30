import { React } from './runtime'
import { METRIC_UNITS } from '@valley/plugin-sdk/units'
import { getStore, type MapSnapshot, type MapStore } from './store'

const EMPTY: MapSnapshot = {
  indexEntries: [],
  loading: true,
  places: [],
  routes: [],
  pins: [],
  pinSources: [],
  sourcePins: [],
  sourcePinCounts: {},
  plannerWaypoints: [],
  plannerMode: 'driving',
  plan: null,
  planning: false,
  planError: null,
  style: 'streets',
  colorMode: 'system',
  resolvedColorMode: 'light',
  selectedPlaceId: null,
  hasMap: false,
  mapboxAvailable: false,
  mapStyleConnections: [],
  clickMode: 'place',
  panelTab: 'search',
  searchQuery: '',
  searchResults: [],
  searchBusy: false,
  searchError: null,
  searchActiveIndex: -1,
  selectedResult: null,
  directionsOpen: false,
  plannerStops: [],
  savedRouteId: null,
  units: METRIC_UNITS,
  liveLocation: null,
  locationStatus: 'off',
  camera: null
}

const noopSubscribe = (): (() => void) => () => {}
const emptySnapshot = (): MapSnapshot => EMPTY

/** Subscribe a view to the window-anchored store (live across hot reloads). */
export function useMap(): { store: MapStore | null; snap: MapSnapshot } {
  const [store] = React.useState(getStore)
  const snap = React.useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getSnapshot : emptySnapshot
  )
  return { store, snap }
}

export function usePinSettings(): { store: MapStore | null; snap: MapSnapshot } {
  const [store] = React.useState(getStore)
  const previous = React.useRef(EMPTY)
  const snapshot = React.useCallback(() => {
    const next = store?.getSnapshot() ?? EMPTY
    const old = previous.current
    if (next.pinSources !== old.pinSources || next.indexEntries !== old.indexEntries || next.sourcePinCounts !== old.sourcePinCounts || next.loading !== old.loading) previous.current = next
    return previous.current
  }, [store])
  const snap = React.useSyncExternalStore(store ? store.subscribe : noopSubscribe, snapshot)
  return { store, snap }
}
