import { CONTACT_PLACES_LIMITS, type ContactPlaceEntry } from './contactPlacesContract'
import { isValidLngLat } from './geo'
import { normalizeAddress, type GeoCache } from './pinSources'
import type { NotePin } from './types'

/** The sourceId prefix of contact pins; a contact with several addresses has one pin per address. */
export const CONTACT_PIN_SOURCE = 'contacts'
/** Contacts' pins wear their first group's colour, else this one. */
export const CONTACT_PIN_COLOR = 'palette:teal'

const str = (value: unknown, max: number): string => typeof value === 'string' ? value.slice(0, max) : ''
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
      return [{ text, ...(label ? { label } : {}), ...(lat !== undefined && lng !== undefined && isValidLngLat(lng, lat) ? { lat, lng } : {}) }]
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
      color: entry.color || CONTACT_PIN_COLOR,
      borderColor: '#ffffff',
      icon: contactPinIcon(place.label),
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
