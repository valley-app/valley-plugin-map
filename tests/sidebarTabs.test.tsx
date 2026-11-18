import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createMockValleyApi } from './harness'
import { initRuntime } from '../src/runtime'
import { initLocalization } from '../src/localization'
import { ExtensionPanel, orderedTabs, SidebarTabs } from '../src/SidebarTabs'
import type { MapSidebarTab } from '../src/sidebarContract'
import { FileInfo } from '../src/FileView'
import { injectStyles } from '../src/styles'
import { createStore, disposeStore } from '../src/store'

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
  // The opened connection gets a back bar under the segments; its title is not repeated in the summary.
  const back = screen.getByRole('button', { name: 'Back to connections' })
  expect(back.closest('.map-journey-backbar')).toHaveTextContent('Brugg AG → Zürich, ETH Hönggerberg')
  expect(screen.getAllByText('Brugg AG → Zürich, ETH Hönggerberg')).toHaveLength(1)
  await act(async () => { fireEvent.click(back) })
  expect(extension.run).toHaveBeenLastCalledWith('back', {})
  await act(async () => { fireEvent.keyDown(screen.getByText('Walk'), { key: 'Escape' }) })
  expect(extension.run).toHaveBeenCalledTimes(4)
  expect(extension.run).toHaveBeenLastCalledWith('back', {})
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

