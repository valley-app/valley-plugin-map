import { React, api } from '../../runtime'
import type { DragEvent, FC, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import type { UiMenuItem } from '@valley/plugin-sdk'
import { paletteCssValue } from '@valley/plugin-sdk/palette'
import { useMap } from '../../hooks'
import { formatDistance } from '../../format'
import type { PlaceFolder, Route } from '../../types'
import { uiText } from '../../localization'
import { ColorDot, FolderGlyph, filed, iconSubmenu, menuTarget, pickColor, rowIconAnchor, strings, useSetting } from '../shared/tree'
import {
  addPlaceFolder,
  deleteFolder,
  filedRoutes,
  folderItemCount,
  folderVisible,
  itemsIn,
  moveFolder,
  moveItem,
  newPlaceFolderId,
  normalizePlaceFolders,
  normalizeRouteFiling,
  PLACE_FOLDER_NAME_MAX,
  routeFiling,
  subfolders,
  type PlaceDrop,
  type RouteFiling
} from '../../placeFolders'
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  EyeOff,
  Folder,
  FolderInput,
  FolderPlus,
  MenuPinGlyph,
  MoreHorizontal,
  PinGlyph,
  Plus,
  RouteIcon,
  TextCursorInput,
  Trash
} from '../../icons'

type Item = RouteFiling & { route: Route }
type Dragged = { kind: 'route' | 'folder'; id: string }
type DropMark = { key: string; position: 'before' | 'after' | 'inside' }
/** The tree helpers speak of places and folders; a route row is the "place" kind. */
type Drop = PlaceDrop

const RouteGlyph: FC<{ icon?: string }> = ({ icon }) => icon ? <PinGlyph id={icon} /> : <RouteIcon />

