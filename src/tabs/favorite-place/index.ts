import { Star } from '../../icons'
import type { MapTab } from '../types'
import { PlacesTab } from './PlacesTab'

/** Favourite places: saved places in folders, shown as pins on the map. */
export const favoritePlaceTab: MapTab = { id: 'places', labelKey: 'auto.0a6622a7d2d8', Icon: Star, Panel: PlacesTab }
