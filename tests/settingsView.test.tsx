import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IndexEntry } from '@valley/plugin-sdk/types'
import { createMockValleyApi, mapBackend, emitMapEvent } from './harness'
import { initRuntime } from '../src/runtime'
import { initLocalization } from '../src/localization'
import { createStore, disposeStore } from '../src/store'
import { Settings } from '../src/SettingsView'
import { Panel } from '../src/Panel'
import { accountProviderChoice, resolveSettings } from '../src/settings'
import { ProviderPanel } from '../src/ProviderPanel'
import { planRoute } from '../src/routing'
import { MapColorModeField, MapLayerField } from '../src/MetadataSegment'
import { registerMapSurfaces } from '../src/surfaces'
import { METADATA_PANEL_SEGMENT_V1 } from '@valley/plugin-sdk'
import type { MapConnectionInfo } from '../src/serviceClient'
import { PUBLIC_SEARCH_ID } from '../src/geocodeProviders'

vi.mock('../src/geocode', () => ({
  GeocodeError: class GeocodeError extends Error {},
  searchPlaces: vi.fn(async () => []),
  searchPlacesWithProvider: vi.fn(async () => ({ provider: PUBLIC_SEARCH_ID, places: [] })),
  reverseGeocode: vi.fn(async () => null)
}))

// `../src/index` is deliberately not imported: it pulls in `maplibre-gl`, which
// touches `URL.createObjectURL` at module scope and cannot load under jsdom.
// The settings pane needs the same three things `register()` sets up first.

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const contact = (name: string, place: unknown, over: Partial<IndexEntry> = {}): IndexEntry => ({
  relPath: `Archive/Contacts/${name}.md`,
  title: name,
  kind: 'note',
  frontmatter: { type: 'contact', place, profession: 'Engineer' },
  mtimeMs: 0,
  ...over
})

interface Mounted {
  mock: ReturnType<typeof createMockValleyApi>
  store: ReturnType<typeof createStore>
  dispose: () => void
}

/** Mount `map.settings` on the "Map pins" sub-section. */
async function renderPins(options: Parameters<typeof createMockValleyApi>[0] = {}, expand = true): Promise<Mounted> {
  const mock = createMockValleyApi({ manifest: { id: 'map', drivers: ['files'] }, ...options })
  initLocalization(mock.api)
  initRuntime(mock.api)
  const store = createStore(mock.api)
  // The section and the store both load asynchronously; flushing inside `act`
  // keeps the settling renders out of the test's own assertions.
  await act(async () => {
    render(React.createElement(Settings, { section: 'pins' }))
  })
  await waitFor(() => expect(document.querySelector('.map-source-row')).not.toBeNull())
  if (expand) for (const button of document.querySelectorAll('.map-source-disclosure')) fireEvent.click(button)
  return { mock, store, dispose: () => { cleanup(); disposeStore(store) } }
}

/** The pin sources as they stand in the plugin dataset. */
function storedSources(mock: Mounted['mock']): Record<string, unknown>[] {
  return (mock.datasets.get('map.pin_sources') ?? [])
    .sort((left, right) => Number(left.position) - Number(right.position))
    .map((row) => row.definition as Record<string, unknown>)
}

const sourceDatasets = (sources: Record<string, unknown>[]) => ({
  'map.pin_sources': sources.map((definition, position) => ({
    id: String(definition.id),
    position,
    definition
  }))
})

/** The pin source the development vault seeds, as the settings pane reads it. */
const CONTACTS_SOURCE = {
  id: 'pinsource-contacts',
  title: 'Contacts',
  matchKey: 'type',
  matchValue: 'contact',
  locationMode: 'address',
  locationField: 'place',
  labelMode: 'filename',
  hoverFields: ['profession', 'place'],
  color: 'palette:primary-blue',
  borderColor: '#ffffff',
  icon: 'person',
  visible: true,
  hidden: false
}

