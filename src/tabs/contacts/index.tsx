import { React } from '../../runtime'
import type { ReactElement } from 'react'
import { useMap } from '../../hooks'
import { Users } from '../../icons'
import type { MapTab } from '../types'
import { ContactsTab } from './ContactsTab'

/** The Contacts plugin's own icon when it sends one (18 Nov), else a people glyph. */
function ContactsIcon({ className }: { className?: string }): ReactElement {
  const icon = useMap().snap.contactsIcon
  if (!icon) return <Users className={className} />
  return <svg className={className} width="1em" height="1em" viewBox={icon.viewBox} fill="currentColor" aria-hidden="true"><path d={icon.path} /></svg>
}
/** Contacts (18 Nov): every contact from the Contacts plugin, shown while it provides `contacts.places`. */
export const contactsTab: MapTab = { id: 'contacts', labelKey: 'contacts.title', Icon: ContactsIcon, Panel: ContactsTab }
