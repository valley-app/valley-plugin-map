import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockValleyApi } from './harness'
import { initRuntime } from '../src/runtime'
import { initLocalization } from '../src/localization'
import { createStore, disposeStore } from '../src/store'
import type { MapEngine } from '../src/mapEngine'
import type { NotePin } from '../src/types'
import { Panel } from '../src/Panel'
import { CONTACT_PLACES_V1, type ContactPlaces, type ContactPlacesSnapshot } from '../src/contactPlacesContract'
import { searchPlacesWithProvider } from '../src/geocode'
import { normalizeContactsIcon, contactAddressLine, buildContactPins, contactPinIcon, contactVisible, normalizeContactEntries, pendingContactAddresses } from '../src/contactPins'

vi.mock('../src/geocode', async () => ({
  GeocodeError: class GeocodeError extends Error {},
  searchPlaces: vi.fn(async () => []),
  searchPlacesWithProvider: vi.fn(async (address: string) => ({ provider: (await vi.importActual<typeof import('../src/geocodeProviders')>('../src/geocodeProviders')).PUBLIC_SEARCH_ID, places: /Nowhere/.test(address) ? [] : [{ name: 'Station', lng: 7.9, lat: 46.6 }] })),
  matchSavedPlaces: vi.fn(() => []),
  reverseGeocode: vi.fn(async () => null)
}))

afterEach(cleanup)

const SNAPSHOT: ContactPlacesSnapshot = { revision: 1, contacts: [
  { id: 'People/Aster Fernwood.vcf', name: 'Aster Fernwood', initials: 'AF', subtitle: 'Botanist', color: 'palette:green', groups: ['Moss Lantern'],
    places: [{ label: 'Home', text: 'Farnweg 3, 12345 Mossville', lat: 46.95, lng: 7.44 }, { label: 'Work', text: 'Moss Lantern Station, Alpine Road 1' }, { label: 'Old', text: 'Nowhere 0' }] },
  { id: 'People/Birk Fernwood.vcf', name: 'Birk Fernwood', initials: 'BF', groups: [], places: [{ label: 'Work', text: 'Harbor Lab', lat: 47.37, lng: 8.54 }] },
  { id: 'People/Colette Moosbach.vcf', name: 'Colette Moosbach', initials: 'CM', groups: [], places: [] }
] }

function provider(snapshot = SNAPSHOT): ContactPlaces & { open: ReturnType<typeof vi.fn> } {
  return { id: 'contacts', icon: { viewBox: '0 0 512 512', path: 'M256 48C148 48 48 148 48 256z' }, getSnapshot: () => snapshot, subscribe: () => () => {}, open: vi.fn(async () => {}) }
}

async function renderContacts(settings: Record<string, unknown> = {}, withProvider = true) {
  const mock = createMockValleyApi({
    manifest: { id: 'map', drivers: ['files'] },
    realm: { path: '/fixtures/map-contacts', name: 'Map contacts', displayName: 'Map contacts' },
    settings: { mapSessionState: { id: 'session', panelTab: 'contacts' }, ...settings }
  })
  initLocalization(mock.api)
  initRuntime(mock.api)
  const extension = provider()
  if (withProvider) mock.api.interop.extensions.provide(CONTACT_PLACES_V1, extension)
  const store = createStore(mock.api)
  await act(async () => { render(React.createElement(Panel)) })
  return { mock, store, extension, dispose: () => { cleanup(); disposeStore(store) } }
}

