import type { MainWorkspaceViewProps } from '@valley/plugin-sdk'
import { publishMapDetails } from './workspaceDetails'
import { React, api, captureMapRenderOwner } from './runtime'
import type { FC } from 'react'
import { useMap } from './hooks'
import type { MapEngine } from './mapEngine'
import { hostAppearance, observeHostAppearance } from './mapStyle'
import { createMapEngine } from './island'
import { SharedSearchBox } from './SearchBox'
import { formatLatLng } from './format'
import type { LngLat, MapLayerId } from './types'
import { mapLayers } from './settings'
import {
  Compass,
  Crosshair,
  Layers,
  MapPin,
  Minus,
  Moon,
  Mountain,
  Navigation,
  Plus,
  Road,
  Satellite,
  Search,
  Sun,
  X
} from './icons'
import { uiText } from './localization'
import type { ReactElement } from 'react'

/** The map's layer picker — every basemap, as circles under the layers button. */
const LAYER_ICONS: Record<MapLayerId, () => ReactElement> = {
  streets: () => <Road />,
  satellite: () => <Satellite />,
  navigation: () => <Navigation />,
  outdoors: () => <Mountain />
}
export const Page: FC<MainWorkspaceViewProps> = ({ instanceId }) => {
  const [owner] = React.useState(() => captureMapRenderOwner(api))
  const { store, snap } = useMap()
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const engineRef = React.useRef<MapEngine | null>(null)
  const [pending, setPending] = React.useState<{ lng: number; lat: number; name: string } | null>(null)
  const [placeName, setPlaceName] = React.useState('')
  const [liveCamera, setCamera] = React.useState<{ lng: number; lat: number } | null>(null)
  const camera = liveCamera ?? snap.camera
  const [detailCamera, setDetailCamera] = React.useState(snap.camera)
  React.useEffect(() => publishMapDetails(owner.api, { instanceId }, detailCamera ?? snap.camera), [owner, instanceId, detailCamera, snap.camera])
  React.useEffect(() => {
    const doc = containerRef.current?.ownerDocument
    if (!doc || !store) return
    store.setHostAppearance(hostAppearance(doc))
    return observeHostAppearance(doc, mode => store.setHostAppearance(mode))
  }, [store])
  // The map control only flips Light ↔ Dark from what is on screen; System lives
  // in the sidebar's Map mode field, which reads the same `colorMode`.
  const nextColorMode = snap.resolvedColorMode === 'dark' ? 'light' : 'dark'
  const colorModeAction = uiText(nextColorMode === 'dark' ? 'style.switchToDark' : 'style.switchToLight')
  /** True while the camera is rotated or tilted — gates the compass button. */
  const [tilted, setTilted] = React.useState(false)
  const [layersOpen, setLayersOpen] = React.useState(false)
  const layersRef = React.useRef<HTMLDivElement | null>(null)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const searchRef = React.useRef<HTMLDivElement | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const noticeTimer = React.useRef<number | null>(null)
  /** Transient banner — a locked control must say why it did nothing. */
  const flashNotice = React.useCallback((message: string): void => {
    setNotice(message)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => {
      setNotice(null)
      noticeTimer.current = null
    }, 7000)
  }, [])

  // A location attempt that fails has to say so on its own. The failure arrives
  // asynchronously — often as a timeout many seconds after the click — so
  // without this the button simply stops claiming it is looking and nothing
  // else ever happens.
  const locationStatus = snap.locationStatus
  const lastLocationStatus = React.useRef(locationStatus)
  React.useEffect(() => {
    const previous = lastLocationStatus.current
    lastLocationStatus.current = locationStatus
    if (locationStatus === previous) return
    if (locationStatus === 'denied') flashNotice(uiText('auto.aed7826804aa'))
    else if (locationStatus === 'error') flashNotice(uiText('auto.357e918caa34'))
  }, [flashNotice, locationStatus])

  // Both map popovers (layer picker, search pill) close on Escape or a click
  // that lands outside them.
  React.useEffect(() => {
    if (!layersOpen && !searchOpen) return
    const view = containerRef.current?.ownerDocument.defaultView
    if (!view) return
    const close = (e: Event): void => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return
      const inside = (ref: HTMLDivElement | null): boolean =>
        e.type === 'pointerdown' && Boolean(ref?.contains(e.target as Node))
      if (!inside(layersRef.current)) setLayersOpen(false)
      if (!inside(searchRef.current)) setSearchOpen(false)
    }
    view.addEventListener('pointerdown', close, true)
    view.addEventListener('keydown', close)
    return () => {
      view.removeEventListener('pointerdown', close, true)
      view.removeEventListener('keydown', close)
    }
  }, [layersOpen, searchOpen])

  // Hold the map until the remembered camera + basemap have been read off disk.
  // Building it earlier paints the settings default for a few frames and then
  // jumps, which reads as the map flying across the world on every reload. The
  // wait is one file read, and `loading` always clears (even on a failed read).
  const ready = Boolean(store) && !snap.loading

  React.useEffect(() => {
    const container = containerRef.current
    if (!container || !store || !ready || !owner.isActive()) return
    let disposed = false
    const lookups = new AbortController()
    let cleanup: (() => void) | undefined
    void createMapEngine({
      container,
      settings: store.settings(),
      theme: store.resolvedColorMode(),
      style: store.getSnapshot().style,
      units: store.getSnapshot().units,
      // The saved camera goes in at construction, not as a later `jumpTo`.
      camera: store.savedCamera() ?? undefined,
      // The page draws its own round zoom/layer controls (below); the scale bar stays.
      showZoom: false,
      onReady: () => store.onMapReady(),
      onError: error => { if (!disposed) flashNotice(error instanceof Error ? error.message : String(error)) },
      onClick: (lngLat: LngLat) => {
        // Read the mode off the store, not a ref: the sidebar chip can flip it
        // while this engine stays mounted.
        if (store.getSnapshot().clickMode === 'route') {
          void store.lookupAddress(lngLat[0], lngLat[1], lookups.signal).then((name) => {
            if (!disposed) store.addWaypoint({ lng: lngLat[0], lat: lngLat[1], label: name ?? formatLatLng(lngLat[1], lngLat[0]) })
          }).catch(() => {})
        } else {
          setPending({ lng: lngLat[0], lat: lngLat[1], name: '' })
          setPlaceName('')
          void store.lookupAddress(lngLat[0], lngLat[1], lookups.signal).then((name) => {
            if (!disposed && name) {
              setPending((cur) => (cur && cur.lng === lngLat[0] && cur.lat === lngLat[1] ? { ...cur, name } : cur))
              setPlaceName((cur) => cur || name)
            }
          }).catch(() => {})
        }
      },
      onPlaceClick: (id: string) => {
        const place = store.getSnapshot().places.find((p) => p.id === id)
        if (place) store.focusPlace(place)
      },
      onPinClick: (relPath: string) => owner.api.workspace.openFile(relPath),
      onCameraChange: ({ center, zoom, bearing, pitch }) => {
        setCamera({ lng: center[0], lat: center[1] })
        setDetailCamera({ lng: center[0], lat: center[1], zoom, bearing, pitch })
        setTilted(bearing !== 0 || pitch !== 0)
        store.rememberView(center, zoom, bearing, pitch)
      }
    }, owner.api, lookups.signal).then((engine) => {
    if (disposed) { engine.destroy(); return }
    engineRef.current = engine
    store.attachMap(engine)

    cleanup = () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
      noticeTimer.current = null
      store.detachMap(engine)
      engine.destroy()
      engineRef.current = null
    }
    }).catch((error) => { if (!disposed) flashNotice(error instanceof Error ? error.message : String(error)) })
    const close = (): void => { if (!disposed) { disposed = true; lookups.abort(); cleanup?.() } }
    const offOwner = owner.onDispose(close)
    return () => { offOwner(); close() }
  }, [owner, ready, store, flashNotice])

  if (!store) return null

  // 'denied' and 'error' keep the button — pressing it is how the user finds out
  // *why* nothing happened (the notice), which a hidden or disabled control
  // cannot tell them.
  const locationBlocked = snap.locationStatus === 'denied' || snap.locationStatus === 'error'
  const locateLabel =
    snap.locationStatus === 'locating' ? uiText('auto.db98b1470eef') : uiText('auto.08ceae86f774')

  const savePending = (): void => {
    if (!pending) return
    void store.addPlace({ name: placeName.trim() || pending.name || 'New place', lng: pending.lng, lat: pending.lat })
    setPending(null)
    setPlaceName('')
  }


  return (
    <div className="map-page">
      <div className="map-topbar">
        <span className="map-topbar-name">
          {camera ? formatLatLng(camera.lat, camera.lng) : uiText('auto.ab478f3efc84')}
        </span>
      </div>

      <div className="map-body">
        <div className="map-canvas" ref={containerRef} />

        {/* One capsule: the circle is its left cap and never moves, the input
            grows out of its right side. */}
        <div className={`map-overlay map-overlay-top ${searchOpen ? 'is-open' : ''}`} ref={searchRef}>
          <button
            className={`map-round-btn ${searchOpen ? 'active' : ''}`}
            onClick={() => setSearchOpen((v) => !v)}
            aria-label={uiText('auto.d81a46a31fbd')}
            aria-expanded={searchOpen}
            title={uiText('auto.d81a46a31fbd')}
          >
            <Search />
          </button>
          {searchOpen && (
            <div className="map-search-pill">
              <SharedSearchBox placeholder={uiText('auto.d81a46a31fbd')} autoFocus hideIcon />
            </div>
          )}
        </div>

        {/* Sideways: this is a vertical stack against the right edge, so a hint
            under a button lands on top of the next one. */}
        <div className="map-overlay map-overlay-controls" data-tooltip-placement="left">
          {/* Only exists while "Allow live location" is on — a permanently dead
              locate button would be an invitation to press something that the
              preference has already answered. */}
          {snap.locationStatus !== 'off' && (
            <button
              className={`map-round-btn ${snap.locationStatus === 'active' ? 'active' : ''} ${locationBlocked ? 'is-locked' : ''}`}
              onClick={() => {
                if (snap.locationStatus === 'denied') flashNotice(uiText('auto.aed7826804aa'))
                else if (snap.locationStatus === 'error') flashNotice(uiText('auto.357e918caa34'))
                else store.locateMe()
              }}
              aria-label={locateLabel}
              title={locateLabel}
            >
              <Crosshair />
            </button>
          )}
          {/* Bearing and pitch now survive a reload, so a rotated map needs a way
              back — there is no MapLibre compass here (`showZoom:false`). */}
          {tilted && (
            <button
              className="map-round-btn"
              onClick={() => engineRef.current?.resetNorth()}
              aria-label={uiText('auto.4651f9e72c5b')}
              title={uiText('auto.4651f9e72c5b')}
            >
              <Compass />
            </button>
          )}
          <button
            className="map-round-btn"
            onClick={() => engineRef.current?.zoomBy(1)}
            aria-label={uiText('auto.4fc05f2763ba')}
            title={uiText('auto.4fc05f2763ba')}
          >
            <Plus />
          </button>
          <button
            className="map-round-btn"
            onClick={() => engineRef.current?.zoomBy(-1)}
            aria-label={uiText('auto.a4ae4b24a1f5')}
            title={uiText('auto.a4ae4b24a1f5')}
          >
            <Minus />
          </button>
          <button
            className="map-round-btn"
            onClick={() => store.setColorMode(nextColorMode)}
            disabled={Boolean(store.settings().offlineBasemapPath)}
            aria-label={colorModeAction}
            title={colorModeAction}
          >
            {snap.resolvedColorMode === 'dark' ? <Moon /> : <Sun />}
          </button>
          <div className="map-layers" ref={layersRef}>
            <button
              className={`map-round-btn ${layersOpen ? 'active' : ''}`}
              onClick={() => setLayersOpen((v) => !v)}
              aria-label={uiText('auto.385a0fa0151d')}
              aria-expanded={layersOpen}
              title={uiText('auto.385a0fa0151d')}
            >
              <Layers />
            </button>
            {layersOpen && (
              <div className="map-layers-pop">
                {mapLayers(store.settings()).map((choice) => {
                  return (
                    <button
                      key={choice.id}
                      className={`map-round-btn ${snap.style === choice.id ? 'active' : ''}`}
                      // Picking a style never closes the stack — only the layers
                      // button or a click outside does.
                      onClick={() => store.setStyle(choice.id)}
                      aria-label={uiText(choice.labelKey)}
                      aria-pressed={snap.style === choice.id}
                      title={uiText(choice.labelKey)}
                    >
                      {LAYER_ICONS[choice.id]()}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

      {notice && (
        <div className="map-overlay map-overlay-notice" role="status">
          <div className="map-overlay-card map-notice-card">
            <span className="map-notice-text">{notice}</span>
            <button className="map-btn" onClick={() => api.workspace.openOwnSettings()}>
              {uiText('auto.fd7108f8312a')}</button>
            <button
              className="map-row-action"
              aria-label={uiText('auto.70afe9eff3f2')}
              title={uiText('auto.70afe9eff3f2')}
              onClick={() => setNotice(null)}
            >
              <X />
            </button>
          </div>
        </div>
      )}

      {pending && (
        <div className="map-overlay map-overlay-save">
          <div className="map-overlay-card map-save-card">
            <div className="map-save-head">
              <span className="map-save-icon"><MapPin /></span>
              <span className="map-save-coords">{formatLatLng(pending.lat, pending.lng)}</span>
              <button className="map-row-action" title={uiText('auto.77dfd2135f4d')} onClick={() => setPending(null)}>
                <X />
              </button>
            </div>
            <input
              className="map-input"
              placeholder={uiText('auto.8eb815111173')}
              value={placeName}
              autoFocus
              onChange={(e) => setPlaceName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') savePending()
                else if (e.key === 'Escape') setPending(null)
              }}
            />
            <button className="map-btn map-btn-primary" onClick={savePending}>
              <Crosshair /> {uiText('auto.e394ba2e21d7')}</button>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
