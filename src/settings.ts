import type {
  AccountMapProvider,
  ElevationProvider,
  LngLat,
  MapColorMode,
  MapLayerId,
  MapSettings,
  MapStyleId,
  RoutingProvider,
  SearchProvider
} from './types'

/** Defaults mirror the manifest `settingsSchema` in src/main/modules/plugin-host/plugins.ts. */
export const DEFAULT_CENTER: LngLat = [8.5417, 47.3769] // Zürich
export const DEFAULT_ZOOM = 12

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function parseCenter(value: unknown): LngLat {
  if (typeof value === 'string') {
    const parts = value.split(/[,;\s]+/).filter(Boolean).map(Number)
    if (parts.length >= 2 && parts.every(Number.isFinite)) {
      const [lng, lat] = parts
      if (lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90) return [lng, lat]
    }
  }
  return DEFAULT_CENTER
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function bool(value: unknown): boolean {
  return value === true
}

export function accountProviderChoice(provider: string, connectionId: string): AccountMapProvider {
  return `account:${provider}:${connectionId}`
}

export function parseAccountProviderChoice(value: unknown): { provider: string; connectionId: string } | null {
  if (typeof value !== 'string' || !value.startsWith('account:')) return null
  const [, provider, ...connection] = value.split(':')
  const connectionId = connection.join(':')
  return provider && connectionId ? { provider, connectionId } : null
}

export const MAP_LAYER_CHOICES: { id: MapLayerId; labelKey: string }[] = [
  { id: 'streets', labelKey: 'auto.6710418d500d' },
  { id: 'satellite', labelKey: 'auto.d1ffec930b29' },
  { id: 'navigation', labelKey: 'style.navigation' },
  { id: 'outdoors', labelKey: 'style.outdoors' }
]

export function mapLayers(settings: MapSettings): typeof MAP_LAYER_CHOICES {
  return parseAccountProviderChoice(effectiveBasemapProvider(settings))?.provider === 'mapbox'
    ? MAP_LAYER_CHOICES
    : MAP_LAYER_CHOICES.slice(0, 2)
}

export function mapLayer(value: unknown, settings?: MapSettings): MapLayerId {
  return (settings ? mapLayers(settings) : MAP_LAYER_CHOICES).find((choice) => choice.id === value)?.id ?? 'streets'
}

export function mapColorMode(value: unknown): MapColorMode | undefined {
  return value === 'system' || value === 'light' || value === 'dark' ? value : undefined
}

function providerEnabled(provider: string, mapboxEnabled: boolean, openRouteServiceEnabled: boolean): boolean {
  if (provider === 'mapbox') return mapboxEnabled
  if (provider === 'openrouteservice') return openRouteServiceEnabled
  return true
}

/** Coerce the plugin's raw settings record into a typed, defaulted MapSettings. */
export function resolveSettings(raw: Record<string, unknown>): MapSettings {
  const zoomRaw = Number(raw.defaultZoom)
  const mapboxEnabled = bool(raw.mapboxEnabled)
  const openRouteServiceEnabled = bool(raw.openRouteServiceEnabled)
  const mapboxConnectionId = str(raw.mapboxConnectionId)
  const openRouteServiceConnectionId = str(raw.openRouteServiceConnectionId)
  const accountChoice = (value: unknown): AccountMapProvider | null => {
    const parsed = parseAccountProviderChoice(value)
    return parsed ? accountProviderChoice(parsed.provider, parsed.connectionId) : null
  }
  return {
    defaultStyle: oneOf<MapStyleId>(raw.defaultStyle, MAP_LAYER_CHOICES.map((choice) => choice.id), 'streets'),
    basemapProvider: accountChoice(raw.basemapProvider) ?? 'free',
    defaultCenter: parseCenter(raw.defaultCenter),
    defaultZoom: Number.isFinite(zoomRaw) && zoomRaw >= 0 && zoomRaw <= 22 ? zoomRaw : DEFAULT_ZOOM,
    mapboxEnabled,
    openRouteServiceEnabled,
    mapboxConnectionId,
    openRouteServiceConnectionId,
    searchProvider: accountChoice(raw.searchProvider) ?? 'nominatim',
    routingProvider: accountChoice(raw.routingProvider) ?? 'osrm',
    elevationProvider: raw.elevationProvider === 'none' ? 'none' : accountChoice(raw.elevationProvider) ?? 'open-elevation',
    offlineBasemapPath: str(raw.offlineBasemapPath)
  }
}

export function mapboxUsable(settings: MapSettings): boolean {
  return settings.mapboxEnabled && Boolean(settings.mapboxConnectionId)
}

export function openRouteServiceUsable(settings: MapSettings): boolean {
  return settings.openRouteServiceEnabled && Boolean(settings.openRouteServiceConnectionId)
}

export function effectiveStyle(settings: MapSettings): MapStyleId {
  return mapLayer(settings.defaultStyle, settings)
}

export function effectiveBasemapProvider(settings: MapSettings): MapSettings['basemapProvider'] {
  const account = parseAccountProviderChoice(settings.basemapProvider)
  return account && providerEnabled(account.provider, settings.mapboxEnabled, settings.openRouteServiceEnabled)
    ? settings.basemapProvider
    : 'free'
}

export function effectiveSearchProvider(settings: MapSettings): SearchProvider {
  const account = parseAccountProviderChoice(settings.searchProvider)
  return account && !providerEnabled(account.provider, settings.mapboxEnabled, settings.openRouteServiceEnabled)
    ? 'nominatim'
    : settings.searchProvider
}

export function effectiveRoutingProvider(settings: MapSettings): RoutingProvider {
  const account = parseAccountProviderChoice(settings.routingProvider)
  if (account && !providerEnabled(account.provider, settings.mapboxEnabled, settings.openRouteServiceEnabled)) return 'osrm'
  return settings.routingProvider
}

export function effectiveElevationProvider(settings: MapSettings): ElevationProvider {
  const account = parseAccountProviderChoice(settings.elevationProvider)
  return account && !providerEnabled(account.provider, settings.mapboxEnabled, settings.openRouteServiceEnabled)
    ? 'open-elevation'
    : settings.elevationProvider
}

export interface MapPresentationOptions {
  style?: MapStyleId
  provider?: string
  theme?: MapColorMode
}

export function parseMapPresentation(value: string | readonly string[]): MapPresentationOptions {
  const options: MapPresentationOptions = {}
  for (const part of typeof value === 'string' ? value.split(/[|\n]+/) : value) {
    const token = part.trim()
    const field = /^(style|theme|mode|provider)\s*[:=]\s*(.+)$/i.exec(token)
    const key = field?.[1].toLowerCase()
    const choice = (field?.[2] ?? token).trim()
    const lower = choice.toLowerCase()
    if ((!key || key === 'style' || key === 'theme') && MAP_LAYER_CHOICES.some(layer => layer.id === lower)) options.style = lower as MapStyleId
    else if ((!key || key === 'theme' || key === 'mode') && mapColorMode(lower)) options.theme = mapColorMode(lower)
    else if (key === 'provider' || !key && (['free', 'mapbox', 'carto', 'osm', 'esri'].includes(lower) || parseAccountProviderChoice(choice))) options.provider = choice
  }
  return options
}

export function mapPresentationSettings(
  raw: Record<string, unknown>,
  kind: 'embed' | 'codeBlock',
  overrides: MapPresentationOptions = {},
  connections: readonly { id: string; provider: string; secretState: string; capabilities: readonly string[] }[] = []
): { settings: MapSettings; theme: MapColorMode } {
  const settings = resolveSettings(raw)
  const savedProvider = str(raw[`${kind}Provider`])
  const requested = overrides.provider ?? (savedProvider && savedProvider !== 'inherit' ? savedProvider : settings.basemapProvider)
  const account = parseAccountProviderChoice(requested)
  const free = ['free', 'carto', 'osm', 'esri'].includes(requested.toLowerCase())
  const usable = connections.filter(connection => connection.secretState === 'ok' && connection.capabilities.includes('map.style'))
  const connection = free ? undefined : account
    ? usable.find(connection => connection.id === account.connectionId && connection.provider === account.provider)
    : usable.find(connection => connection.provider === requested.toLowerCase() && connection.id === settings.mapboxConnectionId)
      ?? usable.find(connection => connection.provider === requested.toLowerCase())
  settings.basemapProvider = connection ? accountProviderChoice(connection.provider, connection.id) : 'free'
  if (connection?.provider === 'mapbox') settings.mapboxEnabled = true
  const savedStyle = raw[`${kind}Style`]
  settings.defaultStyle = mapLayer(overrides.style ?? (savedStyle === 'inherit' || !savedStyle ? settings.defaultStyle : savedStyle), settings)
  return { settings, theme: overrides.theme ?? mapColorMode(raw[`${kind}Theme`]) ?? 'system' }
}
