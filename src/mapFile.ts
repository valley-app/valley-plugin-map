import { gpx, kml } from '@tmcw/togeojson'
import { isValidLngLat, lineLengthMeters } from './geo'
import type { LngLat } from './types'

type FeatureCollection = ReturnType<typeof gpx>
type Feature = FeatureCollection['features'][number]
type Geometry = Feature['geometry']
type Position = Extract<Geometry, { type: 'Point' }>['coordinates']

export interface MapFileData {
  collection: FeatureCollection
  bounds: [LngLat, LngLat] | null
  unsupported: boolean
}

export class MapFileError extends Error {
  constructor(public key: 'file.invalid' | 'file.unsupportedFormat') { super(key) }
}

function invalid(): never { throw new MapFileError('file.invalid') }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}

function position(value: unknown): Position {
  if (!Array.isArray(value) || value.length < 2 || !value.every(v => typeof v === 'number' && Number.isFinite(v)) || !isValidLngLat(value[0], value[1])) invalid()
  return value
}

function sequence(value: unknown, minimum: number): Position[] {
  if (!Array.isArray(value) || value.length < minimum) invalid()
  return value.map(position)
}

function polygon(value: unknown): Position[][] {
  if (!Array.isArray(value) || !value.length) invalid()
  return value.map(raw => {
    const ring = sequence(raw, 4)
    const first = ring[0], last = ring[ring.length - 1]
    if (first.length !== last.length || first.some((v, i) => v !== last[i])) invalid()
    return ring
  })
}

function geometry(raw: unknown): Geometry {
  const value = object(raw)
  switch (value.type) {
    case 'Point': return { type: value.type, coordinates: position(value.coordinates) }
    case 'MultiPoint': return { type: value.type, coordinates: sequence(value.coordinates, 0) }
    case 'LineString': return { type: value.type, coordinates: sequence(value.coordinates, 2) }
    case 'Polygon': return { type: value.type, coordinates: polygon(value.coordinates) }
    case 'MultiLineString':
    case 'MultiPolygon': {
      if (!Array.isArray(value.coordinates)) invalid()
      return value.type === 'MultiLineString'
        ? { type: value.type, coordinates: value.coordinates.map(v => sequence(v, 2)) }
        : { type: value.type, coordinates: value.coordinates.map(polygon) }
    }
    case 'GeometryCollection': {
      if (!Array.isArray(value.geometries)) invalid()
      return { type: value.type, geometries: value.geometries.map(geometry) }
    }
    default: return invalid()
  }
}

function xmlNumber(value: string | null): number {
  if (!value?.trim()) invalid()
  const result = Number(value)
  if (!Number.isFinite(result)) invalid()
  return result
}

