import { DISTANCE_UNITS, LENGTH_UNITS, AREA_UNITS, LARGE_AREA_UNITS, SPEED_UNITS, PACE_UNITS, COORDINATE_FORMATS, type ValleyUnits } from '@valley/plugin-sdk/units'
import { React, api } from './runtime'
import type { FC, ReactElement, ReactNode } from 'react'
import type { IndexEntry } from '@valley/plugin-sdk/types'
import { mapServices, type MapConnectionInfo, type SidebarPluginInfo } from './serviceClient'
import { paletteCssContrast, paletteCssValue } from '@valley/plugin-sdk/palette'
import type { PinSource } from './types'
import { defaultPinSource, isSourceActive, notLocatedYet, ruleSummary, sourceStats } from './pinSources'
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, GripVertical, PinGlyph, PIN_GLYPHS, Plus, Trash, UserSettings } from './icons'
import { MAP_ICON_FOLDER, refreshMapIcons, useMapIcons } from './pinIcons'
import { usePinSettings } from './hooks'
import { uiText } from './localization'
import { accountProviderChoice, DEFAULT_ZOOM, ZOOM_MAX, ZOOM_STEP, HIDDEN_SIDEBAR_PLUGINS_KEY, hiddenSidebarPlugins, MAP_LAYER_CHOICES, mapLayer, mapLayers, parseAccountProviderChoice, resolveSettings } from './settings'
import { useSidebarProviders } from './SidebarTabs'
import { MapProviderSelect, connectionOption, knownChoice, useMapConnections, type MapSelectOption } from './ProviderPanel'

const Section: typeof api.ui.settings.Section = ({ title, className = '', children }) =>
  <section className={`settings-section ${className}`}>{title != null && <h4 className="settings-label">{title}</h4>}{children}</section>
const Row: typeof api.ui.settings.Row = ({ title, description, extra, className = '', children }) =>
  <div className={`settings-path-row ${className}`}>
    <span className="settings-toggle-text"><span className="settings-toggle-title">{title}</span>
      {description != null && <span className="settings-toggle-desc">{description}</span>}{extra}</span>
    {children}
  </div>

const Button: typeof api.ui.settings.Button = (props) => React.createElement(api.ui.settings.Button, props)
const IconButton: typeof api.ui.settings.IconButton = (props) => React.createElement(api.ui.settings.IconButton, props)
const TextField: typeof api.ui.settings.TextField = (props) => React.createElement(api.ui.settings.TextField, props)

function useSettingsValues(): [Record<string, unknown>, (key: string, value: unknown) => void] {
  const [values, setValues] = React.useState<Record<string, unknown>>(() => api.settings.get())
  React.useEffect(() => {
    const refresh = (): void => setValues(api.settings.get())
    return api.settings.subscribe(refresh)
  }, [])
  const commit = (key: string, value: unknown): void => {
    setValues((prev) => ({ ...prev, [key]: value }))
    const save = async (): Promise<void> => {
      if (key === 'defaultStyle' && !api.settings.get().basemapProvider) {
        const result = await api.settings.set('basemapProvider', resolveSettings(api.settings.get()).basemapProvider)
        if (!result.ok) return
      }
      await api.settings.set(key, value)
    }
    void save()
  }
  return [values, commit]
}

/** The default zoom as the stepped slider with its number box and reset, like Appearance → Font size: 0, 5, 10, 15, 20, 25. */
const ZoomField: FC<{ value: number; onCommit: (value: number) => void }> = ({ value, onCommit }) => {
  const { RangeField } = api.ui.settings
  // A zoom saved between two steps shows on the nearest one.
  const stepped = Math.round(value / ZOOM_STEP) * ZOOM_STEP
  const [preview, setPreview] = React.useState(stepped)
  React.useEffect(() => setPreview(stepped), [stepped])
  return (
    <RangeField
      value={preview}
      onChange={setPreview}
      onCommit={onCommit}
      min={0}
      max={ZOOM_MAX}
      step={ZOOM_STEP}
      showStepMarks
      resetValue={DEFAULT_ZOOM}
      resetAriaLabel={uiText('settings.zoomReset')}
      ariaLabel={uiText('auto.84a3f17b629e')}
      numberAriaLabel={uiText('auto.84a3f17b629e')}
    />
  )
}

const MEASUREMENT_ROWS = [
  ['distance', DISTANCE_UNITS], ['length', LENGTH_UNITS], ['area', AREA_UNITS],
  ['largeArea', LARGE_AREA_UNITS], ['speed', SPEED_UNITS], ['pace', PACE_UNITS], ['coordinates', COORDINATE_FORMATS]
] as const
const UNIT_LABELS: Record<string, string> = { m2: 'm²', ft2: 'ft²', kmh: 'km/h', mph: 'mph', 'min-km': 'min/km', 'min-mi': 'min/mi' }

