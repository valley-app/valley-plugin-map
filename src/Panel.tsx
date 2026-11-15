import { React, api } from './runtime'
import type { FC } from 'react'
import { useMap } from './hooks'
import { SearchHit, SearchStatus, SharedSearchBox } from './SearchBox'
import { RouteCard } from './RouteCard'
import { formatLatLng } from './format'
import { sameSpot } from './geo'
import type { GeoResult, PanelTab } from './types'
import { uiText } from './localization'
import { ExtensionPanel, SidebarTabs, useSidebarExtensions } from './SidebarTabs'
import { PlacesTab } from './PlacesTab'
import { RoutesTab } from './RoutesTab'
import { PinsTab } from './PinsTab'
import {
  Bookmark,
  Crosshair,
  MapPin,
  RouteIcon,
  Search,
  Star,
  X
} from './icons'

/** The picked search hit — stays on screen until cleared, like Google Maps. */
const PlaceCard: FC<{ result: GeoResult }> = ({ result }) => {
  const { store, snap } = useMap()
  if (!store) return null
  const savedPlace = snap.places.find((p) => sameSpot(p, result))
  // One bookmark, two subjects. With a route on screen the interesting thing to
  // keep is the route — the place is just its endpoint — so the button follows
  // the card that is open rather than sprouting a second save below it.
  const routeMode = snap.directionsOpen && snap.plan !== null
  const saved = routeMode ? snap.savedRouteId !== null : Boolean(savedPlace)
  const saveTitle = saved
    ? routeMode
      ? uiText('auto.ed9e988752fe')
      : uiText('auto.2303581699b6')
    : routeMode
      ? uiText('auto.85804591aab6')
      : uiText('auto.efc007a393f6')
  const toggleSave = (): void => {
    if (routeMode) {
      if (saved) void store.unsaveRoute()
      else void store.saveRoute('')
      return
    }
    if (savedPlace) void store.deletePlace(savedPlace.id)
    else void store.addPlace({ name: result.name, lng: result.lng, lat: result.lat })
  }
  return (
    <div className="map-place-card">
      <div className="map-place-head">
        <span className="map-row-icon"><MapPin /></span>
        <span className="map-place-name" title={result.name}>{result.name}</span>
        <button
          className="map-row-action"
          title={uiText('auto.719ea396ad92')}
          aria-label={uiText('auto.719ea396ad92')}
          onClick={() => store.clearSearch()}
        >
          <X />
        </button>
      </div>
      {result.context && <div className="map-place-sub">{result.context}</div>}
      <div className="map-place-coords">{formatLatLng(result.lat, result.lng)}</div>
      <div className="map-place-actions">
        <button
          className={`map-btn ${snap.directionsOpen ? 'active' : ''}`}
          onClick={() => (snap.directionsOpen ? store.closeDirections() : store.openDirections())}
        >
          <RouteIcon /> {uiText('auto.f814a9fb4687')}</button>
        <button
          className={`map-btn ${saved ? 'active' : ''}`}
          title={saveTitle}
          onClick={toggleSave}
        >
          <Bookmark /> {saved ? uiText('auto.c0ae8f6ea841') : uiText('auto.efc007a393f6')}
        </button>
        <button
          className="map-btn"
          title={uiText('auto.e4ab9c39375b')}
          aria-label={uiText('auto.e4ab9c39375b')}
          onClick={() => store.focus([result.lng, result.lat], 16)}
        >
          <Crosshair />
        </button>
      </div>
      {snap.directionsOpen && (
        <RouteCard variant="panel" title={uiText('auto.51d4754c9d85')} onClose={() => store.closeDirections()} />
      )}
    </div>
  )
}

/** The default tab: one shared search whose result sticks around, plus the map toggles. */
const SearchTab: FC<{ focusToken: number }> = ({ focusToken }) => {
  const { store, snap } = useMap()
  if (!store) return null
  const showResults = !snap.selectedResult && Boolean(snap.searchQuery.trim())
  return (
    <>
    <div className="search-field-row">
      <SharedSearchBox placeholder={uiText('auto.d81a46a31fbd')} inline focusToken={focusToken} />
    </div>
    <div className="map-tab-body">
      {showResults && (
        <div className="map-result-list">
          <SearchStatus busy={snap.searchBusy} error={snap.searchError} results={snap.searchResults} />
          {snap.searchResults.map((r, i) => (
            <SearchHit
              key={`${r.lng},${r.lat},${i}`}
              result={r}
              active={i === snap.searchActiveIndex}
              onPick={() => store.pickSearchResult(r)}
            />
          ))}
        </div>
      )}

      {snap.selectedResult && <PlaceCard result={snap.selectedResult} />}
    </div>
    </>
  )
}

export const Panel: FC = () => {
  const { store, snap } = useMap()
  const extensions = useSidebarExtensions()
  // Bumped only by a click on the Search tab, so opening the panel never steals focus.
  const [searchFocus, setSearchFocus] = React.useState(0)
  // Child effects run first: the field has taken focus by now, so a later remount must not take it again.
  React.useEffect(() => { if (searchFocus) setSearchFocus(0) }, [searchFocus])
  if (!store) return null
  const extension = extensions.find(entry => entry.id === snap.panelTab)
  const active = snap.panelTab.startsWith('extension:') && !extension ? 'search' : snap.panelTab
  const tabs = [
    { id: 'search', icon: <Search />, label: uiText('auto.bce06414177f') },
    { id: 'places', icon: <Star />, label: uiText('auto.0a6622a7d2d8') },
    { id: 'routes', icon: <RouteIcon />, label: uiText('auto.8cb059657347') },
    { id: 'pins', icon: <MapPin />, label: uiText('auto.adc1a3bbeae6') },
    ...extensions.map(({ id, provider }) => ({ id, label: provider.extension.label,
      icon: <svg width="1em" height="1em" viewBox={provider.extension.icon.viewBox} fill="currentColor" aria-hidden="true"><path d={provider.extension.icon.path} /></svg> }))
  ]

  return (
    <div className="panel map-panel">
      <div className="panel-header">
        <span className="panel-title">{uiText('auto.ab478f3efc84')}</span>
        <div className="map-header-actions">
          {snap.locationStatus !== 'off' && (
            <button
              className="map-locate-btn"
              disabled={snap.locationStatus === 'denied' || snap.locationStatus === 'error'}
              onClick={() => store.locateMe()}
              title={snap.locationStatus === 'denied' ? uiText('auto.aed7826804aa')
                : snap.locationStatus === 'error' ? uiText('auto.357e918caa34')
                : snap.locationStatus === 'locating' ? uiText('auto.db98b1470eef') : uiText('auto.08ceae86f774')}
            >{uiText('map.panel.currentLocation')}</button>
          )}
          <button
            className="plugin-open-page"
            onClick={() => api.workspace.openMainTab()}
            aria-label={uiText('auto.e56f29da2af3')}
            title={uiText('auto.e56f29da2af3')}
          />
        </div>
      </div>
      <SidebarTabs tabs={tabs} active={active} onSelect={id => store.setPanelTab(id as PanelTab)}
        onTabClick={id => { if (id === 'search') setSearchFocus(token => token + 1) }} />
      <div className="panel-body hidescrollbar">
        {active === 'search' && <SearchTab focusToken={searchFocus} />}
        {extension && <ExtensionPanel key={`${extension.provider.sessionId}:${extension.id}`} extension={extension.provider.extension} />}

        {snap.panelTab === 'places' && <PlacesTab />}

        {snap.panelTab === 'routes' && <RoutesTab />}

        {snap.panelTab === 'pins' && <PinsTab />}
      </div>
    </div>
  )
}
