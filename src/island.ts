import type { ValleyPluginApi } from '@valley/plugin-sdk'
import { api, captureMapRenderOwner, type MapRenderOwner } from './runtime'
import type { MapEngine, MapEngineOptions } from './mapEngine'

type Island = Pick<typeof import('./islandRuntime'), 'createMapEngine'>
const islands = new WeakMap<Document, Promise<Island>>()

function loadIsland(document: Document, owner: MapRenderOwner): Promise<Island> {
  const existing = islands.get(document)
  if (existing) return existing
  const pending = new Promise<Island>((resolve, reject) => {
    const script = document.createElement('script')
    script.type = 'module'
    script.src = owner.api.assets.url('island.js')
    script.onload = () => {
      const island = (document.defaultView as unknown as { valleyMapIsland?: Island })?.valleyMapIsland
      if (!island) { islands.delete(document); script.remove(); reject(new Error('Map runtime did not initialize')); return }
      resolve(island)
    }
    script.onerror = () => { islands.delete(document); script.remove(); reject(new Error('Unable to load map runtime')) }
    document.head.appendChild(script)
  })
  islands.set(document, pending)
  return pending
}

export function createMapEngine(options: MapEngineOptions, source: ValleyPluginApi = api, signal?: AbortSignal): Promise<MapEngine> {
  const owner = captureMapRenderOwner(source)
  return owner.run(async () => {
    if (signal?.aborted) throw new DOMException('The map view was closed.', 'AbortError')
    const island = await loadIsland(options.container.ownerDocument, owner)
    owner.assertActive()
    if (signal?.aborted) throw new DOMException('The map view was closed.', 'AbortError')
    return island.createMapEngine(options, owner)
  })
}
