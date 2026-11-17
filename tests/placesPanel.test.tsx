import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataRecord } from '@valley/plugin-sdk/types'
import { createMockValleyApi } from './harness'
import { initRuntime } from '../src/runtime'
import { initLocalization } from '../src/localization'
import { createStore, disposeStore } from '../src/store'
import { Panel } from '../src/Panel'
import { injectStyles } from '../src/styles'
import { registerMapSurfaces } from '../src/surfaces'
import { MetadataSegment } from '../src/MetadataSegment'
import { SearchField } from '../src/SearchBox'
import { METADATA_PANEL_SEGMENT_V1, PLUGIN_SURFACE_V1 } from '@valley/plugin-sdk'

// `../src/index` is deliberately not imported: it pulls in `maplibre-gl`, which
// touches `URL.createObjectURL` at module scope and cannot load under jsdom.

// The address field is the shared geocoder `SearchBox`, so the panel reaches the
// network the same way every other search does. One stubbed hit is all the form
// needs, and stubbing it here keeps the suite off a shared free endpoint.
vi.mock('../src/geocode', () => ({
  GeocodeError: class GeocodeError extends Error {},
  searchPlaces: vi.fn(async () => [
    { name: 'Flint Center, Cupertino', lng: -122.0164, lat: 37.3196, context: 'California' }
  ]),
  reverseGeocode: vi.fn(async () => null)
}))

afterEach(cleanup)

const APPLE_PARK: DataRecord = {
  id: 'apple-park',
  name: 'Apple Park, Cupertino',
  lng: -122.009,
  lat: 37.3349,
  createdAt: '2026-08-14T06:00:00.000Z'
}

interface Mounted {
  mock: ReturnType<typeof createMockValleyApi>
  store: ReturnType<typeof createStore>
  dispose: () => void
}

async function renderPanel(places: DataRecord[] = []): Promise<Mounted> {
  const mock = createMockValleyApi({
    manifest: { id: 'map', drivers: ['files'] },
    realm: { path: '/fixtures/map-places', name: 'Map places', displayName: 'Map places' },
    indexEntries: [
      { relPath: 'Apple/The Macintosh.md', title: 'The Macintosh', kind: 'note', mtimeMs: 0 },
      { relPath: 'Apple/The Product Line Cut.md', title: 'The Product Line Cut', kind: 'note', mtimeMs: 0 }
    ],
    settings: { mapSessionState: { id: 'session', panelTab: 'places' } },
    datasets: { 'map.places': places }
  })
  mock.api.resources.provide({
    kinds: ['place'],
    search: async ({ query }) => query
      ? [{
          id: 'flint-center',
          kind: 'place',
          label: 'Flint Center, Cupertino',
          description: 'California',
          value: 'Flint Center, Cupertino',
          metadata: { longitude: -122.0164, latitude: 37.3196 }
        }]
      : []
  })
  initLocalization(mock.api)
  initRuntime(mock.api)
  const store = createStore(mock.api)
  const off = registerMapSurfaces(mock.api)
  mock.api.workspace.showProperties = vi.fn(() => {
    const provider = mock.api.interop.extensions.providers(PLUGIN_SURFACE_V1).find((entry) => entry.extension.surface === 'main_workspace')!.extension
    const snapshot = provider.getSnapshot()
    const segment = mock.api.interop.extensions.providers(METADATA_PANEL_SEGMENT_V1)[0].extension
    render(<>{segment.render({ relPath: '', kind: 'unsupported', subject: { pluginId: 'map', surface: 'main_workspace', view: snapshot.view, item: snapshot.item } })}</>)
  })
  await act(async () => {
    render(React.createElement(Panel))
  })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add a place' })).toBeTruthy())
  return { mock, store, dispose: () => { cleanup(); off(); disposeStore(store) } }
}

const storedPlaces = (mock: Mounted['mock']): Record<string, unknown>[] =>
  (mock.datasets.get('map.places') ?? []) as Record<string, unknown>[]

