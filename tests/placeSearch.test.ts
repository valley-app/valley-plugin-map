import { describe, expect, it } from 'vitest'
import { foldText, matchSavedPlaces, withoutNearDuplicates } from '../src/geocode'
import { PUBLIC_REQUEST_HEADERS } from '../src/geocodeProviders'

const places = [
  { name: 'Lakeside Field Station', lng: 8.54, lat: 47.37 },
  { name: 'Zürich Hauptbahnhof', lng: 8.54, lat: 47.378 },
  { name: 'Old Mill Wetland', lng: 8.31, lat: 47.05 },
  { name: 'Mill Creek Station', lng: 8.0, lat: 47.0 }
]

describe('place search', () => {
  it('matches saved places by every word, ignoring case and accents, best first', () => {
    expect(foldText('Zürich')).toBe('zurich')
    expect(matchSavedPlaces('zurich', places).map((p) => p.name)).toEqual(['Zürich Hauptbahnhof'])
    expect(matchSavedPlaces('mill', places).map((p) => p.name)).toEqual(['Mill Creek Station', 'Old Mill Wetland'])
    expect(matchSavedPlaces('station field', places).map((p) => p.name)).toEqual(['Lakeside Field Station'])
    expect(matchSavedPlaces('  ', places)).toEqual([])
  })

  it('drops geocoder hits on top of an offered saved place', () => {
    const hits = [{ name: 'Zürich HB', lng: 8.5401, lat: 47.3781 }, { name: 'Baden', lng: 8.30, lat: 47.47 }]
    expect(withoutNearDuplicates(hits, places).map((h) => h.name)).toEqual(['Baden'])
  })

  it('identifies itself to the public geocoder, which refuses the default node agent', () => {
    expect(PUBLIC_REQUEST_HEADERS['User-Agent']).toMatch(/^Valley-Map /)
  })
})