const MeasurementsSection: FC = () => {
  const { SelectField } = api.ui.settings
  const [units, setUnits] = React.useState(() => api.getState().units)
  const [error, setError] = React.useState(false)
  React.useEffect(() => api.subscribeState(['units'], () => setUnits(api.getState().units)), [])
  const change = async (key: keyof ValleyUnits, value: string): Promise<void> => {
    try { setError(!await api.sharedState.patchUnits({ [key]: value } as Partial<ValleyUnits>)) }
    catch { setError(true) }
  }
  return <Section title={uiText('measurements.title')}>
    {MEASUREMENT_ROWS.map(([key, choices]) => <Row key={key} title={uiText(`measurements.${key}`)}>
      <SelectField value={units[key]} ariaLabel={uiText(`measurements.${key}`)}
        options={choices.map(value => ({ value, label: key === 'coordinates' ? uiText(`measurements.${value}`) : UNIT_LABELS[value] ?? value }))}
        onChange={value => { void change(key, value) }} />
    </Row>)}
    {error && <p role="alert" className="settings-path-error">{uiText('measurements.saveError')}</p>}
  </Section>
}

const MapSection: FC = () => {
  const { SelectField, Toggle } = api.ui.settings
  const [values, commit] = useSettingsValues()
  const connections = useMapConnections()
  const settings = resolveSettings(values)
  const enabled = (connection: MapConnectionInfo): boolean =>
    (connection.secretState === 'ok' || connection.secretState === 'stored') &&
    (connection.provider !== 'mapbox' || settings.mapboxEnabled) &&
    (connection.provider !== 'openrouteservice' || settings.openRouteServiceEnabled)
  const choices = (capability: string): MapSelectOption[] => connections
    .filter((connection) => enabled(connection) && connection.capabilities.includes(capability))
    .map((connection) => connectionOption(connection, accountProviderChoice(connection.provider, connection.id)))
  const searchChoices = choices('geo.search')
  const routeChoices = choices('geo.route')
  const elevationChoices = choices('geo.elevation')
  const selectedUsable = (connectionId: string, capability: string): boolean => connections.some((connection) =>
    connection.id === connectionId && enabled(connection) && connection.capabilities.includes(capability)
  )
  const mapbox = selectedUsable(settings.mapboxConnectionId, 'map.style')
  const orsRoute = selectedUsable(settings.openRouteServiceConnectionId, 'geo.route')
  const orsElevation = selectedUsable(settings.openRouteServiceConnectionId, 'geo.elevation')
  const visibleChoice = (value: string, options: Array<{ value: string }>, fallback: string): string =>
    options.some((option) => option.value === value) ? value : fallback
  const configure = (section: string): ReactElement => (
    <IconButton ariaLabel={uiText('auto.ff93b544d698', { p0: section })} title={uiText('auto.ff93b544d698', { p0: section })} onClick={() => api.workspace.openOwnSettings(section)}>
      <UserSettings />
    </IconButton>
  )
  const searchOptions: MapSelectOption[] = [{ value: 'nominatim', label: uiText('auto.966d0987e520') }, ...searchChoices]
  const routeOptions: MapSelectOption[] = [{ value: 'osrm', label: uiText('provider.osrm') }, ...routeChoices]
  const elevationOptions: MapSelectOption[] = [{ value: 'open-elevation', label: uiText('auto.e30f2e4fe133') }, ...elevationChoices, { value: 'none', label: uiText('auto.e3de5ab0ca4c') }]
  return (
    <>
      <Section title={uiText('auto.ab497ab6bda9')}>
        <Row title={uiText('surface.provider')} description={uiText('auto.66a506265656')}><MapProviderSelect /></Row>
        <Row title={uiText('auto.9a227b2961d5')} description={uiText('auto.9ae55949ca46')}>
          <SelectField
            value={mapLayer(settings.defaultStyle, settings)}
            onChange={(value) => commit('defaultStyle', value)}
            options={mapLayers(settings).map((choice) => ({ value: choice.id, label: uiText(choice.labelKey) }))}
            ariaLabel={uiText('auto.9a227b2961d5')}
          />
        </Row>
        <Row className="settings-font-size-row" title={uiText('auto.84a3f17b629e')} description={uiText('auto.866f73101525')}>
          <ZoomField value={settings.defaultZoom} onCommit={(value) => commit('defaultZoom', value)} />
        </Row>
      </Section>

      <Section title={uiText('pins.featureTitle')}>
        <Row title={uiText('auto.adc1a3bbeae6')} description={uiText('pins.featureDescription')}>
          <div className="settings-row-control">
            {settings.pinsEnabled && configure('pins')}
            <Toggle checked={settings.pinsEnabled} onChange={(value) => commit('pinsEnabled', value)} label={uiText('pins.featureToggle')} />
          </div>
        </Row>
      </Section>

      <Section title={uiText('auto.5cbd58404686')}>
        <Row title={uiText('auto.d983e02e49e4')} description={mapbox ? uiText('auto.847e50fd236c') : uiText('auto.e3d7f89dc228')}>
          <div className="settings-row-control">
            {configure('mapbox')}
            <Toggle checked={values.mapboxEnabled === true} onChange={(value) => commit('mapboxEnabled', value)} label={uiText('auto.7e1f0eeac8ed')} />
          </div>
        </Row>
        <Row title={uiText('auto.0a6ca730cc23')} description={orsRoute || orsElevation ? uiText('auto.847e50fd236c') : uiText('auto.e3d7f89dc228')}>
          <div className="settings-row-control">
            {configure('openrouteservice')}
            <Toggle checked={values.openRouteServiceEnabled === true} onChange={(value) => commit('openRouteServiceEnabled', value)} label={uiText('auto.8d61f4b95a1e')} />
          </div>
        </Row>
      </Section>

      <Section title={uiText('auto.e25bbb97e9eb')}>
        <Row title={uiText('auto.7e0759a53aa0')} description={uiText('auto.47b9cd21299a')}>
          <SelectField value={visibleChoice(settings.searchProvider, searchOptions, 'nominatim')} onChange={(value) => commit('searchProvider', value)}
            options={searchOptions} ariaLabel={uiText('auto.a9855411ca93')} />
        </Row>
        <Row title={uiText('auto.7d15dd1bec2e')} description={uiText('auto.53d367a54426')}>
          <SelectField value={visibleChoice(settings.routingProvider, routeOptions, 'osrm')} onChange={(value) => commit('routingProvider', value)}
            options={routeOptions} ariaLabel={uiText('auto.d411677e5e97')} />
        </Row>
        <Row title={uiText('auto.a514da1094ce')} description={uiText('auto.704d60c47d5c')}>
          <SelectField value={visibleChoice(settings.elevationProvider, elevationOptions, settings.elevationProvider === 'none' ? 'none' : 'open-elevation')} onChange={(value) => commit('elevationProvider', value)}
            options={elevationOptions} ariaLabel={uiText('auto.91fed541a689')} />
        </Row>
      </Section>
    </>
  )
}

