import { mapPresentationSettings, parseMapPresentation } from '../src/settings'
import { describe, it, expect } from 'vitest'
import type { IndexEntry } from '@valley/plugin-sdk/types'
import { durationParts, formatDistance, formatDuration, formatLatLng } from '../src/format'
import { haversineMeters, lineLengthMeters, boundsOf, isValidLngLat } from '../src/geo'
import { geoFromFrontmatter, parseGeoPins, parseLatLngPair } from '../src/pins'
import {
  routeToFeatureCollection,
  routeToGeoJsonText,
  parseRouteFromGeoJson
} from '../src/geojson'
import { routeToGpx, gpxToRoute } from '../src/gpx'
import {
  parseOsrmResponse,
  parseOrsResponse,
  parseOsrmSteps,
  parseOrsSteps,
  parseOsrmWaypoints,
  parseOrsWaypoints,
  osrmManeuverText,
  osrmUrl,
  osrmDemoUrl,
  osrmProfileHost,
  mapboxDirectionsUrl,
  orsProfile,
  mapboxProfile
} from '../src/routing'
import { sampleLineString, buildProfile } from '../src/elevation'
import { accountProviderChoice, effectiveStyle, mapLayers, resolveSettings, DEFAULT_CENTER } from '../src/settings'
import { styleFor } from '../src/mapStyle'
import type { StyleSpecification, RasterSourceSpecification } from 'maplibre-gl'
import { fullName, parseNominatimSearch, parseMapboxGeocode } from '../src/geocode'
import type { LngLat, Route, Waypoint } from '../src/types'

describe('map provider layers', () => {
  const connection = accountProviderChoice('mapbox', 'field-map')
  const configured = resolveSettings({ mapboxEnabled: true, basemapProvider: connection })
  const tiles = (style: ReturnType<typeof styleFor>): string[] => ((style as StyleSpecification).sources.base as RasterSourceSpecification).tiles ?? []

  it.each([
    ['satellite', 'satellite-v9'], ['outdoors', 'outdoors-v12']
  ] as const)('uses the selected Mapbox account and fixed %s style in both themes', (layer, id) => {
    for (const theme of ['light', 'dark'] as const) {
      expect(tiles(styleFor(layer, theme, configured))).toEqual([`plugin-map://tile/field-map/${id}/{z}/{x}/{y}`])
      expect(effectiveStyle(resolveSettings({ ...configured, defaultStyle: layer }))).toBe(layer)
    }
  })

  it('uses street and Navigation variants for the selected map mode', () => {
    expect(tiles(styleFor('streets', 'light', configured))).toEqual(['plugin-map://tile/field-map/streets-v12/{z}/{x}/{y}'])
    expect(tiles(styleFor('streets', 'dark', configured))).toEqual(['plugin-map://tile/field-map/dark-v11/{z}/{x}/{y}'])
    expect(tiles(styleFor('navigation', 'light', configured))).toEqual(['plugin-map://tile/field-map/navigation-day-v1/{z}/{x}/{y}'])
    expect(tiles(styleFor('navigation', 'dark', configured))).toEqual(['plugin-map://tile/field-map/navigation-night-v1/{z}/{x}/{y}'])
  })

  it('dims satellite and outdoors in dark mode without replacing their map data', () => {
    for (const layer of ['satellite', 'outdoors'] as const) {
      const light = styleFor(layer, 'light', configured) as StyleSpecification
      const dark = styleFor(layer, 'dark', configured) as StyleSpecification
      expect(dark.sources).toEqual(light.sources)
      expect(dark.layers[0]).toMatchObject({ paint: { 'raster-brightness-max': 0.55, 'raster-saturation': -0.25 } })
      expect(light.layers[0]).not.toHaveProperty('paint')
    }
  })

  it('offers the additional styles only for the active Mapbox provider', () => {
    expect(mapLayers(configured).map((choice) => choice.id)).toEqual(['streets', 'satellite', 'navigation', 'outdoors'])
    for (const settings of [
      resolveSettings({ mapboxEnabled: true, basemapProvider: 'free', defaultStyle: 'outdoors' }),
      { ...configured, mapboxEnabled: false, defaultStyle: 'streets' as const },
      { ...configured, basemapProvider: accountProviderChoice('community-atlas', 'field-map') }
    ]) {
      expect(mapLayers(settings).map((choice) => choice.id)).toEqual(['streets', 'satellite'])
      expect(effectiveStyle(settings)).toBe('streets')
    }
  })

  it('keeps free street and satellite sources when the provider is free or disabled', () => {
    for (const settings of [resolveSettings({ basemapProvider: 'free' }), { ...configured, mapboxEnabled: false }]) {
      expect(styleFor('streets', 'light', settings)).toContain('cartocdn.com')
      expect(tiles(styleFor('satellite', 'dark', settings))[0]).toContain('arcgisonline.com')
      expect(styleFor('outdoors', 'light', settings)).toContain('cartocdn.com')
    }
  })

  it('keeps offline tiles ahead of both online layers', () => {
    const offline = { ...configured, offlineBasemapPath: 'maps/field.pmtiles' }
    for (const { id: layer } of mapLayers(configured)) {
      expect((styleFor(layer, 'dark', offline) as StyleSpecification).sources.offline).toMatchObject({ type: 'raster' })
      expect((styleFor(layer, 'dark', offline) as StyleSpecification).sources.base).toBeUndefined()
    }
  })
})

