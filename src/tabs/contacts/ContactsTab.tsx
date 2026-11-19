import { React, api } from '../../runtime'
import type { FC, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import { paletteCssValue } from '@valley/plugin-sdk/palette'
import { useMap } from '../../hooks'
import { menuTarget, strings, useSetting } from '../shared/tree'
import { uiText } from '../../localization'
import type { ContactPlaceEntry } from '../../contactPlacesContract'
import { CONTACT_PIN_COLOR, CONTACT_PIN_SOURCE, contactAddressLine, contactPinIcon, contactVisible } from '../../contactPins'
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Crosshair, Eye, EyeOff, MoreHorizontal, PinGlyph, Search, ValleyIcon, X } from '../../icons'

/** The contact's photo, else its initials on a disc in its group's colour. */
const Avatar: FC<{ entry: ContactPlaceEntry }> = ({ entry }) => {
  const [failed, setFailed] = React.useState(false)
  return (
    <span className="map-contact-avatar" style={{ ['--badge-fill' as string]: paletteCssValue(entry.color || CONTACT_PIN_COLOR) }} aria-hidden="true">
      {entry.avatarUrl && !failed ? <img src={entry.avatarUrl} alt="" loading="lazy" onError={() => setFailed(true)} /> : entry.initials}
    </span>
  )
}

/**
 * The Contacts tab (18 Nov): every contact from the Contacts plugin, with or without an address.
 * A 38px bar (title, master eye, fold all), the search row, then one row per contact — avatar,
 * name, address, eye and ⋯. A contact whose eye is closed or that has no located address is
 * greyed out; a contact with several addresses opens to list them. A click shows the contact
 * on the map, a double click opens it in Contacts.
 */