function parseXml(text: string, format: 'gpx' | 'kml'): { collection: ReturnType<typeof kml>; unsupported: boolean } {
  const document = new DOMParser().parseFromString(text, 'application/xml')
  if (document.doctype || document.getElementsByTagName('parsererror').length || document.documentElement.localName !== format) invalid()
  const standardNamespace = document.documentElement.namespaceURI
  for (const element of Array.from(document.getElementsByTagName('*'))) {
    const name = element.namespaceURI === standardNamespace ? element.localName
      : element.namespaceURI === 'http://www.google.com/kml/ext/2.2' ? `gx:${element.localName}` : element.tagName
    if (name === element.tagName) continue
    const replacement = document.createElementNS(element.namespaceURI, name)
    for (const attribute of Array.from(element.attributes)) replacement.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value)
    while (element.firstChild) replacement.appendChild(element.firstChild)
    element.replaceWith(replacement)
  }
  let unsupported = false
  if (format === 'kml') {
    for (const name of ['NetworkLink', 'GroundOverlay', 'ScreenOverlay', 'PhotoOverlay', 'Model']) {
      for (const element of Array.from(document.getElementsByTagName(name))) { unsupported = true; element.remove() }
    }
    for (const element of Array.from(document.getElementsByTagName('coordinates'))) {
      const tuples = element.textContent?.trim().replace(/\s*,\s*/g, ',').split(/\s+/) ?? []
      if (!tuples.length) invalid()
      tuples.forEach(tuple => position(tuple.split(',').map(xmlNumber)))
      const kind = element.parentElement?.localName
      if ((kind === 'Point' && tuples.length !== 1) || (kind === 'LineString' && tuples.length < 2) || (kind === 'LinearRing' && tuples.length < 3)) invalid()
      element.textContent = tuples.join(' ')
    }
    for (const name of ['Point', 'LineString', 'LinearRing']) {
      for (const element of Array.from(document.getElementsByTagName(name))) if (!element.getElementsByTagName('coordinates').length) invalid()
    }
    for (const element of Array.from(document.getElementsByTagName('Polygon'))) {
      if (element.getElementsByTagName('outerBoundaryIs').length !== 1) invalid()
      for (const boundary of Array.from(element.children)) {
        if (['outerBoundaryIs', 'innerBoundaryIs'].includes(boundary.localName) && boundary.getElementsByTagName('LinearRing').length !== 1) invalid()
      }
    }
    const trackTimes = new Map<Element, string[][]>()
    for (const track of Array.from(document.getElementsByTagName('gx:Track'))) {
      const coordinates = Array.from(track.getElementsByTagName('gx:coord')).map(element => position((element.textContent?.trim().split(/\s+/) ?? []).map(xmlNumber)))
      if (!coordinates.length) invalid()
      const replacement = document.createElement(coordinates.length === 1 ? 'Point' : 'LineString')
      const values = document.createElement('coordinates')
      values.textContent = coordinates.map(p => p.join(',')).join(' ')
      replacement.appendChild(values)
      let placemark = track.parentElement
      while (placemark && placemark.localName !== 'Placemark') placemark = placemark.parentElement
      if (placemark) {
        const times = Array.from(track.getElementsByTagName('when')).map(element => element.textContent ?? '')
        trackTimes.set(placemark, [...(trackTimes.get(placemark) ?? []), times])
      }
      track.replaceWith(replacement)
    }
    const converted = kml(document)
    Array.from(document.getElementsByTagName('Placemark')).forEach((placemark, index) => {
      const times = trackTimes.get(placemark)
      const feature = converted.features[index]
      if (feature && times?.some(values => values.length)) feature.properties = { ...feature.properties, coordTimes: times.length === 1 ? times[0] : times }
    })
    for (const feature of converted.features) {
      const description = feature.properties?.description
      if (description && typeof description === 'object' && description['@type'] === 'html') feature.properties!.description = String(description.value ?? '')
    }
    return { collection: converted, unsupported }
  }
  for (const name of ['wpt', 'rtept', 'trkpt']) {
    for (const element of Array.from(document.getElementsByTagName(name))) {
      position([xmlNumber(element.getAttribute('lon')), xmlNumber(element.getAttribute('lat'))])
    }
  }
  const converted = gpx(document)
  for (const name of ['trkseg', 'rte']) {
    for (const element of Array.from(document.getElementsByTagName(name))) {
      const points = element.getElementsByTagName(name === 'trkseg' ? 'trkpt' : 'rtept')
      if (points.length !== 1) continue
      const point = points[0]
      const coordinates = [xmlNumber(point.getAttribute('lon')), xmlNumber(point.getAttribute('lat'))]
      const elevation = point.getElementsByTagName('ele')[0]?.textContent
      if (elevation) coordinates.push(xmlNumber(elevation))
      converted.features.push({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties: {
        name: (name === 'trkseg' ? element.parentElement : element)?.getElementsByTagName('name')[0]?.textContent ?? '',
        time: point.getElementsByTagName('time')[0]?.textContent ?? '', _gpxType: name === 'trkseg' ? 'trk' : 'rte'
      } })
    }
  }
  return { collection: converted, unsupported }
}

export function parseMapFile(path: string, text: string): MapFileData {
  const format = path.split('.').at(-1)?.toLowerCase()
  if (format !== 'gpx' && format !== 'kml' && format !== 'geojson') throw new MapFileError('file.unsupportedFormat')
  const collection: FeatureCollection = { type: 'FeatureCollection', features: [] }
  let bounds: MapFileData['bounds'] = null
  let unsupported = false
  function visitCoordinates(value: unknown): void {
    if (!Array.isArray(value) || !value.length) return
    if (typeof value[0] !== 'number') { value.forEach(visitCoordinates); return }
    const [lng, lat] = value as Position
    if (!bounds) bounds = [[lng, lat], [lng, lat]]
    else {
      bounds[0][0] = Math.min(bounds[0][0], lng); bounds[0][1] = Math.min(bounds[0][1], lat)
      bounds[1][0] = Math.max(bounds[1][0], lng); bounds[1][1] = Math.max(bounds[1][1], lat)
    }
  }
  function add(shape: Geometry, properties: Feature['properties'], id?: Feature['id']): void {
    if (shape.type === 'GeometryCollection') { shape.geometries.forEach(g => add(g, properties, id)); return }
    visitCoordinates(shape.coordinates)
    collection.features.push({ type: 'Feature', geometry: shape, properties, ...(id === undefined ? {} : { id }) })
  }
  function feature(raw: unknown): void {
    const value = object(raw)
    if (value.type !== 'Feature' || !('geometry' in value) || !('properties' in value)) invalid()
    const properties = value.properties === null ? null : object(value.properties)
    if (value.id !== undefined && typeof value.id !== 'string' && typeof value.id !== 'number') invalid()
    if (value.geometry !== null) add(geometry(value.geometry), properties, value.id as Feature['id'])
  }
  try {
    const clean = text.replace(/^\uFEFF/, '')
    if (!clean.trim()) return { collection, bounds, unsupported }
    let parsed: unknown
    if (format === 'geojson') parsed = JSON.parse(clean)
    else { const xml = parseXml(clean, format); parsed = xml.collection; unsupported = xml.unsupported }
    const root = object(parsed)
    if (root.crs !== undefined) invalid()
    if (root.type === 'FeatureCollection') {
      if (!Array.isArray(root.features)) invalid()
      root.features.forEach(feature)
    } else if (root.type === 'Feature') feature(root)
    else add(geometry(root), {})
    return { collection, bounds, unsupported }
  } catch (error) {
    if (error instanceof MapFileError) throw error
    return invalid()
  }
}

