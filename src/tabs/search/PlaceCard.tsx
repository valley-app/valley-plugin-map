import { React } from '../../runtime'
import type { FC } from 'react'
import { useMap } from '../../hooks'
import { formatLatLng } from '../../format'
import { fullName } from '../../geocode'
import { sameSpot } from '../../geo'
import type { GeoResult } from '../../types'
import { uiText } from '../../localization'
import { CopyText } from '../../CopyText'
import { Bookmark, Crosshair, MapPin, RouteIcon, X } from '../../icons'

/** The picked search hit — stays on screen until cleared, like Google Maps. */
export const PlaceCard: FC<{ result: GeoResult }> = ({ result }) => {
  const { store, snap } = useMap()
  if (!store) return null
  const savedPlace = snap.places.find((p) => sameSpot(p, result))
  // One bookmark, two subjects. With a route on screen the interesting thing to
  // keep is the route — the place is just its endpoint — so the button follows
  // the planner that is open rather than sprouting a second save below it.
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
  const coords = formatLatLng(result.lat, result.lng)
  return (
    <div className="map-place-card">
      <div className="map-place-head">
        <span className="map-row-icon"><MapPin /></span>
        <span className="map-place-name" title={result.name}>{result.name}</span>
        {/* Without a region line the name is the whole address: its copy sits up here. */}
        {!result.context && <CopyText text={result.name} label={uiText('place.copyAddress')} />}
        <button
          className="map-row-action"
          title={uiText('auto.719ea396ad92')}
          aria-label={uiText('auto.719ea396ad92')}
          onClick={() => store.clearSearch()}
        >
          <X />
        </button>
      </div>
      {result.context && <CopyText className="map-place-sub" text={fullName(result)} label={uiText('place.copyAddress')}>{result.context}</CopyText>}
      <CopyText className="map-place-coords" text={coords} label={uiText('map.copyCoordinates')}>{coords}</CopyText>
      <div className="map-place-actions">
        <button
          className={`map-btn ${snap.directionsOpen ? 'active' : ''}`}
          aria-pressed={snap.directionsOpen}
          onClick={() => (snap.directionsOpen ? store.closeDirections() : store.openDirections())}
        >
          <RouteIcon /> {uiText('auto.f814a9fb4687')}</button>
        <button
          className={`map-btn ${saved ? 'active is-saved' : ''}`}
          aria-pressed={saved}
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
    </div>
  )
}
