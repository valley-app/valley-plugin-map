import { describe, it, expect } from 'vitest'
import type { IndexEntry } from '@valley/plugin-sdk/types'
import type { PinSource } from '../src/types'
import {
  addressText,
  buildSourcePins,
  collectPendingAddresses,
  hoverFieldsFor,
  defaultPinSource,
  matchNotes,
  matchSignature,
  normalizeAddress,
  parseFieldList,
  pendingAddress,
  pinTitle,
  resolvePinLocation,
  sanitizePinSource,
  toDisplay,
  type GeoCache
} from '../src/pinSources'

const source = (over: Partial<PinSource> = {}): PinSource => ({
  id: 's1',
  title: 'Biodiversity',
  matchKey: 'type',
  matchValue: 'contact',
  locationMode: 'address',
  locationField: 'address',
  labelMode: 'filename',
  hoverFields: ['name', 'phone'],
  color: '#2563eb',
  borderColor: '#ffffff',
  icon: 'person',
  visible: true,
  hidden: false,
  ...over
})

const entry = (relPath: string, frontmatter: Record<string, unknown>, over: Partial<IndexEntry> = {}): IndexEntry => ({
  relPath,
  title: relPath.replace(/\.md$/, ''),
  kind: 'note',
  frontmatter,
  mtimeMs: 0,
  ...over
})

describe('normalizeAddress', () => {
  it('trims, lowercases and collapses whitespace', () => {
    expect(normalizeAddress('  Forest Trail   1, Example Grove ')).toBe('forest trail 1, example grove')
    expect(normalizeAddress(42)).toBe('')
  })
})

describe('parseFieldList', () => {
  it('splits on commas and newlines, dropping blanks', () => {
    expect(parseFieldList('name, phone\n  , email ')).toEqual(['name', 'phone', 'email'])
  })
})

describe('addressText', () => {
  it('returns a plain string unchanged', () => {
    expect(addressText('Canopy Trail 51, Fern Reserve')).toBe('Canopy Trail 51, Fern Reserve')
  })
  it('takes the first non-empty entry of a list (a contact place field)', () => {
    expect(addressText(['', 'Moss Path 8, Fungi Basin'])).toBe('Moss Path 8, Fungi Basin')
  })
  it('strips a trailing "(label)" annotation', () => {
    expect(addressText(['Riverbank Trail 61, Otter Sanctuary (den)'])).toBe('Riverbank Trail 61, Otter Sanctuary')
  })
  it('is empty for a non-string, empty list, or blank', () => {
    expect(addressText(42)).toBe('')
    expect(addressText([''])).toBe('')
    expect(addressText(undefined)).toBe('')
  })
  // The canonical shape the Contacts plugin writes for `place` — reading only
  // the string forms meant every contact note resolved to no address at all.
  it('reads the contact-method object list the Contacts plugin writes', () => {
    expect(addressText([{ value: 'Moss Path 8, Fungi Basin', type: 'Home' }]))
      .toBe('Moss Path 8, Fungi Basin')
    expect(addressText({ value: 'Canopy Trail 51, Fern Reserve' }))
      .toBe('Canopy Trail 51, Fern Reserve')
  })
  it('skips a blank contact-method entry for the next one', () => {
    expect(addressText([{ value: '   ' }, { type: 'Field' }, { value: 'Moss Path 8' }])).toBe('Moss Path 8')
  })
  it('is empty for an object carrying no string value', () => {
    expect(addressText([{ name: 'Apple', title: 'Chief of operations' }])).toBe('')
  })
})

describe('toDisplay', () => {
  it('renders scalars and lists on one line', () => {
    expect(toDisplay('Engineer')).toBe('Engineer')
    expect(toDisplay(42)).toBe('42')
    expect(toDisplay(['a', 'b'])).toBe('a, b')
    expect(toDisplay(null)).toBe('')
  })
  // A hover popup configured to show `place` rendered an empty row before this:
  // the value was in the frontmatter, the popup just could not read the shape.
  it('renders a contact method with its label in parentheses', () => {
    expect(toDisplay([{ value: 'Riverbank Trail 61, Otter Sanctuary', type: 'den' }]))
      .toBe('Riverbank Trail 61, Otter Sanctuary (den)')
    expect(toDisplay([{ value: 'otter@example.com' }])).toBe('otter@example.com')
  })
  it('renders any other nested object as nothing', () => {
    expect(toDisplay({ name: 'Apple', title: 'Chief of operations' })).toBe('')
  })
})

