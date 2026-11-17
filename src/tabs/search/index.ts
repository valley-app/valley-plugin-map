import { Search } from '../../icons'
import type { MapTab } from '../types'
import { SearchTab } from './SearchTab'

/** Search: one shared place search, the picked place's card and the A-to-B planner. */
export const searchTab: MapTab = { id: 'search', labelKey: 'auto.bce06414177f', Icon: Search, Panel: SearchTab, focusOnClick: true }
