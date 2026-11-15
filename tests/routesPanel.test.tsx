import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DataRecord } from '@valley/plugin-sdk/types'
import { createMockValleyApi } from './harness'
import { initRuntime } from '../src/runtime'
import { initLocalization } from '../src/localization'
import { createStore, disposeStore } from '../src/store'
import { Panel } from '../src/Panel'
import type { MapEngine } from '../src/mapEngine'
import { filedRoutes, folderColor, normalizeRouteFiling, routeFiling } from '../src/placeFolders'

vi.mock('../src/geocode', () => ({
  GeocodeError: class GeocodeError extends Error {},
  searchPlaces: vi.fn(async () => []),
  reverseGeocode: vi.fn(async () => null)
}))

afterEach(cleanup)

const route = (id: string, name: string, position: number): { route: DataRecord; waypoints: DataRecord[] } => ({
  route: { id, name, mode: 'driving', geometry: [[7.44, 46.95], [7.59, 47.56]], distanceM: 98000, durationS: 4200, createdAt: '2026-11-15T08:00:00.000Z', position },
  waypoints: [
    { routeId: id, position: 0, lng: 7.44, lat: 46.95, label: 'Bern' },
    { routeId: id, position: 1, lng: 7.59, lat: 47.56, label: 'Basel' }
  ]
})
const COMMUTE = route('route-commute', 'Bern – Basel', 0)
const HIKE = route('route-hike', 'Grindelwald – First', 1)

async function renderRoutes(settings: Record<string, unknown> = {}) {
  const mock = createMockValleyApi({
    manifest: { id: 'map', drivers: ['files'] },
    realm: { path: '/fixtures/map-routes', name: 'Map routes', displayName: 'Map routes' },
    settings: { mapSessionState: { id: 'session', panelTab: 'routes' }, ...settings },
    datasets: { 'map.routes': [COMMUTE.route, HIKE.route], 'map.route_waypoints': [...COMMUTE.waypoints, ...HIKE.waypoints] }
  })
  initLocalization(mock.api)
  initRuntime(mock.api)
  const store = createStore(mock.api)
  await act(async () => { render(React.createElement(Panel)) })
  await waitFor(() => expect(screen.getByText('Bern – Basel')).toBeTruthy())
  return { mock, store, dispose: () => { cleanup(); disposeStore(store) } }
}

