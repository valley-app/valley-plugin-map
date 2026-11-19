import { CONTACT_PLACES_LIMITS, type ContactPlaceEntry } from './contactPlacesContract'
import { isValidLngLat } from './geo'
import { sanitizePinSvg } from './pinIcons'
import { normalizeAddress, type GeoCache } from './pinSources'
import type { NotePin } from './types'

/** The sourceId prefix of contact pins; a contact with several addresses has one pin per address. */
export const CONTACT_PIN_SOURCE = 'contacts'
/** Contacts' pins wear their first group's colour, else this one. */
export const CONTACT_PIN_COLOR = 'palette:teal'

const str = (value: unknown, max: number): string => typeof value === 'string' ? value.slice(0, max) : ''
const COLOR = /^(palette:[a-z0-9-]{1,40}|#[0-9a-fA-F]{6})$/
/** Another plugin's icon markup, sanitized by Map's own rules; dropped when too large or unusable. */
function safeSvg(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.length > CONTACT_PLACES_LIMITS.iconSvg) return undefined
  try { return sanitizePinSvg(value) } catch { return undefined }
}
const num = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined

/** A provider's snapshot, bounded and with every value checked, so a broken or hostile one cannot break the map. */
export function normalizeContactEntries(raw: unknown): ContactPlaceEntry[] {
  const contacts = raw && typeof raw === 'object' && Array.isArray((raw as { contacts?: unknown }).contacts) ? (raw as { contacts: unknown[] }).contacts : []
  const seen = new Set<string>()
  const out: ContactPlaceEntry[] = []
  for (const item of contacts.slice(0, CONTACT_PLACES_LIMITS.contacts)) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const id = str(entry.id, 4096)
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name = str(entry.name, CONTACT_PLACES_LIMITS.text) || id.split('/').pop()!.replace(/\.vcf$/i, '')
    const places = (Array.isArray(entry.places) ? entry.places : []).slice(0, CONTACT_PLACES_LIMITS.places).flatMap((value) => {
      if (!value || typeof value !== 'object') return []
      const place = value as Record<string, unknown>
      const text = str(place.text, CONTACT_PLACES_LIMITS.text).trim()
      if (!text) return []
      const lat = num(place.lat), lng = num(place.lng)
      const label = str(place.label, CONTACT_PLACES_LIMITS.text)
      // The label's look (19 Nov): a checked colour, and SVG sanitized again here before Map draws it.
      const color = str(place.color, 64)
      const iconSvg = safeSvg(place.iconSvg)
      return [{ text, ...(label ? { label } : {}), ...(lat !== undefined && lng !== undefined && isValidLngLat(lng, lat) ? { lat, lng } : {}), ...(COLOR.test(color) ? { color } : {}), ...(iconSvg ? { iconSvg } : {}) }]
    })
    const subtitle = str(entry.subtitle, CONTACT_PLACES_LIMITS.text)
    const color = str(entry.color, 64)
    const avatarUrl = str(entry.avatarUrl, 4096)
    out.push({
      id, name,
      initials: str(entry.initials, 4) || name.slice(0, 1).toUpperCase(),
      ...(subtitle ? { subtitle } : {}),
      ...(color ? { color } : {}),
      ...(avatarUrl && /^(valley-|https?:|data:image\/)/.test(avatarUrl) ? { avatarUrl } : {}),
      groups: (Array.isArray(entry.groups) ? entry.groups : []).map((group) => str(group, CONTACT_PLACES_LIMITS.text)).filter(Boolean).slice(0, 64),
      places
    })
  }
  return out
}

/** A provider's tab glyph, or null when it sends none or a malformed one. */
export function normalizeContactsIcon(raw: unknown): { viewBox: string; path: string } | null {
  if (!raw || typeof raw !== 'object') return null
  const { viewBox, path } = raw as Record<string, unknown>
  if (typeof viewBox !== 'string' || !/^[\d.\s-]{3,64}$/.test(viewBox) || typeof path !== 'string' || !path || path.length > 8192 || !/^[MmLlHhVvCcSsQqTtAaZz\d.,\s-]+$/.test(path)) return null
  return { viewBox, path }
}

/** An address's sub-line in the sidebar: its label first, as in `Home · Farnweg 3`. */
export function contactAddressLine(place: { label?: string; text: string }): string {
  return place.label ? `${place.label} · ${place.text}` : place.text
}

/** The pin glyph an address label suggests: home, work, school, else a person. */
export function contactPinIcon(label: string | undefined): string {
  const key = (label ?? '').trim().toLowerCase()
  if (key === 'home' || key === 'family' || key === 'vacation home') return 'home'
  if (key === 'work' || key === 'office' || key === 'company') return 'briefcase'
  if (key === 'school' || key === 'university') return 'school'
  return 'person'
}

/** Where an address is: its picked coordinates, else the map's geocoded answer for its text, else nowhere yet. */
export function contactPlacePoint(place: ContactPlaceEntry['places'][number], geocache: GeoCache): { lng: number; lat: number } | null {
  if (place.lat !== undefined && place.lng !== undefined) return { lng: place.lng, lat: place.lat }
  return geocache.get(normalizeAddress(place.text)) ?? null
}

/** Every contact's located addresses as pins, hidden contacts included (the sidebar counts them). */
export function buildContactPins(entries: readonly ContactPlaceEntry[], geocache: GeoCache): NotePin[] {
  return entries.flatMap((entry) => entry.places.flatMap((place, index) => {
    const point = contactPlacePoint(place, geocache)
    if (!point) return []
    return [{
      relPath: entry.id,
      sourceId: `${CONTACT_PIN_SOURCE}:${index}`,
      title: entry.name,
      lng: point.lng,
      lat: point.lat,
      color: place.color || entry.color || CONTACT_PIN_COLOR,
      borderColor: '#ffffff',
      icon: contactPinIcon(place.label),
      ...(place.iconSvg ? { iconSvg: place.iconSvg } : {}),
      fields: [...(place.label ? [{ key: place.label, value: place.text }] : [{ key: '', value: place.text }]), ...(entry.subtitle ? [{ key: '', value: entry.subtitle }] : [])]
    }]
  }))
}

/** Addresses still to be located: typed text without coordinates of contacts whose eye is open. */
export function pendingContactAddresses(entries: readonly ContactPlaceEntry[], visible: (id: string) => boolean, geocache: GeoCache): string[] {
  return entries.flatMap((entry) => visible(entry.id)
    ? entry.places.filter((place) => place.lat === undefined && !geocache.has(normalizeAddress(place.text))).map((place) => place.text)
    : [])
}

/** Whether a contact's pins are drawn: the master eye and its own eye are both open. */
export function contactVisible(id: string, allHidden: boolean, hidden: readonly string[]): boolean {
  return !allHidden && !hidden.includes(id)
}