describe('contact pins', () => {
  it('bounds a provider snapshot and keeps only checked values', () => {
    const entries = normalizeContactEntries({ contacts: [
      { id: 'a.vcf', name: 'A', places: [{ text: 'X', lat: 200, lng: 7 }, { text: '' }, { text: 'Y', lat: 47, lng: 8 }], groups: ['g', 3] },
      { id: 'a.vcf', name: 'duplicate' }, { name: 'no id' }, 'junk', { id: 'b.vcf', avatarUrl: 'javascript:alert(1)' }
    ] })
    expect(entries.map(entry => entry.id)).toEqual(['a.vcf', 'b.vcf'])
    expect(entries[0].places).toEqual([{ text: 'X' }, { text: 'Y', lat: 47, lng: 8 }])
    expect(entries[0].groups).toEqual(['g'])
    expect(entries[1]).not.toHaveProperty('avatarUrl')
    expect(entries[1].name).toBe('b')
  })

  it('takes each address\'s label colour and icon, sanitized, for its pin', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 3h18v18H3z" onclick="x()"/><script>alert(1)</script></svg>'
    const [entry] = normalizeContactEntries({ contacts: [{ id: 'a.vcf', name: 'A', color: 'palette:blue', places: [
      { label: 'Home', text: 'X', lat: 47, lng: 8, color: 'palette:green', iconSvg: svg },
      { label: 'Work', text: 'Y', lat: 46, lng: 7, color: 'not a colour', iconSvg: 'x'.repeat(9000) }
    ] }] })
    expect(entry.places[0].color).toBe('palette:green')
    expect(entry.places[0].iconSvg).toContain('<path')
    expect(entry.places[0].iconSvg).not.toMatch(/script|onclick/)
    expect(entry.places[1]).not.toHaveProperty('color')
    expect(entry.places[1]).not.toHaveProperty('iconSvg')
    const pins = buildContactPins([entry], new Map())
    expect(pins.map(pin => [pin.color, Boolean(pin.iconSvg)])).toEqual([['palette:green', true], ['palette:blue', false]])
  })

  it('pins picked coordinates at once and typed addresses once the map located them', () => {
    const entries = normalizeContactEntries(SNAPSHOT)
    expect(buildContactPins(entries, new Map()).map(pin => [pin.relPath, pin.sourceId, pin.icon])).toEqual([
      ['People/Aster Fernwood.vcf', 'contacts:0', 'home'], ['People/Birk Fernwood.vcf', 'contacts:0', 'briefcase']])
    const geocache = new Map([['moss lantern station, alpine road 1', { lng: 7.9, lat: 46.6 }]])
    expect(buildContactPins(entries, geocache)).toHaveLength(3)
    expect(pendingContactAddresses(entries, () => true, new Map())).toEqual(['Moss Lantern Station, Alpine Road 1', 'Nowhere 0'])
    expect(pendingContactAddresses(entries, id => id !== 'People/Aster Fernwood.vcf', new Map())).toEqual([])
    expect(contactAddressLine({ label: 'Home', text: 'Farnweg 3' })).toBe('Home · Farnweg 3')
    expect(contactAddressLine({ text: 'Farnweg 3' })).toBe('Farnweg 3')
    expect(normalizeContactsIcon({ viewBox: '0 0 24 24', path: 'M1 1h2v2z' })).toEqual({ viewBox: '0 0 24 24', path: 'M1 1h2v2z' })
    expect(normalizeContactsIcon({ viewBox: '0 0 24 24', path: '<script>' })).toBeNull()
    expect(normalizeContactsIcon(undefined)).toBeNull()
    expect(contactPinIcon('School')).toBe('school')
    expect(contactPinIcon(undefined)).toBe('person')
    expect(contactVisible('x', true, [])).toBe(false)
    expect(contactVisible('x', false, ['x'])).toBe(false)
  })
})

