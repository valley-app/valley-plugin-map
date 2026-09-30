import type { ValleyPluginApi } from '@valley/plugin-sdk'
import { mapServices } from './serviceClient'

export interface MapRequest {
  check(): void
  services: ReturnType<typeof mapServices>
}

export class MapRequestCancelled extends Error {
  constructor() { super('Map request cancelled'); this.name = 'AbortError' }
}

export async function withMapRequest<T>(api: ValleyPluginApi, signal: AbortSignal | undefined,
  run: (request: MapRequest) => Promise<T>): Promise<T> {
  let id: string | undefined
  let closed = false
  let cancellation: Promise<unknown> | undefined
  let failed = false
  let result!: T
  const check = (): void => { if (closed || signal?.aborted) throw new MapRequestCancelled() }
  const cancel = (): void => {
    if (id && !cancellation) cancellation = Promise.resolve().then(() => api.backend.call('cancelRequest', { requestId: id })).catch(() => undefined)
  }
  check()
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    id = await api.backend.call<string>('beginRequest')
    if (signal?.aborted) cancel()
    check()
    result = await run({ check, services: mapServices(api, { id, check, cancel: () => { closed = true; check() } }) })
    check()
  } catch (error) {
    failed = true
    throw error
  } finally {
    closed = true
    signal?.removeEventListener('abort', cancel)
    if (id) {
      await cancellation
      try { await api.backend.call('finishRequest', { requestId: id }) } catch (error) { if (!failed) throw error }
    }
  }
  if (signal?.aborted) throw new MapRequestCancelled()
  return result
}

export function createMapRequests(api: ValleyPluginApi) {
  const pending = new Map<AbortController, Promise<unknown>>()
  let disposed = false
  let draining: Promise<void> | null = null
  const cancelAll = (): Promise<void> => {
    if (draining) return draining
    const requests = [...pending]
    draining = Promise.allSettled(requests.map(([, result]) => result)).then(() => { draining = null })
    for (const [controller] of requests) controller.abort()
    return draining
  }
  return {
    async run<T>(signal: AbortSignal | undefined, run: (request: MapRequest) => Promise<T>): Promise<T> {
      if (disposed || draining || signal?.aborted) throw new MapRequestCancelled()
      if (pending.size >= 32) throw new Error('Map request limit reached')
      const controller = new AbortController()
      const abort = () => controller.abort()
      signal?.addEventListener('abort', abort, { once: true })
      const result = withMapRequest(api, controller.signal, run)
      pending.set(controller, result)
      try { return await result } finally { pending.delete(controller); signal?.removeEventListener('abort', abort) }
    },
    cancelAll,
    async dispose(): Promise<void> { disposed = true; await cancelAll() }
  }
}
