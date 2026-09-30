import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
      expect(getComputedStyle(add).opacity).toBe('0.7')
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

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit place' }))
    })
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

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit place' }))
    })
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
})
