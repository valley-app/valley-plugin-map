import type { ValleyPluginApi } from '@valley/plugin-sdk'
import { api, captureMapRenderOwner } from './runtime'
import type { MapEngine } from './mapEngine'
import { hostAppearance, observeHostAppearance } from './mapStyle'
import { createMapEngine } from './island'
import { getStore } from './store'
import { mapPresentationSettings, parseMapPresentation } from './settings'
import { parseLatLngPair } from './pins'
import { isValidLngLat } from './geo'
import { Plus, Minus } from './icons'
import { uiText } from './localization'
import type { LngLat, Place } from './types'

export interface MapFence {
  center: LngLat
  zoom: number
  label?: string
}

/**
 * Parse a ```map fence body. Accepts a saved place by name (`place: Café X`),
 * or a `lat,lng[,zoom]` coordinate, plus an optional `zoom: N` line. Pure.
 */
export function parseMapFence(code: string, lookupPlace?: (name: string) => LngLat | null): MapFence | null {
  const lines = code
    .split(/\r?\n/)
    .map((l) => l.split('|')[0].trim())
    .filter(Boolean)
  if (lines.length === 0) return null

  let zoom = 13
  let label: string | undefined
  let center: LngLat | null = null

  for (const line of lines) {
    const zoomMatch = /^zoom\s*[:=]\s*(\d+(?:\.\d+)?)/i.exec(line)
    if (zoomMatch) {
      zoom = Math.min(20, Math.max(0, Number(zoomMatch[1])))
      continue
    }
    const placeMatch = /^place\s*[:=]\s*(.+)$/i.exec(line)
    if (placeMatch && lookupPlace) {
      const hit = lookupPlace(placeMatch[1].trim())
      if (hit) {
        center = hit
        label = placeMatch[1].trim()
      }
      continue
    }
    if (!center) {
      const coordinates = line.replace(/[a-z]+\s*[:=]\s*/gi, '').trim()
      const nums = coordinates.split(/[,;\s]+/).map(Number)
      const hasZoom = nums.length === 3 && nums.every(Number.isFinite)
      const pair = parseLatLngPair(hasZoom ? nums.slice(0, 2).join(',') : coordinates)
      if (pair && isValidLngLat(pair.lng, pair.lat)) {
        center = [pair.lng, pair.lat]
        // A trailing third number on the same line is a zoom hint.
        if (hasZoom) zoom = Math.min(20, Math.max(0, nums[2]))
      }
    }
  }

  if (!center) return null
  return { center, zoom, label }
}

/** Center + zoom that frame every saved place (simple bounding-box fit). */
export function overviewView(places: Place[]): { center: LngLat; zoom: number } | null {
  if (places.length === 0) return null
  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const place of places) {
    minLng = Math.min(minLng, place.lng)
    maxLng = Math.max(maxLng, place.lng)
    minLat = Math.min(minLat, place.lat)
    maxLat = Math.max(maxLat, place.lat)
  }
  const center: LngLat = [(minLng + maxLng) / 2, (minLat + maxLat) / 2]
  if (places.length === 1) return { center, zoom: 13 }
  const span = Math.max(maxLng - minLng, (maxLat - minLat) * 1.6, 0.005)
  const zoom = Math.min(15, Math.max(1, Math.floor(Math.log2(360 / span)) - 1))
  return { center, zoom }
}

/**
 * Reading-view renderer for ```map fences. Lazily mounts a small interactive
 * MapLibre map when the block scrolls into view (WebGL contexts are scarce), and
 * tears it down on cleanup.
 */