describe('Map pin source editor', () => {
  it('keeps the folder filter before the match fields and updates its scope', async () => {
    const entries = [
      contact('Fern', '', { relPath: 'Field/Fern.md', frontmatter: { type: 'contact', lat: 12, lng: 8 } }),
      contact('Moss', '', { relPath: 'Archive/Moss.md', frontmatter: { type: 'contact', lat: 13, lng: 8 } })
    ]
    const { mock, dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]), indexEntries: entries })
    const folder = screen.getByRole('textbox', { name: 'Only in this folder' })
    expect(screen.queryByRole('button', { name: /Advanced/i })).toBeNull()
    expect(folder.compareDocumentPosition(screen.getByRole('textbox', { name: 'Frontmatter key' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.change(folder, { target: { value: 'Fie' } })
    // Typing drafts; only a commit saves, so a save cannot re-render the field mid-word.
    expect(storedSources(mock)[0].folder).toBeUndefined()
    fireEvent.change(folder, { target: { value: 'Field' } })
    fireEvent.blur(folder)
    await waitFor(() => expect(storedSources(mock)[0].folder).toBe('Field'))
    expect(document.querySelector('.map-source-stats')).toHaveTextContent('1 notes match · 1 pinned')
    fireEvent.change(folder, { target: { value: '' } })
    fireEvent.blur(folder)
    await waitFor(() => expect(storedSources(mock)[0].folder).toBeUndefined())
    expect(document.querySelector('.map-source-stats')).toHaveTextContent('2 notes match · 2 pinned')
    dispose()
  })

  it('draws the two colours as one fill chip and one ring chip from the settings kit', async () => {
    const { dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]) })

    const chips = document.querySelectorAll('.map-source-color .settings-color-swatch')
    expect(chips).toHaveLength(2)
    // Fill first, ring second — the same order the Calendar's note-date row
    // uses, so the pair reads identically on both surfaces.
    expect(chips[0].getAttribute('data-variant')).toBe('fill')
    expect(chips[1].getAttribute('data-variant')).toBe('ring')
    expect(chips[0].getAttribute('data-color')).toBe('palette:primary-blue')
    expect(chips[1].getAttribute('data-color')).toBe('#ffffff')
    dispose()
  })

  it('paints the source swatch through custom properties, never a resolved colour', async () => {
    const { dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]) })

    const swatch = document.querySelector('.map-source-swatch') as HTMLElement
    // An inline concrete colour beats every stylesheet, a user's
    // `.valley/design/*.css` included — so a palette reference must reach the
    // element as `var(--color-…)` on a custom property, not as a background.
    expect(swatch.style.getPropertyValue('--swatch-fill')).toBe('var(--color-primary-blue)')
    expect(swatch.style.getPropertyValue('--swatch-ring')).toBe('#ffffff')
    expect(swatch.style.getPropertyValue('--swatch-on')).toBe('var(--color-primary-blue-on)')
    expect(swatch.style.background).toBe('')
    dispose()
  })

  it('gives Hide and Delete a glyph each, as the Calendar note-date row does', async () => {
    const { dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]) })

    const actions = document.querySelector('.map-source-actions') as HTMLElement
    const [hide, remove] = within(actions).getAllByRole('button')
    expect(hide).toHaveTextContent('Hide')
    expect(remove).toHaveTextContent('Delete')
    for (const button of [hide, remove]) {
      // Kit buttons, not hand-rolled ones — the frame, padding and typography
      // come from the kit so the two plugins cannot drift apart on them.
      expect(button.getAttribute('data-variant')).toBe('ghost')
      expect(button.getAttribute('data-size')).toBe('small')
      expect(button.querySelector('svg')).not.toBeNull()
    }
    dispose()
  })

  it('reports what the source finds, so a mistyped key is not silence', async () => {
    const entries = [
      contact('Tim Cook', [{ value: '19 Supply Chain Circle, Palo Alto, CA', type: 'Home' }]),
      contact('Ed Catmull', [{ value: '51 Z-Buffer Avenue, Emeryville, CA', type: 'Home' }])
    ]
    const { dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]), indexEntries: entries })

    // Neither note carries coordinates, so both are waiting on the geocoder —
    // "matched, none locatable" must not read as "no notes match".
    expect(document.querySelector('.map-source-stats')).toHaveTextContent('2 notes match')
    expect(document.querySelector('.map-source-stats.warn')).toBeNull()
    dispose()
  })

  it('shows an ordinary zero count when the predicate matches nothing', async () => {
    const { dispose } = await renderPins({
      datasets: sourceDatasets([{ ...CONTACTS_SOURCE, matchValue: 'persoon' }]),
      indexEntries: [contact('Tim Cook', ['19 Supply Chain Circle, Palo Alto, CA'])]
    })

    expect(document.querySelector('.map-source-stats')).toHaveTextContent('0 notes found')
    expect(document.querySelector('.map-source-stats.warn')).toBeNull()
    dispose()
  })

  it('stays silent while the rule is still being written', async () => {
    const { dispose } = await renderPins({ datasets: sourceDatasets([{ ...CONTACTS_SOURCE, matchValue: '' }]) })

    expect(document.querySelector('.map-source-stats')).toBeNull()
    dispose()
  })

  it('counts notes that carry their own coordinates as already pinned', async () => {
    const entries = [
      contact('Tim Cook', [{ value: '19 Supply Chain Circle, Palo Alto, CA', type: 'Home' }], {
        frontmatter: { type: 'contact', lat: 37.448, lng: -122.136 }
      })
    ]
    const { dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]), indexEntries: entries })

    expect(document.querySelector('.map-source-stats')).toHaveTextContent('1 notes match · 1 pinned')
    dispose()
  })

  it('keeps large source lists lightweight until a source is edited', async () => {
    const definitions = Array.from({ length: 22 }, (_, index) => ({ ...CONTACTS_SOURCE, id: `habitat-${index}`, title: `Habitat ${index}` }))
    const { dispose } = await renderPins({ datasets: sourceDatasets(definitions) }, false)
    expect(document.querySelectorAll('.map-source-row')).toHaveLength(22)
    expect(document.querySelectorAll('.map-source-row input:not([type=checkbox])')).toHaveLength(0)
    expect(document.querySelectorAll('.map-source-color')).toHaveLength(0)
    fireEvent.change(screen.getByRole('textbox', { name: 'Find pin sources' }), { target: { value: 'Habitat 17' } })
    expect(document.querySelectorAll('.map-source-row')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Details: Habitat 17' }))
    expect(document.querySelectorAll('.map-source-color')).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: 'Location property' })).toBeInTheDocument()
    dispose()
  })

  it('switches the default location property with the coordinate mode and preserves custom fields', async () => {
    const { mock, dispose } = await renderPins({ datasets: sourceDatasets([{ ...CONTACTS_SOURCE, locationField: 'address' }]) })
    const mode = screen.getByRole('combobox', { name: 'Location' })
    await act(async () => fireEvent.change(mode, { target: { value: 'coordinate' } }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Location property' })).toHaveValue('coordinates'))
    const property = screen.getByRole('textbox', { name: 'Location property' })
    fireEvent.change(property, { target: { value: 'habitat' } })
    await act(async () => fireEvent.blur(property))
    await act(async () => fireEvent.change(mode, { target: { value: 'address' } }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Location property' })).toHaveValue('habitat'))
    expect(storedSources(mock)[0].locationField).toBe('habitat')
    dispose()
  })

  it('adds a source on an unused palette colour rather than the same blue twice', async () => {
    const { dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]) })

    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Add source/i })))
    await waitFor(() => expect(document.querySelectorAll('.map-source-row')).toHaveLength(2))

    const fills = [...document.querySelectorAll('.settings-color-swatch[data-variant="fill"]')]
    expect(fills.map((chip) => chip.getAttribute('data-color'))).toEqual([
      'palette:primary-blue',
      'palette:yellow'
    ])
    dispose()
  })
})

