import { resolveInteropContract, type InteropContract } from '@valley/plugin-sdk'

export interface MapSidebarSnapshot {
  fields: { id: string; label: string; value: string; placeholder?: string }[]
  actions: { id: string; label: string; disabled?: boolean }[]
  rows: { id: string; title: string; detail?: string; action?: string }[]
  message?: string
  error?: string
  busy?: boolean
}

export interface MapSidebarTab {
  id: string
  label: string
  icon: { viewBox: string; path: string }
  getSnapshot(): MapSidebarSnapshot
  subscribe(listener: () => void): () => void
  setActive?(active: boolean): void
  run(action: string, values: Record<string, string>): Promise<void>
}

export const MAP_SIDEBAR_TAB_V1 = resolveInteropContract({
  id: 'map.sidebarTab', kind: 'extension', version: '1.0.0', cardinality: 'many',
  wire: {
    identityKeys: ['id'],
    value: { type: 'object', required: ['id', 'label', 'icon', 'getSnapshot', 'subscribe', 'run'], properties: {
      id: { type: 'string' }, label: { type: 'string' },
      icon: { type: 'object', required: ['viewBox', 'path'], properties: { viewBox: { type: 'string' }, path: { type: 'string' } } },
      setActive: { type: 'function' }, getSnapshot: { type: 'function' }, subscribe: { type: 'function' }, run: { type: 'function' }
    } }
  }
}) as InteropContract<MapSidebarTab, 'extension'>
