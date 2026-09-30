import { uiText } from './localization'
import {
  METRIC_UNITS,
  formatCoordinates,
  formatDistance as formatDistanceIn,
  formatLength as formatLengthIn,
  type ValleyUnits
} from '@valley/plugin-sdk/units'

/**
 * Imperative mirror of the app's unit preference, kept fresh by the store's
 * core-state subscription. React views pass `snap.units`; the command bus and
 * other non-React callers fall back to this — never a second set of conversions.
 */
let currentUnits: ValleyUnits = METRIC_UNITS

export function setFormatUnits(units: ValleyUnits): void {
  currentUnits = units
}

/** Human-readable travel distance in the user's distance unit. */
export function formatDistance(meters: number, units: ValleyUnits = currentUnits): string {
  return formatDistanceIn(meters, units.distance)
}

/** Human-readable height/elevation in the user's length unit. */
export function formatLength(meters: number, units: ValleyUnits = currentUnits): string {
  return formatLengthIn(meters, units.length, units.smallLength)
}

/**
 * A duration split into the numerals a card renders large. **Numbers only** —
 * the unit words are JSX text in the component, because
 * `tooling/architecture/localize-ui-literals.mjs` only scans `.tsx`, so a unit string
 * returned from this file could never become translatable.
 *
 * `valid: false` means "nothing to show"; the caller renders punctuation.
 */
export interface DurationParts {
  hours: number
  minutes: number
  seconds: number
  valid: boolean
}

/** {@link formatDuration}'s rounding, kept as parts. Must agree with it exactly,
 *  or the card and the CLI report different times for the same route. */
export function durationParts(seconds: number): DurationParts {
  if (!Number.isFinite(seconds) || seconds < 0) return { hours: 0, minutes: 0, seconds: 0, valid: false }
  if (seconds < 60) return { hours: 0, minutes: 0, seconds: Math.round(seconds), valid: true }
  // Round to minutes *first*: rounding hours and minutes independently turns
  // 3599 s into "0 h 60 min".
  const totalMin = Math.round(seconds / 60)
  return { hours: Math.floor(totalMin / 60), minutes: totalMin % 60, seconds: 0, valid: true }
}

/** Human-readable duration: "45 s", "12 min", or "1 h 23 min". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)} s`
  const totalMin = Math.round(seconds / 60)
  if (totalMin < 60) return uiText('map.duration.minutes', { minutes: totalMin })
  const h = Math.floor(totalMin / 60)
  const min = totalMin % 60
  return min ? uiText('map.duration.hoursMinutes', { hours: h, minutes: min }) : uiText('map.duration.hours', { hours: h })
}

/** Compact "lat, lng" rendering in the user's coordinate notation. */
export function formatLatLng(lat: number, lng: number, digits = 5): string {
  return formatCoordinates(lat, lng, currentUnits.coordinates, digits)
}