describe('Map provider controls', () => {
  it('shows email subtitles in provider settings and saves the chosen account', async () => {
    const connections = ['field-map', 'survey-map'].map((id) => ({
      id, provider: 'mapbox', displayName: id, email: `${id}@biodiversity.example`,
      capabilities: ['map.style'], secretState: 'ok' as const
    }))
    const mock = createMockValleyApi({
      manifest: { id: 'map', drivers: [] }, settings: { mapboxConnectionId: 'field-map' },
      overrides: { backend: mapBackend({ listConnections: async () => ({ ok: true, data: { connections } }) }) }
    })
    initLocalization(mock.api)
    initRuntime(mock.api)
    await act(async () => render(<Settings section="mapbox" />))
    const field = screen.getByRole('combobox', { name: 'Mapbox connection' })
    expect(field).toHaveValue('field-map')
    expect(within(field).getByRole('option', { name: 'field-map' })).toHaveAttribute('title', 'field-map@biodiversity.example')
    expect(within(field).getByRole('option', { name: 'survey-map' })).toHaveAttribute('title', 'survey-map@biodiversity.example')
    fireEvent.change(field, { target: { value: 'survey-map' } })
    await waitFor(() => expect(mock.api.settings.get().mapboxConnectionId).toBe('survey-map'))
    expect(field).toHaveValue('survey-map')
  })

  it('describes a provider page in localized rows instead of raw value boxes', async () => {
    const connection = { id: 'field-map', provider: 'mapbox', displayName: 'Field map', capabilities: ['map.style'], secretState: 'ok' as const }
    const mock = createMockValleyApi({
      manifest: { id: 'map', drivers: [] },
      settings: { mapboxEnabled: true, mapboxConnectionId: 'field-map', basemapProvider: accountProviderChoice('mapbox', 'field-map') },
      overrides: { backend: mapBackend({ listConnections: async () => ({ ok: true, data: { connections: [connection] } }) }) }
    })
    initLocalization(mock.api)
    initRuntime(mock.api)
    await act(async () => render(<Settings section="mapbox" />))
    await waitFor(() => expect(screen.getByText('Connected — the saved key works.')).toBeInTheDocument())
    expect(screen.getByText('Basemap')).toBeInTheDocument()
    expect(screen.getByText('Basemap styles · Place search · Reverse geocoding · Routing')).toBeInTheDocument()
    expect(document.querySelector('.settings-readonly-value')).toBeNull()
    expect(document.querySelector('.map-settings')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Manage in Accounts' }))
    expect(mock.api.workspace.openSettings).toHaveBeenCalledWith('accounts')
  })

  it('reports an unused provider and a missing account in plain language', async () => {
    const mock = createMockValleyApi({
      manifest: { id: 'map', drivers: [] }, settings: { openRouteServiceEnabled: true },
      overrides: { backend: mapBackend({ listConnections: async () => ({ ok: true, data: { connections: [] } }) }) }
    })
    initLocalization(mock.api)
    initRuntime(mock.api)
    await act(async () => render(<Settings section="openrouteservice" />))
    expect(screen.getByText('Add a OpenRouteService API-key connection in Accounts first.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Accounts' })).toBeInTheDocument()
    expect(screen.getByText('No account chosen yet.')).toBeInTheDocument()
    expect(screen.getByText('Not used yet. Assign it under Map → Provider roles.')).toBeInTheDocument()
    expect(screen.getByText('Routing · Elevation')).toBeInTheDocument()
  })

  it('places each provider pencil immediately before its switch', async () => {
    const mock = createMockValleyApi({ manifest: { id: 'map', drivers: ['files'] } })
    initLocalization(mock.api)
    initRuntime(mock.api)
    await act(async () => {
      render(React.createElement(Settings))
    })

    for (const provider of ['Mapbox', 'OpenRouteService']) {
      const row = screen.getByText(provider).closest('.settings-path-row') as HTMLElement
      const control = row.querySelector('.settings-row-control') as HTMLElement
      expect(control).not.toBeNull()
      expect(control.children).toHaveLength(2)
      expect(control.children[0]).toHaveAttribute('aria-label', `Configure ${provider === 'Mapbox' ? 'mapbox' : 'openrouteservice'}`)
      expect(control.children[1]).toHaveAttribute('role', 'switch')
    }
  })
})