type ProviderId = 'mapbox' | 'openrouteservice'
type ProviderRole = 'basemap' | 'search' | 'routing' | 'elevation'

const PROVIDER_NAME_KEYS: Record<ProviderId, string> = { mapbox: 'auto.d983e02e49e4', openrouteservice: 'auto.0a6ca730cc23' }
const PROVIDER_CAPABILITY_KEYS: Record<ProviderId, string[]> = {
  mapbox: ['capability.basemap', 'capability.search', 'capability.reverse', 'capability.routing'],
  openrouteservice: ['capability.routing', 'capability.elevation']
}
const ROLE_KEYS: Record<ProviderRole, string> = {
  basemap: 'auto.cc0720785428', search: 'auto.7e0759a53aa0', routing: 'auto.7d15dd1bec2e', elevation: 'auto.a514da1094ce'
}

/** Settings → Map → Mapbox / OpenRouteService: which saved account the service
 *  uses, whether its key works, and what Map currently asks of it. */
const ProviderSection: FC<{ providerId: ProviderId; connectionKey: string }> = ({ providerId, connectionKey }) => {
  const { SelectField } = api.ui.settings
  const [values, commit] = useSettingsValues()
  const connections = useMapConnections().filter((connection) => connection.provider === providerId)
  const available = connections.filter((connection) => (connection.secretState === 'ok' || connection.secretState === 'stored'))
  const options = available.map((connection) => connectionOption(connection))
  const selectedId = String(values[connectionKey] ?? '')
  const selected = connections.find((connection) => connection.id === selectedId)
  const providerName = uiText(PROVIDER_NAME_KEYS[providerId])
  const settings = resolveSettings(values)
  const roleChoices: Record<ProviderRole, string> = {
    basemap: settings.basemapProvider, search: settings.searchProvider, routing: settings.routingProvider, elevation: settings.elevationProvider
  }
  const roles = (Object.keys(ROLE_KEYS) as ProviderRole[])
    .filter((role) => parseAccountProviderChoice(roleChoices[role])?.provider === providerId)
    .map((role) => uiText(ROLE_KEYS[role]))
  const status = selected?.secretState === 'ok' ? 'provider.status.connected'
    : selected?.secretState === 'stored' ? 'provider.status.stored'
    : selected?.secretState === 'unreadable' ? 'provider.status.unreadable' : 'provider.status.setup'
  return (
    <Section>
      <Row title={uiText('provider.account')} description={available.length ? uiText('provider.settings.accountDescription', { provider: providerName }) : uiText('auto.3715a6b7072b', { p0: providerName })}>
        {available.length ? (
          <SelectField value={knownChoice(selectedId, options)} onChange={(value) => commit(connectionKey, value)} options={options}
            ariaLabel={uiText('auto.31dbd5e4c32d', { p0: providerName })} placeholder={uiText('auto.42823949fb72')} />
        ) : <Button onClick={() => api.workspace.openSettings('accounts')}>{uiText('auto.9b9b6230e478')}</Button>}
      </Row>
      <Row title={uiText('provider.settings.status')} description={uiText(status)}>
        <Button onClick={() => api.workspace.openSettings('accounts')}>{uiText('auto.2b7839285644')}</Button>
      </Row>
      <Row title={uiText('provider.settings.usedFor')} description={roles.length ? roles.join(', ') : uiText('provider.settings.notAssigned')} />
      <Row title={uiText('provider.settings.provides')} description={PROVIDER_CAPABILITY_KEYS[providerId].map((key) => uiText(key)).join(' · ')} />
    </Section>
  )
}

/** Two-click confirm delete (X → red trash), auto-disarming after a few seconds. */
const ConfirmRemove: FC<{ onDelete: () => void; label: string }> = ({ onDelete, label }) => {
  const [armed, setArmed] = React.useState(false)
  const timer = React.useRef<number | null>(null)
  const disarm = React.useCallback((): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    setArmed(false)
  }, [])
  React.useEffect(() => disarm, [disarm])
  return (
    <Button
      className="map-source-toggle"
      variant={armed ? 'danger' : 'ghost'}
      size="small"
      onClick={() => {
        if (armed) { disarm(); onDelete(); return }
        setArmed(true)
        if (timer.current !== null) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setArmed(false), 3500)
      }}
      onBlur={disarm}
      title={armed ? uiText('auto.0b0311367700') : uiText('auto.7dc25b134780', { p0: label })}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Trash /> {armed ? uiText('auto.04a212215ef9') : uiText('pins.delete')}</span>
    </Button>
  )
}

