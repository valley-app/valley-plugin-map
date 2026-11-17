import { RouteIcon } from '../../icons'
import type { MapTab } from '../types'
import { RoutesTab } from './RoutesTab'

/** Favourite routes: saved routes in folders, shown as lines on the map. */
export const favoriteRouteTab: MapTab = { id: 'routes', labelKey: 'auto.8cb059657347', Icon: RouteIcon, Panel: RoutesTab }
