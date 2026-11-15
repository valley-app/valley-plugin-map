import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createMockValleyApi } from './harness'
import { initRuntime } from '../src/runtime'
import { initLocalization } from '../src/localization'
import { ExtensionPanel, orderedTabs, SidebarTabs } from '../src/SidebarTabs'
import type { MapSidebarTab } from '../src/sidebarContract'
import { FileInfo } from '../src/FileView'

afterEach(cleanup)
const tabs = ['search', 'places', 'routes', 'pins'].map(id => ({ id, label: id, icon: <span>{id}</span> }))
function setup(settings: Record<string, unknown> = {}) { const mock = createMockValleyApi({ settings }); initRuntime(mock.api); initLocalization(mock.api); return mock }

it('normalizes saved order and persists keyboard moves across remounts', async () => {
  expect(orderedTabs(['gone', 'pins', 'pins'], tabs.map(tab => tab.id))).toEqual(['pins', 'search', 'places', 'routes'])
  const mock = setup({ sidebarTabOrder: ['pins', 'search', 'places', 'routes', 'extension:sbb:sbb'] })
  const view = render(<SidebarTabs tabs={tabs} active="search" onSelect={() => {}} />)
  fireEvent.keyDown(screen.getByRole('tab', { name: 'search' }), { key: 'ArrowRight', altKey: true })
  await waitFor(() => expect(mock.api.settings.get().sidebarTabOrder).toEqual(['pins', 'places', 'search', 'routes', 'extension:sbb:sbb']))
  view.unmount()
  render(<SidebarTabs tabs={tabs} active="search" onSelect={() => {}} />)
  expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['pins', 'places', 'search', 'routes'])
})

it('renders a contributed panel, passes edited values, and ends its active lifecycle', async () => {
  setup()
  let notify = () => {}
  let snapshot = { fields: [{ id: 'query', label: 'Station', value: '' }], actions: [{ id: 'search', label: 'Search' }], rows: [] as { id: string; title: string }[], busy: false }
  const extension: MapSidebarTab = { id: 'sbb', label: 'SBB', icon: { path: '', viewBox: '0 0 24 24' }, getSnapshot: () => snapshot, subscribe: listener => { notify = listener; return vi.fn() }, setActive: vi.fn(), run: vi.fn(async () => {}) }
  const view = render(<ExtensionPanel extension={extension} />)
  fireEvent.change(screen.getByLabelText('Station'), { target: { value: 'Fern' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() => expect(extension.run).toHaveBeenCalledWith('search', { query: 'Fern' }))
  act(() => { snapshot = { ...snapshot, rows: [{ id: 'fern', title: 'Fern' }] }; notify() })
  expect(screen.getByText('Fern')).toBeInTheDocument()
  expect(extension.setActive).toHaveBeenCalledWith(true)
  view.unmount(); expect(extension.setActive).toHaveBeenLastCalledWith(false)
})

it('draws a journey planner: segments, typed stops, connection cards and an opened timeline', async () => {
  vi.useFakeTimers()
  setup()
  let notify = () => {}
  const card = { id: 'a', action: 'trip:0', badge: { text: 'IR 36', kind: 'train' as const }, direction: 'to Zürich HB', departure: { time: '11:22' }, arrival: { time: '11:29', expected: '11:31', late: true }, changes: 1, duration: '7 min', platform: 'Pl. 1' }
  let snapshot: ReturnType<MapSidebarTab['getSnapshot']> = { fields: [], actions: [], rows: [],
    segments: [{ id: 'timetable', label: 'Timetable' }, { id: 'touch', label: 'Touch timetable' }, { id: 'commute', label: 'Commute', disabled: true }], segment: 'timetable',
    route: { stops: [{ id: 'origin', role: 'origin', label: 'From', value: 'Current location', location: true }, { id: 'via', role: 'via', label: 'Via', value: '' }, { id: 'destination', role: 'destination', label: 'To', value: '' }], submit: { action: 'plan', label: 'Find connections' }, swap: 'swap' },
    journeys: [card] }
  const extension: MapSidebarTab = { id: 'sbb', label: 'SBB', icon: { path: '', viewBox: '0 0 24 24' }, getSnapshot: () => snapshot, subscribe: listener => { notify = listener; return vi.fn() }, run: vi.fn(async () => {}) }
  render(<ExtensionPanel extension={extension} />)
  expect(screen.getByRole('tab', { name: 'Timetable' })).toHaveClass('active')
  expect(screen.getByRole('tab', { name: 'Commute' })).toBeDisabled()
  // A narrow sidebar scrolls the segments sideways; a vertical wheel turns into that scroll.
  const row = screen.getByRole('tablist')
  Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 400 })
  Object.defineProperty(row, 'clientWidth', { configurable: true, value: 200 })
  fireEvent.wheel(row, { deltaY: 60 })
  expect(row.scrollLeft).toBe(60)
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'Zür' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  expect(extension.run).toHaveBeenCalledWith('input:destination', { origin: 'Current location', via: '', destination: 'Zür' })
  expect(screen.getByText('IR 36')).toHaveClass('map-line-badge', 'is-train')
  expect(screen.getByText('11:31')).toHaveClass('map-journey-late')
  await act(async () => { fireEvent.click(screen.getByText('to Zürich HB')) })
  expect(extension.run).toHaveBeenCalledWith('trip:0', {})
  act(() => {
    snapshot = { ...snapshot, journeys: undefined, journey: { title: 'Brugg AG → Zürich, ETH Hönggerberg', departure: { time: '11:36' }, arrival: { time: '12:26' }, summary: 'Today, 51 min', back: 'back', legs: [
      { kind: 'ride', badge: { text: 'S12', kind: 'regional' }, direction: 'to Schaffhausen', from: { time: { time: '11:36' }, name: 'Brugg AG', platform: 'Pl. 2' }, to: { time: { time: '12:08' }, name: 'Zürich Altstetten', platform: 'Pl. 4' } },
      { kind: 'walk', text: 'Walk', duration: '4′' }] } }
    notify()
  })
  expect(screen.getByText('Brugg AG → Zürich, ETH Hönggerberg')).toBeInTheDocument()
  expect(screen.getByText('S12')).toHaveClass('is-regional')
  expect(screen.getByText('Walk').closest('.map-leg')).toHaveClass('is-walk')
  vi.useRealTimers()
})

