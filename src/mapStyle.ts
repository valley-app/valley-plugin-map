import type { StyleSpecification } from 'maplibre-gl'
import type { MapColorMode, MapSettings, MapStyleId } from './types'
import { effectiveBasemapProvider, mapLayer, parseAccountProviderChoice } from './settings'

export type ThemeMode = Exclude<MapColorMode, 'system'>

/** Valley's effective appearance as the host applies it to a sandboxed document:
 *  its `color-scheme`, which already includes a footer override of System. */
export function hostAppearance(doc: Document): ThemeMode | null {
  const root = doc.documentElement
  const scheme = root.style.colorScheme.trim() || root.getAttribute('data-theme') || ''
  return scheme === 'dark' || scheme === 'light' ? scheme : null
}

/** Calls back whenever the host changes that appearance. */
export function observeHostAppearance(doc: Document, onChange: (mode: ThemeMode | null) => void): () => void {
  const Observer = doc.defaultView?.MutationObserver ?? MutationObserver
  const observer = new Observer(() => onChange(hostAppearance(doc)))
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme'] })
  return () => observer.disconnect()
}

// CARTO's free GL vector styles pair perfectly with the app's light/dark themes.
// Tiles, glyphs and sprites are fetched by the package backend.
// Voyager, not Positron: Positron is a deliberately near-white canvas built to
// sit *under* data, so on its own it reads as a washed-out white sheet. Voyager
// keeps the same light footing but colours roads, water and green space.
const CARTO_LIGHT = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
const CARTO_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const ESRI_IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

function rasterStyle(tiles: string[], attribution: string, dimmed = false): StyleSpecification {
  return {
    version: 8,
    sources: { base: { type: 'raster', tiles, tileSize: 256, attribution } },
    layers: [{ id: 'base', type: 'raster', source: 'base', ...(dimmed ? {
      paint: { 'raster-brightness-max': 0.55, 'raster-saturation': -0.25 }
    } : {}) }]
  } as unknown as StyleSpecification
}

// A raster PMTiles archive served over valley-vault:// (Range-capable) for a
// fully offline base map; the pmtiles protocol resolves the tiles.
function offlineStyle(path: string): StyleSpecification {
  return {
    version: 8,
    sources: { offline: { type: 'raster', url: `pmtiles://plugin-map-offline://archive/${encodeURIComponent(path)}`, tileSize: 256 } },
    layers: [{ id: 'offline', type: 'raster', source: 'offline' }]
  } as unknown as StyleSpecification
}

/** Resolve the base-map style for the chosen preset, theme and settings. */
export function styleFor(
  style: MapStyleId,
  theme: ThemeMode,
  settings: MapSettings
): string | StyleSpecification {
  if (settings.offlineBasemapPath) return offlineStyle(settings.offlineBasemapPath)
  const layer = mapLayer(style, settings)
  const account = parseAccountProviderChoice(effectiveBasemapProvider(settings))
  if (account) {
    const id = {
      streets: theme === 'dark' ? 'dark-v11' : 'streets-v12',
      satellite: 'satellite-v9',
      navigation: theme === 'dark' ? 'navigation-night-v1' : 'navigation-day-v1',
      outdoors: 'outdoors-v12'
    }[layer]
    return rasterStyle(
      [`plugin-map://tile/${encodeURIComponent(account.connectionId)}/${id}/{z}/{x}/{y}`],
      `© ${account.provider === 'mapbox' ? 'Mapbox' : account.provider}${layer === 'satellite' ? '' : ' © OpenStreetMap'}`,
      theme === 'dark' && (layer === 'satellite' || layer === 'outdoors')
    )
  }
  if (layer === 'satellite') return rasterStyle([ESRI_IMAGERY], '© Esri, Maxar, Earthstar Geographics', theme === 'dark')
  return theme === 'dark' ? CARTO_DARK : CARTO_LIGHT
}

/** Whether the resolved style needs the pmtiles protocol registered. */
export function needsPmtiles(settings: MapSettings): boolean {
  return Boolean(settings.offlineBasemapPath)
}
