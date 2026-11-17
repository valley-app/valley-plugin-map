import { readFileSync } from 'node:fs'
import path from 'node:path'
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
import { accountProviderChoice, hiddenSidebarPlugins, resolveSettings } from '../src/settings'
import { MAP_SIDEBAR_TAB_V1 } from '../src/sidebarContract'
import { useSidebarExtensions } from '../src/SidebarTabs'
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

/** The pin source the development realm seeds, as the settings pane reads it. */
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
    expect(folder.compareDocumentPosition(screen.getByRole('textbox', { name: 'Property' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.change(folder, { target: { value: 'Fie' } })
    // Typing drafts; only a commit saves, so a save cannot re-render the field mid-word.
    expect(storedSources(mock)[0].folder).toBeUndefined()
    fireEvent.change(folder, { target: { value: 'Field' } })
    fireEvent.blur(folder)
    await waitFor(() => expect(storedSources(mock)[0].folder).toBe('Field'))
    expect(document.querySelector('.map-source-stats')).toHaveTextContent('1 note found · 1 on the map')
    fireEvent.change(folder, { target: { value: '' } })
    fireEvent.blur(folder)
    await waitFor(() => expect(storedSources(mock)[0].folder).toBeUndefined())
    expect(document.querySelector('.map-source-stats')).toHaveTextContent('2 notes found · 2 on the map')
    dispose()
  })

  it('edits the rule as two fields joined by =', async () => {
    const { mock, dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]) })
    const match = screen.getByRole('textbox', { name: 'Value' }).closest('.map-source-form-control') as HTMLElement
    expect(match.previousElementSibling).toHaveTextContent(/^Property$/)
    expect(within(match).getByRole('textbox', { name: 'Property' })).toHaveValue('type')
    expect(within(match).getByRole('textbox', { name: 'Value' })).toHaveValue('contact')
    expect(match).toHaveTextContent('=')
    const value = within(match).getByRole('textbox', { name: 'Value' })
    fireEvent.change(value, { target: { value: ' person ' } })
    await act(async () => fireEvent.blur(value))
    await waitFor(() => expect(storedSources(mock)[0].matchValue).toBe('person'))
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
    // The icon picker sits in the same row, before the colours.
    const row = screen.getByText('Look').nextElementSibling as HTMLElement
    const picker = within(row).getByRole('button', { name: 'Pin icon' })
    expect(picker.compareDocumentPosition(chips[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    dispose()
  })

  it('paints the source disc through custom properties, never a resolved colour', async () => {
    const { dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]) }, false)

    const disc = document.querySelector('.map-source-disc') as HTMLElement
    // An inline concrete colour beats every stylesheet, a user's
    // `.valley/design/*.css` included — so a palette reference must reach the
    // element as `var(--color-…)` on a custom property, not as a background.
    expect(disc.tagName).toBe('SPAN')
    expect(disc.style.getPropertyValue('--swatch-fill')).toBe('var(--color-primary-blue)')
    expect(disc.style.getPropertyValue('--swatch-ring')).toBe('#ffffff')
    expect(disc.style.getPropertyValue('--swatch-on')).toBe('var(--color-primary-blue-on)')
    expect(disc.style.background).toBe('')
    expect(disc.querySelector('svg')).not.toBeNull()
    dispose()
  })

  it('gives Delete a glyph on a kit Button and arms it before deleting', async () => {
    const { mock, dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]) })

    // Use and delete share one footer row: the switch at the left, Delete at the right.
    const row = document.querySelector('.map-source-footer') as HTMLElement
    expect(within(row).getByRole('switch', { name: 'Use this source' })).toBeInTheDocument()
    expect(row.querySelector('.map-source-use')).toHaveAttribute('title', expect.stringContaining('draws no pins'))
    const remove = within(row).getByRole('button')
    expect(remove).toHaveTextContent('Delete source')
    // A kit button, not a hand-rolled one — the frame, padding and typography
    // come from the kit so the two plugins cannot drift apart on them.
    expect(remove.getAttribute('data-variant')).toBe('ghost')
    expect(remove.getAttribute('data-size')).toBe('small')
    expect(remove.querySelector('svg')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /^(Hide|Show)$/ })).toBeNull()
    await act(async () => fireEvent.click(remove))
    expect(remove).toHaveTextContent('Confirm')
    expect(storedSources(mock)).toHaveLength(1)
    await act(async () => fireEvent.click(remove))
    await waitFor(() => expect(storedSources(mock)).toHaveLength(0))
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
    expect(document.querySelector('.map-source-stats')).toHaveTextContent('2 notes found · 2 not located yet')
    expect(document.querySelector('.map-source-stats.warn')).toBeNull()
    dispose()
  })

  it('warns when the rule matches notes but none has a usable location', async () => {
    const entries = [contact('Fern', '', { frontmatter: { type: 'contact' } }), contact('Moss', '', { frontmatter: { type: 'contact' } })]
    const { dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]), indexEntries: entries })

    expect(document.querySelector('.map-source-stats.warn')).toHaveTextContent('2 notes found · none has a usable “place”')
    fireEvent.click(document.querySelector('.map-source-disclosure')!)
    expect(document.querySelector('.map-source-sub .map-source-warn')).toHaveTextContent('none has a usable “place”')
    dispose()
  })

  it('shows an ordinary zero count when the predicate matches nothing', async () => {
    const { dispose } = await renderPins({
      datasets: sourceDatasets([{ ...CONTACTS_SOURCE, matchValue: 'persoon' }]),
      indexEntries: [contact('Tim Cook', ['19 Supply Chain Circle, Palo Alto, CA'])]
    })

    expect(document.querySelector('.map-source-stats')).toHaveTextContent(/^0 notes found$/)
    expect(document.querySelector('.map-source-stats.warn')).toBeNull()
    fireEvent.click(document.querySelector('.map-source-disclosure')!)
    expect(document.querySelector('.map-source-count')).toHaveTextContent('0')
    expect(document.querySelector('.map-source-warn')).toBeNull()
    dispose()
  })

  it('asks for the rule while it is still being written', async () => {
    const { dispose } = await renderPins({ datasets: sourceDatasets([{ ...CONTACTS_SOURCE, matchValue: '' }]) })

    expect(document.querySelector('.map-source-stats')).toHaveTextContent(/^Choose a property and value$/)
    fireEvent.click(document.querySelector('.map-source-disclosure')!)
    expect(document.querySelector('.map-source-sub')).toHaveTextContent('Choose a property and value · Whole realm')
    expect(document.querySelector('.map-source-count')).toHaveTextContent('–')
    dispose()
  })

  it('counts notes that carry their own coordinates as already pinned', async () => {
    const entries = [
      contact('Tim Cook', [{ value: '19 Supply Chain Circle, Palo Alto, CA', type: 'Home' }], {
        frontmatter: { type: 'contact', lat: 37.448, lng: -122.136 }
      })
    ]
    const { dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]), indexEntries: entries })

    expect(document.querySelector('.map-source-stats')).toHaveTextContent(/^1 note found · 1 on the map$/)
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

  it('mounts only the visibility switch in a collapsed row and states rule, folder and count', async () => {
    const entries = [contact('Fern', '', { relPath: 'Field/Fern.md', frontmatter: { type: 'contact', lat: 12, lng: 8 } })]
    const { dispose } = await renderPins({ datasets: sourceDatasets([{ ...CONTACTS_SOURCE, folder: 'Field' }]), indexEntries: entries }, false)
    const row = document.querySelector('.map-source-row') as HTMLElement
    expect(row.querySelector('.map-source-icon-btn')).toBeNull()
    expect(within(row).queryByRole('button', { name: 'Pin icon' })).toBeNull()
    expect(row.querySelector('.settings-color-swatch')).toBeNull()
    expect(within(row).queryAllByRole('textbox')).toHaveLength(0)
    expect(within(row).queryByRole('combobox')).toBeNull()
    expect(within(row).getAllByRole('switch')).toHaveLength(1)
    expect(row.querySelector('.map-source-name')).toHaveTextContent('Contacts')
    expect(row.querySelector('.map-source-sub')).toHaveTextContent(/^type = contact · Field$/)
    const count = row.querySelector('.map-source-count') as HTMLElement
    expect(count).toHaveTextContent(/^1$/)
    expect(count).toHaveAttribute('title', '1 note found · 1 on the map')
    // The name and sub-line open the source.
    fireEvent.click(row.querySelector('.map-source-name')!)
    expect(row.querySelector('.map-source-editor')).not.toBeNull()
    dispose()
  })

  it('names an untitled source and the whole realm in its collapsed row', async () => {
    const { dispose } = await renderPins({ datasets: sourceDatasets([{ ...CONTACTS_SOURCE, title: '' }]) }, false)
    expect(document.querySelector('.map-source-name')).toHaveTextContent('Untitled')
    expect(document.querySelector('.map-source-sub')).toHaveTextContent('type = contact · Whole realm')
    dispose()
  })

  it('turns a source off with Use this source and disables its row switch', async () => {
    const { mock, dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]) })
    const use = screen.getByRole('switch', { name: 'Use this source' })
    expect(use).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Contacts' })).not.toBeDisabled()
    await act(async () => fireEvent.click(use))
    await waitFor(() => expect(storedSources(mock)[0].hidden).toBe(true))
    expect(screen.getByRole('switch', { name: 'Use this source' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Contacts' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Contacts' })).not.toBeChecked()
    expect(document.querySelector('.map-source-stats')).toHaveTextContent(/^\d+ notes? found · Turned off$/)
    expect(document.querySelector('.map-source-row')).toHaveClass('is-off')
    expect(document.querySelector('.map-source-count')).toHaveTextContent('–')
    fireEvent.click(document.querySelector('.map-source-disclosure')!)
    expect(document.querySelector('.map-source-sub')).toHaveTextContent(/^Turned off · type = contact$/)
    fireEvent.click(document.querySelector('.map-source-disclosure')!)
    await act(async () => fireEvent.click(screen.getByRole('switch', { name: 'Use this source' })))
    await waitFor(() => expect(storedSources(mock)[0].hidden).toBe(false))
    expect(screen.getByRole('switch', { name: 'Contacts' })).not.toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Contacts' })).toBeChecked()
    dispose()
  })

  it('commits popup fields through the chips field', async () => {
    const { mock, dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]) })
    const row = screen.getByText('Popup').nextElementSibling as HTMLElement
    expect(screen.getByText('Popup')).toHaveAttribute('title', 'Shown when you hover a pin, in this order')
    const chips = row.querySelector('.settings-chips-field') as HTMLElement
    expect(chips).toHaveTextContent('profession')
    expect(chips).toHaveTextContent('place')
    const input = within(chips).getByRole('textbox', { name: 'Popup fields' })
    fireEvent.change(input, { target: { value: '  email ' } })
    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }))
    await waitFor(() => expect(storedSources(mock)[0].hoverFields).toEqual(['profession', 'place', 'email']))
    await waitFor(() => expect(row.querySelector('.settings-chips-field')).toHaveTextContent('email'))
    dispose()
  })

  it('switches the default location property with the coordinate mode and preserves custom fields', async () => {
    const { mock, dispose } = await renderPins({ datasets: sourceDatasets([{ ...CONTACTS_SOURCE, locationField: 'address' }]) })
    const mode = screen.getByRole('group', { name: 'Read from' })
    expect(within(mode).getByRole('button', { name: 'Address' })).toHaveAttribute('aria-pressed', 'true')
    await act(async () => fireEvent.click(within(mode).getByRole('button', { name: 'Coordinates' })))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Location property' })).toHaveValue('coordinates'))
    const property = screen.getByRole('textbox', { name: 'Location property' })
    fireEvent.change(property, { target: { value: 'habitat' } })
    await act(async () => fireEvent.blur(property))
    await act(async () => fireEvent.click(within(screen.getByRole('group', { name: 'Read from' })).getByRole('button', { name: 'Address' })))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Location property' })).toHaveValue('habitat'))
    expect(storedSources(mock)[0].locationField).toBe('habitat')
    dispose()
  })

  it('asks for the title property only when the pin title comes from a property', async () => {
    const { mock, dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]) })
    expect(screen.queryByRole('textbox', { name: 'Title property' })).toBeNull()
    await act(async () => fireEvent.click(within(screen.getByRole('group', { name: 'Title' })).getByRole('button', { name: 'Property' })))
    await waitFor(() => expect(storedSources(mock)[0].labelMode).toBe('property'))
    const field = screen.getByRole('textbox', { name: 'Title property' })
    // The title property sits on its own line right under the Filename | Property choice.
    expect(field.closest('.map-source-form-control')!.previousElementSibling!.previousElementSibling!.querySelector('[role=group]')).toHaveAccessibleName('Title')
    fireEvent.change(field, { target: { value: 'name' } })
    await act(async () => fireEvent.blur(field))
    await waitFor(() => expect(storedSources(mock)[0].labelField).toBe('name'))
    dispose()
  })

  it('lays the editor out as Name, then Notes, Location and Pin, then use and delete', async () => {
    const { dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]) })
    const editor = document.querySelector('.map-source-editor') as HTMLElement
    expect([...editor.querySelectorAll('.map-source-group > .map-source-group-title')].map(node => node.textContent)).toEqual(['Notes', 'Location', 'Pin'])
    expect([...editor.querySelectorAll('.map-source-form-label')].map(node => node.textContent).filter(Boolean)).toEqual([
      'Name', 'Folder', 'Property', 'Read from', 'Look', 'Title', 'Popup'
    ])
    // The name is edited in the form, never in the head; the status sits under the rule.
    expect(within(editor).getByRole('textbox', { name: 'Source title' })).toHaveValue('Contacts')
    expect(document.querySelector('.map-source-head input:not([type=checkbox])')).toBeNull()
    const stats = editor.querySelector('.map-source-stats') as HTMLElement
    expect(stats.closest('.map-source-group')).toHaveTextContent('Notes')
    expect(editor.querySelector('.map-source-footer')).toHaveTextContent('Use this source')
    dispose()
  })

  it('keeps the head identical open and closed, with the chevron between the count and the switch', async () => {
    const { dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]) }, false)
    const head = document.querySelector('.map-source-head') as HTMLElement
    const children = (): string[] => [...head.children].map(node => node.className || node.getAttribute('role') || node.tagName)
    const closed = { html: head.querySelector('.map-source-meta')!.outerHTML, count: head.querySelector('.map-source-count')!.outerHTML, children: children() }
    expect(head.querySelector('.map-source-name')).toHaveTextContent('Contacts')
    expect(head.querySelector('.map-source-sub')).toHaveTextContent(/^type = contact · /)
    const order = [...head.children]
    const count = order.indexOf(head.querySelector('.map-source-count')!)
    const chevron = order.indexOf(head.querySelector('.map-source-disclosure')!)
    expect(chevron).toBe(count + 1)
    expect(order[chevron + 1]).toBe(within(head).getByRole('switch', { name: 'Contacts' }).closest('.map-source-head > *'))
    // A click anywhere on the head opens the source; only the chevron turns.
    fireEvent.click(head.querySelector('.map-source-count')!)
    expect(document.querySelector('.map-source-editor')).not.toBeNull()
    expect(head.querySelector('.map-source-disclosure')).toHaveAttribute('aria-expanded', 'true')
    expect({ html: head.querySelector('.map-source-meta')!.outerHTML, count: head.querySelector('.map-source-count')!.outerHTML, children: children() }).toEqual(closed)
    fireEvent.click(head.querySelector('.map-source-name')!)
    expect(document.querySelector('.map-source-editor')).toBeNull()
    dispose()
  })

  it('expands and collapses every listed source from the toolbar', async () => {
    const definitions = [CONTACTS_SOURCE, { ...CONTACTS_SOURCE, id: 'second', title: 'Second' }, { ...CONTACTS_SOURCE, id: 'third', title: 'Third' }]
    const { dispose } = await renderPins({ datasets: sourceDatasets(definitions) }, false)
    const toolbar = document.querySelector('.map-sources-toolbar') as HTMLElement
    const opened = (): boolean[] => [...document.querySelectorAll('.map-source-row')].map(row => row.classList.contains('is-open'))
    // Search, then the expand/collapse button, then Add source.
    const fold = within(toolbar).getByRole('button', { name: 'Expand all sources' })
    expect(fold).toHaveClass('panel-tool-btn')
    expect(fold.previousElementSibling).toHaveClass('map-sources-search')
    expect(fold.nextElementSibling).toHaveClass('map-add-source-row')
    fireEvent.click(fold)
    expect(opened()).toEqual([true, true, true])
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Collapse all sources' }))
    expect(opened()).toEqual([false, false, false])
    // Any open source turns the button into Collapse all.
    fireEvent.click(document.querySelectorAll('.map-source-disclosure')[1])
    expect(opened()).toEqual([false, true, false])
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Collapse all sources' }))
    expect(opened()).toEqual([false, false, false])
    dispose()
  })

  it('adds a source on an unused palette colour rather than the same blue twice', async () => {
    const { dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]) })

    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Add source/i })))
    await waitFor(() => expect(document.querySelectorAll('.map-source-row')).toHaveLength(2))

    const fills = [...document.querySelectorAll('.settings-color-swatch[data-variant="fill"]')]
    expect(fills.map((chip) => chip.getAttribute('data-color'))).toEqual([
      'palette:yellow',
      'palette:primary-blue'
    ])
    dispose()
  })

  it('fills the pane and keeps the Pin sources bar outside the scrolling content', async () => {
    const config = JSON.parse(readFileSync(path.resolve(__dirname, '../config.json'), 'utf8')) as { settingsSections: { id: string; layout?: string }[] }
    expect(config.settingsSections.find(section => section.id === 'pins')?.layout).toBe('fill')
    // Only the pins page scrolls itself; the other sections keep the pane's scrolling.
    expect(config.settingsSections.filter(section => section.layout === 'fill').map(section => section.id)).toEqual(['pins'])
    const { dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]) }, false)
    const frame = document.querySelector('.map-pins-frame') as HTMLElement
    expect(frame).toHaveAttribute('data-plugin-widget-layout', 'fill')
    const bar = document.querySelector('.map-sources-header') as HTMLElement
    const body = document.querySelector('.map-pins-body') as HTMLElement
    expect(bar).toHaveClass('settings-listpage-header')
    expect(within(bar).getByRole('switch', { name: 'All sources' })).toBeInTheDocument()
    // The bar is the ScrollPanel's header: never inside the content that scrolls.
    expect(body.contains(bar)).toBe(false)
    expect(bar.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const part of ['.map-sources-description', '.map-sources-toolbar', '.map-source-list']) expect(body.querySelector(part), part).not.toBeNull()
    dispose()
  })

  it('keeps Add source in the toolbar beside the search, and alone with zero sources', async () => {
    const { dispose } = await renderPins({ datasets: sourceDatasets([CONTACTS_SOURCE]) }, false)
    const toolbar = document.querySelector('.map-sources-toolbar') as HTMLElement
    expect(within(toolbar).getByRole('textbox', { name: 'Find pin sources' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: /Add source/i }).closest('.map-add-source-row')).not.toBeNull()
    // The page has no Pin icons row: the icon popover carries its own folder actions.
    expect(screen.queryByText('Pin icons')).toBeNull()
    expect(document.querySelectorAll('.settings-section')).toHaveLength(1)
    // A new source goes first, open, while the others stay closed.
    await act(async () => fireEvent.click(within(toolbar).getByRole('button', { name: /Add source/i })))
    await waitFor(() => expect(document.querySelectorAll('.map-source-row')).toHaveLength(2))
    expect([...document.querySelectorAll('.map-source-row')].map(row => row.classList.contains('is-open'))).toEqual([true, false])
    expect(document.querySelector('.map-source-row .map-source-name')).toHaveTextContent('Untitled')
    expect(within(document.querySelector('.map-source-editor') as HTMLElement).getByRole('textbox', { name: 'Source title' })).toHaveValue('')
    dispose()

    const mock = createMockValleyApi({ manifest: { id: 'map', drivers: ['files'] } })
    initLocalization(mock.api)
    initRuntime(mock.api)
    const store = createStore(mock.api)
    await act(async () => { render(React.createElement(Settings, { section: 'pins' })) })
    await waitFor(() => expect(screen.getByText('No pin sources yet')).toBeInTheDocument())
    const empty = document.querySelector('.map-sources-toolbar') as HTMLElement
    expect(within(empty).queryByRole('textbox')).toBeNull()
    await act(async () => fireEvent.click(within(empty).getByRole('button', { name: /Add source/i })))
    await waitFor(() => expect(storedSources(mock)).toHaveLength(1))
    // The new source opens expanded with its title field ready.
    expect(screen.getByRole('textbox', { name: 'Source title' })).toBeInTheDocument()
    cleanup()
    disposeStore(store)
  })
})