async function chooseFromMenu(mock: ReturnType<typeof createMockValleyApi>, button: HTMLElement, id: string): Promise<void> {
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

const moreOf = (name: string): HTMLElement =>
  within(screen.getByText(name).closest('.map-tree-row') as HTMLElement).getByRole('button', { name: 'More actions' })

describe('route folder helpers', () => {
  it('orders filed routes first and keeps unknown routes at the end', () => {
    const routes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const items = filedRoutes(routes, normalizeRouteFiling([{ id: 'c', folder: 'folder-x' }, { id: 'gone' }, { id: 'c' }, 'junk']))
    expect(items.map(item => item.id)).toEqual(['c', 'a', 'b'])
    expect(routeFiling(items)).toEqual([{ id: 'c', folder: 'folder-x' }, { id: 'a' }, { id: 'b' }])
  })

  it('colours a route line with its folder, falling back to the parent folder', () => {
    const folders = [{ id: 'folder-a', name: 'A', color: 'palette:blue' }, { id: 'folder-b', name: 'B', parent: 'folder-a' }]
    expect(folderColor(folders, 'folder-b')).toBe('palette:blue')
    expect(folderColor(folders, undefined)).toBeUndefined()
  })
})

describe('Favourite routes tab', () => {
  it('heads the list with a 38px Routes bar in the places order', async () => {
    const { mock, dispose } = await renderRoutes()
    const bar = screen.getByText('Routes').closest('.map-places-bar') as HTMLElement
    expect(within(bar).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['Hide all routes on the map', 'Add folder', 'Plan a new route'])
    await act(async () => { await mock.api.settings.set('routeFolders', [{ id: 'folder-weekend', name: 'Weekend' }, { id: 'folder-hikes', name: 'Hikes', parent: 'folder-weekend' }]) })
    expect(within(bar).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['Collapse all folders', 'Hide all routes on the map', 'Add folder', 'Plan a new route'])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Collapse all folders' })) })
    expect(mock.api.settings.get().collapsedRouteFolders).toEqual(['folder-weekend', 'folder-hikes'])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Plan a new route' })) })
    expect(mock.api.workspace.revealOwnPanel).toHaveBeenCalledWith('right_sidebar')
    dispose()
  })

  it('creates folders with one subfolder level and moves routes up when a folder is deleted', async () => {
    const { mock, dispose } = await renderRoutes()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add folder' })) })
    const name = await screen.findByLabelText('Folder name')
    await act(async () => {
      fireEvent.change(name, { target: { value: 'Weekend' } })
      fireEvent.keyDown(name, { key: 'Enter' })
      fireEvent.blur(name)
    })
    await waitFor(() => expect(screen.getByText('Weekend')).toBeTruthy())
    const folders = (): { id: string; name: string; parent?: string }[] => mock.api.settings.get().routeFolders as never
    expect(folders()).toEqual([{ id: expect.stringMatching(/^folder-[0-9a-f]{12}$/), name: 'Weekend' }])

    await chooseFromMenu(mock, moreOf('Weekend'), 'subfolder')
    const sub = await screen.findByLabelText('Folder name')
    await act(async () => {
      fireEvent.change(sub, { target: { value: 'Hikes' } })
      fireEvent.blur(sub)
    })
    await waitFor(() => expect(folders()).toHaveLength(2))
    expect(folders()[1].parent).toBe(folders()[0].id)
    await act(async () => { fireEvent.click(moreOf('Hikes')) })
    expect((mock.menus.at(-1) ?? []).map(item => item.id)).toEqual(['icon', 'color', 'rename', undefined, 'delete'])

    // Route menu: every item carries an icon; Move to folder opens Weekend's submenu, which starts with Weekend itself.
    await act(async () => { fireEvent.click(moreOf('Grindelwald – First')) })
    const menu = mock.menus.at(-1) ?? []
    expect(menu.map(item => item.id)).toEqual(['show', 'rename', 'icon', 'move', undefined, 'delete'])
    expect(menu.filter(item => item.id).every(item => item.icon)).toBe(true)
    const move = menu.find(item => item.id === 'move') as { submenu: { id: string; submenu?: { id: string }[] }[] }
    expect(move.submenu.map(item => item.id)).toEqual(['top-level', `${folders()[0].id}:sub`])
    expect(move.submenu[1].submenu?.map(item => item.id)).toEqual([folders()[0].id, folders()[1].id])
    await chooseFromMenu(mock, moreOf('Grindelwald – First'), folders()[1].id)
    await waitFor(() => expect(mock.api.settings.get().routeFiling).toEqual([{ id: 'route-commute' }, { id: 'route-hike', folder: folders()[1].id }]))

    await chooseFromMenu(mock, moreOf('Hikes'), 'delete')
    await waitFor(() => expect(folders()).toHaveLength(1))
    expect(mock.api.settings.get().routeFiling).toEqual([{ id: 'route-commute' }, { id: 'route-hike', folder: folders()[0].id }])
    expect(screen.getByText('Grindelwald – First')).toBeTruthy()
    dispose()
  })

  it('changes a folder\'s icon and colour straight from its menu, without a modal', async () => {
    const { mock, dispose } = await renderRoutes({ routeFolders: [{ id: 'folder-work', name: 'Work' }] })
    await chooseFromMenu(mock, moreOf('Work'), 'color')
    expect(document.querySelector('[role=dialog]')).toBeNull()
    await waitFor(() => expect(mock.popovers.length).toBe(1))
    const palette = render(<>{mock.popovers.at(-1)!.node}</>)
    const swatch = palette.container.querySelector('.map-palette-swatch:not(.is-unset)') as HTMLElement
    await act(async () => { fireEvent.click(swatch) })
    const color = (mock.api.settings.get().routeFolders as { color?: string }[])[0].color
    expect(color).toMatch(/^palette:/)
    palette.unmount()

    // Change icon is a submenu listing every icon, not a popover.
    await act(async () => { fireEvent.click(moreOf('Work')) })
    const iconItem = (mock.menus.at(-1) ?? []).find(item => item.id === 'icon') as { submenu: { id: string; checked?: boolean }[] }
    expect(iconItem.submenu.length).toBeGreaterThan(10)
    expect(iconItem.submenu.find(entry => entry.checked)?.id).toBe('icon:folder')
    // Host menus only paint icons that render to static SVG markup (no hooks), so every entry shows its glyph at once.
    const menu = mock.menus.at(-1) ?? []
    for (const entry of [...iconItem.submenu, ...menu.filter(item => item.id === 'icon' || item.id === 'color')] as { icon?: React.ReactElement }[]) {
      expect(renderToStaticMarkup(entry.icon!)).toMatch(/^<svg[\s>]/)
    }
    await chooseFromMenu(mock, moreOf('Work'), 'icon:mountain')
    expect(mock.api.settings.get().routeFolders).toEqual([{ id: 'folder-work', name: 'Work', icon: 'mountain', color }])

    await chooseFromMenu(mock, moreOf('Work'), 'color')
    await waitFor(() => expect(mock.popovers.length).toBe(2))
    const again = render(<>{mock.popovers.at(-1)!.node}</>)
    await act(async () => { fireEvent.click(within(again.container).getByRole('button', { name: 'No color' })) })
    expect(mock.api.settings.get().routeFolders).toEqual([{ id: 'folder-work', name: 'Work', icon: 'mountain' }])
    dispose()
  })

  it('hides routes, folders and everything at once, and draws only the visible routes on the map', async () => {
    const { mock, store, dispose } = await renderRoutes({
      routeFolders: [{ id: 'folder-work', name: 'Work', color: 'palette:blue' }],
      routeFiling: [{ id: 'route-commute', folder: 'folder-work' }]
    })
    const calls: string[][] = []
    const engine = new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, key) => {
        if (key === 'setSavedRoutes') return (routes: { id: string }[]) => calls.push(routes.map(entry => entry.id))
        if (key === 'then') return undefined
        return (target[key] ??= vi.fn())
      }
    }) as unknown as MapEngine
    await act(async () => { store.attachMap(engine) })
    expect(calls.at(-1)).toEqual(['route-commute', 'route-hike'])

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Hide “Work” on the map' })) })
    expect(mock.api.settings.get().hiddenRouteFolders).toEqual(['folder-work'])
    expect(screen.getByText('Bern – Basel').closest('.map-tree-row')).toHaveClass('is-hidden')
    expect(calls.at(-1)).toEqual(['route-hike'])

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Hide “Grindelwald – First” on the map' })) })
    expect(mock.api.settings.get().hiddenRoutes).toEqual(['route-hike'])
    expect(calls.at(-1)).toEqual([])

    await act(async () => {
      await mock.api.settings.set('hiddenRouteFolders', [])
      await mock.api.settings.set('hiddenRoutes', [])
    })
    expect(calls.at(-1)).toEqual(['route-commute', 'route-hike'])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Hide all routes on the map' })) })
    expect(mock.api.settings.get().routesHidden).toBe(true)
    expect(mock.api.settings.get().hiddenRoutes).toEqual([])
    expect(calls.at(-1)).toEqual([])
    expect(screen.getByText('Grindelwald – First').closest('.map-tree-row')).toHaveClass('is-hidden')
    dispose()
  })
})