describe('defaultPinSource', () => {
  it('stores its colour as a palette reference, so a pin follows the theme', () => {
    expect(defaultPinSource().color).toBe('palette:primary-blue')
  })
  it('hands each new source an unused palette colour', () => {
    const first = defaultPinSource()
    const second = defaultPinSource([first])
    const third = defaultPinSource([first, second])
    expect([second.color, third.color]).toEqual(['palette:yellow', 'palette:green'])
  })
  it('keeps the marker hairline a literal white — it is read against the basemap', () => {
    expect(defaultPinSource().borderColor).toBe('#ffffff')
  })
})

describe('list-valued address fields (contact place)', () => {
  const src = source({ locationField: 'place' })
  const cache: GeoCache = new Map([['riverbank trail 61, otter sanctuary', { lng: 8.32, lat: 12.48 }]])

  it('resolves a pin from the first list entry, label stripped', () => {
    const fm = { place: ['Riverbank Trail 61, Otter Sanctuary (den)'] }
    expect(resolvePinLocation(fm, src, cache)).toEqual({ lng: 8.32, lat: 12.48 })
  })
  it('resolves the same pin from the contact-method object form', () => {
    const fm = { place: [{ value: 'Riverbank Trail 61, Otter Sanctuary', type: 'den' }] }
    expect(resolvePinLocation(fm, src, cache)).toEqual({ lng: 8.32, lat: 12.48 })
  })
  it('queues the cleaned address for geocoding', () => {
    const es = [entry('a.md', { type: 'contact', place: ['Moss Path 8, Fungi Basin (field)'] })]
    expect(collectPendingAddresses(es, [src], new Map())).toEqual(['Moss Path 8, Fungi Basin'])
  })
})

describe('sanitizePinSource', () => {
  it('defaults missing fields and coerces a comma string of hover fields', () => {
    const s = sanitizePinSource({ id: 'x', title: ' Canopy ', matchValue: 'place', hoverFields: 'a, b' })
    expect(s).toMatchObject({ id: 'x', title: 'Canopy', matchKey: 'type', matchValue: 'place', locationMode: 'address', locationField: 'address', hoverFields: ['a', 'b'], visible: true })
  })
  it('respects an explicit visible:false and array hover fields', () => {
    const s = sanitizePinSource({ visible: false, hoverFields: ['x', ' y '] })
    expect(s.visible).toBe(false)
    expect(s.hoverFields).toEqual(['x', 'y'])
  })
  it('migrates a legacy addressField into locationField (address mode)', () => {
    const s = sanitizePinSource({ matchValue: 'place', addressField: 'ort' })
    expect(s.locationMode).toBe('address')
    expect(s.locationField).toBe('ort')
  })
  it('reads an explicit coordinate mode and field', () => {
    const s = sanitizePinSource({ matchValue: 'place', locationMode: 'coordinate', locationField: 'coordinates' })
    expect(s.locationMode).toBe('coordinate')
    expect(s.locationField).toBe('coordinates')
  })
  it('defaults the style/visibility fields', () => {
    expect(sanitizePinSource({ matchValue: 'place' })).toMatchObject({
      labelMode: 'filename',
      borderColor: '#ffffff',
      visible: true,
      hidden: false
    })
  })
  it('migrates a legacy labelField (no labelMode) into property mode', () => {
    const s = sanitizePinSource({ matchValue: 'place', labelField: 'name' })
    expect(s.labelMode).toBe('property')
    expect(s.labelField).toBe('name')
  })
  it('honours an explicit hidden flag', () => {
    expect(sanitizePinSource({ matchValue: 'place', hidden: true }).hidden).toBe(true)
  })
})

