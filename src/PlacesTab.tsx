import { React, api } from './runtime'
import type { DragEvent, FC, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import type { UiMenuItem, UiMenuTarget } from '@valley/plugin-sdk'
import { paletteCssValue } from '@valley/plugin-sdk/palette'
import { useMap } from './hooks'
import { formatLatLng } from './format'
import type { LngLat, Place, PlaceFolder } from './types'
import { uiText } from './localization'
import { PinIconGrid } from './SettingsView'
import { mapIconIds, refreshMapIcons } from './pinIcons'
import {
  addPlaceFolder,
  deletePlaceFolder,
  folderPlaceCount,
  folderVisible,
  moveFolder,
  movePlace,
  newPlaceFolderId,
  normalizePlaceFolders,
  placesIn,
  PLACE_FOLDER_NAME_MAX,
  subfolders,
  type PlaceDrop
} from './placeFolders'
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Crosshair,
  Eye,
  EyeOff,
  Folder,
  FolderInput,
  FolderPlus,
  MapPin,
  MoreHorizontal,
  Pencil,
  MenuPinGlyph,
  PIN_GLYPHS,
  PinGlyph,
  Plus,
  TextCursorInput,
  Trash,
  ValleyIcon
} from './icons'

type Dragged = { kind: 'place' | 'folder'; id: string }
type DropMark = { key: string; position: 'before' | 'after' | 'inside' }

export const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

/** A value saved in a hidden plugin setting; a failed write falls back to what is saved. */
export function useSetting<T>(key: string, normalize: (value: unknown) => T): [T, (next: T) => Promise<void>] {
  const read = (): T => normalize(api.settings.get()[key])
  const [value, setValue] = React.useState(read)
  React.useEffect(() => api.settings.subscribe(() => setValue(read())), [])
  const write = React.useCallback(async (next: T): Promise<void> => {
    setValue(next)
    const result = await api.settings.set(key, next).catch(() => ({ ok: false }))
    if (!result.ok) { setValue(read()); throw new Error(uiText('places.folders.saveError')) }
  }, [])
  return [value, write]
}

/** Opens the map icon grid under `anchor`; the chosen glyph replaces the place's icon.
 *  The pin is the default glyph, so choosing it clears the icon (`''`). */
export function pickIcon(anchor: HTMLElement, selected: string, onSelect: (id: string) => void, defaultId = 'pin'): void {
  void refreshMapIcons()
  void api.ui.openPopover(ctx => <PinIconGrid selected={selected} onSelect={id => { onSelect(id === defaultId ? '' : id); ctx.close() }} />,
    { anchor }, { className: 'map-pin-icon-popover', ariaLabel: uiText('places.icon.change') })
}

const iconLabel = (id: string): string => {
  const glyph = PIN_GLYPHS.find(entry => entry.id === id)
  return glyph ? uiText(glyph.labelKey) : id.replace(/[-_]/g, ' ')
}

/** Change icon as a submenu: every map icon by name, the current one checked. The default glyph clears the icon (`''`). */
export function iconSubmenu(selected: string | undefined, defaultId: string, onPick: (id: string) => void): UiMenuItem[] {
  const current = selected || defaultId
  return mapIconIds().sort((a, b) => iconLabel(a).localeCompare(iconLabel(b))).map(id => ({
    id: `icon:${id}`, label: iconLabel(id), icon: <MenuPinGlyph id={id} />, type: 'radio' as const, checked: id === current,
    onSelect: () => { if (id !== current) onPick(id === defaultId ? '' : id) }
  }))
}

const PlaceIcon: FC<{ place: Pick<Place, 'icon' | 'color'> }> = ({ place }) =>
  place.icon ? <PinGlyph id={place.icon} /> : <MapPin />

