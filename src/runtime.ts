import type { ValleyPluginApi } from '@valley/plugin-sdk'

/**
 * Module-global handles to the host's React instance and the plugin API, set
 * once in `register(api)` before any view renders. Components import these instead of bundling their own
 * `react`; JSX compiles to `React.createElement` (classic transform), resolving
 * to this binding.
 */
export let React!: typeof import('react')
export let api!: ValleyPluginApi

const owners = new WeakMap<ValleyPluginApi, MapRenderOwner>()
let current: MapRenderOwner | undefined

function createRenderOwner(source: ValleyPluginApi) {
  const root = source.getState().vault?.path
  let active = true
  let disposal: Promise<void> | undefined
  let offState = (): void => {}
  const pending = new Set<Promise<unknown>>()
  const cleanups = new Set<() => void>()
  const owner = {
    api: source,
    isActive: (): boolean => { try { return active && source.getState().vault?.path === root } catch { return false } },
    assertActive(): void { if (!owner.isActive()) throw new Error('The map rendering session is no longer active.') },
    run<T>(work: () => T | Promise<T>): Promise<T> {
      const task = (async () => { owner.assertActive(); return work() })()
      pending.add(task)
      void task.then(() => pending.delete(task), () => pending.delete(task))
      return task
    },
    onDispose(cleanup: () => void): () => void { if (active) cleanups.add(cleanup); else cleanup(); return () => { cleanups.delete(cleanup) } },
    dispose(): Promise<void> {
      if (disposal) return disposal
      active = false
      offState()
      const errors: unknown[] = []
      for (const cleanup of cleanups) { try { cleanup() } catch (error) { errors.push(error) } }
      cleanups.clear()
      return disposal = (async () => {
        while (pending.size) await Promise.allSettled([...pending])
        if (errors.length) throw errors[0]
      })()
    }
  }
  offState = source.subscribeState(['vault'], () => { if (!owner.isActive()) void owner.dispose().catch(() => {}) })
  return owner
}
export type MapRenderOwner = ReturnType<typeof createRenderOwner>

export function captureMapRenderOwner(source: ValleyPluginApi = api): MapRenderOwner {
  let owner = owners.get(source)
  if (!owner) { owner = createRenderOwner(source); owners.set(source, owner) }
  return owner
}

export function initRuntime(a: ValleyPluginApi): MapRenderOwner {
  if (current) void current.dispose().catch(() => {})
  api = a
  React = a.React
  current = createRenderOwner(a)
  owners.set(a, current)
  return current
}