describe('matchNotes', () => {
  const entries: IndexEntry[] = [
    entry('observations/a.md', { type: 'Contact', address: 'Fern Reserve' }),
    entry('observations/b.md', { type: 'contact' }),
    entry('habitats/c.md', { type: 'contact' }),
    entry('observations/d.md', { type: 'project' }),
    entry('observations/e.md', { type: 'contact' }, { excluded: true }),
    entry('observations/f.png', { type: 'contact' }, { kind: 'asset' })
  ]

  it('matches case-insensitively and skips excluded/non-notes', () => {
    const got = matchNotes(entries, source()).map((e) => e.relPath)
    expect(got).toEqual(['observations/a.md', 'observations/b.md', 'habitats/c.md'])
  })
  it('honours the folder scope', () => {
    const got = matchNotes(entries, source({ folder: 'observations' })).map((e) => e.relPath)
    expect(got).toEqual(['observations/a.md', 'observations/b.md'])
  })
  it('returns nothing when the source is incomplete', () => {
    expect(matchNotes(entries, source({ matchValue: '' }))).toEqual([])
  })
})

describe('resolvePinLocation', () => {
  const cache: GeoCache = new Map([['fern reserve', { lng: 8.54, lat: 12.37 }]])

  it('prefers explicit coordinates over the geocoded address', () => {
    const loc = resolvePinLocation({ lat: 1, lng: 2, address: 'Fern Reserve' }, source(), cache)
    expect(loc).toEqual({ lng: 2, lat: 1 })
  })
  it('falls back to the cached address', () => {
    expect(resolvePinLocation({ address: 'Fern Reserve' }, source(), cache)).toEqual({ lng: 8.54, lat: 12.37 })
  })
  it('returns null when the address is not cached', () => {
    expect(resolvePinLocation({ address: 'Moss Basin' }, source(), cache)).toBeNull()
    expect(resolvePinLocation({}, source(), cache)).toBeNull()
  })
})

describe('resolvePinLocation (coordinate mode)', () => {
  const coordSource = source({ locationMode: 'coordinate', locationField: 'coordinates' })

  it('reads a "lat,lng" coordinate from the configured field', () => {
    expect(resolvePinLocation({ coordinates: '12.37, 8.54' }, coordSource, new Map())).toEqual({ lng: 8.54, lat: 12.37 })
  })
  it('resolves a slash pair from a custom field without requesting geocoding', () => {
    const custom = source({ locationMode: 'coordinate', locationField: 'surveyPoint' })
    const fm = { surveyPoint: '-12.37 / 8.54' }
    expect(resolvePinLocation(fm, custom, new Map())).toEqual({ lng: 8.54, lat: -12.37 })
    expect(pendingAddress(fm, custom)).toBe('')
  })
  it('never geocodes — an address alone yields null even when cached', () => {
    const cache: GeoCache = new Map([['fern reserve', { lng: 8.54, lat: 12.37 }]])
    expect(resolvePinLocation({ address: 'Fern Reserve' }, coordSource, cache)).toBeNull()
  })
  it('is skipped by the geocode work-list', () => {
    const entries: IndexEntry[] = [entry('a.md', { type: 'contact', address: 'Moss Basin' })]
    expect(collectPendingAddresses(entries, [coordSource], new Map())).toEqual([])
  })
})

describe('hoverFieldsFor / pinTitle', () => {
  it('keeps only present hover fields, in order, joining arrays', () => {
    const fm = { name: 'Red Fox', phone: ['one', 'two'], email: 'fox@biodiversity.example' }
    expect(hoverFieldsFor(fm, source())).toEqual([
      { key: 'name', value: 'Red Fox' },
      { key: 'phone', value: 'one, two' }
    ])
  })
  it('uses the property field in property mode, else the note filename', () => {
    const e = entry('observations/a.md', { name: 'Red Fox' })
    expect(pinTitle(e, source({ labelMode: 'property', labelField: 'name' }))).toBe('Red Fox')
    expect(pinTitle(e, source({ labelMode: 'property', labelField: 'missing' }))).toBe('observations/a')
    expect(pinTitle(e, source({ labelMode: 'filename', labelField: 'name' }))).toBe('observations/a')
    expect(pinTitle(e, source())).toBe('observations/a')
  })
})