describe('format', () => {
  it('formats distance in m / km', () => {
    expect(formatDistance(0)).toBe('0 m')
    expect(formatDistance(850)).toBe('850 m')
    expect(formatDistance(8400)).toBe('8.4 km')
    expect(formatDistance(12400)).toBe('12 km')
    expect(formatDistance(123456)).toBe('123 km')
    expect(formatDistance(-5)).toBe('—')
  })
  it('formats duration s / min / h', () => {
    expect(formatDuration(45)).toBe('45 s')
    expect(formatDuration(720)).toBe('12 min')
    expect(formatDuration(5000)).toBe('1 h 23 min')
    expect(formatDuration(3600)).toBe('1 h')
  })
  it('splits a duration into the same parts formatDuration prints', () => {
    expect(durationParts(45)).toEqual({ hours: 0, minutes: 0, seconds: 45, valid: true })
    expect(durationParts(720)).toEqual({ hours: 0, minutes: 12, seconds: 0, valid: true })
    expect(durationParts(3600)).toEqual({ hours: 1, minutes: 0, seconds: 0, valid: true })
    expect(durationParts(5000)).toEqual({ hours: 1, minutes: 23, seconds: 0, valid: true })
    // 3599 s rounds to 60 min, which must carry — computing hours and minutes
    // independently renders this as "0 h 60 min".
    expect(durationParts(3599)).toEqual({ hours: 1, minutes: 0, seconds: 0, valid: true })
    expect(durationParts(-1).valid).toBe(false)
    expect(durationParts(Number.NaN).valid).toBe(false)
  })
  it('formats lat,lng with precision', () => {
    expect(formatLatLng(12.376925, 8.541694, 4)).toBe('12.3769, 8.5417')
  })
})

describe('geo', () => {
  it('haversine ~1.11 km per 0.01° latitude', () => {
    const d = haversineMeters([8.5417, 12.3769], [8.5417, 12.3869])
    expect(d).toBeGreaterThan(1080)
    expect(d).toBeLessThan(1140)
  })
  it('lineLengthMeters sums segments', () => {
    const line: LngLat[] = [
      [8.54, 12.37],
      [8.55, 12.37],
      [8.56, 12.37]
    ]
    expect(lineLengthMeters(line)).toBeCloseTo(haversineMeters(line[0], line[1]) * 2, 0)
  })
  it('boundsOf returns sw/ne', () => {
    expect(boundsOf([])).toBeNull()
    expect(
      boundsOf([
        [1, 2],
        [3, 4],
        [-1, 0]
      ])
    ).toEqual([
      [-1, 0],
      [3, 4]
    ])
  })
  it('validates coordinate ranges', () => {
    expect(isValidLngLat(8.5, 12.3)).toBe(true)
    expect(isValidLngLat(200, 47)).toBe(false)
    expect(isValidLngLat(8, 100)).toBe(false)
    expect(isValidLngLat(NaN, 0)).toBe(false)
  })
})

