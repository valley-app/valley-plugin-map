import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMockValleyApi, loadPackageWasm } from '@valley/plugin-testkit'
import * as mapFile from '../src/mapFile'
import { readMapFile } from '../src/mapFileReader'

const outer = [[8.025, 47.025], [8.075, 47.025], [8.075, 47.075], [8.025, 47.075], [8.025, 47.025]]
const hole = [[8.04, 47.04], [8.06, 47.04], [8.06, 47.06], [8.04, 47.06], [8.04, 47.04]]
const ring = (r: number[][]) => r.map(p => p.join(',')).join(' ')
function longTrack(n: number): string {
  const points = Array.from({ length: n }, (_, i) => `<trkpt lat="${(47 + i * 1e-5).toFixed(7)}" lon="${(8 + i * 1e-5).toFixed(7)}"><ele>${(400 + Math.sin(i / 50) * 30).toFixed(1)}</ele><time>2026-05-01T08:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z</time></trkpt>`)
  return `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Long</name><trkseg>${points.join('\n')}</trkseg></trk></gpx>`
}

const files = {
  'walk.gpx': '<gpx xmlns="http://www.topografix.com/GPX/1/1"><wpt lon="8.01" lat="47.015"><name>Zürich</name></wpt><trk><trkseg><trkpt lon="8" lat="47"/><trkpt lon="8.03" lat="47.03"/></trkseg><trkseg><trkpt lon="8.07" lat="47.07"/><trkpt lon="8.1" lat="47.1"/></trkseg></trk></gpx>',
  'ns.gpx': `<gps:gpx xmlns:gps="http://www.topografix.com/GPX/1/0"><gps:wpt lon='8' lat='47'><gps:name>Grüezi</gps:name></gps:wpt><gps:trk><gps:name>T</gps:name><gps:trkseg><gps:trkpt lon="8" lat="47"><gps:ele>1</gps:ele></gps:trkpt><gps:trkpt lon="8.1" lat="47.1"/></gps:trkseg></gps:trk></gps:gpx>`,
  'survey.gpx': `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Beech transect</name><desc>Canopy <b>count</b></desc><trkseg>
<trkpt lat="47" lon="8"><ele>400</ele><time>2026-05-01T08:00:00Z</time></trkpt><trkpt lat="47.001" lon="8.001"><ele>410.5</ele><time>2026-05-01T08:10:00Z</time></trkpt><trkpt lat="47.002" lon="8.002"><ele>405</ele></trkpt>
</trkseg></trk></gpx>`,
  'garmin.gpx': `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="Garmin Connect" version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:gpxx="http://www.garmin.com/xmlschemas/GpxExtensions/v3" xmlns:ns3="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <metadata><link href="connect.garmin.com"><text>Garmin Connect</text></link><time>2026-05-01T08:00:00.000Z</time></metadata>
  <trk><name>Morning Ride</name><type>cycling</type><extensions><line xmlns="http://www.topografix.com/GPX/gpx_style/0/2"><color>FF0000</color><opacity>0.5</opacity><width>2</width></line></extensions>
    <trkseg>
      <trkpt lat="47.3769" lon="8.5417"><ele>408.2</ele><time>2026-05-01T08:00:00.000Z</time><extensions><ns3:TrackPointExtension><ns3:hr>96</ns3:hr><ns3:cad>70</ns3:cad></ns3:TrackPointExtension><power>210</power></extensions></trkpt>
      <trkpt lat="47.3770" lon="8.5419"><ele>408.4</ele><time>2026-05-01T08:00:01.000Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>97</gpxtpx:hr><gpxtpx:atemp>21.5</gpxtpx:atemp></gpxtpx:TrackPointExtension><power>abc</power></extensions></trkpt>
      <trkpt lat="47.3771" lon="8.5421"><ele>x</ele><extensions><heart>99</heart></extensions></trkpt>
    </trkseg>
    <trkseg><trkpt lat="47.38" lon="8.55"><time>2026-05-01T09:00:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>100</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt><trkpt lat="47.381" lon="8.551"/></trkseg>
    <trkseg><trkpt lat="47.39" lon="8.56"><ele>500</ele><time>2026-05-01T10:00:00Z</time><name>lonely</name></trkpt></trkseg>
  </trk>
  <rte><name>Plan</name><cmt>c &amp; d</cmt><link href="https://example.com/a"><text>A</text><type>text/html</type></link><link/><rtept lat="47" lon="8"/><rtept lat="47.1" lon="8.1"><ele>12</ele></rtept></rte>
  <rte><rtept lat="46" lon="7"><ele> 3 </ele><time>t</time></rtept></rte>
  <wpt lat="47.5" lon="8.5"><ele>500</ele><name><![CDATA[Gipfel <b>]]></name><sym>Flag</sym><gpxx:WaypointExtension><gpxx:Address>Bahnhofstrasse &#49;</gpxx:Address></gpxx:WaypointExtension></wpt>
  <wpt lat="-0" lon="-0.0"><!-- c --><?pi data?><name>Zero&#x20;point&#13;&#10;</name></wpt>
</gpx>`,
  'empty.gpx': '<gpx/>',
  'places.kml': `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Zürich</name><description><![CDATA[<img src=x onerror=alert(1)>]]></description><Point><coordinates>8.01,47.015</coordinates></Point></Placemark><Placemark><LineString><coordinates>8,47 8.1,47.1</coordinates></LineString></Placemark><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>${ring(outer)}</coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>${ring(hole)}</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark></Document></kml>`,
  'prefixed.kml': `<k:kml xmlns:k="http://www.opengis.net/kml/2.2"><k:Document><k:Folder><k:Placemark><k:name>A</k:name><k:Point><k:coordinates>8,47</k:coordinates></k:Point></k:Placemark></k:Folder></k:Document></k:kml>`,
  'track.kml': `<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:track="http://www.google.com/kml/ext/2.2"><Placemark><name>Run</name><track:MultiTrack><track:Track><when>2026-01-01T00:00:00Z</when><when>2026-01-01T00:01:00Z</when><track:coord>8 47 400</track:coord><track:coord>8.1 47.1 410 5</track:coord></track:Track><track:Track><track:coord>9 48</track:coord></track:Track></track:MultiTrack></Placemark></kml>`,
  'links.kml': '<kml><NetworkLink><Link><href>https://example.com/map.kml</href></Link></NetworkLink><GroundOverlay/><Placemark><Model/></Placemark></kml>',
  'space.kml': '<kml><Placemark><LineString><coordinates>8, 47, 410 9, 48, 420</coordinates></LineString></Placemark></kml>',
  'styles.kml': `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2" xmlns:kml="http://www.opengis.net/kml/2.2">
<Document><name>Styled</name>
  <Style id="red"><LineStyle><color>ff0000ff</color><width>4</width></LineStyle><PolyStyle><color>7f00ff00</color><fill>0</fill><outline>0</outline></PolyStyle><IconStyle><color>#abc</color><scale>1.2</scale><heading>0</heading><hotSpot x="0.5" y="1" xunits="fraction" yunits="fraction"/><Icon><href>https://example.com/i.png</href></Icon></IconStyle><LabelStyle><color>zz00ff00</color><scale>0</scale></LabelStyle></Style>
  <StyleMap id="redmap"><Pair><key>normal</key><styleUrl>#red</styleUrl></Pair><Pair><key>highlight</key><styleUrl>#red</styleUrl></Pair></StyleMap>
  <gx:CascadingStyle kml:id="casc"><Style><LineStyle><color>ffffffff</color></LineStyle></Style></gx:CascadingStyle>
  <Schema name="s" id="s"><SimpleField name="pop" type="int"/><SimpleField name="ok" type="bool"/><SimpleField name="ratio" type="double"/></Schema>
  <Folder><name>F</name>
  <Placemark id="p1"><name>One</name><visibility>0</visibility><open>1</open><address>Somewhere 1</address><phoneNumber>+41</phoneNumber><description>plain <![CDATA[<b>html</b>]]> tail</description><styleUrl>redmap</styleUrl>
    <ExtendedData><Data name="kind"><value>hut</value></Data><Data name="empty"/><SchemaData schemaUrl="#s"><SimpleData name="pop">12</SimpleData><SimpleData name="ok"></SimpleData><SimpleData name="ratio">abc</SimpleData><SimpleData name="free">text</SimpleData><SimpleData name="1">first</SimpleData></SchemaData></ExtendedData>
    <TimeSpan><begin>2026</begin></TimeSpan><TimeStamp><when>2026-02</when></TimeStamp>
    <MultiGeometry><Point><coordinates>8.5,47.5,400</coordinates></Point><LineString><coordinates>8,47 8.1,47.1,5,6</coordinates></LineString><Polygon><outerBoundaryIs><LinearRing><coordinates>8,47 8.1,47 8.1,47.1</coordinates></LinearRing></outerBoundaryIs></Polygon></MultiGeometry>
  </Placemark>
  <Placemark><name>No geometry</name><styleUrl>#casc</styleUrl></Placemark>
  <Placemark><styleUrl>#missing</styleUrl><Style><LineStyle><color>ff00ff</color></LineStyle></Style><LinearRing><coordinates>8,47 8.2,47 8.2,47.2 8,47</coordinates></LinearRing></Placemark>
  <Placemark><Track><when>a</when><coord>8 47</coord><coord>8.1 47.1</coord><coord>8.2 47.2</coord></Track></Placemark>
  <Placemark><Track><gx:coord>8 47</gx:coord></Track></Placemark>
  </Folder>
</Document></kml>`,
  'areas.kml': `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Meadow</name><ExtendedData><Data name="tags"><value>reed, sedge</value></Data></ExtendedData><Polygon><outerBoundaryIs><LinearRing><coordinates>8,47 8.01,47 8.01,47.01 8,47</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`,
  'long.gpx': longTrack(1500),
}
const invalid = {
  'bad1.gpx': '<gpx><trk><trkseg><trkpt lon="8" lat="47"/><trkpt lon="181" lat="48"/></trkseg></trk></gpx>',
  'bad2.gpx': '<gpx><wpt lat="47"/></gpx>',
  'bad3.gpx': '<gpx><wpt lat="47" lon=" "/></gpx>',
  'bad4.gpx': '<gpx><trk><trkseg><trkpt lon="8" lat="47"><ele>1e999</ele></trkpt><trkpt lon="8" lat="47"/></trkseg></trk></gpx>',
  'bad5.gpx': '<gpx><trk><trkseg><trkpt lon="8" lat="47"><ele> </ele></trkpt></trkseg></trk></gpx>',
  'doctype.gpx': '<!DOCTYPE gpx><gpx/>',
  'root.gpx': '<kml/>',
  'parsererror.gpx': '<gpx><parsererror/></gpx>',
  'bad1.kml': '<kml><Placemark><Point><coordinates>8,47 9,48</coordinates></Point></Placemark></kml>',
  'bad2.kml': '<kml><Placemark><LineString><coordinates>8,47</coordinates></LineString></Placemark></kml>',
  'bad3.kml': '<kml><Placemark><Point/></Placemark></kml>',
  'bad4.kml': '<kml><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>8,47 9,47 9,48</coordinates></LinearRing><LinearRing><coordinates>8,47 9,47 9,48</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>',
  'bad5.kml': '<kml><Placemark><Point><coordinates>8,,47</coordinates></Point></Placemark></kml>',
  'bad6.kml': '<kml xmlns:gx="http://www.google.com/kml/ext/2.2"><Placemark><gx:Track><gx:coord>8 x</gx:coord></gx:Track></Placemark></kml>',
  'bad7.kml': '<kml><Placemark><Track><coord>8  47</coord></Track></Placemark></kml>',
}

