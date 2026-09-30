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

it('shows read-only status in file Info', async () => {
  const mock = setup()
  mock.api.vault.fileInfo = vi.fn().mockResolvedValue({ size: 2048, mtimeMs: 1 })
  render(<FileInfo relPath="fern.gpx" />)
  expect(screen.getByText('Read-only')).toBeInTheDocument()
  expect(screen.getByText('GPX')).toBeInTheDocument()
  for (const label of ['Path', 'Type', 'Access', 'Size', 'Modified']) expect(screen.getByText(label)).toBeInTheDocument()
  expect(await screen.findByText('2 KB')).toBeInTheDocument()
})