/** A menu item's leading colour disc; dashed while no colour is chosen. */
export const ColorDot: FC<{ color?: string }> = ({ color }) => (
  <svg width="1em" height="1em" viewBox="0 0 16 16" aria-hidden="true">
    {color
      ? <circle cx="8" cy="8" r="6.5" style={{ fill: paletteCssValue(color) }} />
      : <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.4 2" />}
  </svg>
)

/** The folder field's value for "no folder"; never a folder id (those start with `folder-`). */
const TOP_LEVEL = 'top-level'

/** Folder choices for the editor: each top-level folder, then its subfolders as `Folder / Subfolder`. */
const folderOptions = (folders: readonly PlaceFolder[]): { value: string; label: string }[] =>
  folders.filter(folder => !folder.parent).flatMap(folder => [
    { value: folder.id, label: folder.name },
    ...subfolders(folders, folder.id).map(child => ({ value: child.id, label: `${folder.name} / ${child.name}` }))
  ])

/** The row's ⋯ menu opens under the button; a right-click opens it at the pointer. */
export const menuTarget = (event: ReactMouseEvent<HTMLElement>): UiMenuTarget =>
  event.type === 'contextmenu' ? { x: event.clientX, y: event.clientY } : { anchor: event.currentTarget, align: 'end' }

/**
 * Add a favourite place by hand, or edit one already saved, in the host modal.
 *
 * Until this existed a place could only be born from a geocoder hit or a map
 * click, and `Place.note` — the document the row's file glyph opens — could only
 * be set from the command bus, so nothing saved through the UI could ever carry
 * one. The address and document fields use the shared resource picker, the
 * colour the shared palette field.
 */
export const PlaceEditor: FC<{ place?: Place; folders: readonly PlaceFolder[]; onClose: () => void }> = ({ place, folders, onClose }) => {
  const { store } = useMap()
  const ResourcePicker = api.ui.ResourcePicker
  const { ColorField, SelectField } = api.ui.settings
  const [name, setName] = React.useState(place?.name ?? '')
  const [address, setAddress] = React.useState('')
  const [note, setNote] = React.useState(place?.note ?? '')
  const [category, setCategory] = React.useState(place?.category ?? '')
  const [color, setColor] = React.useState(place?.color ?? '')
  const [icon, setIcon] = React.useState(place?.icon ?? '')
  const [folder, setFolder] = React.useState(place?.folder && folders.some(entry => entry.id === place.folder) ? place.folder : '')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState(false)
  const [coords, setCoords] = React.useState<LngLat | null>(place ? [place.lng, place.lat] : null)
  if (!store) return null

  const save = async (): Promise<void> => {
    if (!coords || saving) return
    const [lng, lat] = coords
    const trimmed = name.trim()
    setSaving(true)
    try {
      if (place) await store.updatePlace(place.id, { name: trimmed || place.name, lng, lat, note: note.trim() || undefined, category: category.trim() || undefined, color: color || undefined, icon: icon || undefined, folder: folder || undefined })
      else await store.addPlace({ name: trimmed, lng, lat, note, color: color || undefined, icon: icon || undefined, folder: folder || undefined })
      onClose()
    } catch { setError(true) } finally { setSaving(false) }
  }

  return (
    <api.ui.Modal
      title={place ? uiText('auto.e1746f2c11b3') : uiText('auto.29c5ff60169d')}
      size="small"
      bodyClassName="map-place-editor"
      onClose={onClose}
      footer={
        <div className="map-editor-footer">
          {place && (
            <button type="button" className="map-btn map-editor-delete" onClick={() => { onClose(); void store.deletePlace(place.id) }}>
              <Trash /> {uiText('auto.2303581699b6')}
            </button>
          )}
          <span className="map-editor-spacer" />
          <button type="button" className="map-btn" onClick={onClose}>{uiText('auto.77dfd2135f4d')}</button>
          <button type="button" className="map-btn map-btn-primary" disabled={coords === null || saving} onClick={() => void save()}>{uiText('auto.efc007a393f6')}</button>
        </div>
      }
    >
      <div className="map-place-name-row">
        <button type="button" className="map-place-icon-btn" aria-label={uiText('places.icon.change')} title={uiText('places.icon.change')}
          style={color ? { color: paletteCssValue(color) } : undefined}
          onClick={event => pickIcon(event.currentTarget, icon || 'pin', setIcon)}>
          <PlaceIcon place={{ icon, color }} />
        </button>
        <input
          className="map-input"
          placeholder={uiText('auto.8eb815111173')}
          aria-label={uiText('auto.8eb815111173')}
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save() }}
        />
      </div>
      <ResourcePicker
        value={address}
        onChange={(value, result) => {
          setAddress(value)
          const lng = Number(result?.metadata?.longitude)
          const lat = Number(result?.metadata?.latitude)
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
          setCoords([lng, lat])
          setName((current) => current.trim() || result?.label || value)
        }}
        kinds={['place']}
        allowCustom={false}
        placeholder={uiText('auto.31cb5751a886')}
        ariaLabel={uiText('auto.31cb5751a886')}
      />
      {coords !== null && <div className="map-place-coords">{formatLatLng(coords[1], coords[0])}</div>}
      <ResourcePicker
        value={note}
        onChange={setNote}
        kinds={['realm-file']}
        allowCustom={false}
        placeholder={uiText('auto.4a8b395d17d7')}
        ariaLabel={uiText('auto.4a8b395d17d7')}
      />
      {folders.length > 0 && (
        <div className="map-editor-field">
          <span>{uiText('places.editor.folder')}</span>
          <SelectField
            className="map-editor-folder"
            value={folder || TOP_LEVEL}
            onChange={value => setFolder(value === TOP_LEVEL ? '' : value)}
            ariaLabel={uiText('places.menu.move')}
            options={[{ value: TOP_LEVEL, label: uiText('places.menu.topLevel') }, ...folderOptions(folders)]}
          />
        </div>
      )}
      <label className="map-editor-field">
        <span>{uiText('surface.category')}</span>
        <input className="map-input" value={category} onChange={(event) => setCategory(event.target.value)} />
      </label>
      <div className="map-editor-field">
        <span>{uiText('surface.color')}</span>
        <ColorField value={color} unset={!color} ariaLabel={uiText('surface.color')} onChange={setColor} />
      </div>
      {error && <p role="alert" className="settings-path-error">{uiText('surface.invalid')}</p>}
    </api.ui.Modal>
  )
}

