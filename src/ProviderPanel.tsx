import { mapServices } from './serviceClient'
import type { FC } from 'react'
import type { MapConnectionInfo } from './serviceClient'
import { React, api } from './runtime'
import { accountProviderChoice, effectiveBasemapProvider, effectiveElevationProvider, effectiveRoutingProvider, effectiveSearchProvider, parseAccountProviderChoice, resolveSettings } from './settings'
import { uiText } from './localization'
import { getStore } from './store'

/** One pickable service or account: the saved title, with the account email as
 *  the smaller second line the shared dropdown draws under it. */
export interface MapSelectOption {
  value: string
  label: string
  description?: string
}

export function connectionOption(connection: MapConnectionInfo, value = connection.id): MapSelectOption {
  return { value, label: connection.displayName, ...(connection.email ? { description: connection.email } : {}) }
}

/** The shared dropdown's value, or '' so its placeholder shows instead of a raw id. */
export function knownChoice(value: string, options: readonly MapSelectOption[]): string {
  return options.some((option) => option.value === value) ? value : ''
}

export function useMapConnections(): MapConnectionInfo[] {
  const [connections, setConnections] = React.useState<MapConnectionInfo[]>([])
  React.useEffect(() => {
    let active = true
    let generation = 0
    const refresh = async (): Promise<void> => {
      const request = ++generation
      try {
        const result = await mapServices(api).listConnections()
        if (active && request === generation && result.ok) setConnections(result.data?.connections ?? [])
      } catch {
        if (active && request === generation) setConnections([])
      }
    }
    const store = getStore()
    let previousPlan = store?.getSnapshot().plan
    let previousPlanning = store?.getSnapshot().planning
    const offPlan = store?.subscribe(() => {
      const { plan, planning } = store.getSnapshot()
      const finished = previousPlanning && !planning
      const changed = previousPlan !== plan
      previousPlan = plan
      previousPlanning = planning
      if (finished || changed) void refresh()
    })
    void refresh()
    const offConnections = api.backend.on('connectionsChanged', refresh)
    return () => { active = false; offPlan?.(); offConnections() }
  }, [])
  return connections
}

const UsageLink: FC<{ provider: 'mapbox' | 'openrouteservice' }> = ({ provider }) => {
  const url = provider === 'mapbox' ? 'https://console.mapbox.com/account/statistics/' : 'https://account.heigit.org/'
  return <a href={url} onClick={(event) => { event.preventDefault(); void api.files.openExternalUrl(url) }}>{uiText('usage.dashboard')}</a>
}

const QuotaRow: FC<{ connection?: MapConnectionInfo; service: 'routing' | 'elevation' }> = ({ connection, service }) => {
  const quota = connection?.usage?.find((entry) => entry.service === service)
  return <div className="props-info-row">
    <dt className="props-info-key">{uiText(service === 'routing' ? 'usage.routing' : 'usage.elevation')}</dt>
    <dd className="props-info-value map-usage-value">
      {connection && <span>{connection.displayName}</span>}
      {quota ? <>
        <span>{uiText('usage.used', { used: quota.limit - quota.remaining, limit: quota.limit })}</span>
        <span>{uiText('usage.remaining', { remaining: quota.remaining })}</span>
        <span className="map-usage-detail">{uiText('usage.observed', { date: new Date(quota.observedAt).toLocaleString() })}</span>
        {quota.resetAt !== undefined && <span className="map-usage-detail">{uiText('usage.reset', { date: new Date(quota.resetAt).toLocaleString() })}</span>}
      </> : <span>{uiText(connection?.secretState === 'ok' ? 'usage.noSnapshot' : 'provider.unavailable')}</span>}
    </dd>
  </div>
}

export async function selectServiceProvider(key: string, choice: string, connection?: MapConnectionInfo): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (connection?.provider === 'mapbox') {
    patch.mapboxConnectionId = connection.id
    patch.mapboxEnabled = true
  }
  if (connection?.provider === 'openrouteservice') {
    patch.openRouteServiceConnectionId = connection.id
    patch.openRouteServiceEnabled = true
  }
  patch[key] = choice
  for (const [key, value] of Object.entries(patch)) {
    if (api.settings.get()[key] === value) continue
    const result = await api.settings.set(key, value)
    if (!result.ok) throw new Error(uiText('surface.invalid'))
  }
}