describe('pins', () => {
  it('parses valid lat/lng pairs from strings, arrays, and aliased objects', () => {
    expect(parseLatLngPair('12.37, 8.54')).toEqual({ lat: 12.37, lng: 8.54 })
    expect(parseLatLngPair([12.37, 8.54])).toEqual({ lat: 12.37, lng: 8.54 })
    expect(parseLatLngPair({ name: 'Moss Basin', lat: '12.37', lng: 8.54 })).toEqual({ lat: 12.37, lng: 8.54 })
    expect(parseLatLngPair({ latitude: 12.37, longitude: '8.54' })).toEqual({ lat: 12.37, lng: 8.54 })
    expect(parseLatLngPair({ lat: 91, lng: 8.54 })).toBeNull()
    expect(parseLatLngPair({ lat: 12.37, lng: -181 })).toBeNull()
    expect(parseLatLngPair('nope')).toBeNull()
  })
  it.each([', ', '/', ' / ', '; ', ' | ', ' ', '\t'])(
    'reads signed latitude/longitude with a %s separator', (separator) => {
      expect(parseLatLngPair(` -12.37${separator}+8.54 `)).toEqual({ lat: -12.37, lng: 8.54 })
    }
  )
  it.each(['12.37, 8.54, 100', [12.37, 8.54, 100], '91 / 8', '12 / 181', '12 / unknown'])('rejects ambiguous or invalid pairs: %s', (value) => {
    expect(parseLatLngPair(value)).toBeNull()
  })
  it('reads geo from frontmatter spellings', () => {
    expect(geoFromFrontmatter({ lat: 12.37, lng: 8.54 })).toEqual({ lat: 12.37, lng: 8.54 })
    expect(geoFromFrontmatter({ latitude: '12.37', longitude: '8.54' })).toEqual({ lat: 12.37, lng: 8.54 })
    expect(geoFromFrontmatter({ location: '12.37, 8.54' })).toEqual({ lat: 12.37, lng: 8.54 })
    expect(geoFromFrontmatter({ geo: [12.37, 8.54] })).toEqual({ lat: 12.37, lng: 8.54 })
    expect(geoFromFrontmatter({ coordinates: { name: 'Moss Basin', latitude: '12.37', longitude: '8.54' } })).toEqual({ lat: 12.37, lng: 8.54 })
    expect(geoFromFrontmatter({ location: { lat: 100, lng: 8.54 } })).toBeNull()
    expect(geoFromFrontmatter({ title: 'x' })).toBeNull()
    expect(geoFromFrontmatter(undefined)).toBeNull()
  })
  it('plots only non-excluded notes with coordinates', () => {
    const entries: IndexEntry[] = [
      { relPath: 'a.md', title: 'A', kind: 'note', frontmatter: { lat: 12.37, lng: 8.54 }, mtimeMs: 0 },
      { relPath: 'b.md', title: 'B', kind: 'note', frontmatter: { foo: 1 }, mtimeMs: 0 },
      { relPath: 'c.md', title: 'C', kind: 'note', frontmatter: { lat: 1, lng: 2 }, mtimeMs: 0, excluded: true },
      { relPath: 'd.png', title: 'D', kind: 'asset', mtimeMs: 0 }
    ]
    const pins = parseGeoPins(entries)
    expect(pins).toHaveLength(1)
    expect(pins[0]).toMatchObject({ relPath: 'a.md', title: 'A', lat: 12.37, lng: 8.54 })
  })
})