describe('Contacts tab', () => {
  it('appears only while Contacts provides contacts.places', async () => {
    const without = await renderContacts({}, false)
    expect(screen.queryByRole('tab', { name: 'Contacts' })).toBeNull()
    without.dispose()
    const withIt = await renderContacts()
    // The tab wears the Contacts plugin's own icon, sent with the contract.
    expect(screen.getByRole('tab', { name: 'Contacts' }).querySelector('path')?.getAttribute('d')).toBe('M256 48C148 48 48 148 48 256z')
    withIt.dispose()
  })

  it('lists every contact, greys out the ones the map does not show, and draws the visible ones', async () => {
    const { store, dispose } = await renderContacts()
    const list = await screen.findByRole('list', { name: 'Contacts' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map(row => row.querySelector('.map-row-title')?.textContent)).toEqual(['Aster Fernwood', 'Birk Fernwood', 'Colette Moosbach'])
    expect(rows[2]).toHaveClass('is-hidden')
    expect(within(rows[2]).getByText('No address')).toBeTruthy()
    expect(within(rows[2]).getByRole('button', { name: /Colette Moosbach/ })).toBeDisabled()
    expect(rows[0]).not.toHaveClass('is-hidden')
    // Each address says what it is: one address reads `Work · Harbor Lab`, several list their labels.
    expect(within(rows[0]).getByText('Home · Work · Old')).toBeTruthy()
    expect(within(rows[1]).getByText('Work · Harbor Lab')).toBeTruthy()
    // The typed work address is located by the map's own geocoder and then pinned too.
    await waitFor(() => expect(searchPlacesWithProvider).toHaveBeenCalledWith('Moss Lantern Station, Alpine Road 1', expect.anything(), expect.anything()))
    await waitFor(() => expect(store.getSnapshot().contactPinList).toHaveLength(3))
    dispose()
  })

  it('closes and opens eyes: one contact, then all, saved in settings', async () => {
    const { mock, dispose } = await renderContacts()
    const list = await screen.findByRole('list', { name: 'Contacts' })
    fireEvent.click(within(list).getByRole('button', { name: 'Hide “Birk Fernwood” on the map' }))
    await waitFor(() => expect(mock.api.settings.get().hiddenContacts).toEqual(['People/Birk Fernwood.vcf']))
    expect(within(list).getAllByRole('listitem')[1]).toHaveClass('is-hidden')
    fireEvent.click(screen.getByRole('button', { name: 'Hide all contacts on the map' }))
    await waitFor(() => expect(mock.api.settings.get().contactsHidden).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Show all contacts on the map' }))
    await waitFor(() => expect(mock.api.settings.get().contactsHidden).toBe(false))
    expect(mock.api.settings.get().hiddenContacts).toEqual([])
    dispose()
  })

  it('filters by name or address and opens a contact in Contacts on double click', async () => {
    const { extension, dispose } = await renderContacts()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search contacts' }), { target: { value: 'harbor' } })
    const list = screen.getByRole('list', { name: 'Contacts' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    fireEvent.doubleClick(within(list).getByText('Birk Fernwood'))
    await waitFor(() => expect(extension.open).toHaveBeenCalledWith('People/Birk Fernwood.vcf', { newTab: false }))
    dispose()
  })

  it('opens a contact with several addresses to list each, located or not', async () => {
    const { dispose } = await renderContacts()
    const list = await screen.findByRole('list', { name: 'Contacts' })
    fireEvent.click(within(list).getAllByRole('button', { name: 'Expand all sources' })[0])
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(6)
    expect(within(rows[1]).getByText('Home')).toBeTruthy()
    await waitFor(() => expect(within(list).getAllByRole('listitem')[2]).not.toHaveClass('is-hidden'))
    expect(within(list).getAllByRole('listitem')[3]).toHaveClass('is-hidden')
    expect(within(within(list).getAllByRole('listitem')[3]).getByText(/Not located yet/)).toBeTruthy()
    dispose()
  })

  it('hands the visible contacts\' pins to the map with the note pins, and drops a hidden contact\'s', async () => {
    const { mock, store, dispose } = await renderContacts()
    const drawn: NotePin[][] = []
    const engine = { setPlaces() {}, setPins() {}, setSourcePins: (pins: NotePin[]) => drawn.push(pins), setPlaceMarkers() {}, setSavedRoutes() {}, setWaypoints() {}, setRoute() {},
      setUnits() {}, setLiveLocation() {}, setSidebarOverlay() {}, setSearchMarker() {}, flyTo() {}, fitTo() {} } as unknown as MapEngine
    act(() => { store.attachMap(engine) })
    const contacts = (): string[] => drawn.at(-1)!.filter(pin => pin.sourceId.startsWith('contacts:')).map(pin => pin.relPath)
    expect(contacts()).toContain('People/Birk Fernwood.vcf')
    await act(async () => { await mock.api.settings.set('hiddenContacts', ['People/Birk Fernwood.vcf']) })
    expect(contacts()).not.toContain('People/Birk Fernwood.vcf')
    expect(contacts()).toContain('People/Aster Fernwood.vcf')
    await act(async () => { await mock.api.settings.set('contactsHidden', true) })
    expect(contacts()).toEqual([])
    act(() => { store.detachMap(engine) })
    dispose()
  })
})
