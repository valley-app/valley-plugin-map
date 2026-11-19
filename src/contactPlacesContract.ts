import { resolveInteropContract, type InteropContract } from '@valley/plugin-sdk'

/**
 * `contacts.places` (18 Nov): every contact with its addresses, for a map to show where people live.
 * Contacts provides it, Map consumes it. Keep the copies in both repositories byte-identical and every
 * new key optional.
 */

/**
 * One address of a contact. `lat`/`lng` are present when the address was picked from a suggestion; `color` and
 * `iconSvg` are its label's look from Contacts settings (19 Nov): a palette reference or hex colour, and sanitized SVG
 * markup a consumer sanitizes again before drawing it.
 */
export type ContactPlaceAddress = { label?: string; text: string; lat?: number; lng?: number; color?: string; iconSvg?: string }

/** A contact as a map lists it. `color` is the first group's palette reference or hex colour. */
export type ContactPlaceEntry = {
  id: string
  name: string
  initials: string
  subtitle?: string
  color?: string
  /** A realm image URL for the avatar; embedded photos are not sent. */
  avatarUrl?: string
  groups: string[]
  places: ContactPlaceAddress[]
}

export type ContactPlacesSnapshot = { revision: number; contacts: ContactPlaceEntry[] }

export interface ContactPlaces {
  id: string
  /** The provider's own glyph (one path, filled with currentColor), for a map's tab (18 Nov). */
  icon?: { viewBox: string; path: string }
  getSnapshot(): ContactPlacesSnapshot
  subscribe(listener: () => void): () => void
  /** Opens the contact in Contacts. */
  open(id: string, options?: { newTab?: boolean }): Promise<void>
}

/** Upper bounds a consumer enforces on a snapshot. */
export const CONTACT_PLACES_LIMITS = { contacts: 5000, places: 16, text: 512, iconSvg: 8192 } as const

export const CONTACT_PLACES_V1 = resolveInteropContract({
  id: 'contacts.places', kind: 'extension', version: '1.0.0', cardinality: 'many',
  wire: {
    identityKeys: ['id'],
    value: { type: 'object', required: ['id', 'getSnapshot', 'subscribe', 'open'], properties: {
      id: { type: 'string' },
      icon: { type: 'object', required: ['viewBox', 'path'], properties: { viewBox: { type: 'string' }, path: { type: 'string' } } },
      getSnapshot: { type: 'function' }, subscribe: { type: 'function' }, open: { type: 'function' }
    } }
  }
}) as InteropContract<ContactPlaces, 'extension'>