const sampleRoute: Route = {
  id: 'r1',
  name: 'Canopy Survey',
  mode: 'cycling',
  waypoints: [
    { lng: 8.54, lat: 12.37, label: 'Start' },
    { lng: 8.56, lat: 12.38, label: 'End' }
  ],
  geometry: [
    [8.54, 12.37],
    [8.55, 12.375],
    [8.56, 12.38]
  ],
  createdAt: '2026-01-01T00:00:00Z'
}

describe('geojson', () => {
  it('builds a FeatureCollection with a line + waypoint points', () => {
    const fc = routeToFeatureCollection(sampleRoute)
    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features.filter((f) => f.geometry.type === 'LineString')).toHaveLength(1)
    expect(fc.features.filter((f) => f.geometry.type === 'Point')).toHaveLength(2)
  })
  it('round-trips through text', () => {
    const parsed = parseRouteFromGeoJson(routeToGeoJsonText(sampleRoute))
    expect(parsed).not.toBeNull()
    expect(parsed?.waypoints).toHaveLength(2)
    expect(parsed?.geometry).toHaveLength(3)
  })
  it('derives endpoints from a bare LineString', () => {
    const parsed = parseRouteFromGeoJson(
      JSON.stringify({ type: 'LineString', coordinates: [[8.54, 12.37], [8.56, 12.38]] })
    )
    expect(parsed?.waypoints).toHaveLength(2)
  })
  it('returns null for junk', () => {
    expect(parseRouteFromGeoJson('not json')).toBeNull()
  })
})

describe('gpx', () => {
  it('serializes waypoints + a track', () => {
    const gpx = routeToGpx(sampleRoute)
    expect(gpx).toContain('<wpt lat="12.37" lon="8.54"')
    expect(gpx).toContain('<trkpt lat="12.375" lon="8.55">')
    expect(gpx).toContain('<name>Canopy Survey</name>')
  })
  it('round-trips waypoints + geometry', () => {
    const parsed = gpxToRoute(routeToGpx(sampleRoute))
    expect(parsed).not.toBeNull()
    expect(parsed?.waypoints).toHaveLength(2)
    expect(parsed?.waypoints[0]).toMatchObject({ lat: 12.37, lng: 8.54, label: 'Start' })
    expect(parsed?.geometry).toHaveLength(3)
  })
  it('escapes XML in names', () => {
    const gpx = routeToGpx({ ...sampleRoute, name: 'A & B <x>' })
    expect(gpx).toContain('A &amp; B &lt;x&gt;')
  })
})

