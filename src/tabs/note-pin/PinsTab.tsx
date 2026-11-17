import { React, api } from '../../runtime'
import type { DragEvent, FC, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import type { UiMenuTarget } from '@valley/plugin-sdk'
import { paletteCssValue } from '@valley/plugin-sdk/palette'
import { useMap } from '../../hooks'
import type { NotePin, PinSource } from '../../types'
import { uiText } from '../../localization'
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Crosshair, Eye, EyeOff, MoreHorizontal, PinGlyph, Plus, Settings, ValleyIcon } from '../../icons'

/** A source's glyph in white on a disc in its own colour — the same look as its pins on the map. */
const SourceBadge: FC<{ source: Pick<PinSource, 'color' | 'icon'>; small?: boolean }> = ({ source, small }) => (
  <span className={`map-pin-badge${small ? ' is-small' : ''}`}
    style={{ ['--badge-fill' as string]: paletteCssValue(source.color) }}>
    <PinGlyph id={source.icon} />
  </span>
)

const menuTarget = (event: ReactMouseEvent<HTMLElement>): UiMenuTarget =>
  event.type === 'contextmenu' ? { x: event.clientX, y: event.clientY } : { anchor: event.currentTarget, align: 'end' }

/**
 * The Map pins tab, drawn like Favorites: a 38px bar with the master eye, fold
 * all and add source, then one row per source — chevron, colour badge, name,
 * count, eye and ⋯ — that opens to list the notes it pins. Sources drag to a
 * new place; the order is the one Settings shows.
 */