/** Opens the palette under `anchor`; `''` clears the colour. */
export function pickColor(anchor: HTMLElement, selected: string, onSelect: (value: string) => void): void {
  // Opened from a menu item: wait until the menu has closed and handed focus back, or the
  // popover takes that focus change for the window losing focus and dismisses itself at once.
  setTimeout(() => openPalette(anchor, selected, onSelect), 80)
}

function openPalette(anchor: HTMLElement, selected: string, onSelect: (value: string) => void): void {
  void api.ui.pickColor({ value: selected, clearable: true, ariaLabel: uiText('surface.color') }, { anchor }).then(value => { if (value !== null && value !== selected) onSelect(value) })
}

/** The folder row's glyph, the anchor of its icon and colour popovers. */
export const rowIconAnchor = (event: ReactMouseEvent<HTMLElement>): HTMLElement =>
  (event.currentTarget.closest('.map-tree-row')?.querySelector('.map-row-icon') as HTMLElement | null) ?? event.currentTarget

/** The Favourite Places tab: folders (one subfolder level) and places, all draggable. */
export const PlacesTab: FC = () => {
  const { store, snap } = useMap()
  const [folders, writeFolders] = useSetting<PlaceFolder[]>('placeFolders', normalizePlaceFolders)
  const [collapsed, writeCollapsed] = useSetting<string[]>('collapsedPlaceFolders', strings)
  const [hiddenFolders, writeHiddenFolders] = useSetting<string[]>('hiddenPlaceFolders', strings)
  const [hiddenPlaces, writeHiddenPlaces] = useSetting<string[]>('hiddenPlaces', strings)
  // The bar's eye: hides every favourite at once and leaves each row's own eye as it was.
  const [allHidden, writeAllHidden] = useSetting<boolean>('placesHidden', value => value === true)
  // `'new'` is the add modal; any other value is the id of the place being edited.
  const [editing, setEditing] = React.useState<string | null>(null)
  // `folder:<id>` or `place:<id>` while that row's name is an inline field.
  const [renaming, setRenaming] = React.useState<string | null>(null)
  const [error, setError] = React.useState(false)
  const dragged = React.useRef<Dragged | null>(null)
  const pending = React.useRef<PlaceDrop | null>(null)
  const [mark, setMark] = React.useState<DropMark | null>(null)
  if (!store) return null
  const places = snap.places
  const editedPlace = editing && editing !== 'new' ? places.find(place => place.id === editing) : undefined

  const fail = (): void => setError(true)
  const commitFolders = async (next: PlaceFolder[], nextPlaces?: Place[]): Promise<void> => {
    const previous = folders
    const previousPlaces = places
    setError(false)
    await writeFolders(next)
    if (nextPlaces) await store.replacePlacesRaw(nextPlaces)
    api.undo.push({
      label: uiText('places.undo.folders'),
      undo: async () => { await writeFolders(previous); if (nextPlaces) await store.replacePlacesRaw(previousPlaces); return { ok: true } },
      redo: async () => { await writeFolders(next); if (nextPlaces) await store.replacePlacesRaw(nextPlaces); return { ok: true } }
    })
  }
  const addFolder = (parent?: string): void => {
    const folder = { id: newPlaceFolderId(), name: uiText('places.folders.new'), ...(parent ? { parent } : {}) }
    if (parent && collapsed.includes(parent)) void writeCollapsed(collapsed.filter(id => id !== parent)).catch(fail)
    void commitFolders(addPlaceFolder(folders, folder)).then(() => setRenaming(`folder:${folder.id}`)).catch(fail)
  }
  const renameFolder = (id: string, name: string): void => {
    setRenaming(null)
    const trimmed = name.trim().slice(0, PLACE_FOLDER_NAME_MAX)
    if (!trimmed || folders.find(folder => folder.id === id)?.name === trimmed) return
    void commitFolders(folders.map(folder => folder.id === id ? { ...folder, name: trimmed } : folder)).catch(fail)
  }
  const renamePlace = (place: Place, name: string): void => {
    setRenaming(null)
    const trimmed = name.trim()
    if (!trimmed || trimmed === place.name) return
    void store.updatePlace(place.id, { name: trimmed }).catch(fail)
  }
  const removeFolder = (id: string): void => {
    const next = deletePlaceFolder(folders, places, id)
    const placesChanged = next.places.some((place, index) => place !== places[index])
    void commitFolders(next.folders, placesChanged ? next.places : undefined).catch(fail)
  }
  const flip = (list: string[], id: string): string[] => list.includes(id) ? list.filter(entry => entry !== id) : [...list, id]
  /** The eye of a row: open while it is not hidden itself; dimmed when a folder above it is closed. */
  const eyeButton = (hidden: boolean, onToggle: () => void, name: string): ReactElement => (
    <button type="button" className={`map-row-action map-row-eye${hidden ? ' is-off' : ''}`}
      aria-pressed={!hidden} aria-label={uiText(hidden ? 'places.eye.show' : 'places.eye.hide', { name })} title={uiText(hidden ? 'places.eye.show' : 'places.eye.hide', { name })}
      onClick={(event) => { event.stopPropagation(); onToggle() }} onDoubleClick={(event) => event.stopPropagation()}>
      {hidden ? <EyeOff /> : <Eye />}
    </button>
  )
  const toggle = (id: string): void => {
    void writeCollapsed(collapsed.includes(id) ? collapsed.filter(entry => entry !== id) : [...collapsed, id]).catch(fail)
  }

  // ---- drag and drop ----
  const apply = (drag: Dragged, drop: PlaceDrop): void => {
    if (drag.kind === 'folder') {
      const next = moveFolder(folders, drag.id, drop)
      if (next) void commitFolders(next).catch(fail)
      return
    }
    const next = movePlace(places, folders, drag.id, drop)
    const name = places.find(place => place.id === drag.id)?.name ?? ''
    if (next) void store.reorderPlaces(next, uiText('places.undo.move', { name })).catch(fail)
    if (drop.kind === 'folder' && collapsed.includes(drop.id)) void writeCollapsed(collapsed.filter(id => id !== drop.id)).catch(fail)
  }
  const allowed = (drag: Dragged, drop: PlaceDrop): boolean =>
    drag.kind === 'folder' ? moveFolder(folders, drag.id, drop) !== null : movePlace(places, folders, drag.id, drop) !== null
  const clear = (): void => { dragged.current = null; pending.current = null; setMark(null) }
  const show = (next: DropMark | null): void => {
    if (next?.key !== mark?.key || next?.position !== mark?.position) setMark(next)
  }
  const dragProps = (kind: 'place' | 'folder', id: string) => ({
    draggable: renaming !== `${kind}:${id}`,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.stopPropagation()
      dragged.current = { kind, id }
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', id)
    },
    onDragEnd: clear
  })
  /** Where a drag over this row lands: the upper or lower edge of the row, or inside a folder. */
  const dropAt = (event: DragEvent<HTMLElement>, kind: 'place' | 'folder', id: string): PlaceDrop | null => {
    const drag = dragged.current
    if (!drag || (drag.kind === kind && drag.id === id)) return null
    const rect = event.currentTarget.getBoundingClientRect()
    const fraction = (event.clientY - rect.top) / Math.max(1, rect.height)
    const candidates: PlaceDrop[] = kind === 'place'
      ? [{ kind, id, position: fraction < 0.5 ? 'before' : 'after' }]
      : drag.kind === 'place'
        ? [{ kind, id, position: 'inside' }]
        : fraction < 0.3 ? [{ kind, id, position: 'before' }, { kind, id, position: 'inside' }]
          : fraction > 0.7 ? [{ kind, id, position: 'after' }, { kind, id, position: 'inside' }]
            : [{ kind, id, position: 'inside' }, { kind, id, position: fraction < 0.5 ? 'before' : 'after' }]
    return candidates.find(drop => allowed(drag, drop)) ?? null
  }
  const dropProps = (kind: 'place' | 'folder', id: string) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!dragged.current) return
      event.stopPropagation()
      const drop = dropAt(event, kind, id)
      pending.current = drop
      if (!drop || drop.kind === 'root') { show(null); return }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      show({ key: `${kind}:${id}`, position: drop.position })
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.stopPropagation()
      const drag = dragged.current
      const drop = pending.current
      clear()
      if (!drag || !drop) return
      event.preventDefault()
      apply(drag, drop)
    }
  })
  const shownOnMap = (place: Place): boolean => !allHidden && !hiddenPlaces.includes(place.id) &&
    (!place.folder || !folders.some(folder => folder.id === place.folder) || folderVisible(folders, hiddenFolders, place.folder))
  const markClass = (key: string): string => mark?.key === key ? ` drop-${mark.position}` : ''

  // ---- menus ----
  /** Move to folder: top level first, then the folders; a folder with subfolders opens a submenu that starts with itself. */
  const moveMenu = (place: Place): UiMenuItem[] => {
    const current = place.folder && folders.some(folder => folder.id === place.folder) ? place.folder : undefined
    const moveTo = (folder: string | undefined): void => {
      if (folder === current) return
      const drop: PlaceDrop = folder ? { kind: 'folder', id: folder, position: 'inside' } : { kind: 'root' }
      const next = movePlace(places, folders, place.id, drop)
      if (next) void store.reorderPlaces(next, uiText('places.undo.move', { name: place.name })).catch(fail)
    }
    const entry = (folder: PlaceFolder): UiMenuItem => ({ id: folder.id, label: folder.name, icon: <Folder />, type: 'radio', checked: current === folder.id, onSelect: () => moveTo(folder.id) })
    return [
      { id: 'top-level', label: uiText('places.menu.topLevel'), icon: <MapPin />, type: 'radio', checked: current === undefined, onSelect: () => moveTo(undefined) },
      ...folders.filter(folder => !folder.parent).map(folder => {
        const children = subfolders(folders, folder.id)
        return children.length ? { id: `${folder.id}:sub`, label: folder.name, icon: <Folder />, submenu: [entry(folder), ...children.map(entry)] } : entry(folder)
      })
    ]
  }
  const openPlaceMenu = (event: ReactMouseEvent<HTMLElement>, place: Place): void => {
    event.preventDefault()
    event.stopPropagation()
    void api.ui.openMenu([
      { id: 'edit', label: uiText('auto.e1746f2c11b3'), icon: <Pencil />, onSelect: () => { store.selectPlace(place.id); setEditing(place.id) } },
      { id: 'rename', label: uiText('places.menu.rename'), icon: <TextCursorInput />, onSelect: () => setRenaming(`place:${place.id}`) },
      { id: 'icon', label: uiText('places.icon.change'), icon: place.icon ? <MenuPinGlyph id={place.icon} /> : <MapPin />, submenu: iconSubmenu(place.icon, 'pin', icon => { void store.updatePlace(place.id, { icon: icon || undefined }).catch(fail) }) },
      { id: 'move', label: uiText('places.menu.move'), icon: <FolderInput />, enabled: folders.length > 0, submenu: moveMenu(place) },
      { type: 'separator' },
      { id: 'focus', label: uiText('auto.e4ab9c39375b'), icon: <Crosshair />, onSelect: () => store.focusPlace(place) },
      ...(place.note ? [{ id: 'note', label: uiText('auto.c66a827e3397'), icon: <ValleyIcon />, onSelect: () => store.openNote(place.note as string, false) }] : []),
      { type: 'separator' },
      { id: 'delete', label: uiText('auto.2303581699b6'), icon: <Trash />, danger: true, onSelect: () => { void store.deletePlace(place.id) } }
    ], menuTarget(event))
  }
  const openFolderMenu = (event: ReactMouseEvent<HTMLElement>, folder: PlaceFolder): void => {
    event.preventDefault()
    event.stopPropagation()
    const anchor = rowIconAnchor(event)
    const patch = (change: Pick<PlaceFolder, 'icon' | 'color'>): void => {
      void commitFolders(folders.map(entry => {
        if (entry.id !== folder.id) return entry
        const next: PlaceFolder = { ...entry, ...change }
        if (!next.icon) delete next.icon
        if (!next.color) delete next.color
        return next
      })).catch(fail)
    }
    void api.ui.openMenu([
      { id: 'icon', label: uiText('places.icon.change'), icon: folder.icon ? <MenuPinGlyph id={folder.icon} /> : <Folder />, submenu: iconSubmenu(folder.icon, 'folder', icon => patch({ icon })) },
      { id: 'color', label: uiText('surface.color'), icon: <ColorDot color={folder.color} />, onSelect: () => pickColor(anchor, folder.color ?? '', color => patch({ color })) },
      ...(!folder.parent ? [{ id: 'subfolder', label: uiText('places.folders.addSub'), icon: <FolderPlus />, onSelect: () => addFolder(folder.id) }] : []),
      { id: 'rename', label: uiText('places.folders.rename'), icon: <TextCursorInput />, onSelect: () => setRenaming(`folder:${folder.id}`) },
      { type: 'separator' },
      { id: 'delete', label: uiText('places.folders.delete'), description: uiText('places.folders.deleteHint'), icon: <Trash />, danger: true, onSelect: () => removeFolder(folder.id) }
    ], menuTarget(event))
  }
  const moreButton = (onOpen: (event: ReactMouseEvent<HTMLElement>) => void): ReactElement => (
    <button type="button" className="map-row-action map-row-more" title={uiText('places.menu.more')} aria-label={uiText('places.menu.more')}
      onClick={onOpen} onDoubleClick={(event) => event.stopPropagation()}>
      <MoreHorizontal />
    </button>
  )
  const nameField = (key: string, value: string, maxLength: number | undefined, label: string, commit: (name: string) => void): ReactElement => (
    <input key={key} className="map-folder-input" autoFocus defaultValue={value} maxLength={maxLength} aria-label={label}
      onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') event.currentTarget.blur()
        else if (event.key === 'Escape') setRenaming(null)
      }} />
  )

  // ---- rows ----
  const placeRow = (place: Place, depth: number): ReactElement => {
    const key = `place:${place.id}`
    return (
      <div key={place.id} className={`map-row map-tree-row${snap.selectedPlaceId === place.id ? ' active' : ''}${shownOnMap(place) ? '' : ' is-hidden'}${markClass(key)}`}
        style={{ ['--map-tree-depth' as string]: depth }}
        onClick={() => { if (renaming !== key) store.focusPlace(place) }} role="button" tabIndex={0}
        onContextMenu={(event) => openPlaceMenu(event, place)}
        {...dragProps('place', place.id)} {...dropProps('place', place.id)}>
        <span className="map-tree-slot" />
        <span className="map-row-icon" style={place.color ? { color: paletteCssValue(place.color) } : undefined}>
          <PlaceIcon place={place} />
        </span>
        {renaming === key
          ? nameField(key, place.name, undefined, uiText('auto.8eb815111173'), name => renamePlace(place, name))
          : <span className="map-row-title">{place.name}</span>}
        {renaming !== key && <>
          {eyeButton(hiddenPlaces.includes(place.id), () => { void writeHiddenPlaces(flip(hiddenPlaces, place.id)).catch(fail) }, place.name)}
          {moreButton(event => openPlaceMenu(event, place))}
        </>}
      </div>
    )
  }

  const folderRows = (folder: PlaceFolder, depth: number): ReactElement[] => {
    const key = `folder:${folder.id}`
    const children = subfolders(folders, folder.id)
    const contents = placesIn(places, folders, folder.id)
    const folded = collapsed.includes(folder.id)
    const row = (
      <div key={folder.id} className={`map-row map-tree-row map-folder-row${!allHidden && folderVisible(folders, hiddenFolders, folder.id) ? '' : ' is-hidden'}${markClass(key)}`}
        style={{ ['--map-tree-depth' as string]: depth }}
        role="button" tabIndex={0} aria-expanded={!folded}
        onClick={() => { if (renaming !== key) toggle(folder.id) }}
        onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggle(folder.id) } }}
        onDoubleClick={() => setRenaming(key)}
        onContextMenu={(event) => openFolderMenu(event, folder)}
        {...dragProps('folder', folder.id)} {...dropProps('folder', folder.id)}>
        <span className={`map-tree-slot map-folder-chevron${folded ? '' : ' open'}`}><ChevronRight /></span>
        <span className="map-row-icon map-folder-icon" style={folder.color ? { color: paletteCssValue(folder.color) } : undefined}>{folder.icon ? <PinGlyph id={folder.icon} /> : <Folder />}</span>
        {renaming === key
          ? nameField(key, folder.name, PLACE_FOLDER_NAME_MAX, uiText('places.folders.name'), name => renameFolder(folder.id, name))
          : <span className="map-row-title">{folder.name}</span>}
        {renaming !== key && <>
          <span className="map-section-count">{folderPlaceCount(places, folders, folder.id)}</span>
          {eyeButton(hiddenFolders.includes(folder.id), () => { void writeHiddenFolders(flip(hiddenFolders, folder.id)).catch(fail) }, folder.name)}
          {moreButton(event => openFolderMenu(event, folder))}
        </>}
      </div>
    )
    if (folded) return [row]
    return [row, ...children.flatMap(child => folderRows(child, depth + 1)), ...contents.map(place => placeRow(place, depth + 1))]
  }

  const topFolders = folders.filter(folder => !folder.parent)
  // Folded as far as the eye can see: a subfolder inside a folded folder does not count.
  const allFolded = folders.length > 0 && folders.filter(folder => !folder.parent || !collapsed.includes(folder.parent)).every(folder => collapsed.includes(folder.id))
  const loose = placesIn(places, folders, undefined)
  const empty = places.length === 0 && folders.length === 0

  return (
    <>
      <div className="map-places-bar">
        <span className="panel-title map-places-bar-title">{uiText('places.bar.title')}</span>
        <div className="panel-toolbar">
          {folders.length > 0 && (
            <button type="button" className="panel-tool-btn"
              title={uiText(allFolded ? 'places.folders.expandAll' : 'places.folders.collapseAll')}
              aria-label={uiText(allFolded ? 'places.folders.expandAll' : 'places.folders.collapseAll')}
              onClick={() => { void writeCollapsed(allFolded ? [] : folders.map(folder => folder.id)).catch(fail) }}>
              {allFolded ? <ChevronsUpDown /> : <ChevronsDownUp />}
            </button>
          )}
          <button type="button" className={`panel-tool-btn${allHidden ? ' is-off' : ''}`} aria-pressed={!allHidden}
            title={uiText(allHidden ? 'places.eye.showAll' : 'places.eye.hideAll')} aria-label={uiText(allHidden ? 'places.eye.showAll' : 'places.eye.hideAll')}
            onClick={() => { void writeAllHidden(!allHidden).catch(fail) }}>
            {allHidden ? <EyeOff /> : <Eye />}
          </button>
          <button type="button" className="panel-tool-btn" title={uiText('places.folders.add')} aria-label={uiText('places.folders.add')}
            onClick={() => addFolder()}>
            <FolderPlus />
          </button>
          <button type="button" className="panel-tool-btn" title={uiText('auto.29c5ff60169d')} aria-label={uiText('auto.29c5ff60169d')}
            onClick={() => setEditing('new')}>
            <Plus />
          </button>
        </div>
      </div>
      {editing === 'new' && <PlaceEditor key="new" folders={folders} onClose={() => setEditing(null)} />}
      {editedPlace && <PlaceEditor key={editedPlace.id} place={editedPlace} folders={folders} onClose={() => setEditing(null)} />}
      {error && <p role="alert" className="map-empty">{uiText('places.folders.saveError')}</p>}
      {empty
        ? <div className="map-empty">{uiText('auto.d0966d990865')}</div>
        : (
          <div className={`map-place-tree${mark?.key === 'root' ? ' drop-root' : ''}`}
            onDragOver={(event) => {
              const drag = dragged.current
              if (!drag) return
              const drop: PlaceDrop = { kind: 'root' }
              pending.current = allowed(drag, drop) ? drop : null
              if (!pending.current) { show(null); return }
              event.preventDefault()
              show({ key: 'root', position: 'after' })
            }}
            onDragLeave={(event) => { if (event.currentTarget === event.target && mark?.key === 'root') show(null) }}
            onDrop={(event) => {
              const drag = dragged.current
              const drop = pending.current
              clear()
              if (!drag || !drop) return
              event.preventDefault()
              apply(drag, drop)
            }}>
            {topFolders.flatMap(folder => folderRows(folder, 0))}
            {loose.map(place => placeRow(place, 0))}
          </div>
        )}
    </>
  )
}
