import { describe, expect, it, vi } from 'vitest'
import { createMockValleyApi } from '@valley/plugin-testkit'
import type { DatasetRecord } from '@valley/plugin-sdk'
import type { IndexEntry } from '@valley/plugin-sdk/types'
import { createBackgroundGeocoding, GEOCODE_ANSWER_BYTES, GEOCODE_ANSWER_LIMIT, GEOCODE_NEGATIVE_TTL, GEOCODE_POSITIVE_TTL, GEOCODE_QUEUE_LIMIT } from '../src/backgroundGeocoding'
import { PUBLIC_SEARCH_ID, searchProviderIdentity } from '../src/geocodeProviders'
import { GeocodeError, type GeocodedPlaces } from '../src/geocode'
import { defaultPinSource, normalizeAddress } from '../src/pinSources'
import { accountProviderChoice, resolveSettings } from '../src/settings'

const source = { ...defaultPinSource(), id: 'source', matchKey: 'type', matchValue: 'habitat' }
const settings = resolveSettings({})
const accountSettings = (id: string) => resolveSettings({ mapboxEnabled: true, searchProvider: accountProviderChoice('mapbox', id) })
const entries = (...addresses: string[]): IndexEntry[] => addresses.map((address, index) => ({ relPath: `${index}.md`, title: address, kind: 'note', mtimeMs: 0, frontmatter: { type: 'habitat', address } }))
const positive = (provider = PUBLIC_SEARCH_ID): GeocodedPlaces => ({ provider, places: [{ name: 'Grove', lng: 8, lat: 12 }] })
const id = (provider: string, address: string): string => JSON.stringify([provider, normalizeAddress(address)])
const answer = (address: string, provider = PUBLIC_SEARCH_ID, unresolved = false, observedAt = 100000): DatasetRecord => ({
  id: id(provider, address), address, provider, observedAt, expiresAt: observedAt + (unresolved ? GEOCODE_NEGATIVE_TTL : GEOCODE_POSITIVE_TTL),
  lng: unresolved ? null : 8, lat: unresolved ? null : 12, unresolved
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function setup(rows: DatasetRecord[] = []) {
  let time = 100000
  const mock = createMockValleyApi({ manifest: { id: 'map' }, datasets: { 'map.geocode_answers': rows } })
  const dataset = mock.api.data.dataset('geocode_answers')
  const query = vi.spyOn(dataset, 'query')
  const batch = vi.spyOn(dataset, 'batch')
  const remove = vi.spyOn(dataset, 'delete')
  const lookup = vi.fn(async (_address: string, selected: typeof settings, _signal: AbortSignal) => positive(searchProviderIdentity(selected)))
  const publish = vi.fn(async (_address: string, _point: { lng: number; lat: number }, _signal: AbortSignal) => true)
  const sleep = vi.fn(async (milliseconds: number, _signal: AbortSignal) => { time += milliseconds })
  const onError = vi.fn()
  const owner = createBackgroundGeocoding({ answers: dataset, lookup, publish, sleep, onError, now: () => time })
  return { owner, lookup, publish, sleep, onError, query, batch, remove, dataset, advance: (milliseconds: number) => { time += milliseconds } }
}

describe('Map background geocoding owner', () => {
  it('reuses only fresh answers from the exact provider/account and expires negative answers sooner', async () => {
    const first = accountSettings('first')
    const second = accountSettings('second')
    const mock = setup([answer('Known', searchProviderIdentity(first)), answer('Unknown', searchProviderIdentity(first), true)])
    mock.owner.update(entries('Known', 'Unknown'), [source], first)
    await mock.owner.settled()
    expect(mock.lookup).not.toHaveBeenCalled()
    expect(mock.publish).toHaveBeenCalledTimes(1)
    mock.owner.update(entries('Known', 'Unknown'), [source], second)
    await mock.owner.settled()
    expect(mock.lookup.mock.calls.map(([address]) => address)).toEqual(['Known', 'Unknown'])
    mock.advance(GEOCODE_NEGATIVE_TTL)
    mock.owner.update(entries('Known', 'Unknown'), [source], first)
    await mock.owner.settled()
    expect(mock.lookup.mock.calls.map(([address]) => address)).toEqual(['Known', 'Unknown', 'Unknown'])
    expect(mock.owner.snapshot().cacheEntries).toBe(4)
    await mock.owner.dispose()
  })

  it('never treats missing provenance, future timestamps or invalid coordinates as reusable answers', async () => {
    const mock = setup([
      { ...answer('Unowned'), provider: '' },
      answer('Future', PUBLIC_SEARCH_ID, false, 200000),
      { ...answer('Invalid'), lng: 300 },
      { ...answer('Too old'), observedAt: 0, expiresAt: 100000 }
    ])
    mock.owner.update(entries('Unowned', 'Future', 'Invalid', 'Too old'), [source], settings)
    await mock.owner.settled()
    expect(mock.lookup).toHaveBeenCalledTimes(4)
    expect(mock.publish).toHaveBeenCalledTimes(4)
    expect(mock.batch).toHaveBeenCalledWith(expect.arrayContaining([{ operation: 'delete', key: { id: id(PUBLIC_SEARCH_ID, 'Unowned') } }]))
    await mock.owner.dispose()
  })

  it('streams more addresses than the queue capacity without dropping work and deduplicates normalized batch entries', async () => {
    const mock = setup()
    const first = deferred<GeocodedPlaces>()
    mock.lookup.mockImplementationOnce(() => first.promise)
    const names = Array.from({ length: GEOCODE_QUEUE_LIMIT * 3 + 5 }, (_, index) => `Grove ${index}`)
    mock.owner.update(entries(...names.flatMap(name => [name, ` ${name.toUpperCase()} `])), [source], settings)
    await vi.waitFor(() => expect(mock.lookup).toHaveBeenCalledTimes(1))
    expect(mock.owner.snapshot().queued).toBeLessThanOrEqual(GEOCODE_QUEUE_LIMIT)
    first.resolve(positive())
    await mock.owner.settled()
    expect(mock.lookup.mock.calls.map(([address]) => address)).toEqual(names)
    expect(new Set(mock.publish.mock.calls.map(([address]) => normalizeAddress(address))).size).toBe(names.length)
    expect(mock.query).toHaveBeenCalledTimes(2)
    expect(mock.query).toHaveBeenCalledWith(expect.objectContaining({ limit: GEOCODE_ANSWER_LIMIT + 1 }))
    expect(mock.owner.snapshot()).toMatchObject({ queued: 0, running: false })
    await mock.owner.dispose()
  })

  it('bounds persisted and in-memory answer retention without touching the retained pin projection', async () => {
    const rows = Array.from({ length: GEOCODE_ANSWER_LIMIT + 100 }, (_, index) => answer(`Grove ${index}`, PUBLIC_SEARCH_ID, false, 1000 + index))
    const mock = setup(rows)
    mock.owner.update(entries(), [source], settings)
    await mock.owner.settled()
    expect(mock.owner.snapshot().cacheEntries).toBe(GEOCODE_ANSWER_LIMIT)
    const retained = (await mock.dataset.query({ limit: 1000 })).rows
    expect(retained).toHaveLength(GEOCODE_ANSWER_LIMIT)
    expect(retained.some(row => row.address === 'Grove 0')).toBe(false)
    expect(mock.publish).not.toHaveBeenCalled()
    expect(mock.owner.snapshot().cacheBytes).toBeLessThanOrEqual(GEOCODE_ANSWER_BYTES)
    mock.owner.update(entries('Newest'), [source], settings)
    await mock.owner.settled()
    const afterWrite = (await mock.dataset.query({ limit: 1000 })).rows
    expect(afterWrite).toHaveLength(GEOCODE_ANSWER_LIMIT)
    expect(afterWrite.some(row => row.address === 'Newest')).toBe(true)
    await mock.owner.dispose()
  })

  it('enforces the byte bound and rejects oversized input instead of truncating the address into a different query', async () => {
    const rows = Array.from({ length: GEOCODE_ANSWER_LIMIT }, (_, index) => answer(`${index}${'ä'.repeat(1000)}`))
    const mock = setup(rows)
    mock.owner.update(entries('ä'.repeat(1025)), [source], settings)
    await mock.owner.settled()
    expect(mock.lookup).not.toHaveBeenCalled()
    expect(mock.owner.snapshot().cacheEntries).toBeLessThan(GEOCODE_ANSWER_LIMIT)
    expect(mock.owner.snapshot().cacheBytes).toBeLessThanOrEqual(GEOCODE_ANSWER_BYTES)
    expect((await mock.dataset.query({ limit: 1000 })).rows).toHaveLength(mock.owner.snapshot().cacheEntries)
    await mock.owner.dispose()
  })

  it('drops a superseded provider response before publication and carries the newest source snapshot forward', async () => {
    const mock = setup()
    const pending = deferred<GeocodedPlaces>()
    mock.lookup.mockImplementationOnce(() => pending.promise)
    mock.owner.update(entries('Old'), [source], settings)
    await vi.waitFor(() => expect(mock.lookup).toHaveBeenCalledTimes(1))
    const oldSignal = mock.lookup.mock.calls[0][2]
    const replacement = accountSettings('replacement')
    mock.owner.update(entries('New'), [source], replacement)
    expect(oldSignal.aborted).toBe(true)
    pending.resolve(positive())
    await mock.owner.settled()
    expect(mock.lookup.mock.calls.map(([address]) => address)).toEqual(['Old', 'New'])
    expect(mock.publish.mock.calls.map(([address]) => address)).toEqual(['New'])
    expect((await mock.dataset.query()).rows.map(row => row.address)).toEqual(['New'])
    expect(mock.onError).not.toHaveBeenCalled()
    await mock.owner.dispose()
  })

  it('attributes fallback answers to the actual provider without letting them suppress the selected account', async () => {
    const mock = setup()
    mock.lookup.mockResolvedValue(positive())
    const selected = accountSettings('account')
    mock.owner.update(entries('Grove'), [source], selected)
    await mock.owner.settled()
    expect((await mock.dataset.query()).rows[0].provider).toBe(PUBLIC_SEARCH_ID)
    mock.owner.update(entries('Grove'), [source], selected)
    await mock.owner.settled()
    expect(mock.lookup).toHaveBeenCalledTimes(2)
    mock.owner.update(entries('Grove'), [source], settings)
    await mock.owner.settled()
    expect(mock.lookup).toHaveBeenCalledTimes(2)
    await mock.owner.dispose()
  })

  it('stops on rate limiting without writing a negative answer or dropping later addresses from the next revision', async () => {
    const mock = setup()
    mock.lookup.mockRejectedValueOnce(new GeocodeError(429))
    const notes = entries('First', 'Second')
    mock.owner.update(notes, [source], settings)
    await mock.owner.settled()
    expect(mock.lookup).toHaveBeenCalledTimes(1)
    expect((await mock.dataset.query()).rows).toEqual([])
    mock.owner.update(notes, [source], settings)
    await mock.owner.settled()
    expect(mock.lookup.mock.calls.map(([address]) => address)).toEqual(['First', 'First', 'Second'])
    await mock.owner.dispose()
  })

  it('awaits active work on disposal and prevents a queued request from beginning afterward', async () => {
    const mock = setup()
    const pending = deferred<GeocodedPlaces>()
    mock.lookup.mockImplementationOnce(() => pending.promise)
    mock.owner.update(entries('First', 'Second'), [source], settings)
    await vi.waitFor(() => expect(mock.lookup).toHaveBeenCalledTimes(1))
    let done = false
    const disposing = mock.owner.dispose().then(() => { done = true })
    expect(mock.lookup.mock.calls[0][2].aborted).toBe(true)
    expect(done).toBe(false)
    pending.resolve(positive())
    await disposing
    expect(mock.lookup).toHaveBeenCalledTimes(1)
    expect(mock.publish).not.toHaveBeenCalled()
    expect(mock.owner.snapshot()).toEqual({ queued: 0, cacheEntries: 0, cacheBytes: 0, running: false })
    mock.owner.update(entries('Third'), [source], settings)
    await mock.owner.settled()
    expect(mock.lookup).toHaveBeenCalledTimes(1)
  })

  it('does not publish or prune after a delayed initial cache read is disposed', async () => {
    const mock = setup()
    const read = deferred<Awaited<ReturnType<typeof mock.dataset.query>>>()
    mock.query.mockImplementationOnce(() => read.promise)
    mock.owner.update(entries('Grove'), [source], settings)
    const disposing = mock.owner.dispose()
    read.resolve({ rows: [], revision: 0 })
    await disposing
    expect(mock.remove).not.toHaveBeenCalled()
    expect(mock.lookup).not.toHaveBeenCalled()
    expect(mock.publish).not.toHaveBeenCalled()
  })

  it('does not persist a negative answer for malformed coordinates or another account response', async () => {
    const mock = setup()
    mock.lookup.mockResolvedValueOnce({ provider: PUBLIC_SEARCH_ID, places: [{ name: 'Invalid', lng: 999, lat: 12 }] })
    mock.lookup.mockResolvedValueOnce(positive(searchProviderIdentity(accountSettings('unexpected'))))
    mock.owner.update(entries('Invalid', 'Wrong account'), [source], settings)
    await mock.owner.settled()
    expect(mock.publish).not.toHaveBeenCalled()
    expect((await mock.dataset.query()).rows).toEqual([])
    expect(mock.onError).toHaveBeenCalledTimes(2)
    await mock.owner.dispose()
  })

  it('prunes a full expired cache within host filter and mutation limits', async () => {
    const mock = setup(Array.from({ length: GEOCODE_ANSWER_LIMIT }, (_, index) => answer(`Grove ${index}`, PUBLIC_SEARCH_ID, true)))
    mock.owner.update(entries(), [source], settings)
    await mock.owner.settled()
    const filter = mock.query.mock.calls.find(([query]) => query?.select?.includes('id'))![0]!.where!
    expect((filter.and as Array<{ id: { notIn: string[] } }>).map(part => part.id.notIn.length)).toEqual([100, 100, 100, 100, 100, 12])
    mock.advance(GEOCODE_NEGATIVE_TTL)
    mock.owner.update(entries(), [source], settings)
    await mock.owner.settled()
    expect(mock.batch.mock.calls.map(([operations]) => operations.length)).toEqual([128, 128, 128, 128])
    expect((await mock.dataset.query()).rows).toEqual([])
    expect(mock.owner.snapshot().cacheBytes).toBe(0)
    await mock.owner.dispose()
  })

  it('waits for an accepted projection write and rejects its obsolete result before caching or starting the next request', async () => {
    const mock = setup()
    const write = deferred<boolean>()
    mock.publish.mockImplementationOnce(() => write.promise)
    mock.owner.update(entries('Old'), [source], settings)
    await vi.waitFor(() => expect(mock.publish).toHaveBeenCalledTimes(1))
    const publishingSignal = mock.publish.mock.calls[0][2]
    mock.owner.update(entries('New'), [source], accountSettings('next'))
    expect(publishingSignal.aborted).toBe(true)
    expect(mock.lookup).toHaveBeenCalledTimes(1)
    write.resolve(true)
    await mock.owner.settled()
    expect(mock.lookup.mock.calls.map(([address]) => address)).toEqual(['Old', 'New'])
    expect((await mock.dataset.query()).rows.map(row => row.address)).toEqual(['New'])
    await mock.owner.dispose()
  })

  it('keeps stop awaiting its original work and does not restart from updates delivered during the drain', async () => {
    const mock = setup()
    const pending = deferred<GeocodedPlaces>()
    mock.lookup.mockImplementationOnce(() => pending.promise)
    mock.owner.update(entries('Old'), [source], settings)
    await vi.waitFor(() => expect(mock.lookup).toHaveBeenCalledTimes(1))
    const stopping = mock.owner.stop()
    mock.owner.update(entries('During unload'), [source], settings)
    pending.resolve(positive())
    await stopping
    await mock.owner.settled()
    expect(mock.lookup).toHaveBeenCalledTimes(1)
    expect(mock.owner.snapshot().running).toBe(false)
    mock.owner.update(entries('Later explicit update'), [source], settings)
    await mock.owner.settled()
    expect(mock.lookup.mock.calls.map(([address]) => address)).toEqual(['Old', 'Later explicit update'])
    await mock.owner.dispose()
  })
})
