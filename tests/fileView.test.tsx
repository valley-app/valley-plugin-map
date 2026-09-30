import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createMockValleyApi } from '@valley/plugin-testkit'
import type { MapFileData } from '../src/mapFile'
import { FileView } from '../src/FileView'
import { Page } from '../src/Page'
import type { MainWorkspaceViewProps } from '@valley/plugin-sdk'
import { initRuntime, type MapRenderOwner } from '../src/runtime'
import { createMapEngine } from '../src/island'
import type { MapEngine, MapEngineOptions } from '../src/mapEngine'
import { createStore, disposeStore } from '../src/store'
import { initLocalization } from '../src/localization'

vi.mock('../src/island', () => ({ createMapEngine: vi.fn() }))

const maps: ReturnType<typeof mockEngine>[] = []
const owners: MapRenderOwner[] = []
function mockEngine() {
  return { setFileData: vi.fn(), fitTo: vi.fn(), setStyle: vi.fn(), setUnits: vi.fn(), zoomBy: vi.fn(), destroy: vi.fn() }
}
function setup(files: Record<string, string>) {
  const mock = createMockValleyApi({ manifest: { id: 'map' }, files })
  owners.push(initRuntime(mock.api))
  initLocalization(mock.api)
  vi.mocked(createMapEngine).mockImplementation(async () => {
    const map = mockEngine(); maps.push(map)
    return map as unknown as MapEngine
  })
  return mock
}
const point = (lng = 8) => JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, 47] }, properties: { name: 'Zürich', description: '<img src=x onerror=alert(1)>' } })
const lastData = (index: number): MapFileData['collection'] => maps[index].setFileData.mock.calls.at(-1)![0]

