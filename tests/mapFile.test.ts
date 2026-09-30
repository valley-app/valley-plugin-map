import { describe, expect, it } from 'vitest'
import { parseMapFile, summarizeMapFeature } from '../src/mapFile'

const readJson = (value: unknown) => parseMapFile('data.GEOJSON', JSON.stringify(value))
const ring = [[8, 47], [9, 47], [9, 48], [8, 47]]
const hole = [[8.2, 47.2], [8.4, 47.2], [8.4, 47.4], [8.2, 47.2]]

describe('GeoJSON file parsing', () => {
  it('renders all standard geometries and preserves holes, altitude, IDs, and properties', () => {
    const geometries = [
      { type: 'Point', coordinates: [8, 47, 410] },
      { type: 'MultiPoint', coordinates: [[8, 47], [9, 48]] },
      { type: 'LineString', coordinates: [[8, 47], [9, 48]] },
      { type: 'MultiLineString', coordinates: [[[8, 47], [9, 48]], [[10, 49], [11, 50]]] },
      { type: 'Polygon', coordinates: [ring, hole] },
      { type: 'MultiPolygon', coordinates: [[ring, hole], [[[10, 49], [11, 49], [11, 50], [10, 49]]]] }
    ]
    const data = readJson({ type: 'Feature', id: 'original', properties: { name: 'Zürich & 湖', nested: { time: '2026-09-21' } }, geometry: {
      type: 'GeometryCollection', geometries: [...geometries, { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [-5, -10] }] }]
    } })
    expect(data.collection.features).toHaveLength(7)
    expect(data.collection.features.slice(0, 6).map(f => f.geometry)).toEqual(geometries)
    expect(data.collection.features.every(f => f.id === 'original' && f.properties?.name === 'Zürich & 湖')).toBe(true)
    expect(data.bounds).toEqual([[-5, -10], [11, 50]])
  })

  it('accepts bare geometries, empty collections, null geometries, and a UTF-8 BOM', () => {
    expect(readJson({ type: 'Point', coordinates: [0, 0] }).bounds).toEqual([[0, 0], [0, 0]])
    expect(readJson({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null, properties: null }] }).bounds).toBeNull()
    expect(parseMapFile('empty.geojson', '\uFEFF {"type":"FeatureCollection","features":[]}').collection.features).toEqual([])
    expect(parseMapFile('empty.gpx', ' \n').bounds).toBeNull()
  })

  it.each([
    { type: 'Point', coordinates: ['8', 47] },
    { type: 'Point', coordinates: [181, 47] },
    { type: 'Point', coordinates: [8, 91] },
    { type: 'LineString', coordinates: [[8, 47], [null, 48], [9, 49]] },
    { type: 'LineString', coordinates: [[8, 47]] },
    { type: 'Polygon', coordinates: [ring.slice(0, -1)] },
    { type: 'Polygon', coordinates: [ring, [[8, 47]]] },
    { type: 'GeometryCollection', geometries: [null] },
    { type: 'FeatureCollection', features: [{}] },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: [] },
    { type: 'Point', coordinates: [8, 47], crs: { type: 'name', properties: { name: 'EPSG:3857' } } }
  ])('rejects invalid data rather than joining across missing coordinates: %j', value => {
    expect(() => readJson(value)).toThrow('file.invalid')
  })
  it('rejects malformed JSON and non-finite coordinates', () => {
    expect(() => parseMapFile('bad.geojson', '{')).toThrow('file.invalid')
    expect(() => parseMapFile('bad.geojson', '{"type":"Point","coordinates":[1e999,0]}')).toThrow('file.invalid')
    expect(() => parseMapFile('bad.json', '{}')).toThrow('file.unsupportedFormat')
  })
})

