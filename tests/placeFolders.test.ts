import { describe, expect, it } from 'vitest'
import { addPlaceFolder, deletePlaceFolder, folderPlaceCount, folderVisible, moveFolder, movePlace, normalizePlaceFolders, placesIn, visiblePlaces } from '../src/placeFolders'
import type { Place, PlaceFolder } from '../src/types'

const place = (id: string, folder?: string): Place => ({ id, name: id, lng: 8, lat: 47, createdAt: '2026-11-15T00:00:00.000Z', ...(folder ? { folder } : {}) })
const folders: PlaceFolder[] = [
  { id: 'trips', name: 'Trips' },
  { id: 'alps', name: 'Alps', parent: 'trips' },
  { id: 'food', name: 'Food' }
]

describe('place folders', () => {
  it('keeps nesting one level deep when loading saved folders', () => {
    expect(normalizePlaceFolders([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B', parent: 'a' },
      { id: 'c', name: 'C', parent: 'b' },
      { id: 'd', name: 'D', parent: 'missing' },
      { id: 'a', name: 'Duplicate' },
      { name: 'No id' }
    ])).toEqual([{ id: 'a', name: 'A' }, { id: 'b', name: 'B', parent: 'a' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }])
  })

  it('adds a subfolder only under a top-level folder, after its siblings', () => {
    expect(addPlaceFolder(folders, { id: 'lakes', name: 'Lakes', parent: 'trips' }).map(folder => folder.id)).toEqual(['trips', 'alps', 'lakes', 'food'])
    expect(addPlaceFolder(folders, { id: 'deep', name: 'Deep', parent: 'alps' })).toEqual(folders)
  })

  it('nests a folder inside a top-level folder but never makes a third level', () => {
    expect(moveFolder(folders, 'food', { kind: 'folder', id: 'trips', position: 'inside' })).toEqual([
      { id: 'trips', name: 'Trips' }, { id: 'alps', name: 'Alps', parent: 'trips' }, { id: 'food', name: 'Food', parent: 'trips' }
    ])
    expect(moveFolder(folders, 'food', { kind: 'folder', id: 'alps', position: 'inside' })).toBeNull()
    expect(moveFolder(folders, 'trips', { kind: 'folder', id: 'food', position: 'inside' })).toBeNull()
    expect(moveFolder(folders, 'trips', { kind: 'folder', id: 'alps', position: 'before' })).toBeNull()
  })

  it('reorders folders and lifts a subfolder back to the top level', () => {
    expect(moveFolder(folders, 'food', { kind: 'folder', id: 'trips', position: 'before' })?.map(folder => folder.id)).toEqual(['food', 'trips', 'alps'])
    expect(moveFolder(folders, 'trips', { kind: 'folder', id: 'food', position: 'after' })?.map(folder => folder.id)).toEqual(['alps', 'food', 'trips'])
    expect(moveFolder(folders, 'alps', { kind: 'folder', id: 'food', position: 'after' })).toEqual([
      { id: 'trips', name: 'Trips' }, { id: 'food', name: 'Food' }, { id: 'alps', name: 'Alps' }
    ])
    expect(moveFolder(folders, 'alps', { kind: 'root' })?.at(-1)).toEqual({ id: 'alps', name: 'Alps' })
    expect(moveFolder(folders, 'food', { kind: 'root' })).toBeNull()
  })

  it('moves places into folders, beside other places and back to the top level', () => {
    const places = [place('home'), place('zermatt', 'alps'), place('pizza', 'food')]
    expect(movePlace(places, folders, 'home', { kind: 'folder', id: 'alps', position: 'inside' })?.map(entry => [entry.id, entry.folder])).toEqual([
      ['zermatt', 'alps'], ['home', 'alps'], ['pizza', 'food']
    ])
    expect(movePlace(places, folders, 'home', { kind: 'place', id: 'pizza', position: 'before' })?.map(entry => [entry.id, entry.folder])).toEqual([
      ['zermatt', 'alps'], ['home', 'food'], ['pizza', 'food']
    ])
    const lifted = movePlace(places, folders, 'zermatt', { kind: 'root' })
    expect(lifted?.at(-1)).toEqual(place('zermatt'))
    expect(movePlace(places, folders, 'pizza', { kind: 'root' })?.at(-1)).toEqual(place('pizza'))
    expect(movePlace(places, folders, 'home', { kind: 'place', id: 'zermatt', position: 'before' })?.[0]).toEqual(place('home', 'alps'))
    expect(movePlace(places, folders, 'zermatt', { kind: 'folder', id: 'alps', position: 'inside' })).toBeNull()
  })

  it('counts a folder with its subfolders and treats places of a missing folder as top level', () => {
    const places = [place('home'), place('zermatt', 'alps'), place('basel', 'trips'), place('lost', 'gone')]
    expect(folderPlaceCount(places, folders, 'trips')).toBe(2)
    expect(placesIn(places, folders, undefined).map(entry => entry.id)).toEqual(['home', 'lost'])
  })

  it('deleting a folder keeps its places in the parent and lifts its subfolders', () => {
    const places = [place('zermatt', 'alps'), place('basel', 'trips')]
    expect(deletePlaceFolder(folders, places, 'alps')).toEqual({ folders: [folders[0], folders[2]], places: [place('zermatt', 'trips'), places[1]] })
    expect(deletePlaceFolder(folders, places, 'trips')).toEqual({ folders: [{ id: 'alps', name: 'Alps' }, folders[2]], places: [places[0], place('basel')] })
  })

  it('hides a place when its own eye or any folder above it is closed', () => {
    const places = [place('home'), place('zermatt', 'alps'), place('basel', 'trips'), place('pizza', 'food')]
    expect(visiblePlaces(places, folders, [], []).map(entry => entry.id)).toEqual(['home', 'zermatt', 'basel', 'pizza'])
    expect(visiblePlaces(places, folders, ['trips'], []).map(entry => entry.id)).toEqual(['home', 'pizza'])
    expect(visiblePlaces(places, folders, ['alps'], ['home']).map(entry => entry.id)).toEqual(['basel', 'pizza'])
    expect(folderVisible(folders, ['trips'], 'alps')).toBe(false)
    expect(folderVisible(folders, ['alps'], 'trips')).toBe(true)
  })
})
