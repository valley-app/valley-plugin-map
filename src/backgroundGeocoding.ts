import type { ValleyPluginApi, DatasetRecord, DatasetBatchOperation } from '@valley/plugin-sdk'
import type { IndexEntry } from '@valley/plugin-sdk/types'
import type { GeoResult, MapSettings, PinSource } from './types'
import type { GeocodedPlaces } from './geocode'
import { GeocodeError } from './geocode'
import { isValidLngLat } from './geo'
import { matchingNotes, normalizeAddress, pendingAddress } from './pinSources'
import { PUBLIC_SEARCH_ID, searchProviderIdentity } from './geocodeProviders'
import { MapRequestCancelled } from './requests'

export const GEOCODE_ANSWER_LIMIT = 512
export const GEOCODE_ANSWER_BYTES = 1024 * 1024
export const GEOCODE_QUEUE_LIMIT = 64
export const GEOCODE_POSITIVE_TTL = 7 * 24 * 60 * 60 * 1000
export const GEOCODE_NEGATIVE_TTL = 15 * 60 * 1000
const PUBLIC_INTERVAL = 1100
const encoder = new TextEncoder()
const bytes = (value: string): number => encoder.encode(value).length
const answerId = (provider: string, address: string): string => JSON.stringify([provider, normalizeAddress(address)])
type Answer = DatasetRecord & { id: string; address: string; provider: string; observedAt: number; expiresAt: number; lng: number | null; lat: number | null; unresolved: boolean }
type Dataset = Pick<ReturnType<ValleyPluginApi['data']['dataset']>, 'query' | 'batch'>

interface GeocodingPorts {
  answers: Dataset
  lookup(address: string, settings: MapSettings, signal: AbortSignal): Promise<GeocodedPlaces>
  publish(address: string, coordinate: { lng: number; lat: number }, signal: AbortSignal): Promise<boolean>
  onError(error: unknown, address: string): void
  now?: () => number
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}

function validAnswer(row: DatasetRecord, now: number): row is Answer {
  if (typeof row.address !== 'string' || !row.address || bytes(row.address) > 2048 || typeof row.provider !== 'string' || !row.provider || bytes(row.provider) > 512) return false
  if (row.id !== answerId(row.provider, row.address) || typeof row.observedAt !== 'number' || typeof row.expiresAt !== 'number') return false
  if (!Number.isSafeInteger(row.observedAt) || !Number.isSafeInteger(row.expiresAt) || row.observedAt > now || row.expiresAt <= now) return false
  const ttl = row.unresolved === true ? GEOCODE_NEGATIVE_TTL : GEOCODE_POSITIVE_TTL
  if (row.expiresAt <= row.observedAt || row.expiresAt - row.observedAt > ttl) return false
  return row.unresolved === true ? row.lng === null && row.lat === null : row.unresolved === false && typeof row.lng === 'number' && typeof row.lat === 'number' && isValidLngLat(row.lng, row.lat)
}

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new MapRequestCancelled()); return }
    const finish = (): void => { signal.removeEventListener('abort', abort); resolve() }
    const timer = window.setTimeout(finish, milliseconds)
    const abort = (): void => { window.clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new MapRequestCancelled()) }
    signal.addEventListener('abort', abort, { once: true })
  })
}

function* addresses(entries: readonly IndexEntry[], sources: readonly PinSource[]): Generator<string | null> {
  for (const source of sources) {
    if (source.hidden || !source.visible) continue
    for (let start = 0; start < entries.length; start += 256) {
      for (const entry of matchingNotes(entries.slice(start, start + 256), source)) {
        const address = pendingAddress(entry.frontmatter, source)
        if (address && bytes(address) <= 2048) yield address
      }
      yield null
    }
  }
}