/**
 * The pane and the map must never disagree about which sources exist.
 *
 * Both views subscribe to the same dataset-backed store.
 */
describe('Map pin sources: one list, not two', () => {
  it('lists the source the map is already drawing', async () => {
    const entries = [contact('Tim Cook', [{ value: '19 Supply Chain Circle, Palo Alto, CA', type: 'Home' }])]
    const { store, dispose } = await renderPins({
      datasets: sourceDatasets([CONTACTS_SOURCE]),
      indexEntries: entries
    })

    expect(store.getSnapshot().pinSources).toHaveLength(1)
    expect(screen.getByDisplayValue('Contacts')).toBeInstanceOf(HTMLInputElement)
    expect(document.querySelector('.map-settings')).not.toHaveTextContent('No pin sources yet')
    dispose()
  })

  it('follows a change made outside the pane, with the pane still open', async () => {
    const { mock, store, dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]) })

    // A write from anywhere else in the plugin — the sidebar's eye takes this
    // same path. The pane must re-render from that list, not from a copy it
    // took at mount.
    await act(async () => {
      store.toggleSourceVisible('pinsource-contacts')
      store.savePinSources(
        store.getSnapshot().pinSources.map((s) => ({ ...s, title: 'People' }))
      )
    })

    expect(screen.getByDisplayValue('People')).toBeInstanceOf(HTMLInputElement)
    expect(storedSources(mock)).toMatchObject([{ id: 'pinsource-contacts', visible: false, title: 'People' }])
    dispose()
  })

  it('adds beside the sources already on disk, never over them', async () => {
    const { mock, dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]) })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Add source/i }))
    })

    // Two records, the seeded one intact — this is the write that used to leave
    // a single blank source where the Contacts pins had come from.
    expect(storedSources(mock).map((s) => s.id)).toEqual(['pinsource-contacts', expect.any(String)])
    expect(storedSources(mock)[0]).toMatchObject({ title: 'Contacts', matchValue: 'contact' })
    dispose()
  })

  it('refuses to write before it has read, so an unread dataset is never emptied', async () => {
    const mock = createMockValleyApi({ manifest: { id: 'map', drivers: ['files'] } })
    initLocalization(mock.api)
    initRuntime(mock.api)
    const store = createStore(mock.api)

    // Synchronously after construction the first read has not resolved. An
    // empty in-memory list at this point means "not read yet", never "empty".
    expect(store.savePinSources([])).toBe(false)

    await act(async () => {
      await Promise.resolve()
    })
    await waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    expect(store.savePinSources([])).toBe(true)
    disposeStore(store)
  })
})

