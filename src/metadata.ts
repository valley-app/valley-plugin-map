/**
 * What Map publishes about itself to Settings → Metadata.
 *
 * Identity (name, version, author, what it owns) core reads off the manifest.
 * These are the facts only the plugin knows: a map is never a `.md` or `.quiz`
 * file, but which tile server, geocoder and router it is *actually* talking to
 * right now is metadata worth showing — and it changes with the settings, so it
 * cannot be a static manifest declaration.
 *
 * Pure over `MapSettings` so it is unit-testable without a live map.
 */
import type {
  MetadataPanelSegment,
  PluginMetadataFact,
  PluginMetadataProvider
} from '@valley/plugin-sdk'
import type { MapSettings, MapStyleId } from './types'
import { effectiveBasemapProvider, effectiveElevationProvider, effectiveRoutingProvider, effectiveSearchProvider, effectiveStyle, mapboxUsable, openRouteServiceUsable, parseAccountProviderChoice } from './settings'
import { uiText } from './localization'

const STYLE_LABELS = {
  streets: 'Streets — CARTO Voyager / Dark Matter (free)',
  satellite: 'Satellite — Esri World Imagery'
}

const ELEVATION_LABELS = {
  'open-elevation': 'Open-Elevation',
  none: 'Off'
}

function providerLabel(provider: string): string {
  if (provider === 'mapbox') return 'Mapbox'
  if (provider === 'openrouteservice') return 'OpenRouteService'
  return provider
}

/** The base map actually in use — an offline archive overrides the chosen style,
 *  and `mapbox` silently falls back to the free tiles without a token. Mirrors
 *  the branches in `styleFor`; if that changes, this must change with it. */
function baseMapLabel(settings: MapSettings): string {
  if (settings.offlineBasemapPath) return uiText('auto.e42a8a8acf5b', { p0: settings.offlineBasemapPath })
  if (parseAccountProviderChoice(settings.basemapProvider)?.provider === 'mapbox' && effectiveBasemapProvider(settings) === 'free') {
    return uiText('auto.2a56879fc4af', { p0: STYLE_LABELS.streets })
  }
  const effective = effectiveStyle(settings)
  const account = parseAccountProviderChoice(effectiveBasemapProvider(settings))
  if (account) return uiText('auto.5b91664bf167', { p0: providerLabel(account.provider) })
  return effective === 'satellite' ? STYLE_LABELS.satellite : STYLE_LABELS.streets
}

export function mapFacts(settings: MapSettings): PluginMetadataFact[] {
  return [
    {
      id: 'map.basemap',
      labelKey: 'plugin.map.meta.basemap',
      label: 'Base map',
      value: baseMapLabel(settings)
    },
    {
      id: 'map.geocoding',
      labelKey: 'plugin.map.meta.geocoding',
      label: 'Geocoding',
      value: (() => {
        const provider = parseAccountProviderChoice(effectiveSearchProvider(settings))?.provider
        return provider === 'mapbox' ? 'Mapbox Places' : provider ? providerLabel(provider) : 'Nominatim (OpenStreetMap)'
      })()
    },
    {
      id: 'map.routing',
      labelKey: 'plugin.map.meta.routing',
      label: 'Routing',
      value: (() => {
        const provider = parseAccountProviderChoice(effectiveRoutingProvider(settings))?.provider
        return provider === 'mapbox'
          ? 'Mapbox Directions'
          : provider ? providerLabel(provider) : 'FOSSGIS OSRM (routing.openstreetmap.de)'
      })()
    },
    {
      id: 'map.elevation',
      labelKey: 'plugin.map.meta.elevation',
      label: 'Elevation',
      value: (() => {
        const provider = effectiveElevationProvider(settings)
        const account = parseAccountProviderChoice(provider)
        if (account) return providerLabel(account.provider)
        return provider === 'none' ? uiText('auto.e3de5ab0ca4c') : ELEVATION_LABELS['open-elevation']
      })()
    },
    {
      // Presence only. Settings → Metadata is a readable list the user may well
      // screenshot; a token belongs in the settings field it was typed into.
      id: 'map.credentials',
      labelKey: 'plugin.map.meta.credentials',
      label: 'API keys',
      value: [
        `Mapbox: ${mapboxUsable(settings) ? 'connected' : 'off'}`,
        `OpenRouteService: ${openRouteServiceUsable(settings) ? 'connected' : 'off'}`
      ].join(' · ')
    }
  ]
}

export function mapServiceFacts(settings: MapSettings, style: MapStyleId = effectiveStyle(settings)): PluginMetadataFact[] {
  const account = parseAccountProviderChoice(effectiveBasemapProvider(settings))
  const provider = settings.offlineBasemapPath ? 'PMTiles'
    : account ? providerLabel(account.provider)
      : style === 'satellite' ? 'Esri' : 'CARTO'
  return [
    { id: 'map.provider', labelKey: 'surface.provider', label: 'Map provider', value: provider },
    { id: 'map.data', labelKey: 'surface.mapData', label: 'Map data', value: settings.offlineBasemapPath ? uiText('surface.offlineData') : style === 'satellite' ? account ? `${providerLabel(account.provider)} Satellite` : 'Esri, Maxar, Earthstar Geographics' : 'OpenStreetMap' },
    { id: 'map.engine', labelKey: 'surface.mapEngine', label: 'Map engine', value: 'MapLibre GL JS' },
    ...mapFacts(settings).filter((fact) => ['map.geocoding', 'map.routing', 'map.elevation'].includes(fact.id))
  ]
}

/** The descriptor `register()` hands to the `metadata.plugin` point. Settings
 *  reads `facts()` on every render, so the settings are re-read then — flipping
 *  the base map style changes what Metadata says without a reload. */
export function mapMetadataProvider(readSettings: () => MapSettings): PluginMetadataProvider {
  return {
    id: 'map.metadata',
    labelKey: 'manifest.name',
    label: 'Map',
    icon: 'map-marked',
    facts: () => mapFacts(readSettings())
  }
}

/**
 * The descriptor `register()` hands to the `metadataPanel.segment` point.
 *
 * `pluginTabs` with no `extensions`/`fileKinds` means "my own tabs, and only
 * those": a map is not a file, so without it the note panel has no subject
 * beside a full-screen map and falls back to "No file open".
 *
 * The body arrives as an argument to keep this module React-free — main imports
 * the manifest beside it, and the descriptor is unit-testable without a DOM.
 */
export function mapPanelSegment(render: MetadataPanelSegment['render']): MetadataPanelSegment {
  return {
    id: 'map.overview',
    labelKey: 'manifest.name',
    label: 'Map',
    icon: 'map-marked',
    pluginTabs: true,
    render
  }
}