export function createBackgroundGeocoding(ports: GeocodingPorts) {
  const now = ports.now ?? Date.now
  const pause = ports.sleep ?? sleep
  let cache = new Map<string, Answer>()
  let cacheBytes = 0
  let loaded = false
  let disposed = false
  let generation = 0
  let current: { entries: readonly IndexEntry[]; sources: readonly PinSource[]; settings: MapSettings; provider: string; generation: number } | null = null
  let controller: AbortController | null = null
  let running: Promise<void> | null = null
  let stopping: Promise<void> | null = null
  let queued = 0
  let nextPublicRequest = 0
  const sizes = new WeakMap<Answer, number>()

  const check = (signal: AbortSignal): void => { if (disposed || signal.aborted) throw new MapRequestCancelled() }
  const fresh = (row: Answer, time: number): boolean => row.observedAt <= time && row.expiresAt > time
  const sizeOf = (row: Answer): number => {
    const existing = sizes.get(row)
    if (existing !== undefined) return existing
    const size = bytes(JSON.stringify(row))
    sizes.set(row, size)
    return size
  }
  const measure = (entries: Map<string, Answer>): number => [...entries.values()].reduce((total, row) => total + sizeOf(row), 0)
  const trim = (entries: Map<string, Answer>, time: number): void => {
    for (const [id, row] of entries) if (!fresh(row, time)) entries.delete(id)
    let size = measure(entries)
    while (entries.size > GEOCODE_ANSWER_LIMIT || size > GEOCODE_ANSWER_BYTES) {
      const [id, row] = entries.entries().next().value!
      entries.delete(id)
      size -= sizeOf(row)
    }
  }
  const mutate = async (operations: DatasetBatchOperation[], signal: AbortSignal): Promise<void> => {
    try {
      for (let start = 0; start < operations.length; start += 128) {
        check(signal)
        const result = await ports.answers.batch(operations.slice(start, start + 128))
        check(signal)
        if (!result.affected) throw new Error('Could not save geocode answers')
      }
    } catch (error) { loaded = false; throw error }
  }

  const load = async (signal: AbortSignal): Promise<void> => {
    if (loaded) return
    const rows = (await ports.answers.query({ orderBy: [{ field: 'observedAt', direction: 'desc' }, { field: 'id', direction: 'asc' }], limit: GEOCODE_ANSWER_LIMIT + 1 })).rows
    check(signal)
    const time = now()
    const retained = new Map(rows.filter(row => validAnswer(row, time)).reverse().map(row => [String(row.id), row as Answer]))
    trim(retained, time)
    const ids = [...retained.keys()]
    const where = ids.length ? { and: Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) => ({ id: { notIn: ids.slice(index * 100, index * 100 + 100) } })) } : undefined
    for (;;) {
      const obsolete = (await ports.answers.query({ where, select: ['id'], limit: 128 })).rows
      check(signal)
      if (!obsolete.length) break
      await mutate(obsolete.map(row => ({ operation: 'delete', key: { id: String(row.id) } })), signal)
    }
    cache = retained
    cacheBytes = measure(cache)
    loaded = true
  }

  const save = async (address: string, provider: string, hit: GeoResult | undefined, signal: AbortSignal): Promise<void> => {
    if (!provider || bytes(provider) > 512) return
    const time = now()
    const row: Answer = {
      id: answerId(provider, address), address, provider, observedAt: time,
      expiresAt: time + (hit ? GEOCODE_POSITIVE_TTL : GEOCODE_NEGATIVE_TTL),
      lng: hit?.lng ?? null, lat: hit?.lat ?? null, unresolved: !hit
    }
    const next = new Map(cache)
    next.delete(row.id)
    next.set(row.id, row)
    trim(next, time)
    check(signal)
    await mutate([
      ...[...cache.keys()].filter(id => !next.has(id)).map(id => ({ operation: 'delete' as const, key: { id } })),
      { operation: 'upsert', values: row }
    ], signal)
    cache = next
    cacheBytes = measure(cache)
  }

  const process = async (job: NonNullable<typeof current>, signal: AbortSignal): Promise<void> => {
    await load(signal)
    check(signal)
    const expired = [...cache.values()].filter(row => !fresh(row, now())).map(row => row.id)
    if (expired.length) {
      await mutate(expired.map(id => ({ operation: 'delete', key: { id } })), signal)
      for (const id of expired) cache.delete(id)
      cacheBytes = measure(cache)
    }
    const iterator = addresses(job.entries, job.sources)
    const queue: Array<{ address: string; key: string }> = []
    const fill = async (): Promise<void> => {
      const keys = new Set(queue.map(item => item.key))
      while (queue.length < GEOCODE_QUEUE_LIMIT) {
        const next = iterator.next()
        if (next.done) break
        if (next.value === null) { await pause(0, signal); check(signal); continue }
        const key = normalizeAddress(next.value)
        if (keys.has(key)) continue
        keys.add(key)
        queue.push({ address: next.value, key })
      }
      queued = queue.length
    }
    await fill()
    while (queue.length) {
      check(signal)
      const item = queue.shift()!
      queued = queue.length
      const cached = cache.get(answerId(job.provider, item.key))
      if (cached && fresh(cached, now())) {
        if (!cached.unresolved) {
          await ports.publish(item.address, { lng: cached.lng!, lat: cached.lat! }, signal)
          check(signal)
        }
      } else {
        try {
          if (nextPublicRequest > now()) await pause(nextPublicRequest - now(), signal)
          check(signal)
          const result = await ports.lookup(item.address, job.settings, signal)
          check(signal)
          if (result.provider !== job.provider && result.provider !== PUBLIC_SEARCH_ID) throw new Error('Unexpected geocode provider')
          if (result.provider === PUBLIC_SEARCH_ID) nextPublicRequest = now() + PUBLIC_INTERVAL
          const hit = result.places.slice(0, 8).find(place => isValidLngLat(place.lng, place.lat))
          if (result.places.length && !hit) throw new Error('Invalid geocode coordinates')
          if (hit) {
            const saved = await ports.publish(item.address, { lng: hit.lng, lat: hit.lat }, signal)
            check(signal)
            if (!saved) throw new Error('Could not save geocoded pin')
          }
          await save(item.address, result.provider, hit, signal)
        } catch (error) {
          check(signal)
          if (error instanceof MapRequestCancelled) return
          if (job.provider === PUBLIC_SEARCH_ID || error instanceof GeocodeError) nextPublicRequest = now() + PUBLIC_INTERVAL
          ports.onError(error, item.address)
          if (error instanceof GeocodeError && error.status === 429) return
        }
      }
      if (!queue.length) await fill()
    }
  }

  const start = (): void => {
    if (disposed || stopping || running || !current) return
    const job = current
    const active = new AbortController()
    controller = active
    running = process(job, active.signal).catch(error => {
      if (!(error instanceof MapRequestCancelled)) ports.onError(error, '')
    }).finally(() => {
      controller = null
      running = null
      queued = 0
      if (current?.generation === job.generation) current = null
      if (current && !disposed) start()
    })
  }
  const stop = (): Promise<void> => {
    if (stopping) return stopping
    generation++
    current = null
    stopping = Promise.resolve(running).then(() => { stopping = null })
    controller?.abort()
    return stopping
  }
  return {
    update(entries: readonly IndexEntry[], sources: readonly PinSource[], settings: MapSettings): void {
      if (disposed || stopping) return
      current = { entries, sources, settings: { ...settings }, provider: searchProviderIdentity(settings), generation: ++generation }
      controller?.abort()
      start()
    },
    stop,
    async dispose(): Promise<void> { disposed = true; await stop(); cache.clear(); cacheBytes = 0 },
    settled: async (): Promise<void> => { while (running) await running },
    snapshot: () => ({ queued, cacheEntries: cache.size, cacheBytes, running: Boolean(running) })
  }
}