/** The Favourite Routes tab: the same tree as Favourite Places — folders (one subfolder level) and saved routes, all draggable. */
export const RoutesTab: FC = () => {
  const { store, snap } = useMap()
  const [folders, writeFolders] = useSetting<PlaceFolder[]>('routeFolders', normalizePlaceFolders)
  const [filing, writeFiling] = useSetting<RouteFiling[]>('routeFiling', normalizeRouteFiling)
  const [collapsed, writeCollapsed] = useSetting<string[]>('collapsedRouteFolders', strings)
  const [hiddenFolders, writeHiddenFolders] = useSetting<string[]>('hiddenRouteFolders', strings)
  const [hiddenRoutes, writeHiddenRoutes] = useSetting<string[]>('hiddenRoutes', strings)
  const [allHidden, writeAllHidden] = useSetting<boolean>('routesHidden', value => value === true)
  // `folder:<id>` or `route:<id>` while that row's name is an inline field.
  const [renaming, setRenaming] = React.useState<string | null>(null)
  const [error, setError] = React.useState(false)
  const dragged = React.useRef<Dragged | null>(null)
  const pending = React.useRef<Drop | null>(null)
  const [mark, setMark] = React.useState<DropMark | null>(null)
  if (!store) return null
  const items: Item[] = filedRoutes(snap.routes, filing)

  const fail = (): void => setError(true)
  /** One ⌘Z step for a change of the folders and/or the routes' filing. */
  const commit = async (nextFolders: PlaceFolder[] | null, nextItems: readonly RouteFiling[] | null, label = uiText('places.undo.folders')): Promise<void> => {
    const previousFolders = folders
    const previousFiling = routeFiling(items)
    const next = nextItems ? routeFiling(nextItems) : null
    const write = async (f: PlaceFolder[] | null, r: RouteFiling[] | null): Promise<void> => {
      if (f) await writeFolders(f)
      if (r) await writeFiling(r)
    }
    setError(false)
    await write(nextFolders, next)
    api.undo.push({
      label,
      undo: async () => { await write(nextFolders ? previousFolders : null, next ? previousFiling : null); return { ok: true } },
      redo: async () => { await write(nextFolders, next); return { ok: true } }
    })
  }
  const addFolder = (parent?: string): void => {
    const folder = { id: newPlaceFolderId(), name: uiText('places.folders.new'), ...(parent ? { parent } : {}) }
    if (parent && collapsed.includes(parent)) void writeCollapsed(collapsed.filter(id => id !== parent)).catch(fail)
    void commit(addPlaceFolder(folders, folder), null).then(() => setRenaming(`folder:${folder.id}`)).catch(fail)
  }
  const renameFolder = (id: string, name: string): void => {
    setRenaming(null)
    const trimmed = name.trim().slice(0, PLACE_FOLDER_NAME_MAX)
    if (!trimmed || folders.find(folder => folder.id === id)?.name === trimmed) return
    void commit(folders.map(folder => folder.id === id ? { ...folder, name: trimmed } : folder), null).catch(fail)
  }
  const renameRoute = (route: Route, name: string): void => {
    setRenaming(null)
    const trimmed = name.trim()
    if (!trimmed || trimmed === route.name) return
    void store.renameRoute(route.id, trimmed).catch(fail)
  }
  const removeFolder = (id: string): void => {
    const next = deleteFolder(folders, items, id)
    const moved = next.places.some((item, index) => item !== items[index])
    void commit(next.folders, moved ? next.places : null).catch(fail)
  }
  const setIcon = (item: Item, icon: string): void => {
    void commit(null, items.map(entry => entry.id === item.id ? { ...entry, icon: icon || undefined } : entry), uiText('places.icon.change')).catch(fail)
  }
  const setColor = (item: Item, color: string): void => {
    void commit(null, items.map(entry => entry.id === item.id ? { ...entry, color: color || undefined } : entry), uiText('surface.color')).catch(fail)
  }
  const flip = (list: string[], id: string): string[] => list.includes(id) ? list.filter(entry => entry !== id) : [...list, id]
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
  // The tree helpers call the leaf kind `place`; a route row is that kind here.
  const asDrop = (kind: 'route' | 'folder', id: string, position: 'before' | 'after' | 'inside'): Drop => ({ kind: kind === 'route' ? 'place' : 'folder', id, position })
  const apply = (drag: Dragged, drop: Drop): void => {
    if (drag.kind === 'folder') {
      const next = moveFolder(folders, drag.id, drop)
      if (next) void commit(next, null).catch(fail)
      return
    }
    const next = moveItem(items, folders, drag.id, drop)
    const name = items.find(item => item.id === drag.id)?.route.name ?? ''
    if (next) void commit(null, next, uiText('places.undo.move', { name })).catch(fail)
    if (drop.kind === 'folder' && collapsed.includes(drop.id)) void writeCollapsed(collapsed.filter(id => id !== drop.id)).catch(fail)
  }
  const allowed = (drag: Dragged, drop: Drop): boolean =>
    drag.kind === 'folder' ? moveFolder(folders, drag.id, drop) !== null : moveItem(items, folders, drag.id, drop) !== null
  const clear = (): void => { dragged.current = null; pending.current = null; setMark(null) }
  const show = (next: DropMark | null): void => {
    if (next?.key !== mark?.key || next?.position !== mark?.position) setMark(next)
  }
  const dragProps = (kind: 'route' | 'folder', id: string) => ({
    draggable: renaming !== `${kind}:${id}`,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.stopPropagation()
      dragged.current = { kind, id }
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', id)
    },
    onDragEnd: clear
  })
  const dropAt = (event: DragEvent<HTMLElement>, kind: 'route' | 'folder', id: string): Drop | null => {
    const drag = dragged.current
    if (!drag || (drag.kind === kind && drag.id === id)) return null
    const rect = event.currentTarget.getBoundingClientRect()
    const fraction = (event.clientY - rect.top) / Math.max(1, rect.height)
    const candidates: Drop[] = kind === 'route'
      ? [asDrop(kind, id, fraction < 0.5 ? 'before' : 'after')]
      : drag.kind === 'route'
        ? [asDrop(kind, id, 'inside')]
        : fraction < 0.3 ? [asDrop(kind, id, 'before'), asDrop(kind, id, 'inside')]
          : fraction > 0.7 ? [asDrop(kind, id, 'after'), asDrop(kind, id, 'inside')]
            : [asDrop(kind, id, 'inside'), asDrop(kind, id, fraction < 0.5 ? 'before' : 'after')]
    return candidates.find(drop => allowed(drag, drop)) ?? null
  }
  const dropProps = (kind: 'route' | 'folder', id: string) => ({
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
  const shownOnMap = (item: Item): boolean => !allHidden && !hiddenRoutes.includes(item.id) &&
    (!item.folder || !folders.some(folder => folder.id === item.folder) || folderVisible(folders, hiddenFolders, item.folder))
  const markClass = (key: string): string => mark?.key === key ? ` drop-${mark.position}` : ''

  // ---- menus ----
  const moveMenu = (item: Item): UiMenuItem[] => {
    const current = item.folder && folders.some(folder => folder.id === item.folder) ? item.folder : undefined
    const moveTo = (folder: string | undefined): void => {
      if (folder === current) return
      const next = moveItem(items, folders, item.id, folder ? { kind: 'folder', id: folder, position: 'inside' } : { kind: 'root' })
      if (next) void commit(null, next, uiText('places.undo.move', { name: item.route.name })).catch(fail)
    }
    const entry = (folder: PlaceFolder): UiMenuItem => ({ id: folder.id, label: folder.name, icon: <Folder />, type: 'radio', checked: current === folder.id, onSelect: () => moveTo(folder.id) })
    return [
      { id: 'top-level', label: uiText('places.menu.topLevel'), icon: <RouteIcon />, type: 'radio', checked: current === undefined, onSelect: () => moveTo(undefined) },
      ...folders.filter(folder => !folder.parent).map(folder => {
        const children = subfolders(folders, folder.id)
        return children.length ? { id: `${folder.id}:sub`, label: folder.name, icon: <Folder />, submenu: [entry(folder), ...children.map(entry)] } : entry(folder)
      })
    ]
  }
  const openRouteMenu = (event: ReactMouseEvent<HTMLElement>, item: Item): void => {
    event.preventDefault()
    event.stopPropagation()
    const anchor = rowIconAnchor(event)
    void api.ui.openMenu([
      { id: 'show', label: uiText('routes.menu.show'), icon: <Eye />, onSelect: () => store.showRoute(item.route) },
      { id: 'rename', label: uiText('places.menu.rename'), icon: <TextCursorInput />, onSelect: () => setRenaming(`route:${item.id}`) },
      // Icon and colour belong to a route only while it is outside every folder.
      ...(filed(folders, item.folder) ? [] : [
        { id: 'icon', label: uiText('places.icon.change'), icon: item.icon ? <MenuPinGlyph id={item.icon} /> : <RouteIcon />, submenu: iconSubmenu(item.icon, 'route', icon => setIcon(item, icon)) },
        { id: 'color', label: uiText('surface.color'), icon: <ColorDot color={item.color} />, onSelect: () => pickColor(anchor, item.color ?? '', color => setColor(item, color)) }
      ]),
      { id: 'move', label: uiText('places.menu.move'), icon: <FolderInput />, enabled: folders.length > 0, submenu: moveMenu(item) },
      { type: 'separator' },
      { id: 'delete', label: uiText('auto.520876018815'), icon: <Trash />, danger: true, onSelect: () => { void store.deleteRoute(item.id) } }
    ], menuTarget(event))
  }
  const openFolderMenu = (event: ReactMouseEvent<HTMLElement>, folder: PlaceFolder): void => {
    event.preventDefault()
    event.stopPropagation()
    const anchor = rowIconAnchor(event)
    const patch = (change: Pick<PlaceFolder, 'icon' | 'color'>): void => {
      void commit(folders.map(entry => {
        if (entry.id !== folder.id) return entry
        const next: PlaceFolder = { ...entry, ...change }
        if (!next.icon) delete next.icon
        if (!next.color) delete next.color
        return next
      }), null).catch(fail)
    }
    void api.ui.openMenu([
      { id: 'icon', label: uiText('places.icon.change'), icon: folder.icon ? <MenuPinGlyph id={folder.icon} /> : <Folder />, submenu: iconSubmenu(folder.icon, 'folder', icon => patch({ icon })) },
      { id: 'color', label: uiText('surface.color'), icon: <ColorDot color={folder.color} />, onSelect: () => pickColor(anchor, folder.color ?? '', color => patch({ color })) },
      ...(!folder.parent ? [{ id: 'subfolder', label: uiText('places.folders.addSub'), icon: <FolderPlus />, onSelect: () => addFolder(folder.id) }] : []),
      { id: 'rename', label: uiText('places.folders.rename'), icon: <TextCursorInput />, onSelect: () => setRenaming(`folder:${folder.id}`) },
      { type: 'separator' },
      { id: 'delete', label: uiText('places.folders.delete'), description: uiText('routes.folders.deleteHint'), icon: <Trash />, danger: true, onSelect: () => removeFolder(folder.id) }
    ], menuTarget(event))
  }
  const moreButton = (onOpen: (event: ReactMouseEvent<HTMLElement>) => void): ReactElement => (
    <button type="button" className="map-row-action map-row-more" title={uiText('places.menu.more')} aria-label={uiText('places.menu.more')}
      onClick={onOpen} onDoubleClick={(event) => event.stopPropagation()}>
      <MoreHorizontal />
    </button>
  )
  const nameField = (key: string, value: string, maxLength: number | undefined, label: string, onCommit: (name: string) => void): ReactElement => (
    <input key={key} className="map-folder-input" autoFocus defaultValue={value} maxLength={maxLength} aria-label={label}
      onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={(event) => onCommit(event.currentTarget.value)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') event.currentTarget.blur()
        else if (event.key === 'Escape') setRenaming(null)
      }} />
  )

  // ---- rows ----
  const routeRow = (item: Item, depth: number): ReactElement => {
    const key = `route:${item.id}`
    const { route } = item
    // Rows inside a folder carry no glyph of their own: the folder speaks for them.
    const inFolder = filed(folders, item.folder)
    return (
      <div key={item.id} className={`map-row map-tree-row map-route-row${inFolder ? ' is-filed' : ''}${snap.savedRouteId === item.id ? ' active' : ''}${shownOnMap(item) ? '' : ' is-hidden'}${markClass(key)}`}
        style={{ ['--map-tree-depth' as string]: depth }}
        onClick={() => { if (renaming !== key) store.showRoute(route) }} role="button" tabIndex={0}
        onContextMenu={(event) => openRouteMenu(event, item)}
        {...dragProps('route', item.id)} {...dropProps('route', item.id)}>
        {!inFolder && <>
          <span className="map-tree-slot" />
          <span className="map-row-icon" style={item.color ? { color: paletteCssValue(item.color) } : undefined}><RouteGlyph icon={item.icon} /></span>
        </>}
        {renaming === key
          ? nameField(key, route.name, undefined, uiText('routes.name'), name => renameRoute(route, name))
          : (
            <span className="map-row-meta">
              <span className="map-row-title">{route.name}</span>
              <span className="map-row-sub">{route.distanceM ? formatDistance(route.distanceM, snap.units) : uiText('auto.9691de79c93c', { p0: route.waypoints.length })}</span>
            </span>
          )}
        {renaming !== key && <>
          {eyeButton(hiddenRoutes.includes(item.id), () => { void writeHiddenRoutes(flip(hiddenRoutes, item.id)).catch(fail) }, route.name)}
          {moreButton(event => openRouteMenu(event, item))}
        </>}
      </div>
    )
  }

  const folderRows = (folder: PlaceFolder, depth: number): ReactElement[] => {
    const key = `folder:${folder.id}`
    const children = subfolders(folders, folder.id)
    const contents = itemsIn(items, folders, folder.id)
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
        <span className="map-row-icon map-folder-icon" style={folder.color ? { color: paletteCssValue(folder.color) } : undefined}><FolderGlyph folder={folder} open={!folded} /></span>
        {renaming === key
          ? nameField(key, folder.name, PLACE_FOLDER_NAME_MAX, uiText('places.folders.name'), name => renameFolder(folder.id, name))
          : <span className="map-row-title">{folder.name}</span>}
        {renaming !== key && <>
          <span className="map-section-count">{folderItemCount(items, folders, folder.id)}</span>
          {eyeButton(hiddenFolders.includes(folder.id), () => { void writeHiddenFolders(flip(hiddenFolders, folder.id)).catch(fail) }, folder.name)}
          {moreButton(event => openFolderMenu(event, folder))}
        </>}
      </div>
    )
    if (folded) return [row]
    return [row, ...children.flatMap(child => folderRows(child, depth + 1)), ...contents.map(item => routeRow(item, depth + 1))]
  }

  const topFolders = folders.filter(folder => !folder.parent)
  const allFolded = folders.length > 0 && folders.filter(folder => !folder.parent || !collapsed.includes(folder.parent)).every(folder => collapsed.includes(folder.id))
  const loose = itemsIn(items, folders, undefined)
  const empty = items.length === 0 && folders.length === 0

  return (
    <>
      <div className="map-places-bar">
        <span className="panel-title map-places-bar-title">{uiText('routes.bar.title')}</span>
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
            title={uiText(allHidden ? 'routes.eye.showAll' : 'routes.eye.hideAll')} aria-label={uiText(allHidden ? 'routes.eye.showAll' : 'routes.eye.hideAll')}
            onClick={() => { void writeAllHidden(!allHidden).catch(fail) }}>
            {allHidden ? <EyeOff /> : <Eye />}
          </button>
          <button type="button" className="panel-tool-btn" title={uiText('places.folders.add')} aria-label={uiText('places.folders.add')}
            onClick={() => addFolder()}>
            <FolderPlus />
          </button>
          <button type="button" className="panel-tool-btn" title={uiText('routes.add')} aria-label={uiText('routes.add')}
            onClick={() => { store.clearPlanner(); api.workspace.revealOwnPanel('right_sidebar') }}>
            <Plus />
          </button>
        </div>
      </div>
      {error && <p role="alert" className="map-empty">{uiText('places.folders.saveError')}</p>}
      {empty
        ? <div className="map-empty">{uiText('auto.57681b50d3a2')}</div>
        : (
          <div className={`map-place-tree${mark?.key === 'root' ? ' drop-root' : ''}`}
            onDragOver={(event) => {
              const drag = dragged.current
              if (!drag) return
              const drop: Drop = { kind: 'root' }
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
            {loose.map(item => routeRow(item, 0))}
          </div>
        )}
    </>
  )
}