export const ContactsTab: FC = () => {
  const { store, snap } = useMap()
  const [allHidden, writeAllHidden] = useSetting<boolean>('contactsHidden', value => value === true)
  const [hidden, writeHidden] = useSetting<string[]>('hiddenContacts', strings)
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState<string[]>([])
  const [error, setError] = React.useState(false)
  if (!store) return null
  const save = (write: Promise<void>): void => { void write.then(() => setError(false)).catch(() => setError(true)) }
  const needle = query.trim().toLocaleLowerCase()
  const contacts = [...snap.contacts]
    .sort((a, b) => a.name.localeCompare(b.name, api.ui.language()))
    .filter(entry => !needle || [entry.name, entry.subtitle ?? '', ...entry.groups, ...entry.places.map(place => place.text)]
      .some(value => value.toLocaleLowerCase().includes(needle)))
  const located = (entry: ContactPlaceEntry): number => snap.contactPinList.filter(pin => pin.relPath === entry.id).length
  const anyVisible = !allHidden && snap.contacts.some(entry => !hidden.includes(entry.id))
  const expandable = contacts.filter(entry => entry.places.length > 1)
  const allFolded = expandable.every(entry => !open.includes(entry.id))
  const setVisible = (id: string, visible: boolean): void => {
    if (visible && allHidden) {
      // Opening one eye under a closed master eye shows only that contact.
      save(Promise.all([writeAllHidden(false), writeHidden(snap.contacts.map(entry => entry.id).filter(entry => entry !== id))]).then(() => {}))
      return
    }
    save(writeHidden(visible ? hidden.filter(entry => entry !== id) : [...new Set([...hidden, id])]))
  }
  const toggleAll = (): void => {
    if (anyVisible) save(writeAllHidden(true))
    else save(Promise.all([writeAllHidden(false), writeHidden([])]).then(() => {}))
  }
  const toggleOpen = (id: string): void => setOpen(ids => ids.includes(id) ? ids.filter(entry => entry !== id) : [...ids, id])

  const openMenu = (event: ReactMouseEvent<HTMLElement>, entry: ContactPlaceEntry): void => {
    event.preventDefault()
    event.stopPropagation()
    void api.ui.openMenu([
      ...(located(entry) ? [{ id: 'focus', label: uiText('contacts.menu.focus'), icon: <Crosshair />, onSelect: () => store.focusContact(entry.id) }] : []),
      { id: 'solo', label: uiText('contacts.menu.solo'), icon: <Eye />, onSelect: () => save(Promise.all([writeAllHidden(false), writeHidden(snap.contacts.map(other => other.id).filter(other => other !== entry.id))]).then(() => {})) },
      { type: 'separator' },
      { id: 'open', label: uiText('contacts.menu.open'), icon: <ValleyIcon />, onSelect: () => store.openContact(entry.id) }
    ], menuTarget(event))
  }
  const more = (entry: ContactPlaceEntry): ReactElement => (
    <button type="button" className="map-row-action map-row-more" title={uiText('places.menu.more')} aria-label={uiText('places.menu.more')} onClick={event => openMenu(event, entry)}>
      <MoreHorizontal />
    </button>
  )

  return (
    <div className="map-sidebar-sources map-contacts">
      <div className="map-places-bar">
        <span className="panel-title map-places-bar-title">{uiText('contacts.title')}</span>
        <div className="panel-toolbar">
          <button type="button" className={`panel-tool-btn${anyVisible ? '' : ' is-off'}`} disabled={!snap.contacts.length} aria-pressed={anyVisible}
            title={uiText(anyVisible ? 'contacts.eye.hideAll' : 'contacts.eye.showAll')} aria-label={uiText(anyVisible ? 'contacts.eye.hideAll' : 'contacts.eye.showAll')}
            onClick={toggleAll}>
            {anyVisible ? <Eye /> : <EyeOff />}
          </button>
          {expandable.length > 0 && (
            <button type="button" className="panel-tool-btn"
              title={uiText(allFolded ? 'pins.expandAll' : 'pins.collapseAll')} aria-label={uiText(allFolded ? 'pins.expandAll' : 'pins.collapseAll')}
              onClick={() => setOpen(allFolded ? expandable.map(entry => entry.id) : [])}>
              {allFolded ? <ChevronsUpDown /> : <ChevronsDownUp />}
            </button>
          )}
        </div>
      </div>
      <div className="search-field-row">
        <span className="search-field">
          <Search className="search-field-icon" />
          <input className="search-field-input" value={query} placeholder={uiText('contacts.search')} aria-label={uiText('contacts.search')} spellCheck={false}
            onChange={event => setQuery(event.currentTarget.value)}
            onKeyDown={event => { if (event.key === 'Escape' && query) { event.preventDefault(); setQuery('') } }} />
          {query && <button type="button" className="search-field-action" aria-label={uiText('auto.719ea396ad92')} title={uiText('auto.719ea396ad92')} onClick={() => setQuery('')}><X /></button>}
        </span>
      </div>
      {error && <p role="alert" className="settings-path-error">{uiText('places.folders.saveError')}</p>}
      {!snap.contacts.length && <div className="map-empty">{uiText('contacts.empty')}</div>}
      {snap.contacts.length > 0 && !contacts.length && <div className="map-empty">{uiText('contacts.noMatch')}</div>}
      <div className="map-place-tree map-contact-list" role="list" aria-label={uiText('contacts.title')}>
        {contacts.flatMap(entry => {
          const count = located(entry)
          const visible = contactVisible(entry.id, allHidden, hidden)
          const expanded = entry.places.length > 1 && open.includes(entry.id)
          const first = entry.places[0]
          // The address says what it is: Home · Farnweg 3, or Home · Work for several (18 Nov).
          const labels = [...new Set(entry.places.map(place => place.label).filter((label): label is string => Boolean(label)))]
          const sub = !entry.places.length ? uiText('contacts.noAddress')
            : entry.places.length > 1 ? (labels.length ? labels.join(' · ') : uiText('contacts.addresses', { count: entry.places.length }))
            : contactAddressLine(first)
          const pending = entry.places.length > 0 && !count
          const label = entry.name
          const row = (
            <div key={entry.id} role="listitem" tabIndex={0} aria-expanded={entry.places.length > 1 ? expanded : undefined}
              className={`map-row map-tree-row map-contact-row${visible && count ? '' : ' is-hidden'}`}
              style={{ ['--map-tree-depth' as string]: 0 }}
              title={entry.places.map(place => place.label ? `${place.label}: ${place.text}` : place.text).join('\n') || label}
              onClick={() => { if (count) store.focusContact(entry.id); else if (entry.places.length > 1) toggleOpen(entry.id) }}
              onDoubleClick={() => store.openContact(entry.id)}
              onKeyDown={event => {
                if (event.target !== event.currentTarget) return
                if (event.key === 'Enter') { event.preventDefault(); if (count) store.focusContact(entry.id) }
                if ((event.key === 'ArrowRight' && !expanded) || (event.key === 'ArrowLeft' && expanded)) { if (entry.places.length > 1) { event.preventDefault(); toggleOpen(entry.id) } }
              }}
              onContextMenu={event => openMenu(event, entry)}>
              {entry.places.length > 1
                ? <span role="button" aria-label={uiText(expanded ? 'pins.collapseAll' : 'pins.expandAll')} className={`map-tree-slot map-folder-chevron${expanded ? ' open' : ''}`}
                  onClick={event => { event.stopPropagation(); toggleOpen(entry.id) }} onDoubleClick={event => event.stopPropagation()}><ChevronRight /></span>
                : <span className="map-tree-slot" />}
              <Avatar entry={entry} />
              <span className="map-row-meta">
                <span className="map-row-title">{label}</span>
                <span className="map-row-sub">{sub}{pending && ` · ${uiText('contacts.notLocated')}`}</span>
              </span>
              <button type="button" className={`map-row-action map-row-eye${visible ? '' : ' is-off'}`} aria-pressed={visible} disabled={!entry.places.length}
                title={entry.places.length ? uiText(visible ? 'places.eye.hide' : 'places.eye.show', { name: label }) : uiText('contacts.noAddress')}
                aria-label={uiText(visible ? 'places.eye.hide' : 'places.eye.show', { name: label })}
                onClick={event => { event.stopPropagation(); setVisible(entry.id, !visible) }}
                onDoubleClick={event => event.stopPropagation()}>
                {visible ? <Eye /> : <EyeOff />}
              </button>
              {more(entry)}
            </div>
          )
          if (!expanded) return [row]
          return [row, ...entry.places.map((place, index) => {
            const pin = snap.contactPinList.find(candidate => candidate.relPath === entry.id && candidate.sourceId === `${CONTACT_PIN_SOURCE}:${index}`)
            const point = pin ? { lng: pin.lng, lat: pin.lat } : null
            return (
              <div key={`${entry.id}:${index}`} role="listitem" tabIndex={0}
                className={`map-row map-tree-row${visible && point ? '' : ' is-hidden'}`}
                style={{ ['--map-tree-depth' as string]: 1 }}
                title={place.text}
                onClick={() => { if (point) store.focus([point.lng, point.lat], 16) }}
                onDoubleClick={() => store.openContact(entry.id)}
                onKeyDown={event => { if (event.key === 'Enter' && point) store.focus([point.lng, point.lat], 16) }}>
                <span className="map-tree-slot" />
                <span className="map-pin-badge is-small" style={{ ['--badge-fill' as string]: paletteCssValue(place.color || entry.color || CONTACT_PIN_COLOR) }}>
                  {place.iconSvg ? <span className="map-contact-label-glyph" aria-hidden="true" dangerouslySetInnerHTML={{ __html: place.iconSvg }} /> : <PinGlyph id={contactPinIcon(place.label)} />}
                </span>
                <span className="map-row-meta">
                  <span className="map-row-title">{place.label || place.text}</span>
                  {place.label && <span className="map-row-sub">{point ? place.text : `${place.text} · ${uiText('contacts.notLocated')}`}</span>}
                  {!place.label && !point && <span className="map-row-sub">{uiText('contacts.notLocated')}</span>}
                </span>
              </div>
            )
          })]
        })}
      </div>
    </div>
  )
}
