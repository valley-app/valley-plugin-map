import type { IndexEntry } from '@valley/plugin-sdk/types'
import { nextPaletteColor } from '@valley/plugin-sdk/palette'
import type { NotePin, PinSource } from './types'
import { geoFromFrontmatter, parseLatLngPair } from './pins'
import { isValidLngLat } from './geo'

/** A minimal geocode lookup: normalized address → coordinate. */
export type GeoCache = Map<string, { lng: number; lat: number }>

/** Cache key for an address: trimmed, lowercased, whitespace collapsed. */
export function normalizeAddress(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : ''
}

/**
 * The address text held by a frontmatter value.
 *
 * Three shapes reach this, and a pin source pointed at a contact's `place` sees
 * all three: a plain string, a list of strings, and the list of
 * `{ value, type }` objects the Contacts plugin actually writes
 * (`contactToFrontmatter`) — which is the canonical form, so reading only the
 * string shapes meant every contact note resolved to no address at all. The
 * first non-empty entry wins, and a trailing "(label)" annotation — as in
 * "… Switzerland (Home)", the string form's way of carrying what `type` carries
 * in the object form — is removed.
 */
export function addressText(value: unknown): string {
  const one = (item: unknown): string => {
    if (typeof item === 'string') return item.trim()
    if (item && typeof item === 'object') {
      const held = (item as Record<string, unknown>).value
      return typeof held === 'string' ? held.trim() : ''
    }
    return ''
  }
  const raw = Array.isArray(value) ? value.map(one).find(Boolean) ?? '' : one(value)
  return raw.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/**
 * Render a frontmatter value as a single-line display string (for hover popups).
 *
 * The `{ value, type }` shape gets a case of its own because it is what the
 * Contacts plugin writes for `place`, `email` and `phone` — the three fields
 * anybody would actually put in a contact pin's popup. Without it a source
 * configured to show `place` rendered an empty row: the value was there, the
 * popup just could not read it. Any other object still renders as nothing,
 * which is the right answer for a nested structure on one line.
 */
export function toDisplay(value: unknown): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map(toDisplay).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    const held = (value as Record<string, unknown>).value
    if (typeof held !== 'string' || !held.trim()) return ''
    const label = (value as Record<string, unknown>).type
    return typeof label === 'string' && label.trim() ? `${held.trim()} (${label.trim()})` : held.trim()
  }
  return String(value)
}

let counter = 0
/**
 * A blank, defaulted pin source for the settings "Add source" button.
 *
 * `existing` supplies the colours already in play, so a new source lands on an
 * unused palette entry instead of the same blue every time — the same rule the
 * Calendar's note-date sources follow. Colours are stored as `palette:<id>`
 * references, never hexes, so a pin follows the theme and any user override in
 * `.valley/design/*.css`.
 */
export function defaultPinSource(existing: readonly PinSource[] = []): PinSource {
  counter += 1
  return {
    id: `pinsource-${Date.now().toString(36)}-${counter}`,
    title: '',
    matchKey: 'type',
    matchValue: '',
    folder: '',
    locationMode: 'address',
    locationField: 'address',
    labelMode: 'filename',
    labelField: '',
    hoverFields: [],
    color: nextPaletteColor(existing.map((source) => source.color)),
    // The one literal in here on purpose: the marker's hairline is read against
    // the *basemap*, not the app theme, so it must not follow either.
    borderColor: '#ffffff',
    icon: 'pin',
    visible: true,
    hidden: false
  }
}

/** Coerce a persisted (or partial) record into a fully-defaulted PinSource. */
export function sanitizePinSource(raw: Record<string, unknown>): PinSource {
  const base = defaultPinSource()
  const hover = raw.hoverFields
  return {
    id: str(raw.id, base.id),
    title: str(raw.title).trim(),
    matchKey: str(raw.matchKey, 'type').trim(),
    matchValue: str(raw.matchValue).trim(),
    folder: str(raw.folder).trim() || undefined,
    locationMode: raw.locationMode === 'coordinate' ? 'coordinate' : 'address',
    locationField: str(raw.locationField, str(raw.addressField, 'address')).trim() || 'address',
    labelMode:
      raw.labelMode === 'property' || (raw.labelMode == null && Boolean(str(raw.labelField).trim()))
        ? 'property'
        : 'filename',
    labelField: str(raw.labelField).trim() || undefined,
    hoverFields: Array.isArray(hover)
      ? hover.map((h) => str(h).trim()).filter(Boolean)
      : parseFieldList(str(hover)),
    color: str(raw.color, base.color).trim() || base.color,
    borderColor: str(raw.borderColor, base.borderColor).trim() || base.borderColor,
    icon: str(raw.icon, base.icon).trim() || base.icon,
    visible: raw.visible !== false,
    hidden: raw.hidden === true
  }
}

/** Parse a comma/newline-separated "field list" input into trimmed keys. */
export function parseFieldList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function underFolder(relPath: string, folder: string | undefined): boolean {
  if (!folder) return true
  return relPath === folder || relPath.startsWith(folder.replace(/\/+$/, '') + '/')
}

/** True when a source is complete enough to match notes. */
export function isSourceActive(source: PinSource): boolean {
  return Boolean(source.matchKey && source.matchValue)
}

/**
 * Every non-excluded note matching a source's frontmatter predicate (and its
 * optional folder scope). Reads the pre-parsed index — no file I/O.
 */
export function matchNotes(entries: IndexEntry[], source: PinSource): IndexEntry[] {
  return [...matchingNotes(entries, source)]
}