it('draws the SBB look: split IR badge with pictogram, day headers, earlier and later, and inline travel date fields', async () => {
  setup()
  const when = { action: 'when', now: 'now', date: '2026-11-15', time: '11:46', arrival: false,
    text: { departure: 'Abfahrt', arrival: 'Ankunft', now: 'Jetzt', date: 'Reisedatum', time: 'Uhrzeit' } }
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
  // A change breaks the line: one stretch per ride with a dot at both ends, as long as its share of the time.
  const legs = [...container.querySelectorAll<HTMLElement>('.map-journey-track')[0].querySelectorAll<HTMLElement>('.map-journey-track-leg')]
  expect(legs.map(leg => [Number(leg.style.flexGrow).toFixed(1), leg.querySelectorAll('.map-journey-track-dot').length])).toEqual([['0.4', 2], ['0.6', 2]])
  const list = container.querySelector('.map-journey-list')!
  expect(list.firstElementChild).toHaveTextContent('Frühere Verbindungen')
  expect(list.lastElementChild).toHaveTextContent('Spätere Verbindungen')
  fireEvent.click(screen.getByRole('button', { name: 'Spätere Verbindungen' }))
  await waitFor(() => expect(extension.run).toHaveBeenCalledWith('later', expect.anything()))
  // Valley's date and time fields apply at once; there is no sheet and no Apply.
  await waitFor(() => expect(screen.getByLabelText('Reisedatum')).not.toBeDisabled())
  fireEvent.change(screen.getByLabelText('Reisedatum'), { target: { value: '2026-11-16' } })
  await waitFor(() => expect(extension.run).toHaveBeenCalledWith('when', { date: '2026-11-16', time: '11:46', arrival: '0' }))
  await waitFor(() => expect(screen.getByLabelText('Uhrzeit')).not.toBeDisabled())
  fireEvent.change(screen.getByLabelText('Uhrzeit'), { target: { value: '08:05' } })
  await waitFor(() => expect(extension.run).toHaveBeenCalledWith('when', { date: '2026-11-15', time: '08:05', arrival: '0' }))
  await waitFor(() => expect(screen.getByRole('radio', { name: 'Ankunft' })).not.toBeDisabled())
  expect(screen.getByRole('radio', { name: 'Abfahrt' })).toHaveAttribute('aria-checked', 'true')
  fireEvent.click(screen.getByRole('radio', { name: 'Ankunft' }))
  await waitFor(() => expect(extension.run).toHaveBeenCalledWith('when', { date: '2026-11-15', time: '11:46', arrival: '1' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Jetzt' })).not.toBeDisabled())
  expect(screen.getByRole('button', { name: 'Jetzt' })).toHaveClass('panel-tool-btn')
  fireEvent.click(screen.getByRole('button', { name: 'Jetzt' }))
  await waitFor(() => expect(extension.run).toHaveBeenCalledWith('now', expect.anything()))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('turns a swipe across Touch timetable tiles into one action, with a rested-on tile as via', async () => {
  setup()
  const snapshot: ReturnType<MapSidebarTab['getSnapshot']> = { fields: [], actions: [], rows: [], look: 'sbb', tileSwipe: 'swipe',
    tiles: ['zh', 'be', 'bs'].map(id => ({ id, label: id, action: `tile:${id}`, icon: 'station' as const, size: 'small' as const })) }
  const extension: MapSidebarTab = { id: 'sbb', label: 'SBB', icon: { path: '', viewBox: '0 0 24 24' }, getSnapshot: () => snapshot, subscribe: () => vi.fn(), run: vi.fn(async () => {}) }
  const { container } = render(<ExtensionPanel extension={extension} />)
  const grid = container.querySelector('.map-tiles-area')!
  const tile = (id: string) => container.querySelector(`[data-tile-id="${id}"]`)!
  let under = tile('zh')
  document.elementFromPoint = vi.fn(() => under)
  const clock = vi.spyOn(performance, 'now')
  clock.mockReturnValue(0); fireEvent.pointerDown(tile('zh'), { pointerId: 1, button: 0 })
  clock.mockReturnValue(100); under = tile('be'); fireEvent.pointerMove(grid, { pointerId: 1, clientX: 10 })
  clock.mockReturnValue(800); under = tile('bs'); fireEvent.pointerMove(grid, { pointerId: 1, clientX: 20 })
  fireEvent.pointerMove(grid, { pointerId: 1, clientX: 30, clientY: 12 })
  // The swipe is drawn: a line from the start through the via to the pointer, the other tiles stepping back.
  expect(grid.querySelector('.map-tiles')).toHaveClass('is-swiping')
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

it('places tiles that carry a column and row, leaving empty cells, and keeps size flow for the others', () => {
  setup()
  const snapshot: ReturnType<MapSidebarTab['getSnapshot']> = { fields: [], actions: [], rows: [], look: 'sbb', tileSwipe: 'swipe',
    tiles: [{ id: 'be', label: 'Bern', action: 'tile:be', icon: 'station', size: 'large', column: 1, row: 1, columns: 2, rows: 2 },
      { id: 'bs', label: 'Basel', action: 'tile:bs', icon: 'station', column: 4, row: 3 }] }
  const extension: MapSidebarTab = { id: 'sbb', label: 'SBB', icon: { path: '', viewBox: '0 0 24 24' }, getSnapshot: () => snapshot, subscribe: () => vi.fn(), run: vi.fn(async () => {}) }
  const { container } = render(<ExtensionPanel extension={extension} />)
  expect(container.querySelector('.map-tiles')).toHaveClass('is-placed')
  const tile = (id: string) => container.querySelector<HTMLElement>(`[data-tile-id="${id}"]`)!
  expect(tile('be').style.gridColumn).toBe('1 / span 2')
  expect(tile('be').style.gridRow).toBe('1 / span 2')
  expect(tile('bs').style.gridColumn).toBe('4 / span 1')
  expect(tile('bs').style.gridRow).toBe('3 / span 1')
  snapshot.tiles = [{ id: 'zh', label: 'Zürich', action: 'tile:zh', size: 'wide' }]
  cleanup()
  const again = render(<ExtensionPanel extension={extension} />)
  expect(again.container.querySelector('.map-tiles')).not.toHaveClass('is-placed')
  expect(again.container.querySelector<HTMLElement>('[data-tile-id="zh"]')!.getAttribute('style')).toBeNull()
})

it('swipes from a placed station tile onto a placed fixed tile in the row below', async () => {
  setup()
  const snapshot: ReturnType<MapSidebarTab['getSnapshot']> = { fields: [], actions: [], rows: [], look: 'sbb', tileSwipe: 'swipe',
    tiles: [{ id: 'be', label: 'Bern', action: 'tile:be', icon: 'station', column: 3, row: 1 },
      { id: 'here', label: 'Current location', action: 'tile:here', icon: 'location', column: 1, row: 2, columns: 2, rows: 1 },
      { id: 'pick-destination', label: 'to', action: 'tile:pick-destination', icon: 'destination', column: 4, row: 2 }] }
  const extension: MapSidebarTab = { id: 'sbb', label: 'SBB', icon: { path: '', viewBox: '0 0 24 24' }, getSnapshot: () => snapshot, subscribe: () => vi.fn(), run: vi.fn(async () => {}) }
  const { container } = render(<ExtensionPanel extension={extension} />)
  const area = container.querySelector('.map-tiles-area')!
  expect(area.querySelectorAll('.map-tiles')).toHaveLength(1)
  const tile = (id: string) => container.querySelector(`[data-tile-id="${id}"]`)!
  expect((tile('here') as HTMLElement).style.gridRow).toBe('2 / span 1')
  let under = tile('be')
  document.elementFromPoint = vi.fn(() => under)
  fireEvent.pointerDown(tile('be'), { pointerId: 1, button: 0 })
  under = tile('pick-destination'); fireEvent.pointerMove(area, { pointerId: 1, clientX: 30, clientY: 80 })
  expect(area.querySelectorAll('.map-swipe-line polyline')).toHaveLength(1)
  fireEvent.pointerUp(area, { pointerId: 1, clientX: 30, clientY: 80 })
  await waitFor(() => expect(extension.run).toHaveBeenCalledWith('swipe:be:pick-destination', expect.anything()))
})

it('reorders stops by dragging from the spine or with Alt+arrows, with a floating chip and the insertion line, leaving the empty via row alone', async () => {
  setup()
  const stop = (id: string, role: 'origin' | 'via' | 'destination', value: string, location = false) => ({ id, role, label: id, value, ...(location ? { location } : {}) })
  const snapshot: ReturnType<MapSidebarTab['getSnapshot']> = { fields: [], actions: [], rows: [], look: 'sbb',
    route: { stops: [stop('origin', 'origin', 'Current location', true), stop('via', 'via', 'Baden'), stop('via:2', 'via', ''), stop('destination', 'destination', 'Zürich HB')], reorder: 'reorder' } }
  const extension: MapSidebarTab = { id: 'sbb', label: 'SBB', icon: { path: '', viewBox: '0 0 24 24' }, getSnapshot: () => snapshot, subscribe: () => vi.fn(), run: vi.fn(async () => {}) }
  const { container } = render(<ExtensionPanel extension={extension} />)
  const row = (id: string) => container.querySelector<HTMLElement>(`[data-stop-id="${id}"]`)!
  ;['origin', 'via', 'via:2', 'destination'].forEach((id, index) => { row(id).getBoundingClientRect = () => ({ top: index * 36, bottom: index * 36 + 36, height: 36, left: 0, right: 200, width: 200, x: 0, y: index * 36, toJSON: () => ({}) }) as DOMRect })
  container.querySelector<HTMLElement>('.map-route-stops')!.getBoundingClientRect = () => ({ top: 0, bottom: 144, height: 144, left: 0, right: 200, width: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  // At rest nothing changes: no grip, the same rows.
  expect(container.querySelector('.map-route-chip, .map-route-drop')).toBeNull()
  fireEvent.pointerDown(row('origin').querySelector('.map-route-spine')!, { button: 0, clientX: 10, clientY: 18 })
  fireEvent.pointerMove(document, { clientX: 12, clientY: 140 })
  expect(container.querySelector('.map-route-chip')).toHaveTextContent('Current location')
  expect(row('origin')).toHaveClass('is-dragged')
  // Below Zürich HB: the line sits on its bottom edge and the stop goes last.
  expect(container.querySelector<HTMLElement>('.map-route-drop')!.style.top).toBe('144px')
  fireEvent.pointerUp(document, { clientX: 12, clientY: 140 })
  await waitFor(() => expect(extension.run).toHaveBeenCalledWith('reorder:origin:2', expect.anything()))
  expect(container.querySelector('.map-route-chip')).toBeNull()
  // A plain click into a field never starts a drag.
  fireEvent.pointerDown(screen.getByLabelText('via'), { button: 0, clientX: 50, clientY: 50 })
  fireEvent.pointerUp(document, { clientX: 50, clientY: 50 })
  expect(container.querySelector('.map-route-chip')).toBeNull()
  // The empty via row offers no drag.
  fireEvent.pointerDown(row('via:2').querySelector('.map-route-spine')!, { button: 0, clientX: 10, clientY: 90 })
  expect(container.querySelector('.map-route-chip')).toBeNull()
  fireEvent.keyDown(screen.getByLabelText('destination'), { key: 'ArrowUp', altKey: true })
  await waitFor(() => expect(extension.run).toHaveBeenCalledWith('reorder:destination:1', expect.anything()))
})

it('shows only the station suggestions while a stop is typed in, and the results again once the field is left', async () => {
  setup()
  const card = { id: 'a', action: 'trip:0', badge: { text: 'IR 36', kind: 'train' as const }, direction: 'to Zürich HB', departure: { time: '11:22' }, arrival: { time: '11:29' }, day: 'Today' }
  const snapshot: ReturnType<MapSidebarTab['getSnapshot']> = { fields: [], actions: [], rows: [{ id: 'zh', title: 'Zürich HB', action: 'station:zh' }], rowsTitle: 'Select a station.', message: 'Intro',
    route: { stops: [{ id: 'origin', role: 'origin', label: 'From', value: 'Baden' }, { id: 'destination', role: 'destination', label: 'To', value: 'Zür' }], caption: 'Departures from Baden' },
    journeys: [card], earlier: { action: 'earlier', label: 'Earlier connections' }, later: { action: 'later', label: 'Later connections' } }
  const extension: MapSidebarTab = { id: 'sbb', label: 'SBB', icon: { path: '', viewBox: '0 0 24 24' }, getSnapshot: () => snapshot, subscribe: () => vi.fn(), run: vi.fn(async () => {}) }
  render(<ExtensionPanel extension={extension} />)
  // Not typing: the results stay, the suggestions step aside.
  expect(screen.queryByText('Zürich HB')).toBeNull()
  expect(screen.getByText('to Zürich HB')).toBeInTheDocument()
  await act(async () => { fireEvent.focus(screen.getByLabelText('To')) })
  expect(screen.getByText('Zürich HB')).toBeInTheDocument()
  for (const gone of ['to Zürich HB', 'Earlier connections', 'Later connections', 'Today', 'Departures from Baden', 'Intro']) expect(screen.queryByText(gone)).toBeNull()
  await act(async () => { fireEvent.keyDown(screen.getByLabelText('To'), { key: 'Escape' }); fireEvent.blur(screen.getByLabelText('To')) })
  expect(screen.queryByText('Zürich HB')).toBeNull()
  expect(screen.getByText('Earlier connections')).toBeInTheDocument()
})

it('passes the provider\'s picker design to the date and time fields and leaves the host default otherwise', () => {
  setup()
  const view = (picker?: 'wheel') => {
    const snapshot: ReturnType<MapSidebarTab['getSnapshot']> = { fields: [], actions: [], rows: [],
      route: { stops: [{ id: 'origin', role: 'origin', label: 'Von', value: 'Brugg AG' }], when: { action: 'when', now: 'now', date: '2026-11-17', time: '09:20', arrival: false, ...(picker ? { picker } : {}), text: { now: 'Now', date: 'Date', time: 'Time' } } } }
    const extension: MapSidebarTab = { id: 'sbb', label: 'SBB', icon: { path: '', viewBox: '0 0 24 24' }, getSnapshot: () => snapshot, subscribe: () => vi.fn(), run: vi.fn(async () => {}) }
    return render(<ExtensionPanel extension={extension} />)
  }
  const wheel = view('wheel')
  expect(screen.getByLabelText('Date')).toHaveAttribute('data-picker', 'wheel')
  expect(screen.getByLabelText('Time')).toHaveAttribute('data-picker', 'wheel')
  wheel.unmount()
  view()
  expect(screen.getByLabelText('Date')).toHaveAttribute('data-picker', 'grid')
  expect(screen.getByLabelText('Time')).toHaveAttribute('data-picker', 'grid')
})

it('draws a departure board as aligned columns: the real time alone in red, the delay in its own column, and no departure/arrival choice when the provider offers none', () => {
  setup()
  const row = (id: string, time: string, extra: Record<string, unknown> = {}) => ({ id, badge: { text: 'S12', kind: 'regional' as const }, direction: 'Brugg AG', departure: { time }, platform: 'Pl. 4', day: 'Today', ...extra })
  const snapshot: ReturnType<MapSidebarTab['getSnapshot']> = { fields: [], actions: [], rows: [], look: 'sbb',
    route: { stops: [{ id: 'board', role: 'origin', label: 'Station', value: 'Baden' }], when: { action: 'when', now: 'now', date: '2026-11-17', time: '09:20', arrival: false, text: { now: 'Now', date: 'Date', time: 'Time' } } },
    journeys: [row('a', '09:26', { departure: { time: '09:26', expected: '09:27', late: true }, delay: '+1′' }), row('b', '09:30', { platformChanged: true, platform: 'Pl. 41/42' })],
    earlier: { action: 'earlier', label: 'Earlier departures' }, later: { action: 'later', label: 'Later departures' } }
  const extension: MapSidebarTab = { id: 'sbb', label: 'SBB', icon: { path: '', viewBox: '0 0 24 24' }, getSnapshot: () => snapshot, subscribe: () => vi.fn(), run: vi.fn(async () => {}) }
  const { container } = render(<ExtensionPanel extension={extension} />)
  expect(container.querySelector('.map-journey-list')).toHaveClass('is-board')
  const [late, changed] = [...container.querySelectorAll('.map-journey-card.is-board')]
  expect(late.querySelector('.map-board-time')).toHaveTextContent(/^09:27$/)
  expect(late.querySelector('.map-board-time')).toHaveClass('is-late')
  expect(late.querySelector('.map-board-delay')).toHaveTextContent('+1′')
  expect(changed.querySelector('.map-board-time')).toHaveTextContent(/^09:30$/)
  expect(changed.querySelector('.map-board-time')).not.toHaveClass('is-late')
  expect(changed.querySelector('.map-board-delay')).toHaveTextContent(/^$/)
  expect(changed.querySelector('.map-board-platform')).toHaveClass('is-changed')
  expect(screen.queryByRole('radiogroup')).toBeNull()
  expect(screen.queryByRole('button', { name: /swap/i })).toBeNull()
})

it('keeps board rows on one line: time and badge complete, destination then platform truncating', () => {
  setup()
  const dispose = injectStyles()
  const css = [...document.querySelectorAll('style')].map(node => node.textContent).join('')
  // Time and line tracks are max-content and never shrink; the destination (then the platform) gives way; one line only.
  expect(css).toMatch(/\.map-journey-list\.is-board \{[^}]*grid-template-columns:max-content max-content minmax\(0, 1fr\) minmax\(0, max-content\) minmax\(0, max-content\)/)
  expect(css).toMatch(/\.map-board-line \{[^}]*min-width:max-content/)
  expect(css).not.toMatch(/is-narrow/)
  // Badges keep their natural size: nothing in the line cell grows, stretches or centres them.
  const lineRules = css.match(/[^}]*map-board-line[^{]*\{[^}]*\}/g) ?? []
  expect(lineRules.length).toBeGreaterThan(0)
  for (const rule of lineRules) expect(rule).not.toMatch(/flex:\s*1|width:\s*100%|justify-content:\s*center|justify-self:\s*stretch/)
  expect(css).toMatch(/\.map-board-line \{[^}]*justify-self:start/)
  dispose()
})

it('draws the provider row glyph for station suggestions and its own pin otherwise', async () => {
  setup()
  const snapshot: ReturnType<MapSidebarTab['getSnapshot']> = { fields: [], actions: [], rows: [{ id: 'zh', title: 'Zürich HB', action: 'station:zh' }], look: 'sbb',
    rowIcon: { viewBox: '0 0 36 36', path: 'M1 1h34v34H1z', fillRule: 'evenodd' },
    route: { stops: [{ id: 'origin', role: 'origin', label: 'From', value: 'Zü' }] } }
  const extension: MapSidebarTab = { id: 'sbb', label: 'SBB', icon: { path: '', viewBox: '0 0 24 24' }, getSnapshot: () => snapshot, subscribe: () => vi.fn(), run: vi.fn(async () => {}) }
  const { container } = render(<ExtensionPanel extension={extension} />)
  await act(async () => { fireEvent.focus(screen.getByLabelText('From')) })
  const glyph = container.querySelector('.map-journey-suggestion .map-row-icon svg')!
  expect(glyph.getAttribute('viewBox')).toBe('0 0 36 36')
  expect(glyph.querySelector('path')).toHaveAttribute('d', 'M1 1h34v34H1z')
  expect(glyph.querySelector('path')).toHaveAttribute('fill-rule', 'evenodd')
})

it('opens a ride leg as its run: back bar to the connection, every stop on one spine, roles, SBB-style delays and no legend', async () => {
  setup()
  let notify = () => {}
  const leg = { kind: 'ride' as const, action: 'ride:0', occupancy: { second: 2 }, badge: { text: 'S12', kind: 'regional' as const }, direction: 'to Wil SG', from: { time: { time: '13:06' }, name: 'Brugg AG', platform: 'Pl. 5' }, to: { time: { time: '13:45' }, name: 'Zürich HB', platform: 'Pl. 43/44' } }
  let snapshot: ReturnType<MapSidebarTab['getSnapshot']> = { fields: [], actions: [], rows: [], look: 'sbb', segments: [{ id: 'timetable', label: 'Timetable' }], segment: 'timetable',
    journey: { title: 'Brugg AG → Zürich HB', departure: { time: '13:06' }, arrival: { time: '13:45' }, summary: 'Today, 39 min', back: 'back', legs: [leg] } }
  const extension: MapSidebarTab = { id: 'sbb', label: 'SBB', icon: { path: '', viewBox: '0 0 24 24' }, getSnapshot: () => snapshot, subscribe: listener => { notify = listener; return vi.fn() }, run: vi.fn(async () => {}) }
  const { container } = render(<ExtensionPanel extension={extension} />)
  const card = screen.getByRole('button', { name: /Brugg AG/ })
  expect(card).toHaveClass('map-leg', 'is-action')
  expect(card.querySelector('.map-occupancy.is-level-2')).not.toBeNull()
  expect(container.querySelector('.map-legend')).toBeNull()
  await act(async () => { fireEvent.click(card) })
  expect(extension.run).toHaveBeenLastCalledWith('ride:0', {})
  await act(async () => { fireEvent.keyDown(card, { key: 'Enter' }) })
  expect(extension.run).toHaveBeenLastCalledWith('ride:0', {})
  const scroller = container.parentElement!
  scroller.scrollTop = 240
  act(() => {
    snapshot = { ...snapshot, ride: { title: 'S12 to Wil SG', back: 'rideBack', badge: { text: 'S12', kind: 'regional' }, number: '19251', direction: 'to Wil SG', occupancy: { second: 2 }, stops: [
      { name: 'Brugg AG', departure: { time: '13:06' }, platform: 'Pl. 5', role: 'board' },
      { name: 'Turgi', arrival: { time: '13:10' }, departure: { time: '13:11', expected: '13:13', late: true, delay: 'approx. +2′' }, platform: 'Pl. 3', role: 'pass' },
      { name: 'Zürich HB', arrival: { time: '13:45' }, platform: 'Pl. 43/44', role: 'alight' },
      { name: 'Wil SG', arrival: { time: '14:42', expected: '14:44', late: true, delay: 'approx. +2′' }, platform: 'Pl. 5', role: 'after' }] } }
    notify()
  })
  // The run opens at its first stop.
  expect(scroller.scrollTop).toBe(0)
  const back = screen.getByRole('button', { name: 'Back to the connection' })
  expect(back.closest('.map-journey-backbar')).toHaveTextContent('S12 to Wil SG')
  expect(container.querySelector('.map-journey-detail')).toBeNull()
  expect(container.querySelector('.map-ride-head')).toHaveTextContent('S1219251')
  const rows = [...container.querySelectorAll('.map-ride-stop')]
  expect(rows.map(row => row.classList[1])).toEqual(['is-board', 'is-pass', 'is-alight', 'is-after'])
  expect([...rows[0].querySelectorAll('.map-ride-time')].map(node => [node.textContent, node.classList.contains('is-strong')])).toEqual([['13:06', true]])
  // The planned time keeps its colour; the delay sits under it in the late colour, and the dot turns late.
  expect([...rows[1].querySelectorAll('.map-ride-time')].map(node => [node.textContent, node.classList.contains('is-strong')])).toEqual([['13:10', false], ['13:11', true]])
  expect(rows[1].querySelector('.map-ride-delay')).toHaveTextContent('approx. +2′')
  expect(rows[1]).toHaveClass('is-late', 'has-tail')
  expect(rows[0]).not.toHaveClass('is-late')
  expect(rows[3].querySelector('.map-ride-delay')).toHaveTextContent('approx. +2′')
  expect(rows[3].querySelector('.map-ride-platform')).toHaveTextContent('Pl. 5')
  expect(container.querySelector('.map-legend')).toBeNull()
  expect([...rows[3].querySelectorAll('.map-ride-time')].map(node => [node.textContent, node.classList.contains('is-strong')])).toEqual([['14:42', true]])
  expect(rows[2].querySelector('.map-ride-platform')).toHaveTextContent('Pl. 43/44')
  await act(async () => { fireEvent.keyDown(rows[1], { key: 'Escape' }) })
  expect(extension.run).toHaveBeenLastCalledWith('rideBack', {})
  await act(async () => { fireEvent.click(back) })
  expect(extension.run).toHaveBeenLastCalledWith('rideBack', {})
  // One line per stop: names truncate, times and platforms never wrap.
  const dispose = injectStyles()
  const css = [...document.querySelectorAll('style')].map(node => node.textContent).join('')
  expect(css).toMatch(/\.map-ride-title \{[^}]*text-overflow:ellipsis; white-space:nowrap/)
  expect(css).toMatch(/\.map-ride-time \{ white-space:nowrap; \}/)
  expect(css).toMatch(/\.map-ride-platform \{[^}]*white-space:nowrap/)
  expect(css).toMatch(/\.map-ride-delay \{[^}]*white-space:nowrap/)
  expect(css).not.toMatch(/map-legend/)
  dispose()
})

it('always shows the complete line text at its natural size, never capped or truncated', () => {
  setup()
  const dispose = injectStyles()
  const css = [...document.querySelectorAll('style')].map(node => node.textContent).join('')
  const badgeRules = css.match(/[^}]*map-line-(badge|text)[^{]*\{[^}]*\}/g) ?? []
  expect(badgeRules.length).toBeGreaterThan(0)
  for (const rule of badgeRules) expect(rule).not.toMatch(/max-width|text-overflow|overflow:\s*hidden/)
  dispose()
  const snapshot: ReturnType<MapSidebarTab['getSnapshot']> = { fields: [], actions: [], rows: [], look: 'sbb',
    journeys: [{ id: 'x', badge: { text: 'EC 000060', kind: 'train', category: 'EC', number: '000060' }, direction: 'Basel SBB', departure: { time: '10:33' }, platform: 'Pl. 5' }] }
  const extension: MapSidebarTab = { id: 'sbb', label: 'SBB', icon: { path: '', viewBox: '0 0 24 24' }, getSnapshot: () => snapshot, subscribe: () => vi.fn(), run: vi.fn(async () => {}) }
  const { container } = render(<ExtensionPanel extension={extension} />)
  expect(container.querySelector('.map-board-line .map-line-badge')).toHaveTextContent('EC000060')
})

it('hands the open tab\'s overlay to the map and takes it away when the tab is left', async () => {
  const mock = setup()
  const store = createStore(mock.api); await act(async () => { await store.ready })
  const set = vi.spyOn(store, 'setSidebarOverlay')
  let notify = () => {}
  const overlay = { fit: 'station:1', color: '#2d327d', markers: [{ lng: 8.54, lat: 47.378, kind: 'station' as const, label: 'Zürich HB' }] }
  let snapshot: ReturnType<MapSidebarTab['getSnapshot']> = { fields: [], actions: [], rows: [], segments: [{ id: 'departures', label: 'Departures' }], segment: 'departures', overlay }
  const extension: MapSidebarTab = { id: 'sbb', label: 'SBB', icon: { path: '', viewBox: '0 0 24 24' }, getSnapshot: () => snapshot, subscribe: listener => { notify = listener; return () => {} }, run: vi.fn(async () => {}) }
  const view = render(<ExtensionPanel extension={extension} />)
  expect(set).toHaveBeenLastCalledWith(overlay)
  act(() => { snapshot = { ...snapshot, overlay: undefined }; notify() })
  expect(set).toHaveBeenLastCalledWith(null)
  act(() => { snapshot = { ...snapshot, overlay }; notify() })
  expect(set).toHaveBeenLastCalledWith(overlay)
  view.unmount()
  expect(set).toHaveBeenLastCalledWith(null)
  await disposeStore(store)
})
