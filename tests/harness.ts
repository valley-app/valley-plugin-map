import * as React from 'react'
import { createMockValleyApi as createBaseMock, type MockValleyApi } from '@valley/plugin-testkit'
import type { PluginBackendApi, ValleyPluginApi } from '@valley/plugin-sdk'
import type { PluginFetchRequest } from '@valley/plugin-sdk/pluginNetwork'
import { register } from '../src/backend'
import type { mapServices } from '../src/serviceClient'

export type { MockValleyApi }
type Methods = Partial<Pick<ReturnType<typeof mapServices>, 'listConnections' | 'route'>>
const eventListeners = new WeakMap<ValleyPluginApi, Map<string, Set<(payload: unknown) => void>>>()
export function emitMapEvent(api: ValleyPluginApi, event: string): void { for (const listener of eventListeners.get(api)?.get(event) ?? []) listener(undefined) }
const overrides = new WeakMap<object, Methods>()
export function mapBackend(methods: Methods): ValleyPluginApi['backend'] {
  const backend = { call: async <T>() => undefined as T, callOperation: async <T>() => undefined as T, on: () => () => {} }
  overrides.set(backend, methods)
  return backend
}

type SelectFieldProps = React.ComponentProps<ValleyPluginApi['ui']['settings']['SelectField']>
type DescribedOption = SelectFieldProps['options'][number] & { description?: string }

/**
 * The shared dropdown as the host draws it, in the shape a test can read: it
 * honours `disabled`, shows `placeholder` for a value no option has, and keeps
 * each option's second line (`description`, the account email) as its title.
 */
function DescribedSelectField({ value, onChange, options, ariaLabel, placeholder, disabled, className }: SelectFieldProps): React.ReactElement {
  const known = options.some((option) => option.value === value)
  return React.createElement('select', {
    'aria-label': ariaLabel, className, disabled, value: known ? value : '',
    onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)
  },
  !known && React.createElement('option', { value: '' }, placeholder ?? value),
  ...(options as readonly DescribedOption[]).map((option) => React.createElement('option', { key: option.value, value: option.value, title: option.description }, option.label)))
}

export function createMockValleyApi(options: Parameters<typeof createBaseMock>[0] = {}): MockValleyApi {
  const custom = options.overrides?.backend && overrides.get(options.overrides.backend)
  const mock = createBaseMock(options)
  mock.api.ui.settings.SelectField = DescribedSelectField
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  eventListeners.set(mock.api, listeners)
  const handlers = new Map<string, (payload: unknown) => unknown>()
  const transfers = new Map<string, AbortController>()
  register({
    i18n: { language: () => 'en', t: (key: string) => key },
    rpc: { handle: (method: string, handler: (payload: unknown) => unknown) => { handlers.set(method, handler); return () => { handlers.delete(method) } }, emit: () => {} },
    accounts: { subscribe: () => () => {}, list: async () => [], authorize: async () => { throw new Error('No account authorization fixture') } },
    network: {
      cancel: async (id: string) => { const controller = transfers.get(id); controller?.abort(); return Boolean(controller) },
      fetch: async (request: PluginFetchRequest) => {
        const controller = new AbortController()
        if (request.requestId) transfers.set(request.requestId, controller)
        try {
          const response = await fetch(request.url, { signal: controller.signal, method: request.method, headers: request.headers, body: request.bodyBase64 ? atob(request.bodyBase64) : undefined })
          const body = JSON.stringify(await response.json())
          return { status: response.status || (response.ok ? 200 : 500), headers: Object.fromEntries(response.headers?.entries?.() ?? []), bodyBase64: btoa(String.fromCharCode(...new TextEncoder().encode(body))) }
        } finally { if (request.requestId) transfers.delete(request.requestId) }
      }
    }
  } as unknown as PluginBackendApi)
  mock.api.backend = {
    ...mock.api.backend,
    call: async <T>(method: string, payload?: unknown): Promise<T> => {
      const value = payload as Record<string, unknown> | undefined
      if (method === 'listConnections' && custom?.listConnections) return await custom.listConnections(value?.capability as string | undefined) as T
      if (method === 'route' && custom?.route) return await custom.route(value?.connectionId as string, value?.coordinates as Array<[number, number]>, value?.profile as string | undefined) as T
      const handler = handlers.get(method)
      if (!handler) throw new Error(`Unknown backend method ${method}`)
      return await handler(payload) as T
    },
    on: (event, listener) => { const group = listeners.get(event) ?? new Set(); group.add(listener); listeners.set(event, group); return () => { group.delete(listener) } }
  }
  return mock
}