describe('GPX file parsing', () => {
  it('preserves multiple routes, disconnected segments, waypoints, names, elevation, and time', () => {
    const data = parseMapFile('walk.gpx', `<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
      <wpt lat="47" lon="8"><name>Zürich &amp; 湖</name><ele>410</ele></wpt>
      <rte><name>Route</name><rtept lat="46" lon="7"/><rtept lat="47" lon="8"/></rte>
      <trk><name>Track</name><trkseg><trkpt lat="47" lon="8"><time>2026-09-21T10:00:00Z</time></trkpt><trkpt lat="48" lon="9"/></trkseg>
      <trkseg><trkpt lat="49" lon="10"/><trkpt lat="50" lon="11"/></trkseg></trk>
      <trk><name>Single</name><trkseg><trkpt lat="51" lon="12"/></trkseg></trk>
    </gpx>`)
    expect(data.collection.features).toHaveLength(4)
    expect(data.collection.features[0].geometry).toEqual({ type: 'MultiLineString', coordinates: [[[8, 47], [9, 48]], [[10, 49], [11, 50]]] })
    expect(data.collection.features[0].properties?.coordinateProperties).toBeDefined()
    expect(data.collection.features[2]).toMatchObject({ properties: { name: 'Zürich & 湖' }, geometry: { coordinates: [8, 47, 410] } })
    expect(data.collection.features[3].geometry).toEqual({ type: 'Point', coordinates: [12, 51] })
  })
  it('accepts namespace prefixes and single-quoted attributes', () => {
    expect(parseMapFile('walk.GPX', `<gps:gpx xmlns:gps="http://www.topografix.com/GPX/1/0"><gps:wpt lon='8' lat='47'><gps:name>Grüezi</gps:name></gps:wpt></gps:gpx>`).collection.features[0].properties?.name).toBe('Grüezi')
  })
  it.each(['', 'bad', '8oops', '181'])('rejects invalid longitude %j before the converter can drop it', lon => {
    expect(() => parseMapFile('walk.gpx', `<gpx><trk><trkseg><trkpt lon="8" lat="47"/><trkpt lon="${lon}" lat="48"/><trkpt lon="9" lat="49"/></trkseg></trk></gpx>`)).toThrow('file.invalid')
  })
})

describe('KML file parsing', () => {
  it('renders namespaced MultiGeometry, polygons with holes, and ExtendedData as text', () => {
    const data = parseMapFile('places.kml', `<k:kml xmlns:k="http://www.opengis.net/kml/2.2"><k:Document><k:Folder><k:Placemark>
      <k:name>Zürich</k:name><k:description><![CDATA[<img src=x onerror=alert(1)>]]></k:description>
      <k:ExtendedData><k:Data name="category"><k:value>Park</k:value></k:Data></k:ExtendedData>
      <k:MultiGeometry><k:Point><k:coordinates>8,47,410</k:coordinates></k:Point><k:Polygon>
      <k:outerBoundaryIs><k:LinearRing><k:coordinates>8,47 9,47 9,48 8,47</k:coordinates></k:LinearRing></k:outerBoundaryIs>
      <k:innerBoundaryIs><k:LinearRing><k:coordinates>8.2,47.2 8.4,47.2 8.4,47.4 8.2,47.2</k:coordinates></k:LinearRing></k:innerBoundaryIs>
      </k:Polygon></k:MultiGeometry></k:Placemark></k:Folder></k:Document></k:kml>`)
    expect(data.collection.features).toHaveLength(2)
    expect(data.collection.features[1].geometry).toEqual({ type: 'Polygon', coordinates: [ring, hole] })
    expect(data.collection.features[0].properties).toMatchObject({ name: 'Zürich', category: 'Park', description: '<img src=x onerror=alert(1)>' })
  })
  it('preserves two-point gx tracks, separate tracks, altitude, and timestamps', () => {
    const data = parseMapFile('track.kml', `<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:track="http://www.google.com/kml/ext/2.2"><Placemark><track:MultiTrack>
      <track:Track><when>2026-09-21T10:00:00Z</when><when>2026-09-21T11:00:00Z</when><track:coord>8 47 410</track:coord><track:coord>9 48 420</track:coord></track:Track>
      <track:Track><track:coord>10 49 430</track:coord><track:coord>11 50 440</track:coord></track:Track>
    </track:MultiTrack></Placemark></kml>`)
    expect(data.collection.features.map(f => f.geometry)).toEqual([
      { type: 'LineString', coordinates: [[8, 47, 410], [9, 48, 420]] }, { type: 'LineString', coordinates: [[10, 49, 430], [11, 50, 440]] }
    ])
    expect(data.collection.features[0].properties?.coordTimes).toEqual([['2026-09-21T10:00:00Z', '2026-09-21T11:00:00Z'], []])
  })
  it('reports and removes linked content, overlays, and models', () => {
    const data = parseMapFile('links.kml', '<kml><NetworkLink><Link><href>https://example.com/map.kml</href></Link></NetworkLink><GroundOverlay/><Placemark><Model/></Placemark></kml>')
    expect(data.unsupported).toBe(true)
    expect(data.bounds).toBeNull()
  })
  it('normalizes whitespace inside coordinate tuples before conversion', () => {
    expect(parseMapFile('space.kml', '<kml><Placemark><LineString><coordinates>8, 47, 410 9, 48, 420</coordinates></LineString></Placemark></kml>').collection.features[0].geometry).toEqual({ type: 'LineString', coordinates: [[8, 47, 410], [9, 48, 420]] })
  })
  it.each([
    '<kml>', '<gpx/>', '<!DOCTYPE kml [<!ENTITY x "data">]><kml/>',
    '<kml><Placemark><Point/></Placemark></kml>',
    '<kml><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>8,47 9,47 9,48 8,47</coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs/></Polygon></Placemark></kml>',
    '<kml><Placemark><LineString><coordinates>8,47 bad,48 9,49</coordinates></LineString></Placemark></kml>',
    '<kml><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>8,47 9,48</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>'
  ])('rejects malformed XML and invalid geometry: %s', xml => {
    expect(() => parseMapFile('invalid.kml', xml)).toThrow('file.invalid')
  })
})

