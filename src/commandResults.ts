const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false })
const text = { type: 'string', maxLength: 16384 }
const number = { type: 'number' }
const position = { type: 'integer', minimum: 0 }
const nullable = (schema: unknown) => ({ anyOf: [schema, { type: 'null' }] })
const flag = { type: 'boolean' }
const list = (items: unknown, maxItems = 10000) => ({ type: 'array', items, maxItems })
const lng = { type: 'number', minimum: -180, maximum: 180 }
const lat = { type: 'number', minimum: -90, maximum: 90 }
const mode = { enum: ['driving', 'walking', 'cycling'] }
const point = object({ name: text, lat, lng })
const hit = object({ name: text, lat, lng, context: text }, ['name', 'lat', 'lng'])
const waypoint = object({ label: text, lat, lng, placeId: text, fromLiveLocation: flag }, ['label', 'lat', 'lng'])
const pair = { type: 'array', prefixItems: [lng, lat], items: false, minItems: 2, maxItems: 2 }
const place = object({ id: text, name: text, lat, lng, category: nullable(text), color: nullable(text), note: nullable(text), position, createdAt: text }, ['id', 'name', 'lat', 'lng', 'createdAt'])
const route = object({ id: text, name: text, mode, waypoints: list(waypoint, 100), geometry: nullable(list(pair)), distanceM: nullable(number), durationS: nullable(number), note: nullable(text), position, createdAt: text }, ['id', 'name', 'mode', 'waypoints', 'createdAt'])
const source = object({ id: text, title: text, matchKey: text, matchValue: text, folder: text, locationMode: { enum: ['address', 'coordinate'] }, locationField: text, labelMode: { enum: ['filename', 'property'] }, labelField: text, hoverFields: list(text), color: text, borderColor: text, icon: text, visible: flag, hidden: flag }, ['id', 'title', 'matchKey', 'matchValue', 'locationMode', 'locationField', 'labelMode', 'hoverFields', 'color', 'borderColor', 'icon', 'visible', 'hidden'])
const id = object({ id: text })
const address = object({ lat, lng, address: { anyOf: [text, { type: 'null' }] } })
export const mapCommandResults: Record<string, Record<string, unknown>> = {
  open: { type: 'null' },
  search: object({ query: text, name: text, lat, lng, results: list(hit) }),
  'save-place': place,
  'plan-route': object({ from: text, to: text, via: list(text, 100), mode, distanceM: number, durationS: number, steps: list(object({ instruction: text, distanceM: number, durationS: number })) }, ['from', 'to', 'via', 'mode']),
  goto: object({ lat, lng, zoom: { type: 'number', minimum: 0, maximum: 24 } }),
  describe: address,
  geocode: object({ address: text, ...hit.properties, results: list(hit, 10) }, ['address', 'name', 'lat', 'lng', 'results']),
  'reverse-geocode': address,
  distance: object({ from: point, to: point, straightLineM: number, route: object({ mode, distanceM: number, durationS: number }) }, ['from', 'to', 'straightLineM']),
  'set-style': object({ style: { enum: ['streets', 'satellite', 'navigation', 'outdoors'] } }),
  'clear-route': { type: 'null' },
  'list-places': list(place), 'show-place': place, 'delete-place': place, 'update-place': place,
  'list-routes': list(route), 'save-route': route, 'delete-route': route,
  'list-pin-sources': list(source), 'save-pin-source': source, 'delete-pin-source': id,
  'reorder-pin-sources': list(text), 'set-planner': object({ stops: list(waypoint, 100), mode }),
  'show-route': id, 'export-route': object({ format: { enum: ['gpx', 'geojson'] }, content: { type: 'string', maxLength: 1048576 } }), 'import-route': route,
  'properties-edit': object({ updated: list(text) })
}
export function mapCommandResult(id: string): Record<string, unknown> {
  const schema = mapCommandResults[id]
  if (!schema) throw new Error(`Missing Map result contract: ${id}`)
  return schema
}