afterEach(async () => {
  cleanup()
  await Promise.all(owners.splice(0).map(owner => owner.dispose()))
  maps.length = 0
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

it('renders independent file tabs, fits each file, and exposes safe feature details and map controls', async () => {
  const mock = setup({ 'a.geojson': point(), 'b.geojson': point(10) })
  const read = vi.spyOn(mock.api.vault, 'readFileBaseline')
  render(<><FileView relPath="a.geojson" /><FileView relPath="b.geojson" /></>)
  await waitFor(() => expect(maps[1]?.fitTo).toHaveBeenCalledWith([[10, 47], [10, 47]]))
  expect(lastData(0).features[0].geometry).toMatchObject({ coordinates: [8, 47] })
  expect(lastData(1).features[0].geometry).toMatchObject({ coordinates: [10, 47] })
  expect(read.mock.calls).toEqual([['a.geojson'], ['b.geojson']])
  expect(document.querySelector('.map-topbar')).toBeNull()
  expect(screen.queryByText('Read-only')).toBeNull()
  const options = vi.mocked(createMapEngine).mock.calls[0][0]
  act(() => options.onFileFeatureClick?.(0))
  expect(screen.getByText('Zürich')).toBeInTheDocument()
  expect(screen.getByText('Point')).toBeInTheDocument()
  expect(screen.getByText('47.00000, 8.00000')).toBeInTheDocument()
  expect(screen.queryByText(/onerror/)).toBeNull()
  expect(document.querySelector('.map-file-details img')).toBeNull()
  fireEvent.click(screen.getAllByRole('button', { name: 'Zoom in' })[0])
  expect(maps[0].zoomBy).toHaveBeenCalledWith(1)
  expect(maps[1].zoomBy).not.toHaveBeenCalled()
  fireEvent.click(screen.getAllByRole('button', { name: 'Fit to contents' })[1])
  expect(maps[1].fitTo).toHaveBeenCalledTimes(2)
  expect(mock.api.vault.writeFile).not.toHaveBeenCalled()
  expect(mock.api.vault.writeFileGuarded).not.toHaveBeenCalled()
  expect(mock.commandRuns).toEqual([])
})

it('reloads relevant changes, keeps the camera, and clears deleted or invalid files', async () => {
  const mock = setup({ 'a.geojson': point() })
  const read = vi.spyOn(mock.api.vault, 'readFileBaseline')
  const view = render(<FileView relPath="a.geojson" />)
  await waitFor(() => expect(maps[0]?.fitTo).toHaveBeenCalledTimes(1))
  act(() => mock.emitVaultChanged({ changes: [{ relPath: 'other.geojson', kind: 'change' }] }))
  expect(read).toHaveBeenCalledTimes(1)
  const baseline = (await read.mock.results[0].value)!.baseline
  read.mockResolvedValue({ content: point(11), baseline })
  act(() => mock.emitVaultChanged({ changes: [{ relPath: 'a.geojson', kind: 'change' }] }))
  await waitFor(() => expect(lastData(0).features[0]?.geometry).toMatchObject({ coordinates: [11, 47] }))
  expect(maps[0].fitTo).toHaveBeenCalledTimes(1)
  read.mockResolvedValue({ content: '{', baseline })
  act(() => mock.emitVaultChanged({ full: true }))
  expect(await screen.findByRole('alert')).toHaveTextContent('invalid geographic data')
  expect(lastData(0).features).toEqual([])
  read.mockResolvedValue(null)
  act(() => mock.emitVaultChanged({ changes: [{ relPath: 'a.geojson', kind: 'unlink' }] }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to read'))
  view.unmount()
  const count = read.mock.calls.length
  act(() => mock.emitVaultChanged({ full: true }))
  expect(read).toHaveBeenCalledTimes(count)
  expect(maps[0].destroy).toHaveBeenCalledTimes(1)
})

it('ignores stale reads after navigation or another reload', async () => {
  const mock = setup({ 'a.geojson': point(), 'b.geojson': point(12) })
  const original = mock.api.vault.readFileBaseline
  let release!: (value: Awaited<ReturnType<typeof original>>) => void
  const read = vi.spyOn(mock.api.vault, 'readFileBaseline').mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const view = render(<FileView relPath="a.geojson" />)
  view.rerender(<FileView relPath="b.geojson" />)
  await waitFor(() => expect(lastData(0).features[0]?.geometry).toMatchObject({ coordinates: [12, 47] }))
  await act(async () => release(await original('a.geojson')))
  expect(lastData(0).features[0].geometry).toMatchObject({ coordinates: [12, 47] })
  read.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  act(() => mock.emitVaultChanged({ full: true }))
  act(() => mock.emitVaultChanged({ full: true }))
  await waitFor(() => expect(lastData(0).features).toHaveLength(1))
  await act(async () => release({ content: '{', baseline: (await original('a.geojson'))!.baseline }))
  expect(screen.queryByRole('alert')).toBeNull()
})

it('destroys an engine that finishes loading after its tab closes', async () => {
  setup({ 'a.geojson': point() })
  let release!: (value: MapEngine) => void
  let options!: MapEngineOptions
  vi.mocked(createMapEngine).mockImplementationOnce(value => { options = value; return new Promise(resolve => { release = resolve }) })
  const view = render(<FileView relPath="a.geojson" />)
  view.unmount()
  const map = mockEngine()
  await act(async () => { release(map as unknown as MapEngine); options.onError?.(new Error('late')) })
  expect(map.destroy).toHaveBeenCalledOnce()
  expect(map.setFileData).not.toHaveBeenCalled()
  expect(vi.mocked(createMapEngine).mock.calls[0][2]?.aborted).toBe(true)
})

it('propagates shared units without rebuilding or refitting the file map', async () => {
  const mock = setup({ 'ferns.geojson': point() })
  vi.spyOn(mock.api.backend, 'call').mockResolvedValue({ ok: true, data: { connections: [] } })
  const store = createStore(mock.api)
  await store.ready
  const view = render(<FileView relPath="ferns.geojson" />)
  try {
    await waitFor(() => expect(maps[0]?.setFileData).toHaveBeenCalled())
    const engine = maps[0]
    engine.fitTo.mockClear()
    await act(async () => { mock.emitState({ units: { ...mock.api.getState().units, distance: 'mi', length: 'ft', coordinates: 'dms' } }) })
    expect(maps).toHaveLength(1)
    expect(engine.destroy).not.toHaveBeenCalled()
    expect(engine.fitTo).not.toHaveBeenCalled()
    expect(engine.setUnits).toHaveBeenLastCalledWith(expect.objectContaining({ distance: 'mi', length: 'ft', coordinates: 'dms' }))
  } finally { view.unmount(); await disposeStore(store) }
})

it('shows empty and unsupported-content states', async () => {
  setup({ 'empty.kml': '<kml><NetworkLink/><GroundOverlay/></kml>' })
  render(<FileView relPath="empty.kml" />)
  expect(await screen.findByText('No geographic features to display.')).toBeInTheDocument()
  expect(screen.getByText(/KML linked content/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Fit to contents' })).toBeDisabled()
})

it('shows a localized error when the map runtime cannot load', async () => {
  setup({ 'a.geojson': point() })
  vi.mocked(createMapEngine).mockRejectedValueOnce(new Error('runtime load failed'))
  render(<FileView relPath="a.geojson" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('The map could not be loaded.')
})

it('leaves the main map camera, routes, and places unchanged', async () => {
  const mock = setup({ 'a.geojson': point() })
  vi.spyOn(mock.api.backend, 'call').mockResolvedValue({ ok: true, data: { connections: [] } })
  const store = createStore(mock.api)
  await store.ready
  const attach = vi.spyOn(store, 'attachMap')
  const remember = vi.spyOn(store, 'rememberView')
  const before = structuredClone(store.getSnapshot())
  const view = render(<FileView relPath="a.geojson" />)
  try {
    await waitFor(() => expect(maps[0]?.fitTo).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(store.getSnapshot()).toEqual(before)
    expect(attach).not.toHaveBeenCalled()
    expect(remember).not.toHaveBeenCalled()
  } finally { view.unmount(); await disposeStore(store) }
})

it('switches the map itself only between Light and Dark, writing the mode the sidebar shows', async () => {
  const mock = setup({})
  vi.spyOn(mock.api.backend, 'call').mockResolvedValue({ ok: true, data: { connections: [] } })
  vi.stubGlobal('matchMedia', vi.fn(() => Object.assign(new EventTarget(), { matches: false })))
  const store = createStore(mock.api)
  try {
    await act(async () => { await store.ready; render(<Page {...({ instanceId: 'page' } as MainWorkspaceViewProps)} />) })
    expect(store.getSnapshot()).toMatchObject({ colorMode: 'system', resolvedColorMode: 'light' })
    expect(screen.queryByRole('button', { name: /system/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Switch map to dark mode' }))
    expect(store.getSnapshot()).toMatchObject({ colorMode: 'dark', resolvedColorMode: 'dark' })
    fireEvent.click(screen.getByRole('button', { name: 'Switch map to light mode' }))
    expect(store.getSnapshot()).toMatchObject({ colorMode: 'light', resolvedColorMode: 'light' })
    expect(screen.getByRole('button', { name: 'Switch map to dark mode' })).toBeInTheDocument()
  } finally {
    cleanup()
    await disposeStore(store)
    vi.unstubAllGlobals()
  }
})

it('applies embedded map overrides, keeps wheel scrolling in the note, and falls back without an account', async () => {
  setup({ 'forest.geojson': point() })
  render(<FileView relPath="forest.geojson" embedded embedOptions={['satellite', 'mapbox', 'light']} />)
  await waitFor(() => expect(maps[0]?.setFileData).toHaveBeenCalled())
  expect(vi.mocked(createMapEngine).mock.calls[0][0]).toMatchObject({ scrollZoom: false, retainSnapshot: true, style: 'satellite', theme: 'light', settings: { basemapProvider: 'free' } })
  expect(document.querySelector('.map-file-embed')).not.toBeNull()
})