export type MapFileFeature = Feature
export type MapFileFeatureKind = 'point' | 'points' | 'line' | 'lines' | 'area' | 'areas'

/** What the details card says about one feature, before it is localized. */
export interface MapFileFeatureSummary {
  name: string
  kind: MapFileFeatureKind
  /** A single point's `[lng, lat, elevation?]`. */
  position?: Position
  vertices: number
  lengthMeters?: number
  ascentMeters?: number
  descentMeters?: number
  start?: string
  end?: string
  /** Authored properties worth reading, in file order, as display text. */
  properties: Array<[string, string]>
}

// Converter bookkeeping and simplestyle paint are drawn, not read: a details
// card listing `stroke-opacity` or a track's per-point times is noise.
const INTERNAL_PROPERTIES = new Set(['name', 'title', '_gpxType', 'styleUrl', 'styleHash', 'styleMapHash', 'coordinateProperties', 'coordTimes', 'time', 'timestamp'])
const STYLE_PROPERTY = /^(stroke|fill|icon|marker|label|line|circle|symbol)(-|$)/

function lines(shape: Geometry): Position[][] {
  if (shape.type === 'LineString') return [shape.coordinates]
  if (shape.type === 'MultiLineString') return shape.coordinates
  if (shape.type === 'Polygon') return shape.coordinates.slice(0, 1)
  if (shape.type === 'MultiPolygon') return shape.coordinates.map(polygon => polygon[0]).filter(Boolean)
  return []
}

function times(properties: Record<string, unknown>): string[] {
  const nested = (properties.coordinateProperties as Record<string, unknown> | undefined)?.times ?? properties.coordTimes
  const flat = Array.isArray(nested) ? nested.flat(2) : typeof properties.time === 'string' ? [properties.time] : []
  return flat.filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
}

/** Markup in a description reads as its text; a detached document never loads or runs anything. */
function plainText(value: string): string {
  if (!/<[a-z!/]/i.test(value)) return value.trim()
  return (new DOMParser().parseFromString(value, 'text/html').body.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function propertyText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return plainText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value) && value.every(entry => ['string', 'number', 'boolean'].includes(typeof entry))) return value.join(', ')
  return JSON.stringify(value)
}

export function summarizeMapFeature(feature: Feature): MapFileFeatureSummary {
  const shape = feature.geometry
  const properties = (feature.properties ?? {}) as Record<string, unknown>
  const kind: MapFileFeatureKind = shape.type === 'Point' ? 'point' : shape.type === 'MultiPoint' ? 'points'
    : shape.type === 'LineString' ? 'line' : shape.type === 'MultiLineString' ? 'lines'
      : shape.type === 'Polygon' ? 'area' : 'areas'
  const name = propertyText(properties.name ?? properties.title)
  const paths = kind === 'line' || kind === 'lines' ? lines(shape) : []
  const vertices = shape.type === 'Point' ? 1 : shape.type === 'MultiPoint' ? shape.coordinates.length
    : lines(shape).reduce((total, path) => total + path.length, 0)
  let ascent = 0, descent = 0, climbs = false
  for (const path of paths) {
    for (let index = 1; index < path.length; index++) {
      const before = path[index - 1][2], after = path[index][2]
      if (typeof before !== 'number' || typeof after !== 'number') continue
      climbs = true
      if (after > before) ascent += after - before
      else descent += before - after
    }
  }
  const stamps = times(properties).sort()
  return {
    name,
    kind,
    ...(shape.type === 'Point' ? { position: shape.coordinates } : {}),
    vertices,
    ...(paths.length ? { lengthMeters: paths.reduce((total, path) => total + lineLengthMeters(path.map(([lng, lat]) => [lng, lat] as LngLat)), 0) } : {}),
    ...(climbs ? { ascentMeters: ascent, descentMeters: descent } : {}),
    ...(stamps.length ? { start: stamps[0], end: stamps[stamps.length - 1] } : {}),
    properties: Object.entries(properties)
      .filter(([key]) => !INTERNAL_PROPERTIES.has(key) && !STYLE_PROPERTY.test(key))
      .map(([key, value]) => [key, propertyText(value)] as [string, string])
      .filter(([, value]) => value !== '')
  }
}
