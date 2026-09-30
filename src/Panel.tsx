import { React, api } from './runtime'
import type { FC, ReactNode } from 'react'
import { useMap } from './hooks'
import { SearchHit, SearchStatus, SharedSearchBox } from './SearchBox'
import { RouteCard } from './RouteCard'
import { formatDistance, formatLatLng } from './format'
import { sameSpot } from './geo'
import { paletteCssValue } from '@valley/plugin-sdk/palette'
import type { GeoResult, LngLat, PanelTab, PinSource, Place, Route } from './types'
import { uiText } from './localization'
import { ExtensionPanel, SidebarTabs, useSidebarExtensions } from './SidebarTabs'
import {
  ChevronRight,
  GripVertical,
  Bookmark,
  Crosshair,
  ValleyIcon,
  MapPin,
  Pencil,
  PinGlyph,
  Plus,
  RouteIcon,
  Search,
  Star,
  Trash,
  X
} from './icons'

const PlaceRow: FC<{ place: Place; onEdit: () => void }> = ({ place, onEdit }) => {
  const { store, snap } = useMap()
  const active = snap.selectedPlaceId === place.id
  return (
    <div className={`map-row ${active ? 'active' : ''}`} onClick={() => store?.focusPlace(place)} role="button" tabIndex={0}>
      <span className="map-row-icon" style={place.color ? { color: paletteCssValue(place.color) } : undefined}>
        <MapPin />
      </span>
      <span className="map-row-title">{place.name}</span>
      {place.note && (
        <button
          className="map-row-action"
          title={uiText('auto.c66a827e3397')}
          onClick={(e) => {
            e.stopPropagation()
            store?.openNote(place.note as string)
          }}
        >
          <ValleyIcon />
        </button>
      )}
      <button
        className="map-row-action"
        title={uiText('auto.e1746f2c11b3')}
        onClick={(e) => {
          e.stopPropagation()
          onEdit()
        }}
      >
        <Pencil />
      </button>
      <button
        className="map-row-action map-row-danger"
        title={uiText('auto.2303581699b6')}
        onClick={(e) => {
          e.stopPropagation()
          void store?.deletePlace(place.id)
        }}
      >
        <Trash />
      </button>
    </div>
  )
}

/**
 * Add a favourite place by hand, or edit one already saved.
 *
 * Until this existed a place could only be born from a geocoder hit or a map
 * click, and `Place.note` — the document the row's file glyph opens — could only
 * be set from the command bus, so nothing saved through the UI could ever carry
 * one. The address and document fields use the shared resource picker.
 */
export const PlaceForm: FC<{ place?: Place; onClose: () => void }> = ({ place, onClose }) => {
  const { store } = useMap()
  const ResourcePicker = api.ui.ResourcePicker
  const [name, setName] = React.useState(place?.name ?? '')
  const [address, setAddress] = React.useState('')
  const [note, setNote] = React.useState(place?.note ?? '')
  const [category, setCategory] = React.useState(place?.category ?? '')
  const [color, setColor] = React.useState(place?.color ?? '')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState(false)
  const [coords, setCoords] = React.useState<LngLat | null>(place ? [place.lng, place.lat] : null)
  if (!store) return null

  const save = async (): Promise<void> => {
    if (!coords || saving) return
    const [lng, lat] = coords
    const trimmed = name.trim()
    setSaving(true)
    try {
      if (place) await store.updatePlace(place.id, { name: trimmed || place.name, lng, lat, note: note.trim() || undefined, category, color })
      else await store.addPlace({ name: trimmed, lng, lat, note, color })
      onClose()
    } catch { setError(true) } finally { setSaving(false) }
  }

  return (
    <div className="map-place-form">
      <input
        className="map-input"
        placeholder={uiText('auto.8eb815111173')}
        aria-label={uiText('auto.8eb815111173')}
        value={name}
        autoFocus={!place}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save()
          else if (e.key === 'Escape') onClose()
        }}
      />
      <ResourcePicker
        value={address}
        onChange={(value, result) => {
          setAddress(value)
          const lng = Number(result?.metadata?.longitude)
          const lat = Number(result?.metadata?.latitude)
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
          setCoords([lng, lat])
          setName((current) => current.trim() || result?.label || value)
        }}
        kinds={['place']}
        allowCustom={false}
        placeholder={uiText('auto.31cb5751a886')}
        ariaLabel={uiText('auto.31cb5751a886')}
      />
      {coords !== null && <div className="map-place-coords">{formatLatLng(coords[1], coords[0])}</div>}
      <ResourcePicker
        value={note}
        onChange={setNote}
        kinds={['vault-file']}
        allowCustom={false}
        placeholder={uiText('auto.4a8b395d17d7')}
        ariaLabel={uiText('auto.4a8b395d17d7')}
      />
      <div className="map-place-actions">
        <button className="map-btn" onClick={onClose}>{uiText('auto.77dfd2135f4d')}</button>
        <button className="map-btn map-btn-primary" disabled={coords === null || saving} onClick={() => void save()}>{uiText('auto.efc007a393f6')}</button>
      </div>
      {place && <>
        <label>{uiText('surface.category')}<input className="map-input" value={category} onChange={(event) => setCategory(event.target.value)} /></label>
        <label>{uiText('surface.color')}<input className="map-input" value={color} onChange={(event) => setColor(event.target.value)} /></label>
      </>}
      {error && <p role="alert">{uiText('surface.invalid')}</p>}
    </div>
  )
}

