import type { MapTab } from './types'
import { searchTab } from './search'
import { favoritePlaceTab } from './favorite-place'
import { favoriteRouteTab } from './favorite-route'
import { notePinTab } from './note-pin'

export type { MapTab, MapTabProps } from './types'

/**
 * The Map sidebar's built-in tabs in their default order; a saved order and
 * the tabs other plugins contribute (`map.sidebarTab`) come after, in `Panel`.
 */
export const BUILT_IN_TABS: readonly MapTab[] = [searchTab, favoritePlaceTab, favoriteRouteTab, notePinTab]