describe('Map service roles', () => {
  it('shows Mapbox usage as unavailable with a dashboard link, without a made-up counter', async () => {
    const mock = createMockValleyApi({ manifest: { id: 'map', drivers: [] }, overrides: { backend: mapBackend({ listConnections: async () => ({ ok: true, data: { connections: [] } }) }) } })
    initLocalization(mock.api)
    initRuntime(mock.api)
    await act(async () => render(<ProviderPanel />))
    expect(screen.getByText('Usage totals are not available through the Mapbox API.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Usage dashboard' })).toHaveAttribute('href', 'https://console.mapbox.com/account/statistics/')
    expect(screen.queryByText(/requests used|remaining/)).toBeNull()
  })

  it('renders per-service quota snapshots for the selected accounts, including zero remaining and past resets', async () => {
    const connections: MapConnectionInfo[] = [
      { id: 'field-route', provider: 'openrouteservice', displayName: 'Field route', capabilities: ['geo.route', 'geo.elevation'], secretState: 'ok', usage: [
        { service: 'routing', limit: 2000, remaining: 1872, observedAt: 1700000000000, resetAt: 1700003600000 },
        { service: 'elevation', limit: 1000, remaining: 900, observedAt: 1700000000000 }
      ] },
      { id: 'survey-elevation', provider: 'openrouteservice', displayName: 'Survey elevation', capabilities: ['geo.route', 'geo.elevation'], secretState: 'ok', usage: [
        { service: 'elevation', limit: 1000, remaining: 0, observedAt: 1700000000000 }
      ] }
    ]
    const listConnections = vi.fn(async () => ({ ok: true as const, data: { connections: structuredClone(connections) } }))
    const mock = createMockValleyApi({ manifest: { id: 'map', drivers: [] },
      settings: { routingProvider: accountProviderChoice('openrouteservice', 'field-route'), elevationProvider: accountProviderChoice('openrouteservice', 'survey-elevation'), openRouteServiceEnabled: true },
      overrides: { backend: mapBackend({ listConnections }) }
    })
    initLocalization(mock.api)
    initRuntime(mock.api)
    await act(async () => render(<ProviderPanel routing />))
    expect(screen.getByText('128 / 2000 requests used')).toBeInTheDocument()
    expect(screen.getByText('1872 remaining')).toBeInTheDocument()
    expect(screen.getByText('1000 / 1000 requests used')).toBeInTheDocument()
    expect(screen.getByText('0 remaining')).toBeInTheDocument()
    expect(screen.queryByText('100 / 1000 requests used')).toBeNull()
    expect(screen.getAllByText(/Last response:/)).toHaveLength(2)
    expect(screen.getByText(/Reported reset:/)).toHaveTextContent(new Date(1700003600000).toLocaleString())
    expect(screen.getByText(/not a billing total/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Usage dashboard' })).toHaveAttribute('href', 'https://account.heigit.org/')
    expect(listConnections).toHaveBeenCalledTimes(1)
    connections[0].usage = []
    act(() => emitMapEvent(mock.api, 'connectionsChanged'))
    await waitFor(() => expect(screen.queryByText('128 / 2000 requests used')).toBeNull())
    expect(screen.getByText(/No quota reported yet/)).toBeInTheDocument()
    expect(screen.getByText('0 remaining')).toBeInTheDocument()
  })

  it('synchronizes Mapbox styles with the inspector and falls back when switching to free maps', async () => {
    const connection = { id: 'field-map', provider: 'mapbox', displayName: 'Field map', capabilities: ['map.style'], secretState: 'ok' as const }
    const mock = createMockValleyApi({
      manifest: { id: 'map', drivers: [] },
      settings: {
        mapboxEnabled: true, basemapProvider: accountProviderChoice('mapbox', connection.id),
        mapViewState: { lng: 8.5, lat: 12.4, zoom: 11, bearing: 0, pitch: 0, style: 'outdoors', colorMode: 'dark' }
      },
      overrides: { backend: mapBackend({ listConnections: async () => ({ ok: true, data: { connections: [connection] } }) }) }
    })
    initLocalization(mock.api)
    initRuntime(mock.api)
    const store = createStore(mock.api)
    try {
      await act(async () => { await store.ready; render(<><dl><MapColorModeField /><MapLayerField /></dl><ProviderPanel /></>) })
      const field = screen.getByRole('combobox', { name: 'Map style' })
      const mode = screen.getByRole('combobox', { name: 'Map mode' })
      expect(field).toHaveValue('outdoors')
      expect(mode).toHaveValue('dark')
      expect(within(mode).getAllByRole('option').map((option) => option.textContent)).toEqual(['System', 'Light', 'Dark'])
      await act(async () => fireEvent.change(mode, { target: { value: 'system' } }))
      expect(store.getSnapshot()).toMatchObject({ style: 'outdoors', colorMode: 'system' })
      await act(async () => fireEvent.change(mode, { target: { value: 'light' } }))
      expect(store.getSnapshot()).toMatchObject({ style: 'outdoors', colorMode: 'light' })
      expect(within(field).getAllByRole('option').map((option) => option.textContent)).toEqual(['Streets', 'Satellite', 'Navigation', 'Outdoors'])
      for (const style of ['navigation', 'outdoors'] as const) {
        await act(async () => fireEvent.change(field, { target: { value: style } }))
        expect(store.getSnapshot().style).toBe(style)
        await act(async () => expect(store.applyLinkState({ ...store.buildLinkState(), style })).toBe(true))
        expect(mock.api.settings.get().mapViewState).toMatchObject({ style, colorMode: 'light' })
      }
      await act(async () => store.setColorMode('dark'))
      expect(mode).toHaveValue('dark')
      expect(field).toHaveValue('outdoors')
      fireEvent.change(screen.getByRole('combobox', { name: 'Map provider' }), { target: { value: 'free' } })
      await waitFor(() => expect(field).toHaveValue('streets'))
      expect(within(field).getAllByRole('option').map((option) => option.textContent)).toEqual(['Streets', 'Satellite'])
      expect(store.getSnapshot().style).toBe('streets')
      expect(mode).toHaveValue('dark')
      await act(async () => store.setStyle('outdoors'))
      expect(store.getSnapshot().style).toBe('streets')
    } finally { cleanup(); disposeStore(store) }
  })

  it('changes provider and account in a dedicated inspector tab while preserving the satellite layer', async () => {
    const connections = ['field-map', 'survey-map'].map((id) => ({
      id, provider: 'mapbox', displayName: id, email: `${id}@biodiversity.example`,
      capabilities: ['map.style', 'geo.search', 'geo.route'], secretState: 'ok' as const
    }))
    const mock = createMockValleyApi({
      manifest: { id: 'map', drivers: [] },
      settings: { defaultStyle: 'satellite', mapboxEnabled: false, routingProvider: 'account:openrouteservice:field-route', openRouteServiceEnabled: true, searchProvider: 'nominatim' },
      overrides: { backend: mapBackend({ listConnections: async () => ({ ok: true, data: { connections } }) }) }
    })
    initLocalization(mock.api)
    initRuntime(mock.api)
    const store = createStore(mock.api)
    const off = registerMapSurfaces(mock.api)
    try {
      await act(async () => { await store.ready; render(<ProviderPanel />) })
      const segment = mock.api.interop.extensions.providers(METADATA_PANEL_SEGMENT_V1).find((entry) => entry.extension.id === 'map.providers')?.extension
      expect(segment).toMatchObject({ icon: 'mapbox', label: 'Mapbox', pluginTabs: true, pluginSurfaces: ['main_workspace'] })
      expect(mock.api.interop.extensions.providers(METADATA_PANEL_SEGMENT_V1).find((entry) => entry.extension.id === 'map.routing')?.extension)
        .toMatchObject({ icon: 'route', label: 'OpenRouteService', pluginTabs: true, pluginSurfaces: ['main_workspace'] })
      expect(screen.getByText('No account needed')).toBeInTheDocument()
      fireEvent.change(screen.getByRole('combobox', { name: 'Map provider' }), { target: { value: 'mapbox' } })
      await waitFor(() => expect(mock.api.settings.get().basemapProvider).toBe(accountProviderChoice('mapbox', 'field-map')))
      const account = screen.getByRole('combobox', { name: 'Account' })
      expect(account).toHaveValue('field-map')
      expect(account).toHaveClass('map-select-fill')
      expect(account.closest('.props-info-row')).toHaveClass('map-props-control-row')
      expect(mock.api.settings.get()).toMatchObject({ mapboxEnabled: true, searchProvider: 'nominatim', routingProvider: 'account:openrouteservice:field-route' })
      expect(within(account).getByRole('option', { name: 'survey-map' })).toHaveAttribute('title', 'survey-map@biodiversity.example')
      fireEvent.change(account, { target: { value: 'survey-map' } })
      await waitFor(() => expect(mock.api.settings.get().basemapProvider).toBe(accountProviderChoice('mapbox', 'survey-map')))
      expect(screen.getByRole('combobox', { name: 'Account' })).toHaveValue('survey-map')
      expect(store.getSnapshot().style).toBe('satellite')
      expect(store.settings().basemapProvider).toBe(accountProviderChoice('mapbox', 'survey-map'))
      fireEvent.change(screen.getByRole('combobox', { name: 'Map provider' }), { target: { value: 'free' } })
      await waitFor(() => expect(mock.api.settings.get().basemapProvider).toBe('free'))
      expect(mock.api.settings.get()).toMatchObject({ searchProvider: 'nominatim', routingProvider: 'account:openrouteservice:field-route' })
      expect(store.getSnapshot().style).toBe('satellite')
    } finally { cleanup(); off(); disposeStore(store) }
  })

  it('switches routing between OSRM and separate saved accounts without changing maps, search or elevation', async () => {
    const connections = [
      { id: 'field-map', provider: 'mapbox', displayName: 'Field map', capabilities: ['map.style', 'geo.search', 'geo.route'], secretState: 'ok' as const },
      ...['field-route', 'survey-route'].map((id) => ({ id, provider: 'openrouteservice', displayName: id, email: `${id}@biodiversity.example`, capabilities: ['geo.route', 'geo.elevation'], secretState: 'ok' as const })),
      { id: 'missing-route', provider: 'unreadable', displayName: 'Unreadable router', capabilities: ['geo.route'], secretState: 'unreadable' as const },
      { id: 'tiles-only', provider: 'tiles', displayName: 'Tiles only', capabilities: ['map.style'], secretState: 'ok' as const }
    ]
    const mapChoice = accountProviderChoice('mapbox', 'field-map')
    const route = vi.fn(async () => ({ ok: true as const, data: { coordinates: [[8, 12], [8.1, 12.1]] as Array<[number, number]>, distanceMeters: 1000, durationSeconds: 600 } }))
    const mock = createMockValleyApi({
      manifest: { id: 'map', drivers: [] },
      settings: { mapboxEnabled: true, basemapProvider: mapChoice, searchProvider: mapChoice, mapboxConnectionId: 'field-map', openRouteServiceEnabled: false, elevationProvider: 'none' },
      overrides: { backend: mapBackend({ listConnections: async () => ({ ok: true, data: { connections } }), route }) }
    })
    initLocalization(mock.api)
    initRuntime(mock.api)
    await act(async () => render(<ProviderPanel routing />))
    const provider = screen.getByRole('combobox', { name: 'Routing provider' })
    expect(within(provider).getAllByRole('option').map((option) => option.textContent)).toEqual(['OSRM (open source)', 'Mapbox', 'OpenRouteService'])
    expect(screen.getByText('No account needed')).toBeInTheDocument()
    const stops = [{ lng: 8, lat: 12, label: 'Meadow' }, { lng: 8.1, lat: 12.1, label: 'Canopy' }]
    for (const [selected, id] of [['openrouteservice', 'field-route'], ['mapbox', 'field-map'], ['openrouteservice', 'field-route']]) {
      fireEvent.change(provider, { target: { value: selected } })
      await waitFor(() => expect(mock.api.settings.get().routingProvider).toBe(accountProviderChoice(selected, id)))
      await planRoute(stops, 'walking', resolveSettings(mock.api.settings.get()))
      expect(route).toHaveBeenLastCalledWith(id, [[8, 12], [8.1, 12.1]], 'walking')
      expect(mock.api.settings.get()).toMatchObject({ basemapProvider: mapChoice, searchProvider: mapChoice, elevationProvider: 'none' })
    }
    expect(mock.api.settings.get()).toMatchObject({ openRouteServiceEnabled: true, openRouteServiceConnectionId: 'field-route' })
    const account = screen.getByRole('combobox', { name: 'Account' })
    expect(within(account).queryByRole('option', { name: 'Field map' })).toBeNull()
    expect(within(account).getByRole('option', { name: 'survey-route' })).toHaveAttribute('title', 'survey-route@biodiversity.example')
    fireEvent.change(account, { target: { value: 'survey-route' } })
    await waitFor(() => expect(mock.api.settings.get().routingProvider).toBe(accountProviderChoice('openrouteservice', 'survey-route')))
    await planRoute(stops, 'cycling', resolveSettings(mock.api.settings.get()))
    expect(route).toHaveBeenLastCalledWith('survey-route', [[8, 12], [8.1, 12.1]], 'cycling')
    fireEvent.change(provider, { target: { value: 'osrm' } })
    await waitFor(() => expect(mock.api.settings.get().routingProvider).toBe('osrm'))
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ routes: [{ geometry: { coordinates: [[8, 12], [8.1, 12.1]] }, distance: 1000, duration: 600 }] }))
    vi.stubGlobal('fetch', fetcher)
    route.mockClear()
    await planRoute(stops, 'walking', resolveSettings(mock.api.settings.get()))
    expect(route).not.toHaveBeenCalled()
    expect(String(fetcher.mock.calls[0][0])).toContain('routing.openstreetmap.de/routed-foot/')
    expect(mock.api.settings.get()).toMatchObject({ basemapProvider: mapChoice, searchProvider: mapChoice, elevationProvider: 'none', openRouteServiceConnectionId: 'survey-route' })
  })

  it('keeps routing available with an offline map and changes elevation independently', async () => {
    const connection = { id: 'field-route', provider: 'openrouteservice', displayName: 'Field route', capabilities: ['geo.route', 'geo.elevation'], secretState: 'ok' as const }
    const mock = createMockValleyApi({
      manifest: { id: 'map', drivers: [] }, settings: { offlineBasemapPath: 'maps/field.pmtiles', routingProvider: 'osrm' },
      overrides: { backend: mapBackend({ listConnections: async () => ({ ok: true, data: { connections: [connection] } }) }) }
    })
    initLocalization(mock.api)
    initRuntime(mock.api)
    await act(async () => render(<ProviderPanel routing />))
    expect(screen.getByRole('combobox', { name: 'Routing provider' })).toBeEnabled()
    const elevation = screen.getByRole('combobox', { name: 'Elevation provider' })
    fireEvent.change(elevation, { target: { value: within(elevation).getByRole('option', { name: 'Field route' }).getAttribute('value') } })
    await waitFor(() => expect(mock.api.settings.get().elevationProvider).toBe(accountProviderChoice('openrouteservice', connection.id)))
    expect(mock.api.settings.get()).toMatchObject({ openRouteServiceEnabled: true, routingProvider: 'osrm', offlineBasemapPath: 'maps/field.pmtiles' })
  })

  it('reports an unavailable selected account and failed saves without claiming a switch succeeded', async () => {
    const mock = createMockValleyApi({
      manifest: { id: 'map', drivers: [] }, settings: { routingProvider: 'account:openrouteservice:missing', openRouteServiceEnabled: true },
      overrides: { backend: mapBackend({ listConnections: async () => ({ ok: true, data: { connections: [] } }) }), settings: { set: async () => ({ ok: false, error: 'Save failed' }) } }
    })
    initLocalization(mock.api)
    initRuntime(mock.api)
    await act(async () => render(<ProviderPanel routing />))
    expect(screen.getByRole('combobox', { name: 'Account' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Account' })).toHaveTextContent('Account unavailable')
    fireEvent.change(screen.getByRole('combobox', { name: 'Routing provider' }), { target: { value: 'osrm' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('These map changes could not be saved')
    expect(mock.api.settings.get().routingProvider).toBe('account:openrouteservice:missing')
    expect(screen.getByRole('combobox', { name: 'Routing provider' })).toHaveValue('openrouteservice')
  })

  it('discovers community capabilities and preserves a disabled Mapbox role choice', async () => {
    const connections = [
      {
        id: 'mapbox-primary',
        provider: 'mapbox',
        displayName: 'Mapbox primary',
        capabilities: ['map.style', 'geo.search', 'geo.route'],
        secretState: 'ok' as const
      },
      {
        id: 'community-atlas',
        provider: 'community-atlas',
        displayName: 'Community Atlas',
        capabilities: ['map.style', 'geo.search', 'geo.route', 'geo.elevation'],
        secretState: 'ok' as const
      }
    ]
    const mapboxChoice = accountProviderChoice('mapbox', 'mapbox-primary')
    const mock = createMockValleyApi({
      manifest: { id: 'map', drivers: [] },
      settings: {
        mapboxEnabled: false,
        mapboxConnectionId: 'mapbox-primary',
        searchProvider: mapboxChoice
      },
      overrides: {
        backend: mapBackend({
            listConnections: async () => ({ ok: true, data: { connections } })
          })
      }
    })
    initLocalization(mock.api)
    initRuntime(mock.api)
    await act(async () => render(React.createElement(Settings)))

    const searchField = screen.getByRole('combobox', { name: 'Place search provider' })
    expect(within(searchField).getByRole('option', { name: 'Community Atlas' })).toBeInTheDocument()
    expect(within(searchField).queryByRole('option', { name: 'Mapbox primary' })).toBeNull()
    expect(searchField).toHaveValue('nominatim')
    expect(mock.api.settings.get().searchProvider).toBe(mapboxChoice)

    fireEvent.click(screen.getByRole('switch', { name: 'Enable Mapbox' }))
    await waitFor(() => expect(searchField).toHaveValue(mapboxChoice))

    fireEvent.click(screen.getByRole('switch', { name: 'Enable Mapbox' }))
    await waitFor(() => expect(searchField).toHaveValue('nominatim'))
    expect(mock.api.settings.get().searchProvider).toBe(mapboxChoice)
  })
})


describe('shared measurements', () => {
  it('writes only the changed quantity and observes another consumer live', async () => {
    const mock = createMockValleyApi({ manifest: { id: 'map' } })
    initLocalization(mock.api)
    initRuntime(mock.api)
    const store = createStore(mock.api)
    try {
      await act(async () => { render(React.createElement(Settings)) })
      const distance = screen.getByRole('combobox', { name: 'Distance' })
      expect(distance).toHaveValue('km')
      await act(async () => { fireEvent.change(distance, { target: { value: 'mi' } }) })
      expect(mock.api.sharedState.patchUnits).toHaveBeenCalledWith({ distance: 'mi' })
      expect(mock.api.getState().units).toMatchObject({ distance: 'mi', length: 'm' })
      await act(async () => { mock.emitState({ units: { ...mock.api.getState().units, length: 'ft' } }) })
      expect(screen.getByRole('combobox', { name: 'Elevation' })).toHaveValue('ft')
      expect(store.getSnapshot().units.length).toBe('ft')
      vi.mocked(mock.api.sharedState.patchUnits).mockResolvedValueOnce(false)
      await act(async () => { fireEvent.change(distance, { target: { value: 'km' } }) })
      expect(screen.getByRole('alert')).toHaveTextContent('Could not save shared units')
      expect(distance).toHaveValue('mi')
    } finally { cleanup(); disposeStore(store) }
  })
})

it.each(['embed', 'codeBlock'] as const)('saves independent provider, style, and appearance defaults for %s', async kind => {
  const mock = createMockValleyApi({ manifest: { id: 'map' } })
  initRuntime(mock.api); initLocalization(mock.api)
  await act(async () => { render(<Settings section={kind} />) })
  fireEvent.change(screen.getByRole('combobox', { name: 'Map style' }), { target: { value: 'satellite' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Appearance' }), { target: { value: 'light' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Map provider' }), { target: { value: 'free' } })
  await waitFor(() => expect(mock.api.settings.get()).toMatchObject({ [`${kind}Style`]: 'satellite', [`${kind}Theme`]: 'light', [`${kind}Provider`]: 'free' }))
  expect(mock.api.settings.get().defaultStyle).toBeUndefined()
})


it('persists source order through filtered settings without dropping hidden sources and switches all sources', async () => {
  const definitions = Array.from({ length: 4 }, (_, index) => ({ ...CONTACTS_SOURCE, id: `source-${index}`, title: index === 1 ? 'Other' : `Habitat ${index}`, hidden: index === 1 }))
  const { mock, dispose } = await renderPins({ datasets: sourceDatasets(definitions) }, false)
  fireEvent.change(screen.getByRole('textbox', { name: 'Find pin sources' }), { target: { value: 'Habitat' } })
  await act(async () => fireEvent.keyDown(document.querySelectorAll('.map-source-grip')[0], { key: 'ArrowDown' }))
  await waitFor(() => expect(storedSources(mock).map(source => source.id)).toEqual(['source-2', 'source-1', 'source-0', 'source-3']))
  await act(async () => fireEvent.click(document.querySelector('.map-sources-header input')!))
  await waitFor(() => expect(storedSources(mock).every(source => source.visible === false)).toBe(true))
  expect(storedSources(mock)[1].hidden).toBe(true)
  dispose()
})


it('reorders sidebar sources without losing hidden or empty definitions', async () => {
  const definitions = [CONTACTS_SOURCE, { ...CONTACTS_SOURCE, id: 'hidden', title: 'Hidden', hidden: true }, { ...CONTACTS_SOURCE, id: 'second', title: 'Second' }, { ...CONTACTS_SOURCE, id: 'empty', title: 'Empty', matchValue: 'absent' }]
  const { mock, store, dispose } = await renderPins({ datasets: sourceDatasets(definitions), indexEntries: [contact('Fern habitat', '47.1, 8.1', { frontmatter: { type: 'contact', lat: 47.1, lng: 8.1 } })] }, false)
  await act(async () => { store.setPanelTab('pins'); render(<Panel />) })
  await waitFor(() => expect(document.querySelectorAll('.map-sidebar-row')).toHaveLength(2))
  await act(async () => fireEvent.keyDown(document.querySelector('.map-sidebar-row .map-source-grip')!, { key: 'ArrowDown' }))
  await waitFor(() => expect(storedSources(mock).map(source => source.id)).toEqual(['second', 'hidden', CONTACTS_SOURCE.id, 'empty']))
  fireEvent.click(document.querySelector('.map-sidebar-row .map-source-disclosure')!)
  expect(document.querySelector('.map-sidebar-details')).not.toBeNull()
  await act(async () => fireEvent.click(document.querySelector('.map-sidebar-sources .map-sources-header input')!))
  await waitFor(() => expect(storedSources(mock).find(source => source.id === 'second')!.visible).toBe(false))
  expect(storedSources(mock).find(source => source.id === 'hidden')!.hidden).toBe(true)
  dispose()
})