const RouteRow: FC<{ route: Route }> = ({ route }) => {
  const { store, snap } = useMap()
  return (
    <div className="map-row" onClick={() => store?.showRoute(route)} role="button" tabIndex={0}>
      <span className="map-row-icon"><RouteIcon /></span>
      <span className="map-row-meta">
        <span className="map-row-title">{route.name}</span>
        <span className="map-row-sub">
          {route.distanceM ? formatDistance(route.distanceM, snap.units) : uiText('auto.9691de79c93c', { p0: route.waypoints.length })}
        </span>
      </span>
      <button
        className="map-row-action map-row-danger"
        title={uiText('auto.520876018815')}
        onClick={(e) => {
          e.stopPropagation()
          void store?.deleteRoute(route.id)
        }}
      >
        <Trash />
      </button>
    </div>
  )
}

const PinSourcesTab: FC = () => {
  const { store, snap } = useMap()
  const [expanded, setExpanded] = React.useState<string[]>([])
  const [error, setError] = React.useState(false)
  const sources = snap.pinSources
  const shown = sources.filter(source => !source.hidden && (snap.sourcePinCounts[source.id] ?? 0) > 0)
  const commit = (next: PinSource[]): void => {
    if (!store?.savePinSources(next)) { setError(true); return }
    void store.flushPinSources().then(() => setError(false)).catch(() => setError(true))
  }
  const reorder = api.ui.settings.useReorderDrag({ items: shown, getId: source => source.id, getLabel: source => source.title, indicatorOnly: true,
    onReorder: next => { const ids = new Set(next.map(source => source.id)); let position = 0; commit(sources.map(source => ids.has(source.id) ? next[position++] : source)) }
  })
  return <div className="map-sidebar-sources">
    <div className="map-sources-header"><span>{uiText('auto.adc1a3bbeae6')}</span><api.ui.settings.Toggle label={uiText('sources.toggleAll')} checked={shown.length > 0 && shown.every(source => source.visible)} disabled={!shown.length} onChange={visible => commit(sources.map(source => source.hidden ? source : { ...source, visible }))} /></div>
    <div className="map-sidebar-list">
    {shown.map(source => <div key={source.id} className="map-source-sortable" {...reorder.getItemProps(source)}>
      <div className="map-sidebar-row">
        <button {...reorder.getHandleProps(source)} className="settings-reorder-handle map-source-grip" title={uiText('sources.reorder')}><GripVertical /></button>
        <button type="button" className="map-source-disclosure" aria-expanded={expanded.includes(source.id)} aria-label={uiText('sources.details', { title: source.title })} onClick={() => setExpanded(ids => ids.includes(source.id) ? ids.filter(id => id !== source.id) : [...ids, source.id])}><ChevronRight /></button>
        <button type="button" className="map-sidebar-focus" onClick={() => store?.focusSource(source.id)}><span className="map-row-icon" style={{ color: paletteCssValue(source.color) }}><PinGlyph id={source.icon} /></span><span className="map-row-title">{source.title || uiText('auto.aa6effbf44cd')}</span></button>
        <span className="map-section-count">{snap.sourcePinCounts[source.id]}</span>
        <api.ui.settings.Toggle checked={source.visible} label={source.title || uiText('auto.aa6effbf44cd')} onChange={visible => commit(sources.map(item => item.id === source.id ? { ...item, visible } : item))} />
      </div>
      {expanded.includes(source.id) && <div className="map-sidebar-details">{source.matchKey && <span>{source.matchKey}: {source.matchValue}</span>}<span>{source.locationField}</span>{source.folder && <span>{source.folder}</span>}<button type="button" onClick={() => api.workspace.openOwnSettings('pins')}>{uiText('pins.edit')}</button></div>}
    </div>)}
    {!shown.length && <div className="map-empty">{uiText('auto.ad479c6c0689')}</div>}
    {reorder.liveRegion}
    </div>
    {error && <p role="alert" className="settings-path-error">{uiText('pins.saveError')}</p>}
  </div>
}

