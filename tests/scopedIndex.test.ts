import { afterEach, expect, it, vi } from 'vitest'
import type { PluginIndexPage } from '@valley/plugin-sdk'
import { createMockValleyApi } from './harness'
import { createStore, disposeStore } from '../src/store'

const entry = (index: number) => ({ relPath: `Grove/${index}.md`, title: `Grove ${index}`, kind: 'note' as const, mtimeMs: index, frontmatter: { lat: 47, lng: 8 + index / 1000, custom: 'field' }, links: ['omit'], tags: ['omit'] })
const cleanups: (() => unknown)[] = []
const releases: (() => void)[] = []
afterEach(async () => { for (const release of releases.splice(0)) release(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks() })

it('opens related notes by filename and alias from owned pages without the legacy resolver', async () => {
  const mock = createMockValleyApi({ manifest: { id: 'map', indexState: 'scoped' }, indexEntries: [{ ...entry(0), aliases: ['Map target'] }] })
  vi.spyOn(mock.api.workspace, 'resolveWikilink').mockImplementation(() => { throw new Error('Legacy index resolver is unavailable') })
  const store = createStore(mock.api)
  cleanups.push(() => disposeStore(store))
  await store.ready
  store.openNote('[[Map target]]')
  store.openNote('0.md')
  expect(mock.api.workspace.openFile).toHaveBeenNthCalledWith(1, 'Grove/0.md')
  expect(mock.api.workspace.openFile).toHaveBeenNthCalledWith(2, 'Grove/0.md')
  expect(mock.api.getState().indexEntries).toEqual([])
})

function hold(mock: ReturnType<typeof createMockValleyApi>, offset: number) {
  const observe = mock.api.index.observe
  let captured: PluginIndexPage | undefined
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  releases.push(release)
  const disposed = vi.fn()
  vi.spyOn(mock.api.index, 'observe').mockImplementation(async (scope, listener) => {
    const owner = await observe(scope, listener)
    return { read: async request => {
      const page = await owner.read(request)
      if (request?.offset === offset && !captured) { captured = page; await gate }
      return page
    }, dispose: async () => { disposed(); await owner.dispose() } }
  })
  return { release, captured: () => captured, disposed }
}

it('hydrates complete note-only pin pages and exposes requested property fields to settings', async () => {
  const mock = createMockValleyApi({ manifest: { id: 'map', indexState: 'scoped' }, indexEntries: [...Array.from({ length: 129 }, (_, index) => entry(index)), { ...entry(200), kind: 'asset' }] })
  const held = hold(mock, 128)
  const store = createStore(mock.api)
  cleanups.push(() => disposeStore(store))
  await vi.waitFor(() => expect(held.captured()).toBeDefined())
  const ready = vi.fn()
  void store.ready.then(ready)
  expect(store.getSnapshot().pins).toEqual([])
  expect(ready).not.toHaveBeenCalled()
  expect(mock.api.getState().indexEntries).toEqual([])
  held.release(); await store.ready
  expect(store.getSnapshot().pins).toHaveLength(129)
  expect(store.getSnapshot().indexEntries[0].frontmatter).toHaveProperty('custom', 'field')
  expect(store.getSnapshot().indexEntries[0]).not.toHaveProperty('links')
  expect(mock.api.index.observe).toHaveBeenCalledOnce()
  expect(mock.api.index.observe).toHaveBeenCalledWith({ kinds: ['note'], fields: ['aliases', 'excluded', 'frontmatter', 'kind', 'title'] }, expect.any(Function))
})

it('updates coordinate pins from scoped revisions while location updates leave the index alone', async () => {
  const mock = createMockValleyApi({ manifest: { id: 'map', indexState: 'scoped' }, indexEntries: [entry(0)] })
  const store = createStore(mock.api)
  cleanups.push(() => disposeStore(store))
  await store.ready
  const entries = store.getSnapshot().indexEntries
  mock.emitState({ liveLocationState: 'active', allowLiveLocation: true, liveLocation: { lat: 45, lng: 7, accuracy: 10, ts: 1 } })
  expect(store.getSnapshot().indexEntries).toBe(entries)
  mock.emitState({ indexEntries: [{ ...entry(0), frontmatter: { lat: 46, lng: 9 } }] })
  await vi.waitFor(() => expect(store.getSnapshot().pins[0]).toMatchObject({ lat: 46, lng: 9 }))
  expect(mock.api.getState().indexEntries).toEqual([])
})

it('joins the held physical read and releases once without late pin publication', async () => {
  const mock = createMockValleyApi({ manifest: { id: 'map', indexState: 'scoped' }, indexEntries: [entry(0)] })
  const held = hold(mock, 0)
  const store = createStore(mock.api)
  cleanups.push(() => disposeStore(store))
  const readiness = expect(store.ready).rejects.toThrow('no longer active')
  await vi.waitFor(() => expect(held.captured()).toBeDefined())
  const closing = store.dispose()
  const changed = vi.fn()
  store.subscribe(changed)
  const ended = vi.fn()
  void closing.then(ended)
  expect(store.dispose()).toBe(closing)
  await readiness
  expect(ended).not.toHaveBeenCalled()
  held.release(); await closing
  expect(held.disposed).toHaveBeenCalledOnce()
  expect(changed).not.toHaveBeenCalled()
  expect(store.getSnapshot().pins).toEqual([])
})