describe('buildSourcePins / collectPendingAddresses', () => {
  const entries: IndexEntry[] = [
    entry('a.md', { type: 'contact', name: 'A', lat: 12.1, lng: 8.1 }),
    entry('b.md', { type: 'contact', name: 'B', address: 'Fern Reserve' }),
    entry('c.md', { type: 'contact', name: 'C', address: 'Moss Basin' })
  ]
  const cache: GeoCache = new Map([['fern reserve', { lng: 8.54, lat: 12.37 }]])

  it('builds pins for coords and cached addresses, skipping un-geocoded ones', () => {
    const pins = buildSourcePins(entries, source(), cache)
    expect(pins.map((p) => p.relPath)).toEqual(['a.md', 'b.md'])
    expect(pins[0]).toMatchObject({ sourceId: 's1', color: '#2563eb', icon: 'person', title: 'a' })
    expect(pins[1]).toMatchObject({ relPath: 'b.md', lng: 8.54, lat: 12.37 })
  })
  it('returns no pins when the source is not visible', () => {
    expect(buildSourcePins(entries, source({ visible: false }), cache)).toEqual([])
  })
  it('returns no pins when the source is hidden from the sidebar', () => {
    expect(buildSourcePins(entries, source({ hidden: true }), cache)).toEqual([])
  })
  it('carries the source border color onto each pin', () => {
    const pins = buildSourcePins(entries, source({ borderColor: '#000000' }), cache)
    expect(pins[0].borderColor).toBe('#000000')
  })
  it('collects only un-cached addresses, de-duplicated', () => {
    expect(collectPendingAddresses(entries, [source()], cache)).toEqual(['Moss Basin'])
  })
})

describe('matchSignature', () => {
  const entries: IndexEntry[] = [entry('a.md', { type: 'contact', name: 'A', address: 'Fern Reserve' })]
  it('changes when a matched note field the pins depend on changes', () => {
    const before = matchSignature(entries, [source()])
    const after = matchSignature([entry('a.md', { type: 'contact', name: 'A2', address: 'Fern Reserve' })], [source()])
    expect(after).not.toBe(before)
  })
  it('changes when source styling changes', () => {
    expect(matchSignature(entries, [source({ color: '#ff0000' })])).not.toBe(matchSignature(entries, [source()]))
  })
  it('is stable for an unrelated frontmatter edit', () => {
    const before = matchSignature(entries, [source()])
    const after = matchSignature([entry('a.md', { type: 'contact', name: 'A', address: 'Fern Reserve', unrelated: 9 })], [source()])
    expect(after).toBe(before)
  })
})


describe('pin source combinations', () => {
  const combinations = (['coordinate', 'address'] as const).flatMap((locationMode) =>
    (['filename', 'property'] as const).flatMap((labelMode) =>
      [undefined, 'Field'].flatMap((folder) =>
        [[], ['status'], ['status', 'count', 'verified', 'tags', 'contact']].map((hoverFields) =>
          ({ locationMode, labelMode, folder, hoverFields })
        )
      )
    )
  )
  it.each(combinations)('resolves locations, titles, folder scope and popup fields for %j', (combination) => {
    const configured = source({ ...combination, matchKey: 'scenario', matchValue: 'field-trip', locationField: 'site', labelField: 'name' })
    const fm = {
      scenario: ' Field-Trip ', name: 'Fern observation', status: 'Ready', count: 0,
      verified: false, tags: ['fern', 'moss'], contact: [{ value: 'Field station', type: 'Field' }],
      site: combination.locationMode === 'coordinate' ? '12.37 / 8.54' : [{ value: 'Fern Reserve', type: 'Field' }]
    }
    const entries = [entry('Field/first.md', fm), entry('Field/Subfolder/fallback.md', { ...fm, name: '' }), entry('Fieldwork/outside.md', fm)]
    const cache: GeoCache = new Map([['fern reserve', { lat: 12.37, lng: 8.54 }]])
    const pins = buildSourcePins(entries, configured, cache)
    expect(pins.map((pin) => pin.relPath)).toEqual(entries.slice(0, combination.folder ? 2 : 3).map((note) => note.relPath))
    expect(pins[0]).toMatchObject({ lat: 12.37, lng: 8.54, title: combination.labelMode === 'property' ? 'Fern observation' : 'Field/first' })
    expect(pins[1].title).toBe('Field/Subfolder/fallback')
    const values = { status: 'Ready', count: '0', verified: 'false', tags: 'fern, moss', contact: 'Field station (Field)' }
    expect(pins[0].fields).toEqual(combination.hoverFields.map((key) => ({ key, value: values[key as keyof typeof values] })))
  })
})
