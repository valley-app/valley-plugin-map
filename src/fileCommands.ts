import type { MountedPluginView, ValleyPluginApi } from '@valley/plugin-sdk'
import type { CommandContext } from '@valley/plugin-sdk/commands'
import { React, api } from './runtime'

const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false })
const text = { type: 'string', maxLength: 4096 }
const cameraProperties = { lng: { type: 'number', minimum: -180, maximum: 180 }, lat: { type: 'number', minimum: -85, maximum: 85 }, zoom: { type: 'number', minimum: 0, maximum: 24 }, bearing: { type: 'number', minimum: -360, maximum: 360 }, pitch: { type: 'number', minimum: 0, maximum: 85 } }
const targetSchema = object({ mountId: text, generation: { type: 'integer', minimum: 0 } })
export const mapFileActionSchema = { oneOf: [...['zoom-in', 'zoom-out', 'fit', 'dismiss'].map(type => object({ type: { const: type } })), object({ type: { const: 'select' }, index: { type: 'integer', minimum: 0, maximum: 1000000 } }), object({ type: { const: 'camera' }, patch: { ...object(cameraProperties, []), minProperties: 1 } })] }
export type MapFileAction = { type: 'zoom-in' | 'zoom-out' | 'fit' | 'dismiss' } | { type: 'select'; index: number } | { type: 'camera'; patch: Partial<Record<keyof typeof cameraProperties, number>> }
export interface MapFileObservation { status: 'loading' | 'loaded' | 'error'; engineReady: boolean; sourceRevision: string; camera: Record<keyof typeof cameraProperties, number> | null; selected: number | null; featureCount: number; hasBounds: boolean; readOnly: true }
interface Entry { target: MountedPluginView; snapshot(): MapFileObservation; run(action: MapFileAction): void; signature: string; revision: string; pending: boolean }
const registry = (owner = api) => owner.runtime.getOrCreate('map.fileCommands', () => ({ entries: new Map<string, Entry>(), identity: crypto.randomUUID(), sequence: 0 }))
const keyOf = (target: Pick<MountedPluginView, 'mountId' | 'generation'>) => JSON.stringify([target.mountId, target.generation])
const refused = (code: string, message: string) => Object.assign(new Error(message), { code, outcome: 'not-applied' })
function strict(raw: unknown, keys: string[], required = keys): Record<string, unknown> { if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !keys.includes(key)) || required.some(key => !(key in raw))) throw new Error('Expected a strict Map file action.'); return raw as Record<string, unknown> }
function parse(raw: unknown, mutation = false) {
  const input = strict(raw, mutation ? ['target', 'expectedRevision', 'action'] : ['target']), target = strict(input.target, ['mountId', 'generation'])
  if (typeof target.mountId !== 'string' || !target.mountId || target.mountId.length > 4096 || !Number.isSafeInteger(target.generation) || Number(target.generation) < 0) throw new Error('Expected the exact Map file mount and generation.')
  const exact = { mountId: target.mountId, generation: Number(target.generation) }
  if (!mutation) return { target: exact }
  if (typeof input.expectedRevision !== 'string' || !input.expectedRevision || input.expectedRevision.length > 4096) throw new Error('Expected the observed Map file revision.')
  const action = strict(input.action, ['type', 'index', 'patch'], ['type']), type = action.type
  if (type === 'select') { strict(action, ['type', 'index']); if (!Number.isSafeInteger(action.index) || Number(action.index) < 0 || Number(action.index) > 1000000) throw new Error('Expected a bounded Map feature index.') }
  else if (type === 'camera') { strict(action, ['type', 'patch']); const patch = strict(action.patch, Object.keys(cameraProperties), []); if (!Object.keys(patch).length || (patch.lng === undefined) !== (patch.lat === undefined)) throw new Error('Expected a complete centre or another camera field.'); for (const [key, value] of Object.entries(patch)) { const bounds = cameraProperties[key as keyof typeof cameraProperties]; if (typeof value !== 'number' || !Number.isFinite(value) || value < bounds.minimum || value > bounds.maximum) throw new Error('Invalid Map camera value.') } }
  else { if (!['zoom-in', 'zoom-out', 'fit', 'dismiss'].includes(String(type))) throw new Error('Unsupported Map file action.'); strict(action, ['type']) }
  return { target: exact, expectedRevision: input.expectedRevision, action: action as unknown as MapFileAction }
}
function observe(owner: ValleyPluginApi, target: Pick<MountedPluginView, 'mountId' | 'generation'>) {
  const state = registry(owner), entry = state.entries.get(keyOf(target))
  if (!entry) throw refused('TARGET_REPLACED', 'The exact Map file view is unavailable.')
  const view = entry.snapshot(), signature = JSON.stringify(view)
  if (signature !== entry.signature) { entry.signature = signature; entry.revision = `${state.identity}:${++state.sequence}` }
  return { entry, result: { target, filePath: entry.target.filePath, revision: entry.revision, view } }
}
export function useMapFileCommands(target: MountedPluginView | undefined, snapshot: () => MapFileObservation, run: (action: MapFileAction) => void): void {
  const latest = React.useRef({ snapshot, run }); latest.current = { snapshot, run }
  const [owner] = React.useState(() => api), key = target ? keyOf(target) : null
  React.useEffect(() => { if (!key || !target) return; const state = registry(owner), entry: Entry = { target, snapshot: () => latest.current.snapshot(), run: action => latest.current.run(action), signature: '', revision: '', pending: false }; if (state.entries.has(key)) throw new Error('Duplicate Map file mount.'); state.entries.set(key, entry); return () => { if (state.entries.get(key) === entry) state.entries.delete(key) } }, [owner, key])
}
export function registerMapFileCommands(owner: ValleyPluginApi): () => void {
  const inputSchema = (mutation = false) => object({ target: targetSchema, ...(mutation ? { expectedRevision: text, action: mapFileActionSchema } : {}) })
  const observationSchema = object({ target: targetSchema, filePath: text, revision: text, view: object({ status: { enum: ['loading', 'loaded', 'error'] }, engineReady: { type: 'boolean' }, sourceRevision: text, camera: { anyOf: [object(cameraProperties), { type: 'null' }] }, selected: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] }, featureCount: { type: 'integer', minimum: 0, maximum: 1000000 }, hasBounds: { type: 'boolean' }, readOnly: { const: true } }) })
  const fileTargets = (input: ReturnType<typeof parse>) => [{ kind: 'file' as const, path: observe(owner, input.target).entry.target.filePath, fileOperation: 'read' as const }]
  const inspect = owner.commands.register({ id: 'file-view-inspect', label: 'Map: inspect exact read-only file view', sideEffect: 'read', paletteSafe: false, input: { schema: inputSchema(), parse }, outputSchema: observationSchema, fileTargets, recovery: 'observational', idempotent: true, limits: { requestBytes: 131072, responseBytes: 131072 }, run: input => observe(owner, input.target).result })
  const invoke = async (input: ReturnType<typeof parse>, context: CommandContext) => {
    const { entry, result } = observe(owner, input.target)
    if (!input.action || entry.pending || result.revision !== input.expectedRevision) throw refused('REVISION_CONFLICT', 'Map file state changed. Inspect its exact view again.')
    const assert = () => { if (context.cancellation?.aborted) throw refused('CANCELLED', 'The Map action was cancelled before dispatch.'); if (registry(owner).entries.get(keyOf(input.target)) !== entry) throw refused('TARGET_REPLACED', 'The Map file mount changed before dispatch.') }
    assert(); if (context.validateBeforeRun && !await context.validateBeforeRun(fileTargets(input))) throw refused('PERMISSION_DENIED', 'The Map file action was denied.'); assert()
    if (observe(owner, input.target).result.revision !== input.expectedRevision) throw refused('REVISION_CONFLICT', 'Map state changed during authorization.')
    entry.pending = true
    try { entry.run(input.action); if (registry(owner).entries.get(keyOf(input.target)) !== entry) throw new Error('The Map file mount changed after dispatch.'); return { value: { status: 'queued' as const, target: input.target, action: input.action.type }, revert: null } }
    catch (cause) { if ((cause as { outcome?: string })?.outcome === 'not-applied') throw cause; throw Object.assign(new Error('The Map action dispatched without confirmed effect; inspect its original execution instead of replaying.'), { code: 'EFFECT_UNVERIFIED', outcome: 'unknown', retryable: false, cause }) }
    finally { entry.pending = false; entry.signature = ''; entry.revision = `${registry(owner).identity}:${++registry(owner).sequence}` }
  }
  const control = owner.commands.register({ id: 'file-view-control', label: 'Map: change exact read-only file viewer state', sideEffect: 'write', paletteSafe: false, input: { schema: inputSchema(true), parse: raw => parse(raw, true) }, outputSchema: object({ status: { const: 'queued' }, target: targetSchema, action: text }), fileTargets, revision: input => observe(owner, input.target).result, revisionRequirements: [{ argument: 'expectedRevision', inspectionCommand: 'map:file-view-inspect', description: 'Exact file data, engine readiness, camera and selected feature.' }], recovery: 'non-replayable', idempotent: false, limits: { requestBytes: 131072, responseBytes: 131072 }, preview: input => input, run: invoke })
  return () => { inspect(); control(); registry(owner).entries.clear() }
}
