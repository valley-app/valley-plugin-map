import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '../..')
const outer = [[8.025, 47.025], [8.075, 47.025], [8.075, 47.075], [8.025, 47.075], [8.025, 47.025]]
const hole = [[8.04, 47.04], [8.06, 47.04], [8.06, 47.06], [8.04, 47.06], [8.04, 47.04]]
const fixtures = {
  'walk.gpx': '<gpx xmlns="http://www.topografix.com/GPX/1/1"><wpt lon="8.01" lat="47.015"><name>Zürich</name></wpt><trk><trkseg><trkpt lon="8" lat="47"/><trkpt lon="8.03" lat="47.03"/></trkseg><trkseg><trkpt lon="8.07" lat="47.07"/><trkpt lon="8.1" lat="47.1"/></trkseg></trk></gpx>',
  'places.kml': `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Zürich</name><description><![CDATA[<img src=x onerror=alert(1)>]]></description><Point><coordinates>8.01,47.015</coordinates></Point></Placemark><Placemark><LineString><coordinates>8,47 8.1,47.1</coordinates></LineString></Placemark><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>${outer.map(p => p.join(',')).join(' ')}</coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>${hole.map(p => p.join(',')).join(' ')}</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark></Document></kml>`,
  'areas.geojson': JSON.stringify({ type: 'Feature', properties: { name: 'Zürich', description: '<img src=x onerror=alert(1)>' }, geometry: { type: 'GeometryCollection', geometries: [
    { type: 'Point', coordinates: [8.01, 47.015] }, { type: 'LineString', coordinates: [[8, 47], [8.1, 47.1]] }, { type: 'Polygon', coordinates: [outer, hole] }
  ] } })
}
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FileView } from './src/FileView';
import { initRuntime } from './src/runtime';
import { initLocalization } from './src/localization';
import { injectStyles } from './src/styles';
const files = ${JSON.stringify(fixtures)};
const runtime = new Map();
const changes = new Set();
const api = {
  React, getState: () => ({ vault: { path: '/synthetic-map-fixture' } }), subscribeState: () => () => {},
  runtime: { getOrCreate(key, create) { if (!runtime.has(key)) runtime.set(key, create()); return runtime.get(key); } },
  settings: { get: () => ({}), subscribe: () => () => {} },
  ui: { registerCatalogs(catalogs) { this.catalogs = catalogs }, t(key) { return this.catalogs?.en[key] ?? key } },
  assets: { url: () => '/island.js' },
  backend: { async call(method) { if (method !== 'resource') throw Error('Unexpected backend call: ' + method); return { bodyBase64: btoa(JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': document.documentElement.dataset.theme === 'light' ? '#f4f4f4' : '#202024' } }] })) } } },
  vault: { async readFileBaseline(path) { return files[path] === undefined ? null : { content: files[path], baseline: { hash: 'fixture', size: files[path].length, mtimeMs: 0 } }; }, onChanged(listener) { changes.add(listener); return () => changes.delete(listener) } }
};
window.fixtureEngines = [];
let island;
Object.defineProperty(window, 'valleyMapIsland', { get: () => island, set(value) { island = { createMapEngine(...args) { const engine = value.createMapEngine(...args); window.fixtureEngines.push(engine); return engine; } }; } });
const owner = initRuntime(api); initLocalization(api); const disposeStyles = injectStyles();
const reactRoot = createRoot(document.getElementById('root'));
reactRoot.render(React.createElement(React.Fragment, null, ...Object.keys(files).map(relPath => React.createElement('section', { key: relPath }, React.createElement(FileView, { relPath })))));
window.fixture = { files, embed() { reactRoot.render(React.createElement('div', { style: { width: '100%', height: '2200px' } }, React.createElement(FileView, { relPath: 'walk.gpx', embedded: true }), React.createElement('div', { style: { height: '1800px' } }, 'Scroll fixture'))); }, update(path, content) { files[path] = content; for (const change of changes) change({ changes: [{ relPath: path, kind: 'change' }] }); }, async close() { reactRoot.unmount(); disposeStyles(); await owner.dispose(); return { subscriptions: changes.size, maps: window.fixtureEngines.map(engine => engine.map) }; } };
`
const bundle = await build({ absWorkingDir: root, stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', conditions: ['production'], define: { 'process.env.NODE_ENV': '"production"' }, jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', loader: { '.css': 'text', '.svg': 'text' } })
const island = await readFile(path.join(root, 'runtime/assets/island.js'))
const output = await mkdtemp(path.join(tmpdir(), 'map-file-render-'))
const html = theme => `<!doctype html><html data-theme="${theme}"><meta charset="utf-8"><style>
:root { --accent-color:#2563eb; --container-color:${theme === 'light' ? '#fff' : '#28282c'}; --container-color-alt:${theme === 'light' ? '#f5f5f5' : '#222226'}; --text-color:${theme === 'light' ? '#171717' : '#eee'}; --text-secondary:${theme === 'light' ? '#555' : '#aaa'}; --border-light:${theme === 'light' ? '#ddd' : '#444'}; --border-medium:#888; --hover-bg:#8883; --app-bar-height:36px; --radius:6px; --radius-sm:3px; }
html,body,#root { height:100%; margin:0; font:14px system-ui; } #root { display:flex; } section { flex:1; min-width:0; border-right:1px solid var(--border-light); } button { font:inherit; } .map-round-btn:disabled { opacity:.5; }
</style><div id="root"></div><script type="module" src="/viewer.js"></script></html>`
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/island.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(island) }
  else if (url.pathname === '/viewer.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents) }
  else if (url.pathname === '/surface') { res.setHeader('Content-Type', 'text/html'); res.end(html(url.searchParams.get('theme') === 'dark' ? 'dark' : 'light')) }
  else if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(`<html><body style="margin:0"><iframe title="Map plugin sandbox" sandbox="allow-scripts allow-same-origin" src="/surface?theme=${url.searchParams.get('theme') === 'dark' ? 'dark' : 'light'}" style="border:0;width:100vw;height:100vh"></iframe></body></html>`) }
  else { res.statusCode = 404; res.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({ ...(process.env.MAP_TEST_BROWSER_CHANNEL ? { channel: process.env.MAP_TEST_BROWSER_CHANNEL } : {}), headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 800 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort())
  for (const theme of ['light', 'dark']) {
    await page.goto(`${origin}/?theme=${theme}`)
    const frame = await page.locator('iframe').elementHandle().then(handle => handle.contentFrame())
    await frame.waitForFunction(() => window.fixtureEngines.length === 3 && window.fixtureEngines.every(engine => engine.map?.loaded() && !engine.map.isMoving() && engine.map.getSource('sig-file')), null, { timeout: 15000 })
    await frame.evaluate(() => {
      const pin = { relPath: 'Fern.md', sourceId: 'habitats', title: 'Fern', lng: 8.01, lat: 47.015,
        color: '#007a50', borderColor: '#ffffff', icon: 'fern', fields: [],
        iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="24" height="24"><path d="M8 8L40 40M8 40L40 8" stroke="currentColor" stroke-width="4"/></svg>' }
      const engine = window.fixtureEngines[0]
      engine.setSourcePins([pin])
      const marker = document.querySelector('.map-note-marker')
      engine.setSourcePins([{ ...pin }])
      if (marker !== document.querySelector('.map-note-marker')) throw new Error('Unchanged pin was recreated')
      if (!marker.querySelector('svg[viewBox="0 0 48 48"]')) throw new Error('Custom icon missing from marker')
      if (marker.getAttribute('aria-label') !== 'Fern' || marker.tabIndex !== 0) throw new Error('Pin is not keyboard accessible')
      engine.setSourcePins([])
      if (document.querySelector('.map-note-marker')) throw new Error('Removed source left a stale pin')
    })
    const rendered = await frame.evaluate(() => window.fixtureEngines.map(engine => [...new Set(engine.map.queryRenderedFeatures().filter(f => f.source === 'sig-file').map(f => f.geometry.type.replace(/^Multi/, '')))].sort()))
    assert.deepEqual(rendered, [['LineString', 'Point'], ['LineString', 'Point', 'Polygon'], ['LineString', 'Point', 'Polygon']])
    const invisible = await frame.evaluate(() => window.fixtureEngines.flatMap(engine => engine.map.queryRenderedFeatures().filter(f => f.source === 'sig-file' && f.layer.type !== 'circle')
      .filter(f => f.layer.type === 'fill' ? !(f.layer.paint['fill-opacity'] > 0) : !(f.layer.paint['line-opacity'] > 0 && f.layer.paint['line-width'] > 0)).map(f => f.layer.id)))
    assert.deepEqual(invisible, [], 'Unstyled lines and areas must stay visible')
    const holes = await frame.evaluate(() => window.fixtureEngines.slice(1).map(engine => engine.map.queryRenderedFeatures(engine.map.project([8.05, 47.05]), { layers: ['sig-file-fill'] }).length))
    assert.deepEqual(holes, [0, 0], 'Polygon holes must remain unfilled')
    const gaps = await frame.evaluate(() => window.fixtureEngines[0].map.queryRenderedFeatures(window.fixtureEngines[0].map.project([8.05, 47.05]), { layers: ['sig-file-line'] }).length)
    assert.equal(gaps, 0, 'Separate GPX segments must not be connected')
    const coordinate = await frame.evaluate(() => { const map = window.fixtureEngines[1].map; const point = map.project([8.01, 47.015]); const rect = map.getCanvas().getBoundingClientRect(); return { x: rect.x + point.x, y: rect.y + point.y } })
    await page.mouse.click(coordinate.x, coordinate.y)
    await frame.getByRole('complementary', { name: 'Feature details' }).waitFor()
    assert.equal(await frame.locator('.map-file-details img').count(), 0)
    assert.match(await frame.locator('.map-file-details').innerText(), /Zürich/)
    assert.equal(await frame.locator('.map-file-details button').evaluate(button => getComputedStyle(button).opacity), '1')
    await page.screenshot({ path: path.join(output, `${theme}.png`) })
    await frame.locator('.map-file-details button').click()
    assert.equal(await frame.locator('.map-file-details').count(), 0)
    const zooms = await frame.evaluate(() => window.fixtureEngines.map(engine => engine.getZoom()))
    await frame.getByRole('button', { name: 'Zoom in', exact: true }).first().click()
    await frame.waitForFunction(zoom => Math.abs(window.fixtureEngines[0].getZoom() - zoom - 1) < 0.01 && !window.fixtureEngines[0].map.isMoving(), zooms[0])
    assert.deepEqual(await frame.evaluate(() => window.fixtureEngines.slice(1).map(engine => engine.getZoom())), zooms.slice(1))
    const centers = await frame.evaluate(() => window.fixtureEngines.map(engine => engine.getCenter()))
    await page.mouse.move(200, 200); await page.mouse.down(); await page.mouse.move(250, 225, { steps: 8 }); await page.mouse.up()
    await frame.waitForFunction(() => !window.fixtureEngines[0].map.isMoving())
    assert.notDeepEqual(await frame.evaluate(() => window.fixtureEngines[0].getCenter()), centers[0])
    assert.deepEqual(await frame.evaluate(() => window.fixtureEngines.slice(1).map(engine => engine.getCenter())), centers.slice(1))
    await frame.getByRole('button', { name: 'Fit to contents', exact: true }).first().click()
    await frame.waitForFunction(zoom => Math.abs(window.fixtureEngines[0].getZoom() - zoom) < 0.01 && !window.fixtureEngines[0].map.isMoving(), zooms[0])
    await frame.evaluate(() => window.fixture.update('areas.geojson', '{'))
    await frame.getByRole('alert').filter({ hasText: 'invalid geographic data' }).waitFor()
    assert.equal(await frame.evaluate(() => window.fixtureEngines[2].fileData.features.length), 0)
    await frame.evaluate(() => window.fixture.embed())
    await frame.waitForFunction(() => window.fixtureEngines.length === 4 && window.fixtureEngines[3].map?.loaded() && window.fixtureEngines[3].snapshot?.hidden === true)
    const camera = await frame.evaluate(() => ({ center: window.fixtureEngines[3].getCenter(), zoom: window.fixtureEngines[3].getZoom() }))
    await page.mouse.move(200, 150)
    await page.mouse.wheel(0, 650)
    await frame.waitForFunction(() => window.scrollY > 300 && window.fixtureEngines[3].map === null)
    const staticMap = await frame.evaluate(() => {
      const engine = window.fixtureEngines[3]
      const canvas = engine.snapshot?.querySelector('canvas')
      const pixels = canvas?.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      return { visible: engine.snapshot?.hidden === false, painted: pixels && Array.from(pixels).some((value, index) => index % 4 === 3 && value > 0), center: engine.getCenter(), zoom: engine.getZoom() }
    })
    assert.equal(staticMap.visible, true, 'Suspending the map must retain its last visible image')
    assert.equal(staticMap.painted, true, 'The retained map must contain painted pixels, not a cleared WebGL canvas')
    assert.deepEqual({ center: staticMap.center, zoom: staticMap.zoom }, camera)
    await page.mouse.wheel(0, -650)
    await frame.waitForFunction(() => window.scrollY === 0 && window.fixtureEngines[3].map?.loaded() && window.fixtureEngines[3].snapshot?.hidden === true)
    assert.deepEqual(await frame.evaluate(() => ({ center: window.fixtureEngines[3].getCenter(), zoom: window.fixtureEngines[3].getZoom() })), camera)
    await page.screenshot({ path: path.join(output, `${theme}-embed-returned.png`) })
    assert.deepEqual(await frame.evaluate(() => window.fixture.close()), { subscriptions: 0, maps: [null, null, null, null] })
  }
  assert.deepEqual(errors, [])
  process.stdout.write(`Map file rendering passed in light and dark themes. Screenshots: ${output}\n`)
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