/** A list tab: the section label + count the old collapsible head carried, then
 *  its rows. `action` rides in the head beside the count; `lead` sits above the
 *  rows, so an open form still shows while the list behind it is empty. */
const ListTab: FC<{
  title: string
  count: number
  empty: string
  action?: ReactNode
  lead?: ReactNode
  children: ReactNode
}> = ({ title, count, empty, action, lead, children }) => (
  <>
    <div className="map-tab-head">
      <span>{title}</span>
      <span className="map-section-count">{count}</span>
      {action}
    </div>
    {lead}
    {count === 0 ? <div className="map-empty">{empty}</div> : children}
  </>
)

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
const SearchTab: FC = () => {
  const { store, snap } = useMap()
  if (!store) return null
  const showResults = !snap.selectedResult && Boolean(snap.searchQuery.trim())
  return (
    <>
    <div className="search-field-row">
      <SharedSearchBox placeholder={uiText('auto.d81a46a31fbd')} inline />
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
  // `'new'` is the add form; any other value is the id of the place being edited.
  const [editing, setEditing] = React.useState<string | null>(null)
  const extensions = useSidebarExtensions()
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
        <button
          className="plugin-open-page"
          onClick={() => api.workspace.openMainTab()}
          aria-label={uiText('auto.e56f29da2af3')}
          title={uiText('auto.e56f29da2af3')}
        />
      </div>
      <SidebarTabs tabs={tabs} active={active} onSelect={id => store.setPanelTab(id as PanelTab)} />
      <div className="panel-body hidescrollbar">
        {active === 'search' && <SearchTab />}
        {extension && <ExtensionPanel key={`${extension.provider.sessionId}:${extension.id}`} extension={extension.provider.extension} />}

        {snap.panelTab === 'places' && (
          <ListTab
            title={uiText('auto.0a6622a7d2d8')}
            count={snap.places.length}
            empty={uiText('auto.d0966d990865')}
            action={
              <button
                className="map-row-action map-tab-head-action"
                title={uiText('auto.29c5ff60169d')}
                aria-label={uiText('auto.29c5ff60169d')}
                onClick={() => setEditing((current) => (current === 'new' ? null : 'new'))}
              >
                <Plus />
              </button>
            }
            lead={
              editing === 'new' && <PlaceForm key="new" onClose={() => setEditing(null)} />
            }
          >
            {snap.places.map((p) =>
              editing === p.id ? (
                <PlaceForm key={p.id} place={p} onClose={() => setEditing(null)} />
              ) : (
                <PlaceRow key={p.id} place={p} onEdit={() => { store.selectPlace(p.id); setEditing(p.id) }} />
              )
            )}
          </ListTab>
        )}

        {snap.panelTab === 'routes' && (
          <ListTab title={uiText('auto.8cb059657347')} count={snap.routes.length} empty={uiText('auto.57681b50d3a2')}>
            {snap.routes.map((r) => (
              <RouteRow key={r.id} route={r} />
            ))}
          </ListTab>
        )}

        {snap.panelTab === 'pins' && <PinSourcesTab />}
      </div>
    </div>
  )
}