describe('routing parsers', () => {
  it('parses an OSRM geojson route', () => {
    const json = {
      routes: [{ distance: 1234, duration: 567, geometry: { coordinates: [[8.54, 12.37], [8.56, 12.38]] } }]
    }
    const r = parseOsrmResponse(json)
    expect(r).toMatchObject({ distanceM: 1234, durationS: 567 })
    expect(r?.geometry).toHaveLength(2)
  })
  it('carries OSRM snapped waypoints, all or nothing', () => {
    const json = {
      waypoints: [{ location: [8.541, 12.371] }, { location: [8.561, 12.381] }],
      routes: [{ distance: 1234, duration: 567, geometry: { coordinates: [[8.54, 12.37], [8.56, 12.38]] } }]
    }
    expect(parseOsrmWaypoints(json)).toEqual([[8.541, 12.371], [8.561, 12.381]])
    expect(parseOsrmResponse(json)?.snapped).toEqual([[8.541, 12.371], [8.561, 12.381]])

    // One bad entry drops the whole list: half-snapped markers pair snapped and
    // typed coordinates by index and put some pins in the wrong place.
    expect(parseOsrmWaypoints({ ...json, waypoints: [{ location: [8.54, 12.37] }, { location: [null, 47] }] }))
      .toBeUndefined()
    expect(parseOsrmWaypoints({ ...json, waypoints: [{ location: [8.54, 12.37] }, {}] })).toBeUndefined()
    expect(parseOsrmWaypoints({ routes: json.routes })).toBeUndefined()
    expect(parseOsrmWaypoints({ ...json, waypoints: [] })).toBeUndefined()
  })
  it('resolves ORS way_point indices against the geometry', () => {
    const geometry: LngLat[] = [[8.54, 12.37], [8.55, 12.375], [8.56, 12.38]]
    const json = { features: [{ properties: { way_points: [0, 2] } }] }
    expect(parseOrsWaypoints(json, geometry)).toEqual([[8.54, 12.37], [8.56, 12.38]])
    // Out of range must not read past the end of the line.
    expect(parseOrsWaypoints({ features: [{ properties: { way_points: [0, 9] } }] }, geometry)).toBeUndefined()
    expect(parseOrsWaypoints({ features: [{ properties: {} }] }, geometry)).toBeUndefined()
  })
  it('parses ORS 3D coordinates into elevations', () => {
    const json = {
      features: [
        {
          geometry: { coordinates: [[8.54, 12.37, 400], [8.56, 12.38, 460]] },
          properties: { summary: { distance: 2000, duration: 600 } }
        }
      ]
    }
    const r = parseOrsResponse(json)
    expect(r?.elevations).toEqual([400, 460])
    expect(r?.distanceM).toBe(2000)
  })
  it('synthesizes OSRM maneuver text and parses steps', () => {
    expect(osrmManeuverText({ type: 'turn', modifier: 'left' }, 'Forest Trail')).toBe(
      'Turn left onto Forest Trail'
    )
    expect(osrmManeuverText({ type: 'depart' })).toBe('Head out')
    expect(osrmManeuverText({ type: 'arrive' })).toBe('Arrive at your destination')
    const json = {
      routes: [
        {
          geometry: { coordinates: [[8.54, 12.37], [8.56, 12.38]] },
          legs: [
            {
              steps: [
                { maneuver: { type: 'depart' }, name: 'Canopy Trail', distance: 120, duration: 30 },
                { maneuver: { type: 'turn', modifier: 'right' }, name: 'River Trail', distance: 400, duration: 90 },
                { maneuver: { type: 'arrive' }, name: '', distance: 0, duration: 0 }
              ]
            }
          ]
        }
      ]
    }
    const steps = parseOsrmSteps(json)
    expect(steps).toHaveLength(3)
    expect(steps?.[1]).toMatchObject({ instruction: 'Turn right onto River Trail', distanceM: 400, durationS: 90 })
  })
  it('prefers a provided Mapbox instruction over synthesis', () => {
    const json = {
      routes: [{ legs: [{ steps: [{ maneuver: { type: 'turn', modifier: 'left', instruction: 'Turn left toward the lake' }, distance: 50, duration: 12 }] }] }]
    }
    expect(parseOsrmSteps(json)?.[0].instruction).toBe('Turn left toward the lake')
  })
  it('parses ORS step instructions', () => {
    const json = {
      features: [
        {
          properties: {
            segments: [
              {
                steps: [
                  { instruction: 'Head north on Canopy Trail', name: 'Canopy Trail', distance: 100, duration: 40 },
                  { instruction: 'Arrive at your destination', name: '-', distance: 0, duration: 0 }
                ]
              }
            ]
          }
        }
      ]
    }
    const steps = parseOrsSteps(json)
    expect(steps).toHaveLength(2)
    expect(steps?.[0]).toMatchObject({ instruction: 'Head north on Canopy Trail', name: 'Canopy Trail' })
    expect(steps?.[1].name).toBeUndefined()
  })
  it('returns undefined when no steps are present', () => {
    expect(parseOsrmSteps({ routes: [{ legs: [{ steps: [] }] }] })).toBeUndefined()
    expect(parseOrsSteps({ features: [{ properties: { segments: [] } }] })).toBeUndefined()
  })
  it('builds provider URLs / profiles', () => {
    const wps: Waypoint[] = [
      { lng: 8.54, lat: 12.37, label: '' },
      { lng: 8.56, lat: 12.38, label: '' }
    ]
    // One FOSSGIS host per travel mode — a walk must not be routed as a car.
    expect(osrmUrl(wps, 'driving')).toContain('/routed-car/route/v1/driving/8.54,12.37;8.56,12.38')
    expect(osrmUrl(wps, 'walking')).toContain('/routed-foot/route/v1/driving/')
    expect(osrmUrl(wps, 'cycling')).toContain('/routed-bike/route/v1/driving/')
    expect(osrmUrl(wps, 'driving')).toContain('steps=true')
    expect(osrmProfileHost('walking')).toBe('routed-foot')
    // The car-only demo server stays as the fallback.
    expect(osrmDemoUrl(wps)).toContain('router.project-osrm.org/route/v1/driving/')
    expect(mapboxDirectionsUrl(wps, 'walking', 'TKN')).toContain('steps=true')
    expect(mapboxDirectionsUrl(wps, 'walking', 'TKN')).toContain('/mapbox/walking/')
    expect(mapboxDirectionsUrl(wps, 'walking', 'TKN')).toContain('access_token=TKN')
    expect(orsProfile('walking')).toBe('foot-walking')
    expect(orsProfile('cycling')).toBe('cycling-regular')
    expect(mapboxProfile('driving')).toBe('driving')
  })
})