describe('feature details', () => {
  it('measures a timed GPX track and hides converter bookkeeping', () => {
    const data = parseMapFile('survey.gpx', `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Beech transect</name><desc>Canopy <b>count</b></desc><trkseg>
      <trkpt lat="47.0" lon="8.0"><ele>400</ele><time>2026-05-16T09:00:00Z</time></trkpt>
      <trkpt lat="47.001" lon="8.0"><ele>430</ele><time>2026-05-16T09:10:00Z</time></trkpt>
      <trkpt lat="47.002" lon="8.0"><ele>420</ele><time>2026-05-16T09:20:00Z</time></trkpt></trkseg></trk></gpx>`)
    const summary = summarizeMapFeature(data.collection.features[0])
    expect(summary).toMatchObject({ name: 'Beech transect', kind: 'line', vertices: 3, ascentMeters: 30, descentMeters: 10, start: '2026-05-16T09:00:00Z', end: '2026-05-16T09:20:00Z' })
    expect(summary.lengthMeters).toBeCloseTo(222.4, 0)
    expect(summary.properties).toEqual([['desc', 'Canopy count']])
  })

  it('keeps authored KML fields but drops style paint, and reads markup as inert text', () => {
    const data = parseMapFile('meadow.kml', `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Style id="s"><IconStyle><color>ff2f6fd8</color></IconStyle></Style>
      <Placemark><name>Orchid meadow</name><styleUrl>#s</styleUrl><description><![CDATA[<img src=x onerror="alert(1)"><i>Ophrys</i> survey]]></description>
      <ExtendedData><Data name="species"><value>12</value></Data></ExtendedData><Point><coordinates>8.5,47.3,410</coordinates></Point></Placemark></Document></kml>`)
    const feature = data.collection.features[0]
    expect(feature.properties).toMatchObject({ 'icon-color': expect.any(String) })
    const summary = summarizeMapFeature(feature)
    expect(summary).toMatchObject({ name: 'Orchid meadow', kind: 'point', position: [8.5, 47.3, 410], vertices: 1 })
    expect(summary.properties).toEqual([['description', 'Ophrys survey'], ['species', '12']])
  })

  it('names multi-part and area shapes and lists plain values', () => {
    const area = readJson({ type: 'Feature', properties: { name: 'Wetland', tags: ['reed', 'sedge'], stroke: '#00ff00', 'fill-opacity': 0.4 }, geometry: { type: 'Polygon', coordinates: [ring] } })
    expect(summarizeMapFeature(area.collection.features[0])).toMatchObject({ kind: 'area', vertices: 4, properties: [['tags', 'reed, sedge']] })
    expect(summarizeMapFeature(area.collection.features[0]).lengthMeters).toBeUndefined()
    const points = readJson({ type: 'Feature', properties: null, geometry: { type: 'MultiPoint', coordinates: [[8, 47], [9, 48]] } })
    expect(summarizeMapFeature(points.collection.features[0])).toMatchObject({ name: '', kind: 'points', vertices: 2, properties: [] })
  })
})