const DraftTextField: FC<{
  value: string
  ariaLabel: string
  placeholder?: string
  className?: string
  onCommit: (value: string) => void
}> = ({ value, ariaLabel, placeholder, className, onCommit }) => {
  const [draft, setDraft] = React.useState(value)
  React.useEffect(() => setDraft(value), [value])
  return (
    <TextField
      className={className}
      value={draft}
      onChange={setDraft}
      onCommit={onCommit}
      onEscape={() => setDraft(value)}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
    />
  )
}

/** The folder filter drafts locally and saves on commit: saving every keystroke
 *  re-rendered the host field mid-word and dropped what was being typed. */
const DraftFolderField: FC<{ value: string; onCommit: (value: string) => void }> = ({ value, onCommit }) => {
  const { RealmFolderField } = api.ui.settings
  const [draft, setDraft] = React.useState(value)
  React.useEffect(() => setDraft(value), [value])
  return (
    <RealmFolderField
      value={draft}
      onChange={setDraft}
      onCommit={onCommit}
      onEscape={() => setDraft(value)}
      placeholder={uiText('auto.ad980036b394')}
      ariaLabel={uiText('pins.onlyInFolder')}
    />
  )
}

/** One colour control. `fill` is the pin's body, `ring` its border — the kit
 *  swatch draws the pair differently, so they are tellable apart without
 *  reading their tooltips. Identical to the Calendar's note-date colours. */
const ColorChip: FC<{
  variant: 'ring' | 'fill'
  value: string
  label: string
  onChange: (value: string) => void
}> = ({ variant, value, label, onChange }) => {
  const { ColorField } = api.ui.settings
  return <ColorField variant={variant} value={value} onChange={onChange} ariaLabel={label} />
}

/** The source's pin as a static disc: its glyph on its colour, inside its ring. */
const SourceDisc: FC<{ source: PinSource }> = ({ source }) => (
  <span className="map-source-disc" aria-hidden="true"
    style={{
      ['--swatch-fill' as string]: paletteCssValue(source.color),
      ['--swatch-ring' as string]: paletteCssValue(source.borderColor),
      ['--swatch-on' as string]: paletteCssContrast(source.color)
    }}>
    <PinGlyph id={source.icon} />
  </span>
)

/** The compact icon-only button that opens the pin icon grid. */
const IconPicker: FC<{ icon: string; onChange: (id: string) => void }> = ({ icon, onChange }) => {
  const ref = React.useRef<HTMLButtonElement>(null)
  return (
    <button ref={ref} type="button" className="map-source-icon-btn"
      aria-label={uiText('auto.f6ae21a5ccb9')} title={uiText('auto.bfb52c1e0245')}
      onClick={() => {
        if (!ref.current) return
        void refreshMapIcons()
        void api.ui.openPopover(ctx => <PinIconGrid selected={icon} onSelect={id => { onChange(id); ctx.close() }} />,
          { anchor: ref.current }, { className: 'map-pin-icon-popover', ariaLabel: uiText('auto.f6ae21a5ccb9') })
      }}>
      <PinGlyph id={icon} />
    </button>
  )
}

