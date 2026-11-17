import type { FC, ReactElement } from 'react'
import type { PanelTab } from '../types'

/** What a built-in tab's panel is handed by the sidebar. */
export interface MapTabProps {
  /** Bumped when the tab's own icon is clicked (0 otherwise), for a tab that wants to take focus then. */
  focusToken: number
}

/**
 * One built-in tab of the Map sidebar. Each lives in its own folder under
 * `src/tabs/` and hands the sidebar this description: the sidebar knows a tab
 * only by it, the way it knows a plugin's tab only by the `map.sidebarTab`
 * contract. Inside its folder a tab is free: it reads the store, opens menus
 * and popovers and draws whatever it needs.
 */
export interface MapTab {
  /** Saved in the tab order and the session; never renamed. */
  id: Exclude<PanelTab, `extension:${string}:${string}`>
  /** Catalog key of the tab's name (tooltip and accessible name). */
  labelKey: string
  Icon: (props: { className?: string }) => ReactElement
  Panel: FC<MapTabProps>
  /** The tab takes keyboard focus when its icon is clicked. */
  focusOnClick?: boolean
}