describe('Map provider controls', () => {
  it.each(['ok', 'stored'] as const)('shows email subtitles for %s credentials and saves the chosen account', async secretState => {
    const connections = ['field-map', 'survey-map'].map((id) => ({
      id, provider: 'mapbox', displayName: id, email: `${id}@biodiversity.example`,
      capabilities: ['map.style'], secretState
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
    if (secretState === 'stored') expect(screen.getByText('Key saved — checked when used.')).toBeInTheDocument()
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

  it('offers no default centre or offline basemap and sets the default zoom with a slider in steps of five up to 25', async () => {
    const mock = createMockValleyApi({ manifest: { id: 'map', drivers: ['files'] }, settings: { defaultZoom: 11 } })
    initLocalization(mock.api)
    initRuntime(mock.api)
    await act(async () => { render(React.createElement(Settings)) })
    expect(screen.queryByText('Default centre')).toBeNull()
    expect(screen.queryByText('Offline basemap')).toBeNull()
    const slider = screen.getByRole('slider', { name: 'Default zoom' })
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '25')
    expect(slider).toHaveAttribute('step', '5')
    expect(slider).toHaveValue('10')
    fireEvent.change(slider, { target: { value: '15' } })
    fireEvent.pointerUp(slider)
    fireEvent.blur(slider)
    await waitFor(() => expect(mock.api.settings.get().defaultZoom).toBe(15))
  })

  it('lists the plugins that add a Map sidebar tab and switches one off for Map only', async () => {
    const sidebarPlugins = vi.fn(async (ids: string[]) => ({ plugins: ids.map(id => ({ id, name: 'Timetable', version: '1.2.0', author: 'example', description: 'Stations and connections.', configurable: true })) }))
    const mock = createMockValleyApi({ manifest: { id: 'map', drivers: [] }, overrides: { backend: mapBackend({ sidebarPlugins }) } })
    initLocalization(mock.api)
    initRuntime(mock.api)
    mock.api.interop.extensions.provide(MAP_SIDEBAR_TAB_V1, {
      id: 'timetable', label: 'Timetable', icon: { viewBox: '0 0 24 24', path: 'M0 0h24v24H0z' },
      getSnapshot: () => ({ fields: [], actions: [], rows: [] }), subscribe: () => () => {}, run: async () => {}
    })
    const owner = mock.api.interop.extensions.providers(MAP_SIDEBAR_TAB_V1)[0].owner
    await act(async () => { render(<Settings section="plugins" />) })
    await waitFor(() => expect(screen.getByText('Timetable')).toBeInTheDocument())
    expect(sidebarPlugins).toHaveBeenCalledWith([owner])
    expect(screen.getByText('Stations and connections.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Configure Timetable' }))
    expect(mock.api.workspace.openSettings).toHaveBeenCalledWith(`plugin:${owner}`)
    fireEvent.click(screen.getByRole('switch', { name: 'Disable Timetable in Map' }))
    await waitFor(() => expect(mock.api.settings.get().hiddenSidebarPlugins).toEqual([owner]))
    expect(hiddenSidebarPlugins(mock.api.settings.get())).toEqual([owner])
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Timetable in Map' }))
    await waitFor(() => expect(mock.api.settings.get().hiddenSidebarPlugins).toEqual([]))
  })

  it('leaves out the sidebar tabs of a plugin that is switched off', async () => {
    const mock = createMockValleyApi({ manifest: { id: 'map', drivers: [] } })
    initLocalization(mock.api)
    initRuntime(mock.api)
    mock.api.interop.extensions.provide(MAP_SIDEBAR_TAB_V1, {
      id: 'timetable', label: 'Timetable', icon: { viewBox: '0 0 24 24', path: 'M0 0h24v24H0z' },
      getSnapshot: () => ({ fields: [], actions: [], rows: [] }), subscribe: () => () => {}, run: async () => {}
    })
    const owner = mock.api.interop.extensions.providers(MAP_SIDEBAR_TAB_V1)[0].owner
    const Tabs = (): React.ReactElement => <ul>{useSidebarExtensions().map(tab => <li key={tab.id}>{tab.provider.extension.label}</li>)}</ul>
    await act(async () => { render(<Tabs />) })
    expect(screen.getByText('Timetable')).toBeInTheDocument()
    await act(async () => { await mock.api.settings.set('hiddenSidebarPlugins', [owner]) })
    await waitFor(() => expect(screen.queryByText('Timetable')).toBeNull())
    await act(async () => { await mock.api.settings.set('hiddenSidebarPlugins', []) })
    await waitFor(() => expect(screen.getByText('Timetable')).toBeInTheDocument())
  })

  it('says so when no plugin adds a tab to Map', async () => {
    const mock = createMockValleyApi({ manifest: { id: 'map', drivers: [] } })
    initLocalization(mock.api)
    initRuntime(mock.api)
    await act(async () => { render(<Settings section="plugins" />) })
    expect(screen.getByText('No plugin adds a tab to Map.')).toBeInTheDocument()
  })

  it('places each provider account button immediately before its switch', async () => {
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
    // The new source is saved first, so the sidebar lists it first too.
    expect(storedSources(mock).map((s) => s.id)).toEqual([expect.any(String), 'pinsource-contacts'])
    expect(storedSources(mock)[0].id).not.toBe('pinsource-contacts')
    expect(storedSources(mock)[1]).toMatchObject({ title: 'Contacts', matchValue: 'contact' })
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

  it('keeps routing available and changes elevation independently', async () => {
    const connection = { id: 'field-route', provider: 'openrouteservice', displayName: 'Field route', capabilities: ['geo.route', 'geo.elevation'], secretState: 'ok' as const }
    const mock = createMockValleyApi({
      manifest: { id: 'map', drivers: [] }, settings: { routingProvider: 'osrm' },
      overrides: { backend: mapBackend({ listConnections: async () => ({ ok: true, data: { connections: [connection] } }) }) }
    })
    initLocalization(mock.api)
    initRuntime(mock.api)
    await act(async () => render(<ProviderPanel routing />))
    expect(screen.getByRole('combobox', { name: 'Routing provider' })).toBeEnabled()
    const elevation = screen.getByRole('combobox', { name: 'Elevation provider' })
    fireEvent.change(elevation, { target: { value: within(elevation).getByRole('option', { name: 'Field route' }).getAttribute('value') } })
    await waitFor(() => expect(mock.api.settings.get().elevationProvider).toBe(accountProviderChoice('openrouteservice', connection.id)))
    expect(mock.api.settings.get()).toMatchObject({ openRouteServiceEnabled: true, routingProvider: 'osrm' })
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
  await waitFor(() => expect(document.querySelectorAll('.map-pin-tree .map-folder-row')).toHaveLength(2))
  await act(async () => fireEvent.keyDown(document.querySelector('.map-pin-tree .map-folder-row')!, { key: 'ArrowDown', altKey: true }))
  await waitFor(() => expect(storedSources(mock).map(source => source.id)).toEqual(['second', 'hidden', CONTACTS_SOURCE.id, 'empty']))
  // A source opens like a folder and lists the notes it pins.
  await act(async () => fireEvent.click(document.querySelectorAll('.map-pin-tree .map-folder-row')[1]))
  expect(screen.getByText('Fern habitat')).toBeInTheDocument()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Hide all pins on the map' })))
  await waitFor(() => expect(storedSources(mock).find(source => source.id === 'second')!.visible).toBe(false))
  expect(storedSources(mock).find(source => source.id === 'hidden')!.hidden).toBe(true)
  dispose()
})