export const MapProviderSelect: FC<{ settingKey?: string }> = ({ settingKey = 'basemapProvider' }) => {
  const { SelectField } = api.ui.settings
  const connections = useMapConnections()
  const [values, setValues] = React.useState(() => api.settings.get())
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState(false)
  React.useEffect(() => api.settings.subscribe(() => setValues(api.settings.get())), [])
  const settings = resolveSettings(values)
  const options: MapSelectOption[] = [
    ...(settingKey === 'basemapProvider' ? [] : [{ value: 'inherit', label: uiText('embed.inherit') }]),
    { value: 'free', label: uiText('provider.free') },
    ...connections.filter(connection => connection.secretState === 'ok' && connection.capabilities.includes('map.style')).map(connection => ({
      ...connectionOption(connection, accountProviderChoice(connection.provider, connection.id)),
      label: `${connection.provider === 'mapbox' ? 'Mapbox' : connection.provider} · ${connection.displayName}`
    }))
  ]
  const choose = async (value: string): Promise<void> => {
    const connection = connections.find(entry => accountProviderChoice(entry.provider, entry.id) === value)
    setBusy(true)
    setError(false)
    try { await selectServiceProvider(settingKey, value, connection) }
    catch { setError(true) }
    finally { setBusy(false) }
  }
  return <>
    <SelectField className="map-select-fill" ariaLabel={uiText('surface.provider')}
      value={knownChoice(settingKey === 'basemapProvider' ? effectiveBasemapProvider(settings) : String(values[settingKey] || 'inherit'), options)} options={options}
      placeholder={uiText('provider.unavailable')} disabled={busy || Boolean(settings.offlineBasemapPath)}
      onChange={value => { void choose(value) }} />
    {error && <span role="alert">{uiText('surface.invalid')}</span>}
  </>
}