export const PinIconGrid: FC<{ selected: string; onSelect: (id: string) => void }> = ({ selected, onSelect }) => {
  const { icons, error } = useMapIcons()
  const [query, setQuery] = React.useState('')
  const label = (id: string): string => {
    const glyph = PIN_GLYPHS.find(glyph => glyph.id === id)
    return glyph ? uiText(glyph.labelKey) : id.replace(/[-_]/g, ' ')
  }
  const shown = Object.keys(icons).sort((a, b) => label(a).localeCompare(label(b)))
    .filter(id => `${id} ${label(id)}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <div className="map-pin-icon-browser">
    <div className="search-field">
      <input className="search-field-input" autoFocus value={query} placeholder={uiText('pins.icons.search')} aria-label={uiText('pins.icons.search')}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && shown[0]) { event.preventDefault(); onSelect(shown[0]) } }} />
    </div>
    <div className="map-icon-grid">
      {shown.map(id => <button key={id} type="button" className={`map-icon-opt${id === selected ? ' active' : ''}`}
        aria-label={label(id)} title={`${id}.svg`} aria-pressed={id === selected} onClick={() => onSelect(id)}>
        <PinGlyph id={id} />
      </button>)}
    </div>
    {!shown.length && <p className="map-hint">{uiText('pins.icons.empty')}</p>}
    <p className="map-hint">{uiText('pins.icons.hint')}</p>
    <div className="map-icon-actions">
      <Button variant="ghost" size="small" onClick={() => api.files.revealInFinder(MAP_ICON_FOLDER)}>{uiText('pins.icons.open')}</Button>
      <Button variant="ghost" size="small" onClick={() => void refreshMapIcons()}>{uiText('pins.icons.refresh')}</Button>
    </div>
    {error && <p role="alert" className="settings-path-error">{uiText('pins.icons.readError')}{error !== 'pins.icons.readError' ? `: ${error}` : ''}</p>}
  </div>
}

interface SourceStatus {
  /** The full status sentence. */
  text: string
  /** Pins on the map, or null when the rule is unfinished. */
  onMap: number | null
  /** The rule matches notes but none has a usable location. */
  unusable: boolean
}

/**
 * What this source currently finds. A mistyped key, value or location property
 * is otherwise indistinguishable from an empty realm — nothing appears on the
 * map and nothing says why. The Calendar's note-date sources carry the same
 * line, in the same place, for the same reason.
 */
function useSourceStatus(source: PinSource, entries: IndexEntry[], pinned: number): SourceStatus {
  const stats = React.useMemo(
    () => sourceStats(entries, source),
    // Only the fields the predicate and the location resolve actually read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, source.matchKey, source.matchValue, source.folder, source.locationMode, source.locationField]
  )
  if (!isSourceActive(source)) return { text: uiText('pins.unfinished'), onMap: null, unusable: false }
  const found = uiText(stats.matched === 1 ? 'pins.stats.foundOne' : 'pins.stats.found', { count: stats.matched })
  if (source.hidden) return { text: `${found} · ${uiText('pins.turnedOff')}`, onMap: null, unusable: false }
  if (stats.matched === 0) return { text: found, onMap: 0, unusable: false }
  if (pinned === 0 && stats.locatable === 0 && stats.awaiting === 0) {
    return { text: `${found} · ${uiText('pins.noUsableLocation', { field: source.locationField })}`, onMap: 0, unusable: true }
  }
  const onMap = Math.max(pinned, stats.locatable)
  const later = notLocatedYet(stats, onMap)
  const parts = [found]
  if (onMap > 0) parts.push(uiText('pins.stats.onMap', { count: onMap }))
  if (later > 0) parts.push(uiText('pins.stats.notLocated', { count: later }))
  return { text: parts.join(' · '), onMap, unusable: false }
}

const MatchStats: FC<{ status: SourceStatus }> = ({ status }) =>
  <span className={status.unusable ? 'map-source-stats warn' : 'map-source-stats'}>{status.text}</span>

/** The collapsed second line: rule, folder and a broken-location warning. */
const SourceSubLine: FC<{ source: PinSource; status: SourceStatus }> = ({ source, status }) => {
  const rule = ruleSummary(source) || uiText('pins.unfinished')
  if (source.hidden) return <span className="map-source-sub">{`${uiText('pins.turnedOff')} · ${rule}`}</span>
  return (
    <span className="map-source-sub">
      {`${rule} · ${source.folder || uiText('auto.ad980036b394')}`}
      {status.unusable && <> · <span className="map-source-warn">{uiText('pins.noUsableLocation', { field: source.locationField })}</span></>}
    </span>
  )
}

/** One open-source section: a hairline above, a small title, then the form. */
const SourceGroup: FC<{ title?: string; children: ReactNode }> = ({ title, children }) => (
  <section className="map-source-group">
    {title != null && <h5 className="map-source-group-title">{title}</h5>}
    <div className="map-source-form">{children}</div>
  </section>
)

/** A form line: the label column, then the control column right beside it. */
const FormRow: FC<{ label?: string; title?: string; children: ReactNode }> = ({ label, title, children }) => (
  <>
    <span className="settings-toggle-title map-source-form-label" title={title}>{label}</span>
    <div className="settings-row-control map-source-form-control">{children}</div>
  </>
)

/** A quiet line under the control it explains (status, hint). */
const FormNote: FC<{ children: ReactNode }> = ({ children }) => (
  <>
    <span className="map-source-form-label" aria-hidden="true" />
    <div className="map-source-form-note">{children}</div>
  </>
)

/**
 * One source. The head is identical open or closed — only the chevron turns —
 * so opening a source never moves its name, rule, count or switch. The whole
 * head except the grip and the switch opens and closes it.
 */
export const SourceRow: FC<{
  source: PinSource
  entries: IndexEntry[]
  pinned: number
  onChange: (patch: Partial<PinSource>) => void
  onDelete: () => void
  /** Controlled open state; the row keeps its own when it is left out. */
  expanded?: boolean
  onToggle?: () => void
  initiallyExpanded?: boolean
  handle?: ReactNode
}> = ({ source, entries, pinned, onChange, onDelete, handle, expanded: controlled, onToggle, initiallyExpanded = true }) => {
  const { Toggle } = api.ui.settings
  const [own, setOwn] = React.useState(initiallyExpanded)
  const expanded = controlled ?? own
  const toggle = onToggle ?? ((): void => setOwn(value => !value))
  const status = useSourceStatus(source, entries, pinned)
  const name = source.title || uiText('pins.untitled')
  const count = source.hidden || status.onMap === null ? '–' : String(status.onMap)
  return (
    <div className={`map-source-row${source.hidden ? ' is-off' : ''}${expanded ? ' is-open' : ''}`}>
      <div className="map-source-head" onClick={(event) => { if (!(event.target as Element).closest('.map-source-grip')) toggle() }}>
        {handle ?? <span aria-hidden="true" />}
        <SourceDisc source={source} />
        <span className="map-source-meta">
          <span className={source.title ? 'map-source-name' : 'map-source-name is-placeholder'}>{name}</span>
          <SourceSubLine source={source} status={status} />
        </span>
        <span className="map-source-count" title={status.text}>{count}</span>
        {/* A pointer press never focuses the chevron, so no ring is left behind after a click. */}
        <button type="button" className="map-source-disclosure" aria-expanded={expanded} aria-label={uiText('sources.details', { title: name })}
          onMouseDown={(event) => event.preventDefault()}><ChevronRight /></button>
        <Toggle checked={source.visible && !source.hidden} label={name} disabled={source.hidden} onChange={visible => onChange({ visible })} />
      </div>
      {expanded && <SourceEditor source={source} status={status} onChange={onChange} onDelete={onDelete} />}
    </div>
  )
}

/** The open source: name, then Notes, Location and Pin as one compact form, then use and delete. */
const SourceEditor: FC<{
  source: PinSource
  status: SourceStatus
  onChange: (patch: Partial<PinSource>) => void
  onDelete: () => void
}> = ({ source, status, onChange, onDelete }) => {
  const { ChipsField, Segmented, Toggle } = api.ui.settings
  const coordinate = source.locationMode === 'coordinate'
  return (
    <div className="map-source-editor">
      <div className="map-source-form">
        <FormRow label={uiText('pins.form.name')}>
          <DraftTextField
            value={source.title}
            placeholder={uiText('auto.7412dd4f8cee')}
            ariaLabel={uiText('auto.73723c3d0b28')}
            onCommit={(value) => onChange({ title: value.trim() })}
          />
        </FormRow>
      </div>
      <SourceGroup title={uiText('pins.group.notes')}>
        <FormRow label={uiText('pins.folder')} title={uiText('pins.folderDescription')}>
          <DraftFolderField value={source.folder ?? ''} onCommit={(value) => onChange({ folder: value.trim() || undefined })} />
        </FormRow>
        <FormRow label={uiText('pins.matchProperty')}>
          <DraftTextField
            value={source.matchKey}
            placeholder={uiText('auto.d0a3e7f81a98')}
            ariaLabel={uiText('pins.matchProperty')}
            onCommit={(value) => onChange({ matchKey: value.trim() })}
          />
          <span className="map-source-match-eq" aria-hidden="true">=</span>
          <DraftTextField
            value={source.matchValue}
            placeholder={uiText('auto.1a73af9e7ae0')}
            ariaLabel={uiText('pins.matchValue')}
            onCommit={(value) => onChange({ matchValue: value.trim() })}
          />
        </FormRow>
        <FormNote><MatchStats status={status} /></FormNote>
      </SourceGroup>
      <SourceGroup title={uiText('pins.group.location')}>
        <FormRow label={uiText('pins.form.readFrom')}>
          <Segmented
            value={source.locationMode}
            ariaLabel={uiText('pins.form.readFrom')}
            options={[
              { value: 'address', label: uiText('pins.mode.address') },
              { value: 'coordinate', label: uiText('pins.mode.coordinates') }
            ]}
            onChange={(v) => {
              const mode = v === 'coordinate' ? 'coordinate' : 'address'
              onChange({ locationMode: mode, ...(['address', 'coordinates', ''].includes(source.locationField) ? { locationField: mode === 'coordinate' ? 'coordinates' : 'address' } : {}) })
            }}
          />
        </FormRow>
        <FormRow>
          <DraftTextField
            value={source.locationField}
            placeholder={coordinate ? uiText('auto.d27cafe12dda') : uiText('auto.c662180230ca')}
            ariaLabel={uiText('pins.locationProperty')}
            onCommit={(value) => onChange({ locationField: value.trim() || (coordinate ? 'coordinates' : 'address') })}
          />
        </FormRow>
        <FormNote><span className="map-source-hint">{uiText(coordinate ? 'pins.form.coordinateHint' : 'pins.form.addressHint')}</span></FormNote>
      </SourceGroup>
      <SourceGroup title={uiText('pins.group.pin')}>
        <FormRow label={uiText('pins.form.look')}>
          <IconPicker icon={source.icon} onChange={(id) => onChange({ icon: id })} />
          <div className="map-source-color">
            <ColorChip variant="fill" value={source.color} label={uiText('auto.9c307613d98e')} onChange={(value) => onChange({ color: value })} />
            <ColorChip variant="ring" value={source.borderColor} label={uiText('auto.eeffa83765fc')} onChange={(value) => onChange({ borderColor: value })} />
          </div>
        </FormRow>
        <FormRow label={uiText('pins.form.title')}>
          <Segmented
            value={source.labelMode}
            ariaLabel={uiText('pins.form.title')}
            options={[
              { value: 'filename', label: uiText('auto.a3cbb98ddf5e') },
              { value: 'property', label: uiText('auto.9ae33a7d0ecb') }
            ]}
            onChange={(v) => onChange({ labelMode: v === 'property' ? 'property' : 'filename' })}
          />
        </FormRow>
        {source.labelMode === 'property' && (
          <FormRow>
            <DraftTextField
              value={source.labelField ?? ''}
              placeholder={uiText('pins.matchProperty')}
              ariaLabel={uiText('pins.titleProperty')}
              onCommit={(value) => onChange({ labelField: value.trim() || undefined })}
            />
          </FormRow>
        )}
        <FormRow label={uiText('pins.form.popup')} title={uiText('pins.popupFieldsDescription')}>
          <ChipsField
            items={source.hoverFields}
            ariaLabel={uiText('pins.popupFields')}
            placeholder={uiText('pins.popupFieldsPlaceholder')}
            reorderable
            removable
            normalize={(value) => value.trim()}
            onChange={(next) => onChange({ hoverFields: next.map((field) => field.trim()).filter(Boolean) })}
          />
        </FormRow>
      </SourceGroup>
      <div className="map-source-group map-source-footer">
        <span className="map-source-use" title={uiText('pins.useDescription')}>
          <span className="settings-toggle-title">{uiText('pins.use')}</span>
          <Toggle checked={!source.hidden} label={uiText('pins.use')} onChange={(on) => onChange({ hidden: !on })} />
        </span>
        <ConfirmRemove label={source.title || uiText('pins.untitled')} onDelete={onDelete} />
      </div>
    </div>
  )
}

/**
 * Settings → Map → Map pins: manage the pin sources that scrape notes.
 *
 * The list comes from the store, never from a read of its own. `pinSources.jsonl`
 * is rewritten whole on every edit, so a pane holding a second copy writes
 * whatever it read at mount over the real file — a stale array from the sidebar's
 * eye toggle, or the empty one a rejected read stands in for. That is how the map
 * drew a source this page said did not exist, and how "Add source" then deleted
 * it. The store subscribes to the file, so its copy is the current one.
 */
const PinsSection: FC = () => {
  const { store, snap } = usePinSettings()
  const { indexEntries } = snap
  const [saveError, setSaveError] = React.useState(false)
  const sources = snap.pinSources
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState<ReadonlySet<string>>(() => new Set())
  const [added, setAdded] = React.useState('')
  const top = React.useRef<HTMLParagraphElement>(null)
  const shownSources = sources.filter(source => `${source.title} ${source.folder ?? ''} ${source.matchKey} ${source.matchValue}`.toLowerCase().includes(query.trim().toLowerCase()))
  const anyOpen = shownSources.some(source => open.has(source.id))

  // A new source sits first: scroll the list back to its top.
  React.useEffect(() => {
    if (added && sources[0]?.id === added) top.current?.ownerDocument.documentElement.scrollIntoView?.({ block: 'start' })
  }, [added, sources])

  const commit = (next: PinSource[]): void => {
    if (!store?.savePinSources(next)) { setSaveError(true); return }
    setSaveError(false)
    void store.flushPinSources().catch(() => setSaveError(true))
  }
  const toggle = (id: string): void => setOpen(current => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  })
  const reorder = api.ui.settings.useReorderDrag({
    items: shownSources, getId: source => source.id, getLabel: source => source.title, indicatorOnly: true,
    onReorder: next => { const ids = new Set(next.map(source => source.id)); let position = 0; commit(sources.map(source => ids.has(source.id) ? next[position++] : source)) }
  })
  const update = (id: string, patch: Partial<PinSource>): void =>
    commit(sources.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  // The section fills the pane (`layout: 'fill'` in config.json): the bar sits in
  // the ScrollPanel's header and never scrolls; everything else scrolls under it.
  const bar = (
    <div className="settings-listpage-header map-sources-header"><span>{uiText('auto.ae6a58048a94')}</span><api.ui.settings.Toggle label={uiText('sources.toggleAll')} checked={sources.length > 0 && sources.every(source => source.visible)} disabled={!sources.length || snap.loading} onChange={visible => commit(sources.map(source => ({ ...source, visible })))} /></div>
  )
  return (
    <div className="map-pins-frame" data-plugin-widget-layout="fill">
      <api.ui.ScrollPanel fill className="map-pins-scroll" header={bar}>
        <Section className="map-settings map-pins-body">
          <p ref={top} className="map-sources-description">{uiText('pins.description')}</p>
          {(sources.length > 0 || store !== null) && <div className="map-sources-toolbar">
            {sources.length > 0 && <div className="search-field map-sources-search">
              <input className="search-field-input" value={query} onChange={event => setQuery(event.target.value)} placeholder={uiText('pins.searchSources')} aria-label={uiText('pins.searchSources')} />
            </div>}
            {sources.length > 0 && <button type="button" className="panel-tool-btn map-sources-fold" disabled={!shownSources.length}
              title={uiText(anyOpen ? 'pins.collapseAll' : 'pins.expandAll')} aria-label={uiText(anyOpen ? 'pins.collapseAll' : 'pins.expandAll')}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setOpen(anyOpen ? new Set() : new Set(shownSources.map(source => source.id)))}>
              {anyOpen ? <ChevronsDownUp /> : <ChevronsUpDown />}
            </button>}
            {/* No store means nothing has read the file yet — adding here would write
                an empty list over it, which is the failure this section exists to end. */}
            {store !== null && <div className="map-add-source-row">
              <Button
                variant="secondary"
                className="map-add-source"
                onClick={() => { const source = defaultPinSource(sources); setQuery(''); setOpen(current => new Set(current).add(source.id)); setAdded(source.id); commit([source, ...sources]) }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus /> {uiText('auto.3bab9497c30a')}</span>
              </Button>
            </div>}
          </div>}
          {saveError && <p role="alert" className="settings-path-error">{uiText('pins.saveError')}</p>}
          {/* Never while the store is still reading: "no sources yet" is an answer,
              and it must not be given before there is one. */}
          {sources.length === 0 && !snap.loading && <p className="settings-empty-text map-sources-empty">
            <span>{uiText('auto.768b5398251f')}</span><span>{uiText('auto.d83b2865159e')}</span>
          </p>}
          {sources.length > 0 && shownSources.length === 0 && <p className="settings-empty-text">{uiText('sources.noResults')}</p>}
          <div className="map-source-list">
            {shownSources.map((source) => (
              <div key={source.id} className="map-source-sortable" {...reorder.getItemProps(source)}>
                <SourceRow
                  source={source}
                  expanded={open.has(source.id)}
                  onToggle={() => toggle(source.id)}
                  handle={<button {...reorder.getHandleProps(source)} className="settings-reorder-handle map-source-grip" title={uiText('sources.reorder')}><GripVertical /></button>}
                  entries={indexEntries}
                  pinned={snap.sourcePinCounts[source.id] ?? 0}
                  onChange={(patch) => update(source.id, patch)}
                  onDelete={() => commit(sources.filter((s) => s.id !== source.id))}
                />
              </div>
            ))}
            {reorder.liveRegion}
          </div>
        </Section>
      </api.ui.ScrollPanel>
    </div>
  )
}

const EmbedSection: FC<{ kind: 'embed' | 'codeBlock' }> = ({ kind }) => {
  const { SelectField } = api.ui.settings
  const [values, commit] = useSettingsValues()
  return <Section title={uiText(`embed.${kind}`)}>
    <Row title={uiText('surface.provider')} description={uiText('embed.fallback')}><MapProviderSelect settingKey={`${kind}Provider`} /></Row>
    <Row title={uiText('embed.style')}>
      <SelectField ariaLabel={uiText('embed.style')} value={String(values[`${kind}Style`] || 'inherit')}
        onChange={value => commit(`${kind}Style`, value)} options={[{ value: 'inherit', label: uiText('embed.inherit') }, ...MAP_LAYER_CHOICES.map(choice => ({ value: choice.id, label: uiText(choice.labelKey) }))]} />
    </Row>
    <Row title={uiText('embed.theme')}>
      <SelectField ariaLabel={uiText('embed.theme')} value={String(values[`${kind}Theme`] || 'system')}
        onChange={value => commit(`${kind}Theme`, value)} options={['system', 'light', 'dark'].map(value => ({ value, label: uiText(`style.${value}`) }))} />
    </Row>
    <Row title={uiText('embed.overrides')} description={uiText(kind === 'embed' ? 'embed.syntax' : 'embed.codeSyntax')} />
  </Section>
}

/**
 * Settings → Map → Plugins: the plugins that add a tab to the Map sidebar
 * (`map.sidebarTab`), one card each, the same page as Calendar's Plugins. The
 * switch hides that plugin's tabs in Map only; the gear opens the plugin's own
 * settings. Name, version and description come from the installed plugin list.
 */
const PluginsSection: FC = () => {
  const { PluginCard } = api.ui.settings
  const providers = useSidebarProviders()
  const [values, commit] = useSettingsValues()
  const [plugins, setPlugins] = React.useState<Record<string, SidebarPluginInfo>>({})
  const owners = [...new Set(providers.map(provider => provider.owner))]
  const ownersKey = owners.join('\n')
  React.useEffect(() => {
    let live = true
    const ids = ownersKey ? ownersKey.split('\n') : []
    if (!ids.length) return
    mapServices(api).sidebarPlugins(ids)
      .then(result => { if (live) setPlugins(Object.fromEntries(result.plugins.map(plugin => [plugin.id, plugin]))) })
      .catch(() => {})
    return () => { live = false }
  }, [ownersKey])
  const hidden = hiddenSidebarPlugins(values)
  return (
    <Section className="map-plugins-settings">
      <div className="map-plugins-intro"><p>{uiText('plugins.description')}</p></div>
      {owners.length === 0 ? (
        <span className="settings-empty-text">{uiText('plugins.empty')}</span>
      ) : (
        <div className="settings-plugin-list">
          {owners.map((owner) => {
            const plugin = plugins[owner]
            const name = plugin?.name ?? owner
            const enabled = !hidden.includes(owner)
            return (
              <PluginCard
                key={owner}
                name={name}
                version={plugin?.version ?? providers.find(provider => provider.owner === owner)?.version ?? ''}
                versionLabel={uiText('plugins.version')}
                author={plugin?.author}
                authorLabel={uiText('plugins.by')}
                description={plugin?.description}
                enabled={enabled}
                onChange={(next) => commit(HIDDEN_SIDEBAR_PLUGINS_KEY, next ? hidden.filter(id => id !== owner) : [...hidden.filter(id => id !== owner), owner])}
                toggleLabel={uiText(enabled ? 'plugins.disable' : 'plugins.enable', { p0: name })}
                onConfigure={plugin?.configurable ? () => api.workspace.openSettings(`plugin:${owner}`) : undefined}
                configureLabel={uiText('plugins.configure', { p0: name })}
              />
            )
          })}
        </div>
      )}
    </Section>
  )
}

/** `map.settings` — rendered once per manifest `settingsSections` id. */
export const Settings: FC<{ section?: string }> = ({ section }) => {
  if (section === 'embed' || section === 'codeBlock') return <EmbedSection kind={section} />
  if (section === 'pins') return <PinsSection />
  if (section === 'plugins') return <PluginsSection />
  if (section === 'mapbox') return <ProviderSection providerId="mapbox" connectionKey="mapboxConnectionId" />
  if (section === 'openrouteservice') return <ProviderSection providerId="openrouteservice" connectionKey="openRouteServiceConnectionId" />
  return <><MapSection /><MeasurementsSection /></>
}
