import { MapEngine, type MapEngineOptions } from './mapEngine'
import type { MapRenderOwner } from './runtime'

export function createMapEngine(options: MapEngineOptions, owner: MapRenderOwner): MapEngine {
  return new MapEngine(options, owner)
}

Object.assign(window, { valleyMapIsland: { createMapEngine } })
