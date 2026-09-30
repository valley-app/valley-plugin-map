import type { PluginBackendApi } from '@valley/plugin-sdk'
import type { PluginFetchRequest, PluginFetchResponse } from '@valley/plugin-sdk/pluginNetwork'

export interface MapBackendRequest {
  check(): void
  fetch(request: PluginFetchRequest): Promise<PluginFetchResponse>
}

export function createBackendRequests(network: PluginBackendApi['network']) {
  type Scope = { id: string; cancelled: boolean; task: Promise<unknown> | null; transfers: Set<string>; sequence: number }
  const scopes = new Map<string, Scope>()
  const prefix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  let sequence = 0
  let disposed = false
  const check = (scope: Scope): void => {
    if (disposed || scope.cancelled || scopes.get(scope.id) !== scope) throw new Error('Map request cancelled')
  }
  const find = (id: unknown): Scope => {
    if (typeof id !== 'string' || id.length > 128 || !scopes.has(id)) throw new Error('Unknown map request')
    return scopes.get(id)!
  }
  const cancel = async (scope: Scope): Promise<void> => {
    scope.cancelled = true
    await Promise.allSettled([
      ...[...scope.transfers].map(id => { try { return network.cancel(id) } catch (error) { return Promise.reject(error) } }),
      ...(scope.task ? [scope.task] : [])
    ])
  }
  return {
    active(id: unknown): boolean { return typeof id === 'string' && !disposed && scopes.has(id) && !scopes.get(id)!.cancelled },
    begin(): string {
      if (disposed) throw new Error('Map request cancelled')
      if (scopes.size >= 32 || !Number.isSafeInteger(sequence + 1)) throw new Error('Map request limit reached')
      const id = `${prefix}-${++sequence}`
      scopes.set(id, { id, cancelled: false, task: null, transfers: new Set(), sequence: 0 })
      return id
    },
    async run<T>(id: unknown, run: (request: MapBackendRequest) => Promise<T>): Promise<T> {
      const scope = find(id)
      check(scope)
      if (scope.task) throw new Error('Map request is already running')
      const task = Promise.resolve().then(() => {
        check(scope)
        return run({
          check: () => check(scope),
          async fetch(request) {
            check(scope)
            if (scope.transfers.size) throw new Error('Map request is already running')
            const requestId = `${scope.id}-${++scope.sequence}`
            scope.transfers.add(requestId)
            try {
              const response = await network.fetch({ ...request, requestId })
              check(scope)
              return response
            } finally { scope.transfers.delete(requestId) }
          }
        })
      })
      scope.task = task
      try { return await task } finally { if (scope.task === task) scope.task = null }
    },
    async cancel(id: unknown): Promise<boolean> {
      const scope = find(id)
      await cancel(scope)
      return true
    },
    async finish(id: unknown): Promise<void> {
      const scope = find(id)
      await cancel(scope)
      scopes.delete(scope.id)
    },
    async dispose(): Promise<void> {
      disposed = true
      await Promise.allSettled([...scopes.values()].map(cancel))
      scopes.clear()
    }
  }
}