describe('elevation', () => {
  it('downsamples while keeping endpoints', () => {
    const line: LngLat[] = Array.from({ length: 200 }, (_, i) => [8.5 + i * 0.001, 12.3])
    const sampled = sampleLineString(line, 50)
    expect(sampled).toHaveLength(50)
    expect(sampled[0]).toEqual(line[0])
    expect(sampled[49]).toEqual(line[199])
  })
  it('builds a profile with ascent/descent', () => {
    const coords: LngLat[] = [
      [8.54, 12.37],
      [8.55, 12.37],
      [8.56, 12.37]
    ]
    const { profile, ascentM, descentM } = buildProfile(coords, [400, 450, 420])
    expect(profile).toHaveLength(3)
    expect(profile[0].distanceM).toBe(0)
    expect(profile[2].distanceM).toBeGreaterThan(profile[1].distanceM)
    expect(ascentM).toBe(50)
    expect(descentM).toBe(30)
  })
})

describe('settings resolver', () => {
  it('applies defaults', () => {
    const s = resolveSettings({})
    expect(s.defaultStyle).toBe('streets')
    expect(s.defaultCenter).toEqual(DEFAULT_CENTER)
    expect(s.defaultZoom).toBe(12)
    expect(s.routingProvider).toBe('osrm')
    expect(s.elevationProvider).toBe('open-elevation')
  })
  it('parses centre + coerces invalid enums', () => {
    const s = resolveSettings({ defaultCenter: '7.44,11.95', defaultZoom: 9, defaultStyle: 'bogus', mapboxEnabled: true, mapboxConnectionId: 'mapbox-1' })
    expect(s.defaultCenter).toEqual([7.44, 11.95])
    expect(s.defaultZoom).toBe(9)
    expect(s.defaultStyle).toBe('streets')
    expect(s.mapboxEnabled).toBe(true)
    expect(s.mapboxConnectionId).toBe('mapbox-1')
  })
})