/** The JavaScript parser's answer: its data, or the error it throws, with key order and -0 kept. */
function reference(path: string, text: string): string {
  try { return JSON.stringify(mapFile.parseMapFile(path, text), (_, v) => Object.is(v, -0) ? '-0' : v) } catch (error) { return `error ${(error as Error).message}` }
}

async function wasm(api: ReturnType<typeof createMockValleyApi>['api'], path: string, text: string): Promise<string> {
  try { return JSON.stringify(await readMapFile(api, path, text), (_, v) => Object.is(v, -0) ? '-0' : v) } catch (error) { return `error ${(error as Error).message}` }
}

let api: ReturnType<typeof createMockValleyApi>['api']
beforeAll(async () => {
  const module = await loadPackageWasm(process.cwd(), 'mapfile')
  api = createMockValleyApi({ manifest: { id: 'map' }, wasm: { modules: [module] } }).api
})

describe('WebAssembly map file reader', () => {
  it.each(Object.entries(files))('%s reads exactly like the JavaScript parser, without falling back', async (path, text) => {
    const fallback = vi.spyOn(mapFile, 'parseMapFile')
    const answer = await wasm(api, path, text)
    expect(fallback).not.toHaveBeenCalled()
    fallback.mockRestore()
    expect(answer).toBe(reference(path, text))
  })

  it.each(Object.entries(invalid))('%s is rejected like the JavaScript parser rejects it', async (path, text) => {
    expect(reference(path, text)).toBe('error file.invalid')
    expect(await wasm(api, path, text)).toBe('error file.invalid')
  })

  it('leaves GeoJSON, prototype keys and hosts without WebAssembly to the JavaScript parser', async () => {
    const prototypeKey = '<kml><Placemark><ExtendedData><Data name="__proto__"><value>x</value></Data></ExtendedData><Point><coordinates>8,47</coordinates></Point></Placemark></kml>'
    for (const [path, text] of [['a.geojson', '{"type":"Point","coordinates":[8,47]}'], ['p.kml', prototypeKey]]) {
      const expected = reference(path, text)
      const fallback = vi.spyOn(mapFile, 'parseMapFile')
      expect(await wasm(api, path, text)).toBe(expected)
      expect(fallback).toHaveBeenCalledTimes(1)
      fallback.mockRestore()
    }
    const bare = createMockValleyApi({ manifest: { id: 'map' } }).api
    expect(await wasm(bare, 'walk.gpx', files['walk.gpx'])).toBe(reference('walk.gpx', files['walk.gpx']))
  })

  it('revives non-finite extension and schema values', async () => {
    const text = '<kml><Schema><SimpleField name="n" type="double"/></Schema><Placemark><ExtendedData><SchemaData><SimpleData name="n">x</SimpleData></SchemaData></ExtendedData><Point><coordinates>8,47</coordinates></Point></Placemark></kml>'
    const data = await readMapFile(api, 'n.kml', text)
    expect(data.collection.features[0].properties?.n).toBeNaN()
  })
})
