import { afterEach, describe, expect, it, vi } from 'vitest'
import { WORKSPACE_DETAILS_V1 } from '@valley/plugin-sdk'
import { METRIC_UNITS } from '@valley/plugin-sdk/units'
import { createMockValleyApi } from '@valley/plugin-testkit'
import { publishMapDetails, registerMapDetails } from '../src/workspaceDetails'
import { resolveSettings } from '../src/settings'
import { formatLatLng } from '../src/format'
import type { MapSnapshot, MapStore } from '../src/store'

afterEach(() => vi.useRealTimers())
function setup() {
  const mock = createMockValleyApi()
  let selected = ['coordinates', 'address', 'zoom']
  mock.api.workspace.details.getSelection = () => selected
  const state = { places: [], selectedPlaceId: null, selectedResult: null, style: 'streets', plan: null, liveLocation: null, units: METRIC_UNITS } as unknown as MapSnapshot
  const lookupAddress = vi.fn(async () => 'Woodland, Switzerland')
  const store = { getSnapshot: () => state, subscribe: () => () => {}, settings: () => resolveSettings({}), lookupAddress } as unknown as MapStore
  const off = registerMapDetails(mock.api, store)
  const provider = mock.api.interop.extensions.providers(WORKSPACE_DETAILS_V1)[0].extension
  return { ...mock, state, lookupAddress, provider, off, select: (items: string[]) => { selected = items } }
}

describe('map workspace details', () => {
  it('uses the exact mounted instance, selected place, and current camera', () => {
    const test = setup()
    try {
      publishMapDetails(test.api, { instanceId: 'first' }, { lng: 8, lat: 47, zoom: 9, bearing: 0, pitch: 0 })
      publishMapDetails(test.api, { instanceId: 'second' }, { lng: 10, lat: 49, zoom: 12, bearing: 20, pitch: 10 })
      const context = { instanceId: 'second', selectedItemIds: [] }
      expect(test.provider.getSnapshot(context).items.zoom.text).toBe('12.0')
      expect(test.provider.getSnapshot({ instanceId: 'missing', selectedItemIds: [] }).items).toEqual({})
      test.state.selectedResult = { name: 'Forest', context: 'Zürich', lng: 8.5, lat: 47.3 }
      const snapshot = test.provider.getSnapshot(context)
      // The header shows the camera centre; the footer describes that same point.
      expect(snapshot.items.coordinates.text).toBe(formatLatLng(49, 10))
      expect(snapshot.items.address).toBeUndefined()
      expect(snapshot.items.place.text).toBe('Forest')
      expect(test.lookupAddress).not.toHaveBeenCalled()
      publishMapDetails(test.api, { instanceId: 'file', filePath: 'trees.geojson' }, null, { lng: 8.6, lat: 47.4, name: 'Oak', elevation: 520 })
      const file = test.provider.getSnapshot({ instanceId: 'file', filePath: 'trees.geojson', selectedItemIds: [] })
      expect(file.items.place.text).toBe('Oak')
      expect(file.items.elevation.text).toContain('520')
    } finally { test.off() }
  })
  it('keeps footer coordinates and address on the header point while a place is selected', async () => {
    vi.useFakeTimers()
    const test = setup()
    try {
      publishMapDetails(test.api, { instanceId: 'page' }, { lng: 8.54366, lat: 47.37545, zoom: 14, bearing: 0, pitch: 0 })
      test.state.places = [{ id: 'zurich', name: 'Zürich', lng: 8.5417, lat: 47.3769 }] as MapSnapshot['places']
      test.state.selectedPlaceId = 'zurich'
      const context = { instanceId: 'page', selectedItemIds: ['coordinates', 'address', 'place'] }
      expect(test.provider.getSnapshot(context).items.coordinates.text).toBe(formatLatLng(47.37545, 8.54366))
      await vi.advanceTimersByTimeAsync(450)
      expect(test.lookupAddress).toHaveBeenCalledWith(8.54366, 47.37545, expect.any(AbortSignal))
      const snapshot = test.provider.getSnapshot(context)
      expect(snapshot.items.address.text).toBe('Woodland, Switzerland')
      expect(snapshot.items.place.text).toBe('Zürich')
    } finally { test.off() }
  })

  it('debounces address requests, cancels stale coordinates, and skips deselected work', async () => {
    vi.useFakeTimers()
    const test = setup()
    try {
      publishMapDetails(test.api, { instanceId: 'one' }, { lng: 8, lat: 47, zoom: 9, bearing: 0, pitch: 0 })
      const context = { instanceId: 'one', selectedItemIds: ['address'] }
      test.provider.getSnapshot(context)
      await vi.advanceTimersByTimeAsync(200)
      publishMapDetails(test.api, { instanceId: 'one' }, { lng: 9, lat: 48, zoom: 9, bearing: 0, pitch: 0 })
      test.provider.getSnapshot(context)
      await vi.advanceTimersByTimeAsync(450)
      expect(test.lookupAddress).toHaveBeenCalledTimes(1)
      expect(test.lookupAddress).toHaveBeenCalledWith(9, 48, expect.any(AbortSignal))
      expect(test.provider.getSnapshot(context).items.address.text).toBe('Woodland, Switzerland')
      test.select([])
      publishMapDetails(test.api, { instanceId: 'one' }, { lng: 10, lat: 49, zoom: 9, bearing: 0, pitch: 0 })
      test.provider.getSnapshot(context)
      await vi.advanceTimersByTimeAsync(500)
      expect(test.lookupAddress).toHaveBeenCalledTimes(1)
    } finally { test.off() }
  })
})
