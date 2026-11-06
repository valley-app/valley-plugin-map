import type { ValleyPluginApi } from '@valley/plugin-sdk'
import { MapFileError, parseMapFile, type MapFileData } from './mapFile'

/**
 * GPX and KML files are read by the `mapfile` WebAssembly module (src/wasm): the same collection, bounds and
 * unsupported flag as {@link parseMapFile}, without building a DOM. GeoJSON stays on `JSON.parse`, already native.
 * The JavaScript parser remains the reference and the fallback: for a host without `api.wasm`, a module that cannot
 * load or runs out of memory, files above {@link MAX_WASM_CHARS}, text that is not well-formed UTF-16, and the rare
 * constructs the module hands back.
 */

const MODULE_ID = 'mapfile'
/**
 * The module holds the file, one record per element and the JSON it writes in its 64 MiB memory, up to 2.5 times the
 * file: above this many characters it would run out of memory, so the JavaScript parser reads the file directly.
 */
const MAX_WASM_CHARS = 20_000_000
const FORMATS: Record<string, number> = { gpx: 0, kml: 1 }

interface ReaderExports {
  valley_alloc(length: number): number
  valley_free(pointer: number, length: number): void
  map_file_parse(pointer: number, length: number): bigint
}

interface Reader { exports: ReaderExports; memory: WebAssembly.Memory }

const readers = new WeakMap<object, Promise<Reader | null>>()

function load(api: Pick<ValleyPluginApi, 'wasm'>): Promise<Reader | null> {
  let reader = readers.get(api)
  if (!reader) {
    reader = (async () => {
      if (!api.wasm || typeof WebAssembly === 'undefined') return null
      const env: { memory?: WebAssembly.Memory } = {}
      const instance = await api.wasm.instantiate(MODULE_ID, { env }) as unknown as { exports: ReaderExports }
      return env.memory && typeof instance.exports.map_file_parse === 'function' ? { exports: instance.exports, memory: env.memory } : null
    })().catch(() => null)
    readers.set(api, reader)
  }
  return reader
}

const revive = (_key: string, value: unknown): unknown => typeof value === 'string' && value.charCodeAt(0) === 0 ? Number(value.slice(1)) : value

/** Runs the module once; `undefined` means "use the JavaScript parser". A trap discards the instance. */
function run(api: object, reader: Reader, format: number, text: string): MapFileData | undefined {
  const { exports, memory } = reader
  let input = 0, size = 0, used = 0
  try {
    for (const capacity of [text.length + 1, text.length * 3 + 1]) {
      if (input) exports.valley_free(input, size)
      size = capacity
      input = exports.valley_alloc(size)
      if (!input) return undefined
      const view = new Uint8Array(memory.buffer, input, size)
      view[0] = format
      const { read, written } = new TextEncoder().encodeInto(text, view.subarray(1))
      if (read === text.length) { used = written + 1; break }
    }
    const packed = exports.map_file_parse(input, used)
    const pointer = Number(BigInt.asUintN(64, packed) >> 32n), length = Number(BigInt.asUintN(32, packed))
    const frame = new Uint8Array(memory.buffer, pointer, length)
    if (frame[0] !== 0) {
      const message = new TextDecoder().decode(frame.subarray(1))
      exports.valley_free(pointer, length)
      if (message === 'invalid') throw new MapFileError('file.invalid')
      return undefined
    }
    // [0, flags, count, (ptr, len, capacity) × count]: the JSON in chunks, decoded in order.
    const table = new DataView(memory.buffer, pointer, length)
    const nonfinite = frame[1] === 1
    const decoder = new TextDecoder()
    let json = ''
    for (let index = 0, count = table.getUint32(2, true); index < count; index++) {
      const at = 6 + index * 12
      const chunk = table.getUint32(at, true)
      json += decoder.decode(new Uint8Array(memory.buffer, chunk, table.getUint32(at + 4, true)), { stream: true })
      exports.valley_free(chunk, table.getUint32(at + 8, true))
    }
    json += decoder.decode()
    exports.valley_free(pointer, length)
    return JSON.parse(json, nonfinite ? revive : undefined) as MapFileData
  } catch (error) {
    if (error instanceof MapFileError) throw error
    readers.delete(api)
    return undefined
  } finally {
    // After a trap the module's memory is gone with its instance; freeing into a live one is always safe.
    if (input && readers.has(api)) exports.valley_free(input, size)
  }
}

/** {@link parseMapFile}, with GPX and KML read by the WebAssembly module when it is available. */
export async function readMapFile(api: Pick<ValleyPluginApi, 'wasm'>, path: string, text: string): Promise<MapFileData> {
  const format = FORMATS[path.split('.').at(-1)?.toLowerCase() ?? '']
  const clean = text.replace(/^\uFEFF/, '')
  if (format === undefined || clean.length > MAX_WASM_CHARS || !clean.trim() || !(clean as { isWellFormed?(): boolean }).isWellFormed?.()) return parseMapFile(path, text)
  const reader = await load(api)
  return (reader && run(api, reader, format, clean)) || parseMapFile(path, text)
}
