import { resolveInteropContract, type InteropContract } from '@valley/plugin-sdk'

/**
 * `contacts.places` (18 Nov): every contact with its addresses, for a map to show where people live.
 * Contacts provides it, Map consumes it. Keep the copies in both repositories byte-identical and every
 * new key optional.
 */

/** One address of a contact. `lat`/`lng` are present when the address was picked from a suggestion. */
export type ContactPlaceAddress = { label?: string; text: string; lat?: number; lng?: number }

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
  getSnapshot(): ContactPlacesSnapshot
  subscribe(listener: () => void): () => void
  /** Opens the contact in Contacts. */
  open(id: string, options?: { newTab?: boolean }): Promise<void>
}

/** Upper bounds a consumer enforces on a snapshot. */
export const CONTACT_PLACES_LIMITS = { contacts: 5000, places: 16, text: 512 } as const

export const CONTACT_PLACES_V1 = resolveInteropContract({
  id: 'contacts.places', kind: 'extension', version: '1.0.0', cardinality: 'many',
  wire: {
    identityKeys: ['id'],
    value: { type: 'object', required: ['id', 'getSnapshot', 'subscribe', 'open'], properties: {
      id: { type: 'string' }, getSnapshot: { type: 'function' }, subscribe: { type: 'function' }, open: { type: 'function' }
    } }
  }
}) as InteropContract<ContactPlaces, 'extension'>