export function renderMapFence(code: string, el: HTMLElement, source: ValleyPluginApi = api, meta = ''): void | (() => void) {
  const owner = captureMapRenderOwner(source)
  const store = getStore(source)
  const places = store?.getSnapshot().places ?? []
  const lookup = (name: string): LngLat | null => {
    const hit = places.find((p) => p.name.toLowerCase() === name.toLowerCase())
    return hit ? [hit.lng, hit.lat] : null
  }
  // Empty body (or `places: all`) → overview of every saved place.
  const overview = /^\s*$/.test(code) || /^\s*places\s*[:=]\s*all\s*(?:\|.*)?$/im.test(code)
  const fence = overview ? null : parseMapFence(code, lookup)
  const overviewFit = overview ? overviewView(places) : null
  if (!fence && !overviewFit) {
    el.classList.add('map-embed', 'map-embed-error')
    el.textContent = overview
      ? 'No saved places yet — pin some on the Map page, or use "lat, lng" / "place: Name".'
      : 'Invalid map block — use "lat, lng", "place: Name", or leave empty for all places.'
    return
  }

  el.classList.add('map-embed')
  if (fence?.label) {
    const caption = el.ownerDocument.createElement('div')
    caption.className = 'map-embed-label'
    caption.textContent = fence.label
    el.appendChild(caption)
  }

  const overrides = parseMapPresentation(`${code}\n${meta}`)
  const presentation = () => mapPresentationSettings(source.settings.get(), 'codeBlock', overrides, store?.getSnapshot().mapStyleConnections ?? [])
  let { settings, theme: colorMode } = presentation()
  const theme = () => colorMode === 'system' ? hostAppearance(el.ownerDocument) ?? 'dark' : colorMode
  const view = fence ?? overviewFit!
  let engine: MapEngine | null = null
  let disposed = false
  let mounting = false
  const lifetime = new AbortController()
  const controls = el.ownerDocument.createElement('div')
  controls.className = 'map-overlay map-overlay-controls'
  el.appendChild(controls)
  const disposeControls = source.ui.renderReact(controls, source.React.createElement(source.React.Fragment, null,
    source.React.createElement('button', { type: 'button', className: 'map-round-btn', 'aria-label': uiText('auto.4fc05f2763ba'), title: uiText('auto.4fc05f2763ba'), onClick: () => engine?.zoomBy(1) }, source.React.createElement(Plus)),
    source.React.createElement('button', { type: 'button', className: 'map-round-btn', 'aria-label': uiText('auto.a4ae4b24a1f5'), title: uiText('auto.a4ae4b24a1f5'), onClick: () => engine?.zoomBy(-1) }, source.React.createElement(Minus))))

  const mount = (): void => {
    if (engine || mounting || disposed) return
    mounting = true
    void createMapEngine({
      container: el,
      settings,
      theme: theme(),
      style: settings.defaultStyle,
      camera: { center: view.center, zoom: view.zoom, bearing: 0, pitch: 0 },
      interactive: true,
      scrollZoom: false,
      retainSnapshot: true,
      showControls: false,
      onReady: () => {
        if (fence) {
          engine?.setPlaces([
            { id: 'embed', name: fence.label ?? '', lng: fence.center[0], lat: fence.center[1], createdAt: '' }
          ])
        } else if (overviewFit) {
          engine?.setPlaces(places)
        }
      }
    }, source, lifetime.signal).then((value) => { if (disposed) value.destroy(); else engine = value }).catch((error) => { if (!disposed) el.textContent = error instanceof Error ? error.message : String(error) })
  }

  let previous = ''
  const refresh = (): void => {
    const next = presentation()
    settings = next.settings
    colorMode = next.theme
    const key = JSON.stringify([settings, theme()])
    if (key !== previous) engine?.setStyle(settings.defaultStyle, theme(), settings)
    previous = key
  }
  const offSettings = source.settings.subscribe(refresh)
  const offAppearance = observeHostAppearance(el.ownerDocument, refresh)
  const offStore = store?.subscribe(refresh)
  const Observer = el.ownerDocument.defaultView?.IntersectionObserver ?? IntersectionObserver
  const io = new Observer((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      mount()
      io.disconnect()
    }
  })
  io.observe(el)

  const close = (): void => {
    if (disposed) return
    disposed = true
    lifetime.abort()
    offSettings()
    offAppearance()
    offStore?.()
    io.disconnect()
    disposeControls()
    controls.remove()
    engine?.destroy()
    engine = null
  }
  const offOwner = owner.onDispose(close)
  return () => { offOwner(); close() }
}