export function* matchingNotes(entries: readonly IndexEntry[], source: PinSource): Generator<IndexEntry> {
  if (!isSourceActive(source)) return
  const key = source.matchKey
  const want = source.matchValue.trim().toLowerCase()
  for (const entry of entries) {
    if (entry.excluded || entry.kind !== 'note') continue
    if (!underFolder(entry.relPath, source.folder)) continue
    const value = entry.frontmatter?.[key]
    if (String(value ?? '').trim().toLowerCase() !== want) continue
    yield entry
  }
}

/**
 * Resolve a note's location. In `coordinate` mode, parse `lat,lng` from
 * `locationField` (never geocodes). In `address` mode, prefer explicit
 * coordinate frontmatter, else look up the geocoded `locationField` in the
 * cache — returning null when it isn't cached yet (the caller queues it).
 */
export function resolvePinLocation(
  fm: Record<string, unknown> | undefined,
  source: PinSource,
  cache: GeoCache
): { lng: number; lat: number } | null {
  if (source.locationMode === 'coordinate') {
    const pair = parseLatLngPair(fm?.[source.locationField]) ?? geoFromFrontmatter(fm)
    return pair && isValidLngLat(pair.lng, pair.lat) ? { lng: pair.lng, lat: pair.lat } : null
  }
  const coords = geoFromFrontmatter(fm)
  if (coords) return { lng: coords.lng, lat: coords.lat }
  const key = normalizeAddress(addressText(fm?.[source.locationField]))
  if (!key) return null
  const hit = cache.get(key)
  return hit && isValidLngLat(hit.lng, hit.lat) ? hit : null
}

/** The address string a note would be geocoded by, or '' when it has none/coords/uses coordinate mode. */
export function pendingAddress(
  fm: Record<string, unknown> | undefined,
  source: PinSource
): string {
  if (source.locationMode === 'coordinate') return ''
  if (geoFromFrontmatter(fm)) return ''
  return addressText(fm?.[source.locationField])
}

/** The hover-popup rows for a note: the configured fields with present values. */
export function hoverFieldsFor(
  fm: Record<string, unknown> | undefined,
  source: PinSource
): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = []
  for (const key of source.hoverFields) {
    const value = toDisplay(fm?.[key])
    if (value) out.push({ key, value })
  }
  return out
}

/** The pin's title: the `labelField` value in 'property' mode, else the note title (filename). */
export function pinTitle(entry: IndexEntry, source: PinSource): string {
  if (source.labelMode === 'property' && source.labelField) {
    const value = toDisplay(entry.frontmatter?.[source.labelField])
    if (value) return value
  }
  return entry.title
}

/**
 * Build the on-map pins for a single source, resolving each matched note's
 * location against the cache. Notes whose location isn't known yet are omitted
 * (and surfaced via {@link collectPendingAddresses} for geocoding).
 */
export function buildSourcePins(
  entries: IndexEntry[],
  source: PinSource,
  cache: GeoCache,
  opts?: {
    /**
     * Build a hidden source's pins anyway. The sidebar row states how many pins
     * a source *has*, which does not change when the eye is closed — counting
     * the drawn ones reported "0" and read as "the source lost its notes".
     */
    ignoreVisibility?: boolean
  }
): NotePin[] {
  if (source.hidden) return []
  if (!source.visible && !opts?.ignoreVisibility) return []
  const out: NotePin[] = []
  for (const entry of matchNotes(entries, source)) {
    const loc = resolvePinLocation(entry.frontmatter, source, cache)
    if (!loc) continue
    out.push({
      relPath: entry.relPath,
      sourceId: source.id,
      title: pinTitle(entry, source),
      lng: loc.lng,
      lat: loc.lat,
      color: source.color,
      borderColor: source.borderColor,
      icon: source.icon,
      fields: hoverFieldsFor(entry.frontmatter, source)
    })
  }
  return out
}

/**
 * A cheap fingerprint of everything the derived pins depend on: source config
 * plus each matched note's location/label/hover values. When it's unchanged the
 * store can skip an index-change rebuild.
 */
export function matchSignature(entries: IndexEntry[], sources: PinSource[]): string {
  const parts: string[] = []
  for (const source of sources) {
    parts.push(
      `#${source.id}:${source.visible ? 1 : 0}:${source.hidden ? 1 : 0}:${source.color}:${source.borderColor}:${source.icon}:` +
        `${source.matchKey}=${source.matchValue}:${source.folder ?? ''}:${source.locationMode}:${source.locationField}:` +
        `${source.labelMode}:${source.labelField ?? ''}:${source.hoverFields.join(',')}`
    )
    for (const entry of matchNotes(entries, source)) {
      const fm = entry.frontmatter
      const coords = geoFromFrontmatter(fm)
      parts.push(entry.relPath, pendingAddress(fm, source), coords ? `${coords.lng},${coords.lat}` : '', toDisplay(fm?.[source.locationField]), pinTitle(entry, source))
      for (const key of source.hoverFields) parts.push(toDisplay(fm?.[key]))
    }
  }
  return parts.join('')
}

/** Distinct, un-cached addresses across all active sources — the geocode work-list. */
export function collectPendingAddresses(
  entries: IndexEntry[],
  sources: PinSource[],
  cache: GeoCache
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const source of sources) {
    if (source.hidden || !source.visible) continue
    for (const entry of matchNotes(entries, source)) {
      const address = pendingAddress(entry.frontmatter, source)
      if (!address) continue
      const key = normalizeAddress(address)
      if (cache.has(key) || seen.has(key)) continue
      seen.add(key)
      out.push(address)
    }
  }
  return out
}