it('shows read-only status in file Info', async () => {
  const mock = setup()
  mock.api.realm.fileInfo = vi.fn().mockResolvedValue({ size: 2048, mtimeMs: 1 })
  render(<FileInfo relPath="fern.gpx" />)
  expect(screen.getByText('Read-only')).toBeInTheDocument()
  expect(screen.getByText('GPX')).toBeInTheDocument()
  for (const label of ['Path', 'Type', 'Access', 'Size', 'Modified']) expect(screen.getByText(label)).toBeInTheDocument()
  expect(await screen.findByText('2 KB')).toBeInTheDocument()
})

it('draws the SBB look: split IR badge with pictogram, day headers, earlier and later, and the travel date sheet', async () => {
  setup()
  const when = { action: 'when', now: 'now', date: '2026-11-15', time: '11:46', arrival: false, label: 'So. 15.11.',
    days: [{ value: '2026-11-15', label: 'Heute' }, { value: '2026-11-16', label: 'Mo., 16. Nov.' }],
    text: { title: 'Wann fahren Sie?', departure: 'Abfahrt', arrival: 'Ankunft', apply: 'Übernehmen', now: 'Jetzt', departureShort: 'ab', arrivalShort: 'an', date: 'Reisedatum', close: 'Schliessen' } }
  const card = (id: string, day: string) => ({ id, action: `trip:${id}`, badge: { text: 'IR 36', kind: 'train' as const, category: 'IR', number: '36' }, direction: 'Richtung Zürich HB',
    departure: { time: '23:22' }, arrival: { time: '23:49' }, changes: 1, stops: [0.4], duration: '27 min', platform: 'Gl. 1', day })
  const snapshot: ReturnType<MapSidebarTab['getSnapshot']> = { fields: [], actions: [], rows: [], look: 'sbb',
    route: { stops: [{ id: 'origin', role: 'origin', label: 'Von', value: 'Brugg AG' }], when },
    earlier: { action: 'earlier', label: 'Frühere Verbindungen' }, later: { action: 'later', label: 'Spätere Verbindungen' },
    journeys: [card('a', 'Sonntag, 15.11.2026'), card('b', 'Sonntag, 15.11.2026'), card('c', 'Montag, 16.11.2026')] }
  const extension: MapSidebarTab = { id: 'sbb', label: 'SBB', icon: { path: '', viewBox: '0 0 24 24' }, getSnapshot: () => snapshot, subscribe: () => vi.fn(), run: vi.fn(async () => {}) }
  const { container } = render(<ExtensionPanel extension={extension} />)
  expect(container.querySelector('.map-journey')).toHaveClass('is-sbb')
  const badge = screen.getAllByLabelText('IR 36')[0]
  expect(badge.querySelector('.map-line-picto')).not.toBeNull()
  expect(badge.querySelector('.map-line-cat')).toHaveTextContent('IR')
  // One header per day, again where the list crosses midnight.
  expect([...container.querySelectorAll('.map-journey-day')].map(node => node.textContent)).toEqual(['Sonntag, 15.11.2026', 'Montag, 16.11.2026'])
  expect(container.querySelector('.map-journey-track-dot.is-placed')).toHaveStyle({ left: '40.0%' })
  const list = container.querySelector('.map-journey-list')!
  expect(list.firstElementChild).toHaveTextContent('Frühere Verbindungen')
  expect(list.lastElementChild).toHaveTextContent('Spätere Verbindungen')
  fireEvent.click(screen.getByRole('button', { name: 'Spätere Verbindungen' }))
  await waitFor(() => expect(extension.run).toHaveBeenCalledWith('later', expect.anything()))
  await waitFor(() => expect(screen.getByRole('button', { name: /Reisedatum/ })).not.toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: /Reisedatum: So\. 15\.11\. 11:46 ab/ }))
  const sheet = screen.getByRole('dialog', { name: 'Wann fahren Sie?' })
  fireEvent.click(screen.getByRole('radio', { name: 'Ankunft' }))
  fireEvent.click(screen.getByRole('option', { name: 'Mo., 16. Nov.' }))
  fireEvent.click(screen.getAllByRole('option', { name: '08' })[0])
  fireEvent.click(screen.getAllByRole('option', { name: '05' })[1])
  fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))
  await waitFor(() => expect(extension.run).toHaveBeenCalledWith('when', { date: '2026-11-16', time: '08:05', arrival: '1' }))
  expect(sheet).not.toBeInTheDocument()
})

