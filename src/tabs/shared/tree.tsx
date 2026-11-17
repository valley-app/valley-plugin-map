import { React, api } from '../../runtime'
import type { FC, MouseEvent as ReactMouseEvent } from 'react'
import type { UiMenuItem, UiMenuTarget } from '@valley/plugin-sdk'
import { paletteCssValue } from '@valley/plugin-sdk/palette'
import type { PlaceFolder } from '../../types'
import { uiText } from '../../localization'
import { PinIconGrid } from '../../SettingsView'
import { mapIconIds, refreshMapIcons } from '../../pinIcons'
import { Folder, FolderOpen, MenuPinGlyph, PIN_GLYPHS, PinGlyph } from '../../icons'

/** What the favourites trees (places, routes) share: saved settings, the icon and colour pickers and the folder glyph. */

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

/** Opens the map icon grid under `anchor`; the chosen glyph replaces the icon.
 *  The default glyph clears the icon (`''`). */
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

/** A menu item's leading colour disc; dashed while no colour is chosen. */
export const ColorDot: FC<{ color?: string }> = ({ color }) => (
  <svg width="1em" height="1em" viewBox="0 0 16 16" aria-hidden="true">
    {color
      ? <circle cx="8" cy="8" r="6.5" style={{ fill: paletteCssValue(color) }} />
      : <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.4 2" />}
  </svg>
)

/** The row's ⋯ menu opens under the button; a right-click opens it at the pointer. */
export const menuTarget = (event: ReactMouseEvent<HTMLElement>): UiMenuTarget =>
  event.type === 'contextmenu' ? { x: event.clientX, y: event.clientY } : { anchor: event.currentTarget, align: 'end' }

/** Opens the palette under `anchor`; `''` clears the colour. */
export function pickColor(anchor: HTMLElement, selected: string, onSelect: (value: string) => void): void {
  // Opened from a menu item: wait until the menu has closed and handed focus back, or the
  // popover takes that focus change for the window losing focus and dismisses itself at once.
  setTimeout(() => {
    void api.ui.pickColor({ value: selected, clearable: true, ariaLabel: uiText('surface.color') }, { anchor }).then(value => { if (value !== null && value !== selected) onSelect(value) })
  }, 80)
}

/** The folder row's glyph, the anchor of its icon and colour popovers. */
export const rowIconAnchor = (event: ReactMouseEvent<HTMLElement>): HTMLElement =>
  (event.currentTarget.closest('.map-tree-row')?.querySelector('.map-row-icon') as HTMLElement | null) ?? event.currentTarget

/**
 * A folder row's glyph: its own icon when it has one, else the folder that is
 * open while the row is expanded and closed while it is folded.
 */
export const FolderGlyph: FC<{ folder: Pick<PlaceFolder, 'icon'>; open: boolean }> = ({ folder, open }) =>
  folder.icon ? <PinGlyph id={folder.icon} /> : open ? <FolderOpen /> : <Folder />

/** Is an item filed in a folder that still exists? Only items outside every folder carry an icon and colour of their own. */
export const filed = (folders: readonly PlaceFolder[], folder: string | undefined): boolean =>
  Boolean(folder) && folders.some(entry => entry.id === folder)