/** Type an address and take the geocoder's first hit. */
async function pickAddress(): Promise<void> {
  const address = screen.getByPlaceholderText('Search an address…')
  await act(async () => {
    fireEvent.change(address, { target: { value: 'Flint Center' } })
  })
  await act(async () => {
    fireEvent.keyDown(address, { key: 'Enter' })
    await Promise.resolve()
  })
  const result = await screen.findByText('Flint Center, Cupertino')
  await act(async () => {
    fireEvent.click(result)
  })
}

/** Open a row's ⋯ menu and run one of its items (searched through submenus). */
async function chooseFromMenu(mock: Mounted['mock'], button: HTMLElement, id: string): Promise<void> {
  await act(async () => { fireEvent.click(button) })
  const find = (items: { id?: string; submenu?: unknown[]; onSelect?: () => unknown }[]): { onSelect?: () => unknown } | undefined => {
    for (const item of items) {
      if (item.id === id) return item
      const nested = item.submenu ? find(item.submenu as never) : undefined
      if (nested) return nested
    }
  }
  const item = find(mock.menus.at(-1) as never)
  if (!item?.onSelect) throw new Error(`no menu item ${id}`)
  await act(async () => { await item.onSelect!() })
}

describe('Favourite places: add and edit by hand', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('shares the search frame while retaining selection, submit, dismissal, and compact route hooks', () => {
    const mock = createMockValleyApi({ manifest: { id: 'map' } })
    initLocalization(mock.api)
    initRuntime(mock.api)
    const result = { name: 'Canopy station', lng: 8.24, lat: 12.46 }
    const props = {
      query: '', results: [result], busy: false, error: null, open: false,
      placeholder: 'Find a place', onActiveMove: vi.fn(), onQueryChange: vi.fn(),
      onSubmit: vi.fn(), onDismiss: vi.fn(), onPick: vi.fn(), onClear: vi.fn()
    }
    const { container, rerender } = render(<SearchField {...props} />)
    const input = screen.getByPlaceholderText('Find a place')
    const frame = input.parentElement!
    expect(frame).toHaveClass('search-field')
    expect(input).toHaveClass('search-field-input')
    expect(frame.querySelector('.search-field-icon')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'Canopy' } })
    expect(props.onQueryChange).toHaveBeenCalledWith('Canopy')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(props.onActiveMove.mock.calls).toEqual([[1], [-1]])
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onSubmit).toHaveBeenCalledOnce()
    rerender(<SearchField {...props} query="Canopy" activeIndex={0} />)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onPick).toHaveBeenCalledWith(result)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(props.onDismiss).toHaveBeenCalledOnce()
    const clear = screen.getByRole('button', { name: 'Clear' })
    expect(clear).toHaveClass('search-field-action')
    expect(clear.parentElement).toBe(frame)
    fireEvent.click(clear)
    expect(props.onClear).toHaveBeenCalledOnce()
    rerender(<SearchField {...props} flat />)
    expect(container.querySelector('.map-search')).toHaveClass('is-flat')
    expect(screen.getByPlaceholderText('Find a place')).toBe(input)
  })

  it('keeps the add-place button visible without hovering', async () => {
    const { dispose } = await renderPanel()
    const disposeStyles = injectStyles()
    try {
      const add = screen.getByRole('button', { name: 'Add a place' })
      expect(add).toBeVisible()
      // A Files-style toolbar button: always shown, never the hover-only row action.
      expect(add).toHaveClass('panel-tool-btn')
      expect(add).not.toHaveClass('map-row-action')
      expect(getComputedStyle(add).opacity).not.toBe('0')
      await act(async () => fireEvent.click(add))
      expect(screen.getByLabelText('Name this place')).toBeInTheDocument()
      expect(add).toBeVisible()
    } finally {
      disposeStyles()
      dispose()
    }
  })

  it('uses Markdown key/value rows for read-only map facts', async () => {
    const { store, dispose } = await renderPanel()
    try {
      const { container } = render(<MetadataSegment />)
      expect(container.querySelectorAll('.props-info-row').length).toBeGreaterThan(3)
      for (const row of container.querySelectorAll('.props-info-row')) {
        expect(row.querySelector('dt.props-info-key')).toBeInTheDocument()
        expect(row.querySelector('dd.props-info-value')).toBeInTheDocument()
      }
      expect(container.querySelector('input, button, .map-meta-section')).not.toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Map provider' })).toHaveValue('free')
      expect(screen.getAllByText('Map provider')).toHaveLength(1)
      expect(container).toHaveTextContent('Map dataOpenStreetMap')
      expect(container).toHaveTextContent('Map engineMapLibre GL JS')
      expect(container).toHaveTextContent('FOSSGIS OSRM')
      expect(screen.getByRole('combobox', { name: 'Map style' })).toHaveValue('streets')
      await act(async () => fireEvent.change(screen.getByRole('combobox', { name: 'Map style' }), { target: { value: 'satellite' } }))
      expect(store.getSnapshot().style).toBe('satellite')
      await act(async () => store.setStyle('streets'))
      expect(screen.getByRole('combobox', { name: 'Map style' })).toHaveValue('streets')
      await act(async () => store.setStyle('satellite'))
      expect(screen.getByRole('combobox', { name: 'Map provider' })).toHaveValue('free')
      expect(container).toHaveTextContent('Map dataEsri, Maxar, Earthstar Geographics')
    } finally { dispose() }
  })

  it('saves a place typed in by hand, with the document it links to', async () => {
    const { mock, dispose } = await renderPanel()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add a place' }))
    })
    // No coordinate yet — saving now would write a place that cannot be drawn.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await pickAddress()
    await act(async () => fireEvent.change(screen.getByLabelText('Name this place'), { target: { value: 'Flint Center' } }))
    await act(async () => fireEvent.change(screen.getByLabelText('Linked document (optional)'), {
      target: { value: 'Apple/The Macintosh.md' }
    }))
    await screen.findByText('The Macintosh')
    await act(async () => fireEvent.click(screen.getByText('The Macintosh')))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })

    expect(storedPlaces(mock)).toMatchObject([
      {
        name: 'Flint Center',
        lng: -122.0164,
        lat: 37.3196,
        // The document is the point of the manual form: before it, nothing saved
        // through the UI could carry one, so the row's file glyph never showed.
        note: 'Apple/The Macintosh.md'
      }
    ])
    dispose()
  })

  it('takes the picked address as the name when none was typed', async () => {
    const { mock, dispose } = await renderPanel()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add a place' }))
    })
    await pickAddress()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })

    expect(storedPlaces(mock)[0]).toMatchObject({ name: 'Flint Center, Cupertino' })
    dispose()
  })

  it('attaches a document to a place saved earlier', async () => {
    const { mock, store, dispose } = await renderPanel([APPLE_PARK])
    expect(store.getSnapshot().places[0].note).toBeUndefined()

    await chooseFromMenu(mock, screen.getByRole('button', { name: 'More actions' }), 'edit')
    await act(async () => fireEvent.change(screen.getByLabelText('Linked document (optional)'), {
      target: { value: 'Apple/The Product Line Cut.md' }
    }))
    await screen.findByText('The Product Line Cut')
    await act(async () => fireEvent.click(screen.getByText('The Product Line Cut')))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })

    expect(storedPlaces(mock)).toMatchObject([
      { id: 'apple-park', name: 'Apple Park, Cupertino', note: 'Apple/The Product Line Cut.md' }
    ])
    // The coordinates the form was opened on survive an edit that never touched
    // the address field.
    expect(storedPlaces(mock)[0]).toMatchObject({ lng: -122.009, lat: 37.3349 })
    dispose()
  })

  it('makes an edit revertible, like every other place write', async () => {
    const { mock, dispose } = await renderPanel([APPLE_PARK])

    await chooseFromMenu(mock, screen.getByRole('button', { name: 'More actions' }), 'edit')
    await act(async () => fireEvent.change(screen.getByLabelText('Name this place'), { target: { value: 'Infinite Loop' } }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(storedPlaces(mock)[0]).toMatchObject({ name: 'Infinite Loop' })

    const [action] = mock.undoActions
    expect(action.label).toContain('Infinite Loop')
    await act(async () => {
      await action.undo()
    })
    expect(storedPlaces(mock)[0]).toMatchObject({ name: 'Apple Park, Cupertino' })
    dispose()
  })

  it('closes the form without writing anything on Cancel', async () => {
    const { mock, dispose } = await renderPanel()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add a place' }))
    })
    await pickAddress()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    })

    expect(storedPlaces(mock)).toHaveLength(0)
    expect(screen.queryByLabelText('Name this place')).toBeNull()
    dispose()
  })

  it('files places in folders with one subfolder level and keeps the places when a folder is deleted', async () => {
    const { mock, dispose } = await renderPanel([APPLE_PARK])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add folder' })) })
    const name = await screen.findByLabelText('Folder name')
    await act(async () => {
      fireEvent.change(name, { target: { value: 'Trips' } })
      fireEvent.keyDown(name, { key: 'Enter' })
      fireEvent.blur(name)
    })
    await waitFor(() => expect(screen.getByText('Trips')).toBeTruthy())
    const folders = (): { id: string; name: string; parent?: string }[] => mock.api.settings.get().placeFolders as never
    expect(folders()).toEqual([{ id: expect.stringMatching(/^folder-[0-9a-f]{12}$/), name: 'Trips' }])

    await chooseFromMenu(mock, screen.getAllByRole('button', { name: 'More actions' })[0], 'subfolder')
    const sub = await screen.findByLabelText('Folder name')
    await act(async () => { fireEvent.blur(sub) })
    await waitFor(() => expect(folders()).toHaveLength(2))
    expect(folders()[1].parent).toBe(folders()[0].id)
    // A subfolder's menu offers no further subfolder.
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[1]) })
    expect((mock.menus.at(-1) ?? []).map(item => item.id)).toEqual(['icon', 'color', 'rename', undefined, 'delete'])

    await act(async () => {
      await mock.api.data.dataset('places').update({ id: 'apple-park' }, { folder: folders()[1].id })
    })
    await chooseFromMenu(mock, screen.getAllByRole('button', { name: 'More actions' })[1], 'delete')
    await waitFor(() => expect(folders()).toHaveLength(1))
    expect(storedPlaces(mock)).toHaveLength(1)
    dispose()
  })

  it('focuses the search field when the Search tab is clicked', async () => {
    const { dispose } = await renderPanel()
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Search' })) })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByPlaceholderText('Search the map…')))
    dispose()
  })

  it('keeps place actions in one menu and edits the colour with the palette field', async () => {
    const { mock, dispose } = await renderPanel([{ ...APPLE_PARK, color: 'palette:teal' }])
    const more = screen.getByRole('button', { name: 'More actions' })
    expect(screen.queryByRole('button', { name: 'Edit place' })).toBeNull()
    await act(async () => { fireEvent.click(more) })
    const items = mock.menus.at(-1) ?? []
    expect(items.map(item => item.id)).toEqual(['edit', 'rename', 'icon', 'color', 'move', undefined, 'focus', undefined, 'delete'])
    expect(items.filter(item => item.id).every(item => item.icon)).toBe(true)

    await chooseFromMenu(mock, more, 'edit')
    const dialog = screen.getByRole('dialog', { name: 'Edit place' })
    expect(dialog.querySelector('[data-color="palette:teal"]')).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })) })
    expect(screen.queryByRole('dialog')).toBeNull()

    await chooseFromMenu(mock, more, 'rename')
    const field = screen.getByDisplayValue('Apple Park, Cupertino')
    await act(async () => {
      fireEvent.change(field, { target: { value: 'Infinite Loop' } })
      fireEvent.blur(field)
    })
    await waitFor(() => expect(storedPlaces(mock)[0]).toMatchObject({ name: 'Infinite Loop' }))
    dispose()
  })

  it('moves a place to a folder or subfolder from the edit modal', async () => {
    const { mock, dispose } = await renderPanel([APPLE_PARK])
    await act(async () => {
      await mock.api.settings.set('placeFolders', [{ id: 'folder-trips', name: 'Trips' }, { id: 'folder-alps', name: 'Alps', parent: 'folder-trips' }])
    })
    await chooseFromMenu(mock, screen.getAllByRole('button', { name: 'More actions' }).at(-1)!, 'edit')
    const dialog = screen.getByRole('dialog', { name: 'Edit place' })
    const field = within(dialog).getByRole('combobox', { name: 'Move to folder' }) as HTMLSelectElement
    expect([...field.options].map(option => option.textContent)).toEqual(['Top level', 'Trips', 'Trips / Alps'])
    await act(async () => { fireEvent.change(field, { target: { value: 'folder-alps' } }) })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save' })) })
    await waitFor(() => expect(storedPlaces(mock)[0]).toMatchObject({ id: 'apple-park', folder: 'folder-alps' }))

    await chooseFromMenu(mock, screen.getAllByRole('button', { name: 'More actions' }).at(-1)!, 'edit')
    const again = screen.getByRole('dialog', { name: 'Edit place' })
    expect((within(again).getByRole('combobox', { name: 'Move to folder' }) as HTMLSelectElement).value).toBe('folder-alps')
    await act(async () => { fireEvent.change(within(again).getByRole('combobox', { name: 'Move to folder' }), { target: { value: 'top-level' } }) })
    await act(async () => { fireEvent.click(within(again).getByRole('button', { name: 'Save' })) })
    await waitFor(() => expect(storedPlaces(mock)[0].folder ?? null).toBeNull())
    dispose()
  })

  it('has an eye on every folder and place that hides it on the map', async () => {
    const { mock, dispose } = await renderPanel([APPLE_PARK])
    await act(async () => {
      await mock.api.settings.set('placeFolders', [{ id: 'folder-trips', name: 'Trips' }])
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Hide “Trips” on the map' })) })
    expect(mock.api.settings.get().hiddenPlaceFolders).toEqual(['folder-trips'])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Hide “Apple Park, Cupertino” on the map' })) })
    expect(mock.api.settings.get().hiddenPlaces).toEqual(['apple-park'])
    expect(screen.getByText('Apple Park, Cupertino').closest('.map-tree-row')).toHaveClass('is-hidden')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show “Apple Park, Cupertino” on the map' })) })
    expect(mock.api.settings.get().hiddenPlaces).toEqual([])
    dispose()
  })

  it('heads the list with a 38px Favorites bar that folds every folder at once', async () => {
    const { mock, dispose } = await renderPanel([APPLE_PARK])
    const bar = screen.getByText('Favorites').closest('.map-places-bar') as HTMLElement
    expect(bar.querySelector('.map-section-count')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Collapse all folders' })).toBeNull()
    await act(async () => {
      await mock.api.settings.set('placeFolders', [{ id: 'folder-trips', name: 'Trips' }, { id: 'folder-alps', name: 'Alps', parent: 'folder-trips' }])
    })
    expect(within(bar).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['Collapse all folders', 'Hide all favorites on the map', 'Add folder', 'Add a place'])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Collapse all folders' })) })
    expect(mock.api.settings.get().collapsedPlaceFolders).toEqual(['folder-trips', 'folder-alps'])
    expect(screen.queryByText('Alps')).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Expand all folders' })) })
    expect(mock.api.settings.get().collapsedPlaceFolders).toEqual([])
    // Only the visible folders count: an open subfolder inside a folded folder still reads as all folded.
    await act(async () => { await mock.api.settings.set('collapsedPlaceFolders', ['folder-trips']) })
    expect(screen.getByRole('button', { name: 'Expand all folders' })).toBeInTheDocument()
    dispose()
  })

  it('hides every favourite from the Favorites bar eye and keeps the rows\' own eyes', async () => {
    const { mock, dispose } = await renderPanel([APPLE_PARK])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Hide all favorites on the map' })) })
    expect(mock.api.settings.get().placesHidden).toBe(true)
    expect(mock.api.settings.get().hiddenPlaces ?? []).toEqual([])
    expect(screen.getByText('Apple Park, Cupertino').closest('.map-tree-row')).toHaveClass('is-hidden')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show favorites on the map' })) })
    expect(mock.api.settings.get().placesHidden).toBe(false)
    expect(screen.getByText('Apple Park, Cupertino').closest('.map-tree-row')).not.toHaveClass('is-hidden')
    dispose()
  })
})