describe('geocode parsers', () => {
  it('parses Nominatim search rows', () => {
    const hits = parseNominatimSearch([
      { lat: '12.37', lon: '8.54', display_name: 'Fern Reserve' },
      { lat: 'x', lon: 'y', display_name: 'bad' }
    ])
    expect(hits).toEqual([{ name: 'Fern Reserve', lng: 8.54, lat: 12.37 }])
  })
  it('parses Mapbox geocoding features', () => {
    const hits = parseMapboxGeocode({ features: [{ place_name: 'Moss Basin', center: [7.44, 11.95] }] })
    expect(hits).toEqual([{ name: 'Moss Basin', lng: 7.44, lat: 11.95 }])
  })

  it('splits a Nominatim display_name into a short name + its region context', () => {
    const hits = parseNominatimSearch([
      {
        lat: '12.46',
        lon: '8.24',
        name: 'Canopy Station',
        display_name: 'Canopy Station, Canopy District, Fernlands, Biodiversity Reserve'
      }
    ])
    expect(hits).toEqual([
      { name: 'Canopy Station', lng: 8.24, lat: 12.46, context: 'Canopy District, Fernlands, Biodiversity Reserve' }
    ])
  })

  it('falls back to the first display_name segment when Nominatim omits `name`', () => {
    const hits = parseNominatimSearch([
      { lat: '11.23', lon: '7.35', display_name: 'Alpine Meadow, Alpine Habitat, Biodiversity Reserve' }
    ])
    expect(hits).toEqual([{ name: 'Alpine Meadow', lng: 7.35, lat: 11.23, context: 'Alpine Habitat, Biodiversity Reserve' }])
  })

  it('keeps the whole label as the name when the short form is not its prefix', () => {
    const hits = parseNominatimSearch([{ lat: '12.37', lon: '8.54', name: 'Elsewhere', display_name: 'Fern Reserve HB' }])
    expect(hits).toEqual([{ name: 'Elsewhere', lng: 8.54, lat: 12.37, context: 'Fern Reserve HB' }])
  })

  it('splits a Mapbox place_name using its `text` lead', () => {
    const hits = parseMapboxGeocode({
      features: [{ text: 'Moss Basin', place_name: 'Moss Basin, Moss Basin, Biodiversity Reserve', center: [7.44, 11.95] }]
    })
    expect(hits).toEqual([{ name: 'Moss Basin', lng: 7.44, lat: 11.95, context: 'Moss Basin, Biodiversity Reserve' }])
  })

  it('rejoins a split hit into one line', () => {
    expect(fullName({ name: 'Moss Basin', lng: 7.44, lat: 11.95, context: 'Biodiversity Reserve' })).toBe('Moss Basin, Biodiversity Reserve')
    expect(fullName({ name: 'Moss Basin', lng: 7.44, lat: 11.95 })).toBe('Moss Basin')
  })
})

it('resolves separate embed defaults and explicit overrides, falling back to free without a usable account', () => {
  const raw = { defaultStyle: 'outdoors', embedStyle: 'satellite', embedProvider: 'account:mapbox:forest', codeBlockStyle: 'streets', mapboxEnabled: true }
  const connection = { id: 'forest', provider: 'mapbox', secretState: 'ok', capabilities: ['map.style'] }
  const options = parseMapPresentation('48, 12|satellite|mapbox|light')
  expect(options).toEqual({ style: 'satellite', provider: 'mapbox', theme: 'light' })
  expect(parseMapPresentation('style: outdoors\nprovider: mapbox\ntheme: dark')).toEqual({ style: 'outdoors', provider: 'mapbox', theme: 'dark' })
  expect(mapPresentationSettings(raw, 'embed', {}, [connection]).settings).toMatchObject({ defaultStyle: 'satellite', basemapProvider: 'account:mapbox:forest' })
  expect(mapPresentationSettings(raw, 'codeBlock', {}, [connection]).settings.defaultStyle).toBe('streets')
  expect(mapPresentationSettings(raw, 'codeBlock', options, [connection])).toMatchObject({ theme: 'light', settings: { defaultStyle: 'satellite', basemapProvider: 'account:mapbox:forest' } })
  for (const connections of [[], [{ ...connection, secretState: 'missing' }], [{ ...connection, capabilities: ['geo.search'] }]]) {
    expect(mapPresentationSettings(raw, 'embed', {}, connections).settings).toMatchObject({ defaultStyle: 'satellite', basemapProvider: 'free' })
    expect(mapPresentationSettings(raw, 'codeBlock', { style: 'navigation', provider: 'mapbox' }, connections).settings).toMatchObject({ defaultStyle: 'streets', basemapProvider: 'free' })
  }
  expect(mapPresentationSettings({ defaultStyle: 'satellite', embedStyle: 'inherit' }, 'embed', {}, []).settings.defaultStyle).toBe('satellite')
  expect(mapPresentationSettings(raw, 'embed', { provider: 'free' }, [connection]).settings.basemapProvider).toBe('free')
})
