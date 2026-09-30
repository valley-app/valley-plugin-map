import type { TravelMode } from './types'
import { Bike, Car, Walk } from './icons'

/**
 * The travel modes, shared by the right-sidebar planner and the sidebar's
 * directions form. Stores the icon *component* (not an element) — evaluating
 * `<Car/>` at module scope would run React.createElement before the runtime
 * React binding is set, rejecting the import (no rail icon, no views).
 */
export const MODES: { id: TravelMode; labelKey: string; Icon: typeof Car }[] = [
  { id: 'driving', labelKey: 'auto.a02bb4593793', Icon: Car },
  { id: 'walking', labelKey: 'auto.e0c705d18e3f', Icon: Walk },
  { id: 'cycling', labelKey: 'auto.3a12a2c6c506', Icon: Bike }
]