it('turns a swipe across Touch timetable tiles into one action, with a rested-on tile as via', async () => {
  setup()
  const snapshot: ReturnType<MapSidebarTab['getSnapshot']> = { fields: [], actions: [], rows: [], look: 'sbb', tileSwipe: 'swipe',
    tiles: ['zh', 'be', 'bs'].map(id => ({ id, label: id, action: `tile:${id}`, icon: 'station' as const, size: 'small' as const })) }
  const extension: MapSidebarTab = { id: 'sbb', label: 'SBB', icon: { path: '', viewBox: '0 0 24 24' }, getSnapshot: () => snapshot, subscribe: () => vi.fn(), run: vi.fn(async () => {}) }
  const { container } = render(<ExtensionPanel extension={extension} />)
  const grid = container.querySelector('.map-tiles')!
  const tile = (id: string) => container.querySelector(`[data-tile-id="${id}"]`)!
  let under = tile('zh')
  document.elementFromPoint = vi.fn(() => under)
  const clock = vi.spyOn(performance, 'now')
  clock.mockReturnValue(0); fireEvent.pointerDown(tile('zh'), { pointerId: 1, button: 0 })
  clock.mockReturnValue(100); under = tile('be'); fireEvent.pointerMove(grid, { pointerId: 1, clientX: 10 })
  clock.mockReturnValue(800); under = tile('bs'); fireEvent.pointerMove(grid, { pointerId: 1, clientX: 20 })
  fireEvent.pointerMove(grid, { pointerId: 1, clientX: 30, clientY: 12 })
  // The swipe is drawn: a line from the start through the via to the pointer, the other tiles stepping back.
  expect(grid).toHaveClass('is-swiping')
  expect(grid.querySelector('.map-swipe-line polyline')?.getAttribute('points')?.split(' ')).toHaveLength(3)
  expect(grid.querySelector('.map-swipe-line circle.is-end')).toHaveAttribute('cx', '30')
  fireEvent.pointerUp(grid, { pointerId: 1, clientX: 20 })
  expect(grid.querySelector('.map-swipe-line')).toBeNull()
  clock.mockRestore()
  fireEvent.click(tile('bs'))
  await waitFor(() => expect(extension.run).toHaveBeenCalledWith('swipe:zh:bs:be', expect.anything()))
  expect(extension.run).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(tile('zh')).not.toBeDisabled())
  fireEvent.click(tile('zh'))
  await waitFor(() => expect(extension.run).toHaveBeenCalledWith('tile:zh', expect.anything()))
})