export const ProviderPanel: FC<{ routing?: boolean }> = ({ routing = false }) => {
  const { SelectField, Button } = api.ui.settings
  const [values, setValues] = React.useState(() => api.settings.get())
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const connections = useMapConnections()
  React.useEffect(() => api.settings.subscribe(() => setValues(api.settings.get())), [])
  const settings = resolveSettings(values)
  const primaryKey = routing ? 'routingProvider' : 'basemapProvider'
  const primaryValue = routing ? effectiveRoutingProvider(settings) : effectiveBasemapProvider(settings)
  const fallback = routing ? 'osrm' : 'free'
  const primaryLabel = uiText(routing ? 'auto.d411677e5e97' : 'surface.provider')
  const secondaryKey = routing ? 'elevationProvider' : 'searchProvider'
  const secondaryValue = routing ? effectiveElevationProvider(settings) : effectiveSearchProvider(settings)
  const secondaryLabel = uiText(routing ? 'auto.91fed541a689' : 'auto.a9855411ca93')
  const selected = parseAccountProviderChoice(primaryValue)
  const available = connections.filter((connection) => connection.secretState === 'ok')
  const primaryAccounts = available.filter((connection) => connection.capabilities.includes(routing ? 'geo.route' : 'map.style'))
  const secondaryAccounts = available.filter((connection) => connection.capabilities.includes(routing ? 'geo.elevation' : 'geo.search'))
  const providers = [...new Set(primaryAccounts.map((connection) => connection.provider))]
  if (selected && !providers.includes(selected.provider)) providers.push(selected.provider)
  const accounts = primaryAccounts.filter((connection) => connection.provider === selected?.provider)
  const choose = async (key: string, value: string, connection?: MapConnectionInfo): Promise<void> => {
    setBusy(true)
    setError('')
    try { await selectServiceProvider(key, value, connection) }
    catch { setError(uiText('surface.invalid')) }
    finally { setBusy(false) }
  }
  const choosePrimary = (connection?: MapConnectionInfo): void => {
    void choose(primaryKey, connection ? accountProviderChoice(connection.provider, connection.id) : fallback, connection)
  }
  const providerName = (provider: string): string => provider === 'mapbox' ? 'Mapbox' : provider === 'openrouteservice' ? 'OpenRouteService' : provider
  const secondaryOptions: MapSelectOption[] = [
    ...(routing ? [{ value: 'open-elevation', label: uiText('auto.e30f2e4fe133') }, { value: 'none', label: uiText('auto.e3de5ab0ca4c') }]
      : [{ value: 'nominatim', label: uiText('auto.966d0987e520') }]),
    ...secondaryAccounts.map((connection) => connectionOption(connection, accountProviderChoice(connection.provider, connection.id)))
  ]
  const accountOptions = accounts.map((connection) => connectionOption(connection))
  const offline = !routing && Boolean(settings.offlineBasemapPath)
  const usageRoles = (routing ? [['routing', primaryValue], ['elevation', secondaryValue]] as const : []).flatMap(([service, value]) => {
    const account = parseAccountProviderChoice(value)
    return account?.provider === 'openrouteservice' ? [{ service, connection: connections.find((entry) => entry.id === account.connectionId) }] : []
  })
  const usesMapbox = !routing || [primaryValue, secondaryValue].some((value) => parseAccountProviderChoice(value)?.provider === 'mapbox')

  return <div className="right-panel-body props-info map-provider-panel">
    <p className="map-provider-description">{uiText(routing ? 'provider.routingDescription' : 'provider.description')}</p>
    {offline && <p className="map-provider-description">{uiText('provider.offline')}</p>}
    <dl className="props-info-table">
      <div className="props-info-row map-props-control-row">
        <dt className="props-info-key">{primaryLabel}</dt>
        <dd className="props-info-value">
          <SelectField className="map-select-fill" ariaLabel={primaryLabel} value={selected?.provider ?? fallback} disabled={busy || offline} options={[
            { value: fallback, label: uiText(routing ? 'provider.osrm' : 'provider.free') },
            ...providers.map((provider) => ({ value: provider, label: providerName(provider) }))
          ]} onChange={(provider) => {
            const connection = primaryAccounts.find((entry) => entry.provider === provider && entry.id === (provider === 'mapbox' ? settings.mapboxConnectionId : settings.openRouteServiceConnectionId))
              ?? primaryAccounts.find((entry) => entry.provider === provider)
            if (provider === fallback || connection) choosePrimary(provider === fallback ? undefined : connection)
          }} />
        </dd>
      </div>
      <div className={selected ? 'props-info-row map-props-control-row' : 'props-info-row'}>
        <dt className="props-info-key">{uiText('provider.account')}</dt>
        <dd className="props-info-value">
          {selected ? <SelectField className="map-select-fill" value={knownChoice(selected.connectionId, accountOptions)} ariaLabel={uiText('provider.account')}
            options={accountOptions} placeholder={uiText('provider.unavailable')}
            disabled={busy || offline || accountOptions.length === 0}
            onChange={(value) => { const connection = accounts.find((account) => account.id === value); if (connection) choosePrimary(connection) }} /> : uiText('provider.noAccount')}
        </dd>
      </div>
      <div className="props-info-row map-props-control-row">
        <dt className="props-info-key">{secondaryLabel}</dt>
        <dd className="props-info-value">
          <SelectField className="map-select-fill" value={knownChoice(secondaryValue, secondaryOptions)} ariaLabel={secondaryLabel}
            options={secondaryOptions} placeholder={uiText('provider.unavailable')} disabled={busy}
            onChange={(value) => {
              const connection = secondaryAccounts.find((entry) => accountProviderChoice(entry.provider, entry.id) === value)
              if (secondaryOptions.some((option) => option.value === value)) void choose(secondaryKey, value, connection)
            }} />
        </dd>
      </div>
      {usesMapbox && <div className="props-info-row">
        <dt className="props-info-key">{uiText('usage.mapbox')}</dt>
        <dd className="props-info-value map-usage-value"><span>{uiText('usage.mapboxUnavailable')}</span><UsageLink provider="mapbox" /></dd>
      </div>}
      {usageRoles.map(({ service, connection }) => <QuotaRow key={service} service={service} connection={connection} />)}
    </dl>
    {routing && <p className="map-provider-description map-usage-note">{uiText('usage.quotaNote')} <UsageLink provider="openrouteservice" /></p>}
    {error && <p role="alert" className="map-provider-description">{error}</p>}
    <div className="map-provider-manage">
      <span>{uiText('provider.change')}</span>
      <Button size="small" onClick={() => api.workspace.openSettings('accounts')}>{uiText('provider.manageAccounts')}</Button>
    </div>
  </div>
}