export const PinsTab: FC = () => {
  const { store, snap } = useMap()
  const [open, setOpen] = React.useState<string[]>([])
  const [error, setError] = React.useState(false)
  const dragged = React.useRef<string | null>(null)
  const [mark, setMark] = React.useState<{ id: string; position: 'before' | 'after' } | null>(null)
  if (!store) return null
  const sources = snap.pinSources
  const shown = sources.filter(source => !source.hidden && (snap.sourcePinCounts[source.id] ?? 0) > 0)
  const anyVisible = shown.some(source => source.visible)
  const allFolded = shown.every(source => !open.includes(source.id))

  const commit = (next: PinSource[]): void => {
    if (!store.savePinSources(next)) { setError(true); return }
    void store.flushPinSources().then(() => setError(false)).catch(() => setError(true))
  }
  const setVisible = (id: string, visible: boolean): void => commit(sources.map(source => source.id === id ? { ...source, visible } : source))
  const toggleOpen = (id: string): void => setOpen(ids => ids.includes(id) ? ids.filter(entry => entry !== id) : [...ids, id])
  const pinsOf = (id: string): NotePin[] => snap.sourcePinList.filter(pin => pin.sourceId === id)
    .sort((a, b) => a.title.localeCompare(b.title, api.ui.language()))

  const openSourceMenu = (event: ReactMouseEvent<HTMLElement>, source: PinSource): void => {
    event.preventDefault()
    event.stopPropagation()
    void api.ui.openMenu([
      { id: 'focus', label: uiText('pins.menu.focus'), icon: <Crosshair />, onSelect: () => store.focusSource(source.id) },
      { id: 'solo', label: uiText('pins.menu.solo'), icon: <Eye />, onSelect: () => commit(sources.map(entry => entry.hidden ? entry : { ...entry, visible: entry.id === source.id })) },
      { type: 'separator' },
      { id: 'edit', label: uiText('pins.edit'), icon: <Settings />, onSelect: () => api.workspace.openOwnSettings('pins') }
    ], menuTarget(event))
  }
  const openPinMenu = (event: ReactMouseEvent<HTMLElement>, pin: NotePin): void => {
    event.preventDefault()
    event.stopPropagation()
    void api.ui.openMenu([
      { id: 'focus', label: uiText('auto.e4ab9c39375b'), icon: <Crosshair />, onSelect: () => store.focus([pin.lng, pin.lat], 16) },
      { id: 'note', label: uiText('auto.c66a827e3397'), icon: <ValleyIcon />, onSelect: () => store.openNote(pin.relPath, false) }
    ], menuTarget(event))
  }
  const more = (onOpen: (event: ReactMouseEvent<HTMLElement>) => void): ReactElement => (
    <button type="button" className="map-row-action map-row-more" title={uiText('places.menu.more')} aria-label={uiText('places.menu.more')} onClick={onOpen}>
      <MoreHorizontal />
    </button>
  )

  // Sources reorder by dragging the row itself; the insertion line shows where it lands.
  const drop = (event: DragEvent<HTMLElement>, target: PinSource): { id: string; position: 'before' | 'after' } | null => {
    if (!dragged.current || dragged.current === target.id) return null
    const rect = event.currentTarget.getBoundingClientRect()
    return { id: target.id, position: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' }
  }
  /** Reorder among the listed sources only: hidden and empty definitions keep their slots in the saved order. */
  const move = (dragId: string, at: { id: string; position: 'before' | 'after' }): void => {
    const moving = shown.find(source => source.id === dragId)
    if (!moving) return
    const rest = shown.filter(source => source.id !== dragId)
    const index = rest.findIndex(source => source.id === at.id) + (at.position === 'after' ? 1 : 0)
    const order = [...rest.slice(0, index), moving, ...rest.slice(index)]
    if (order.every((source, position) => source.id === shown[position].id)) return
    const listed = new Set(order.map(source => source.id))
    let position = 0
    commit(sources.map(source => listed.has(source.id) ? order[position++] : source))
  }
  /** Alt+↑/↓ moves a source by one, the keyboard twin of dragging it. */
  const step = (source: PinSource, delta: -1 | 1): void => {
    const index = shown.findIndex(entry => entry.id === source.id)
    const target = shown[index + delta]
    if (target) move(source.id, { id: target.id, position: delta < 0 ? 'before' : 'after' })
  }

  return (
    <div className="map-sidebar-sources">
      <div className="map-places-bar">
        <span className="panel-title map-places-bar-title">{uiText('auto.adc1a3bbeae6')}</span>
        <div className="panel-toolbar">
          <button type="button" className={`panel-tool-btn${anyVisible ? '' : ' is-off'}`} disabled={!shown.length} aria-pressed={anyVisible}
            title={uiText(anyVisible ? 'pins.eye.hideAll' : 'pins.eye.showAll')} aria-label={uiText(anyVisible ? 'pins.eye.hideAll' : 'pins.eye.showAll')}
            onClick={() => commit(sources.map(source => source.hidden ? source : { ...source, visible: !anyVisible }))}>
            {anyVisible ? <Eye /> : <EyeOff />}
          </button>
          {shown.length > 0 && (
            <button type="button" className="panel-tool-btn"
              title={uiText(allFolded ? 'pins.expandAll' : 'pins.collapseAll')} aria-label={uiText(allFolded ? 'pins.expandAll' : 'pins.collapseAll')}
              onClick={() => setOpen(allFolded ? shown.map(source => source.id) : [])}>
              {allFolded ? <ChevronsUpDown /> : <ChevronsDownUp />}
            </button>
          )}
          <button type="button" className="panel-tool-btn" title={uiText('pins.add')} aria-label={uiText('pins.add')}
            onClick={() => api.workspace.openOwnSettings('pins')}>
            <Plus />
          </button>
        </div>
      </div>
      {error && <p role="alert" className="settings-path-error">{uiText('pins.saveError')}</p>}
      {!shown.length && <div className="map-empty">{uiText('auto.ad479c6c0689')}</div>}
      <div className="map-place-tree map-pin-tree">
        {shown.flatMap(source => {
          const expanded = open.includes(source.id)
          const label = source.title || uiText('auto.aa6effbf44cd')
          const row = (
            <div key={source.id} role="button" tabIndex={0} aria-expanded={expanded}
              className={`map-row map-tree-row map-folder-row${source.visible ? '' : ' is-hidden'}${mark?.id === source.id ? ` drop-${mark.position}` : ''}`}
              style={{ ['--map-tree-depth' as string]: 0 }}
              onClick={() => toggleOpen(source.id)}
              onDoubleClick={() => store.focusSource(source.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return
                if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); step(source, event.key === 'ArrowUp' ? -1 : 1); return }
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleOpen(source.id) }
              }}
              title={uiText('pins.row.hint')}
              onContextMenu={(event) => openSourceMenu(event, source)}
              draggable
              onDragStart={(event) => { dragged.current = source.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', source.id) }}
              onDragOver={(event) => {
                const at = drop(event, source)
                if (!at) return
                event.preventDefault()
                if (mark?.id !== at.id || mark.position !== at.position) setMark(at)
              }}
              onDrop={(event) => {
                const at = drop(event, source)
                const id = dragged.current
                dragged.current = null
                setMark(null)
                if (!at || !id) return
                event.preventDefault()
                move(id, at)
              }}
              onDragEnd={() => { dragged.current = null; setMark(null) }}>
              <span className={`map-tree-slot map-folder-chevron${expanded ? ' open' : ''}`}><ChevronRight /></span>
              <SourceBadge source={source} />
              <span className="map-row-title">{label}</span>
              <span className="map-section-count">{snap.sourcePinCounts[source.id]}</span>
              <button type="button" className={`map-row-action map-row-eye${source.visible ? '' : ' is-off'}`} aria-pressed={source.visible}
                title={uiText(source.visible ? 'places.eye.hide' : 'places.eye.show', { name: label })}
                aria-label={uiText(source.visible ? 'places.eye.hide' : 'places.eye.show', { name: label })}
                onClick={(event) => { event.stopPropagation(); setVisible(source.id, !source.visible) }}
                onDoubleClick={(event) => event.stopPropagation()}>
                {source.visible ? <Eye /> : <EyeOff />}
              </button>
              {more(event => openSourceMenu(event, source))}
            </div>
          )
          if (!expanded) return [row]
          return [row, ...pinsOf(source.id).map(pin => (
            <div key={`${source.id}:${pin.relPath}`} role="button" tabIndex={0}
              className={`map-row map-tree-row${source.visible ? '' : ' is-hidden'}`}
              style={{ ['--map-tree-depth' as string]: 1 }}
              title={pin.relPath}
              onClick={() => store.focus([pin.lng, pin.lat], 16)}
              onDoubleClick={() => store.openNote(pin.relPath, false)}
              onKeyDown={(event) => { if (event.key === 'Enter') store.focus([pin.lng, pin.lat], 16) }}
              onContextMenu={(event) => openPinMenu(event, pin)}>
              <span className="map-tree-slot" />
              <SourceBadge source={source} small />
              <span className="map-row-title">{pin.title}</span>
              {more(event => openPinMenu(event, pin))}
            </div>
          ))]
        })}
      </div>
    </div>
  )
}
