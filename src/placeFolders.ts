import type { PlaceFolder } from './types'

/** Anything filed in a folder tree: a favourite place or a saved route. */
export type FiledItem = { id: string; folder?: string }

export const MAX_PLACE_FOLDERS = 200
export const PLACE_FOLDER_NAME_MAX = 60

/** Where a dragged row lands: on a row's upper or lower edge, inside a folder, or at the end of the top level. */
export type PlaceDrop =
  | { kind: 'place' | 'folder'; id: string; position: 'before' | 'after' | 'inside' }
  | { kind: 'root' }

export function newPlaceFolderId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return `folder-${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

/** Coerce the saved setting: unnamed or duplicate entries dropped, and a parent
 *  that is missing or itself a subfolder cleared, so nesting stays one level deep. */
export function normalizePlaceFolders(value: unknown): PlaceFolder[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const folders: PlaceFolder[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const { id, name, parent, icon, color } = entry as Record<string, unknown>
    if (typeof id !== 'string' || !id || seen.has(id) || typeof name !== 'string') continue
    seen.add(id)
    folders.push({ id, name: name.slice(0, PLACE_FOLDER_NAME_MAX), ...(typeof parent === 'string' && parent ? { parent } : {}),
      ...(typeof icon === 'string' && icon ? { icon } : {}), ...(typeof color === 'string' && color ? { color } : {}) })
    if (folders.length >= MAX_PLACE_FOLDERS) break
  }
  const topLevel = new Set(folders.filter(folder => !folder.parent).map(folder => folder.id))
  return folders.map(folder => folder.parent && (!topLevel.has(folder.parent) || folder.parent === folder.id) ? withParent(folder, undefined) : folder)
}

/** A copy of a folder at another level; its name, icon and colour stay. */
function withParent(folder: PlaceFolder, parent: string | undefined): PlaceFolder {
  const copy: PlaceFolder = { ...folder }
  if (parent) copy.parent = parent
  else delete copy.parent
  return copy
}

export function subfolders(folders: readonly PlaceFolder[], id: string): PlaceFolder[] {
  return folders.filter(folder => folder.parent === id)
}

/** The places filed in `folder` (top level for undefined), in list order.
 *  A place naming a folder that no longer exists counts as top level. */
export function placesIn<T extends FiledItem>(places: readonly T[], folders: readonly PlaceFolder[], folder: string | undefined): T[] {
  const known = new Set(folders.map(entry => entry.id))
  return places.filter(place => (place.folder && known.has(place.folder) ? place.folder : undefined) === folder)
}

/** Is a folder shown on the map: its own eye and its parent's are open. */
export function folderVisible(folders: readonly PlaceFolder[], hiddenFolders: readonly string[], id: string): boolean {
  if (hiddenFolders.includes(id)) return false
  const parent = folders.find(folder => folder.id === id)?.parent
  return !parent || !hiddenFolders.includes(parent)
}

/** The places the map draws: the place's eye is open and so is every folder above it. */
export function visiblePlaces<T extends FiledItem>(places: readonly T[], folders: readonly PlaceFolder[], hiddenFolders: readonly string[], hiddenPlaces: readonly string[]): T[] {
  const known = new Set(folders.map(folder => folder.id))
  return places.filter(place => !hiddenPlaces.includes(place.id) && (!place.folder || !known.has(place.folder) || folderVisible(folders, hiddenFolders, place.folder)))
}

/** Places in a folder and its subfolders. */
export function folderPlaceCount(places: readonly FiledItem[], folders: readonly PlaceFolder[], id: string): number {
  const ids = new Set([id, ...subfolders(folders, id).map(folder => folder.id)])
  return places.filter(place => place.folder && ids.has(place.folder)).length
}

export function addPlaceFolder(folders: readonly PlaceFolder[], folder: PlaceFolder): PlaceFolder[] {
  const parent = folder.parent ? folders.find(entry => entry.id === folder.parent) : undefined
  if (folder.parent && (!parent || parent.parent)) return [...folders]
  const next = withParent({ ...folder, name: folder.name.slice(0, PLACE_FOLDER_NAME_MAX) }, parent?.id)
  if (!parent) return [...folders, next]
  const family = folders.reduce((last, entry, index) => entry.id === parent.id || entry.parent === parent.id ? index : last, -1)
  return [...folders.slice(0, family + 1), next, ...folders.slice(family + 1)]
}

/**
 * Move a folder. `inside` files it under a top-level folder — refused when that
 * would make a third level (the folder has subfolders of its own, or the target is
 * a subfolder). `before`/`after` place it beside the target at the target's level.
 * Returns null for a drop that is not allowed or changes nothing.
 */
export function moveFolder(folders: readonly PlaceFolder[], dragId: string, drop: PlaceDrop): PlaceFolder[] | null {
  const dragged = folders.find(folder => folder.id === dragId)
  if (!dragged) return null
  const hasChildren = folders.some(folder => folder.parent === dragId)
  const rest = folders.filter(folder => folder.id !== dragId)
  if (drop.kind === 'root') {
    const next = [...rest, withParent(dragged, undefined)]
    return same(folders, next) ? null : next
  }
  if (drop.kind !== 'folder' || drop.id === dragId) return null
  const target = rest.find(folder => folder.id === drop.id)
  if (!target) return null
  if (drop.position === 'inside') {
    if (target.parent || hasChildren) return null
    const family = rest.reduce((last, folder, index) => folder.id === target.id || folder.parent === target.id ? index : last, -1)
    const next = [...rest.slice(0, family + 1), withParent(dragged, target.id), ...rest.slice(family + 1)]
    return same(folders, next) ? null : next
  }
  if (target.parent && hasChildren) return null
  const moved = withParent(dragged, target.parent)
  let index = rest.indexOf(target)
  // After a top-level folder means after its subfolders too, so they stay together.
  if (drop.position === 'after') index = target.parent ? index + 1 : rest.reduce((last, folder, at) => folder.id === target.id || folder.parent === target.id ? at : last, index) + 1
  const next = [...rest.slice(0, index), moved, ...rest.slice(index)]
  return same(folders, next) ? null : next
}

/**
 * Move a place: `inside` a folder (at its end), before or after another place
 * (adopting that place's folder), or to the end of the top level.
 * Returns null for a drop that is not allowed or changes nothing.
 */
export function movePlace<T extends FiledItem>(places: readonly T[], folders: readonly PlaceFolder[], dragId: string, drop: PlaceDrop): T[] | null {
  const dragged = places.find(place => place.id === dragId)
  if (!dragged) return null
  const rest = places.filter(place => place.id !== dragId)
  let folder: string | undefined
  let index: number
  if (drop.kind === 'root') {
    index = rest.length
  } else if (drop.kind === 'folder') {
    if (!folders.some(entry => entry.id === drop.id)) return null
    folder = drop.id
    // Already the last place of that folder: the folder's order would not change.
    if (dragged.folder === folder && !places.slice(places.indexOf(dragged) + 1).some(place => place.folder === folder)) return null
    const last = rest.reduce((at, place, position) => place.folder === folder ? position : at, -1)
    index = last === -1 ? rest.length : last + 1
  } else {
    if (drop.id === dragId) return null
    const target = rest.find(place => place.id === drop.id)
    if (!target) return null
    folder = target.folder && folders.some(entry => entry.id === target.folder) ? target.folder : undefined
    index = rest.indexOf(target) + (drop.position === 'after' ? 1 : 0)
  }
  const moved: T = { ...dragged }
  if (folder) moved.folder = folder
  else delete moved.folder
  const next = [...rest.slice(0, index), moved, ...rest.slice(index)]
  const unchanged = next.every((place, position) => place.id === places[position].id && (place.folder ?? undefined) === (places[position].folder ?? undefined))
  return unchanged ? null : next
}

/** Remove a folder: its places move to its parent (or the top level) and its subfolders become top-level folders in its place. */
export function deletePlaceFolder<T extends FiledItem>(folders: readonly PlaceFolder[], places: readonly T[], id: string): { folders: PlaceFolder[]; places: T[] } {
  const folder = folders.find(entry => entry.id === id)
  if (!folder) return { folders: [...folders], places: [...places] }
  return {
    folders: folders.filter(entry => entry.id !== id).map(entry => entry.parent === id ? withParent(entry, undefined) : entry),
    places: places.map(place => {
      if (place.folder !== id) return place
      const moved: T = { ...place }
      if (folder.parent) moved.folder = folder.parent
      else delete moved.folder
      return moved
    })
  }
}

function same(a: readonly PlaceFolder[], b: readonly PlaceFolder[]): boolean {
  return a.length === b.length && a.every((folder, index) => folder.id === b[index].id && folder.parent === b[index].parent)
}

/** Generic names for the same tree operations, used by the routes tab. */
export const itemsIn = placesIn
export const visibleItems = visiblePlaces
export const folderItemCount = folderPlaceCount
export const moveItem = movePlace
export const deleteFolder = deletePlaceFolder

/** Where a saved route sits in the routes tree: its folder and glyph. The setting's order is the tree's order. */
export type RouteFiling = { id: string; folder?: string; icon?: string }

export function normalizeRouteFiling(value: unknown): RouteFiling[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const filing: RouteFiling[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const { id, folder, icon } = entry as Record<string, unknown>
    if (typeof id !== 'string' || !id || seen.has(id)) continue
    seen.add(id)
    filing.push({ id, ...(typeof folder === 'string' && folder ? { folder } : {}), ...(typeof icon === 'string' && icon ? { icon } : {}) })
  }
  return filing
}

/** Saved routes in tree order with their filing: filed routes in the setting's order, then the rest in list order. */
export function filedRoutes<R extends { id: string }>(routes: readonly R[], filing: readonly RouteFiling[]): (RouteFiling & { route: R })[] {
  const byId = new Map(routes.map(route => [route.id, route]))
  const known = new Set<string>()
  const items: (RouteFiling & { route: R })[] = []
  for (const entry of filing) {
    const route = byId.get(entry.id)
    if (!route) continue
    known.add(entry.id)
    items.push({ ...entry, route })
  }
  for (const route of routes) if (!known.has(route.id)) items.push({ id: route.id, route })
  return items
}

/** The setting value for a tree: one entry per route, without empty fields. */
export function routeFiling(items: readonly RouteFiling[]): RouteFiling[] {
  return items.map(({ id, folder, icon }) => ({ id, ...(folder ? { folder } : {}), ...(icon ? { icon } : {}) }))
}

/** The colour a route line is drawn in: its folder's, else its parent folder's. */
export function folderColor(folders: readonly PlaceFolder[], id: string | undefined): string | undefined {
  const folder = id ? folders.find(entry => entry.id === id) : undefined
  if (!folder) return undefined
  return folder.color ?? (folder.parent ? folders.find(entry => entry.id === folder.parent)?.color : undefined)
}
