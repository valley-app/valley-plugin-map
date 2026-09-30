import { describe, it, expect } from 'vitest'
import { mapFacts, mapPanelSegment, mapServiceFacts } from '../src/metadata'
import { resolveSettings } from '../src/settings'
import type { MapSettings } from '../src/types'

const settings = (raw: Record<string, unknown> = {}): MapSettings => resolveSettings(raw)

function value(facts: ReturnType<typeof mapFacts>, id: string): string {
  const fact = facts.find((f) => f.id === id)
  if (!fact) throw new Error(`no fact ${id}`)
  return fact.value
}

describe('mapFacts', () => {
  it('reports the free OpenStreetMap stack by default', () => {
    const facts = mapFacts(settings())
    expect(value(facts, 'map.basemap')).toContain('CARTO')
    expect(value(facts, 'map.geocoding')).toContain('Nominatim')
    expect(value(facts, 'map.routing')).toContain('FOSSGIS')
  })

  it('reports Mapbox geocoding once a connection is enabled', () => {
    const facts = mapFacts(settings({ mapboxEnabled: true, mapboxConnectionId: 'mapbox-1', searchProvider: 'account:mapbox:mapbox-1' }))
    expect(value(facts, 'map.geocoding')).toBe('Mapbox Places')
  })

  it('says so when Mapbox tiles are selected but unusable — the map falls back silently', () => {
    const facts = mapFacts(settings({ basemapProvider: 'account:mapbox:mapbox-1' }))
    expect(value(facts, 'map.basemap')).toContain('unavailable')
  })

  it('reports the offline archive, which overrides the chosen style', () => {
    const facts = mapFacts(settings({ defaultStyle: 'satellite', offlineBasemapPath: 'maps/ch.pmtiles' }))
    expect(value(facts, 'map.basemap')).toContain('maps/ch.pmtiles')
    const services = mapServiceFacts(settings({ offlineBasemapPath: 'maps/ch.pmtiles' }), 'satellite')
    expect(value(services, 'map.provider')).toBe('PMTiles')
    expect(value(services, 'map.data')).not.toContain('Esri')
  })

  it('reports the current map provider when it differs from the preferred style', () => {
    const preferred = settings({ defaultStyle: 'satellite' })
    const services = mapServiceFacts(preferred, 'streets')
    expect(value(services, 'map.provider')).toBe('CARTO')
    expect(value(services, 'map.data')).toBe('OpenStreetMap')
    expect(value(mapServiceFacts(preferred, 'satellite'), 'map.provider')).toBe('Esri')
  })

  it('reports enabled routing connections and resolves disabled ones to OSRM', () => {
    const connected = { routingProvider: 'account:openrouteservice:ors-1', openRouteServiceConnectionId: 'ors-1', openRouteServiceEnabled: true }
    expect(value(mapServiceFacts(settings(connected)), 'map.routing')).toBe('OpenRouteService')
    expect(value(mapServiceFacts(settings({ ...connected, openRouteServiceEnabled: false })), 'map.routing')).toContain('FOSSGIS OSRM')
  })

  it('reports credential presence and never the credential', () => {
    const facts = mapFacts(settings({ mapboxEnabled: true, mapboxConnectionId: 'mapbox-1', openRouteServiceEnabled: true, openRouteServiceConnectionId: 'ors-1' }))
    const all = facts.map((fact) => fact.value).join(' ')
    expect(all).not.toContain('pk.secret-token')
    expect(all).not.toContain('ors-secret')
    expect(value(facts, 'map.credentials')).toBe('Mapbox: connected · OpenRouteService: connected')
    expect(value(mapFacts(settings()), 'map.credentials')).toBe(
      'Mapbox: off · OpenRouteService: off'
    )
  })

  it('gives every fact a stable namespaced id and an English fallback', () => {
    const facts = mapFacts(settings())
    for (const fact of facts) {
      expect(fact.id.startsWith('map.')).toBe(true)
      expect(fact.label).not.toBe('')
      expect(fact.labelKey).not.toBe('')
    }
    expect(new Set(facts.map((f) => f.id)).size).toBe(facts.length)
  })
})

describe('mapPanelSegment', () => {
  it('claims the plugin’s own tabs and no file type', () => {
    // Declaring a file filter here would put the map's panel on notes; declaring
    // none *without* `pluginTabs` would put it on every file in the vault.
    const segment = mapPanelSegment(() => null)
    expect(segment.pluginTabs).toBe(true)
    expect(segment.extensions).toBeUndefined()
    expect(segment.fileKinds).toBeUndefined()
  })

  it('carries a stable id and a translatable label with an English fallback', () => {
    const segment = mapPanelSegment(() => null)
    expect(segment.id).toBe('map.overview')
    expect(segment.labelKey).toBe('manifest.name')
    expect(segment.label).toBe('Map')
  })

  it('hands the body straight through', () => {
    const body = (): null => null
    expect(mapPanelSegment(body).render).toBe(body)
  })
})
