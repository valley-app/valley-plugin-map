import { Users } from '../../icons'
import type { MapTab } from '../types'
import { ContactsTab } from './ContactsTab'

/** Contacts (18 Nov): every contact from the Contacts plugin, shown while it provides `contacts.places`. */
export const contactsTab: MapTab = { id: 'contacts', labelKey: 'contacts.title', Icon: Users, Panel: ContactsTab }
