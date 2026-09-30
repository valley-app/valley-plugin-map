import {
  createAgentToolProvider,
  type AgentToolExecutionContext,
  type AgentToolProvider,
  type ValleyPluginApi
} from '@valley/plugin-sdk'

const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object', properties, required, additionalProperties: false
})
const text = (description: string) => ({ type: 'string', description })
const str = (value: unknown) => value == null ? '' : String(value)

async function execute(api: ValleyPluginApi, id: string, input: unknown, context?: AgentToolExecutionContext): Promise<unknown> {
  const result = await api.commands.executeOwn(id, input, { ...context, autonomous: true })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

const render = (value: unknown): string => value === undefined ? 'Done.' : JSON.stringify(value, null, 2)

export function mapAgentTools(api: ValleyPluginApi): AgentToolProvider {
  return createAgentToolProvider([
    {
      name: 'map_view',
      description: 'Open the map, search a place, go to or describe coordinates, change style, or clear a route.',
      parameters: schema({
        action: { type: 'string', enum: ['open', 'search', 'goto', 'describe', 'style', 'clear_route'] },
        query: text('Place or address'), lat: { type: 'number' }, lng: { type: 'number' },
        zoom: { type: 'number' }, style: { type: 'string', enum: ['streets', 'satellite', 'navigation', 'outdoors'] }
      }, ['action']),
      sideEffect: 'read', commandDispatch: 'dynamic', timeoutMs: 120_000,
      run: async (args, context) => {
        const action = str(args.action)
        const id = action === 'clear_route' ? 'clear-route' : action === 'style' ? 'set-style' : action
        const input = action === 'search' ? { query: str(args.query) }
          : action === 'goto' ? { lat: args.lat, lng: args.lng, zoom: args.zoom }
            : action === 'describe' ? { lat: args.lat, lng: args.lng }
              : action === 'style' ? { style: str(args.style) } : undefined
        return render(await execute(api, id, input, context))
      }
    },
    {
      name: 'map_lookup',
      description: 'Answer a location question without changing the map: address → coordinates (geocode), coordinates → address (reverse), or the distance between two points (distance; add mode for travel distance and time). Points are an address, "lat, lng", or a saved place name. Returns JSON; distances in metres, durations in seconds.',
      parameters: schema({
        action: { type: 'string', enum: ['geocode', 'reverse', 'distance'] },
        address: text('Address or place to geocode'), limit: { type: 'integer', minimum: 1, maximum: 10 },
        lat: { type: 'number' }, lng: { type: 'number' },
        from: text('Start: address, "lat, lng", or saved place'), to: text('End: address, "lat, lng", or saved place'),
        mode: { type: 'string', enum: ['driving', 'walking', 'cycling'] }
      }, ['action']),
      sideEffect: 'read', commandDispatch: 'dynamic', timeoutMs: 120_000,
      run: async (args, context) => {
        const action = str(args.action)
        if (action === 'reverse') return render(await execute(api, 'reverse-geocode', { lat: args.lat, lng: args.lng }, context))
        if (action === 'distance') return render(await execute(api, 'distance', { from: str(args.from), to: str(args.to), ...(args.mode ? { mode: str(args.mode) } : {}) }, context))
        return render(await execute(api, 'geocode', { address: str(args.address), ...(args.limit ? { limit: args.limit } : {}) }, context))
      }
    },
    {
      name: 'map_route', description: 'Plan a route and return its distance, duration, and directions.',
      parameters: schema({
        to: text('Destination'), from: text('Optional origin'),
        via: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        mode: { type: 'string', enum: ['driving', 'walking', 'cycling'] }
      }, ['to']),
      sideEffect: 'read', commandId: 'plan-route', timeoutMs: 120_000,
      run: async (args, context) => render(await execute(api, 'plan-route', args, context))
    },
    {
      name: 'map_places', description: 'List, show, save, update, or delete saved map places.',
      parameters: schema({
        action: { type: 'string', enum: ['list', 'show', 'save', 'update', 'delete'] },
        name: text('Name this place'), newName: text('New name'), lat: { type: 'number' },
        lng: { type: 'number' }, note: text('Optional note')
      }, ['action']),
      sideEffect: 'write', commandDispatch: 'dynamic', timeoutMs: 120_000,
      run: async (args, context) => {
        const ids: Record<string, string> = {
          list: 'list-places', show: 'show-place', save: 'save-place', update: 'update-place', delete: 'delete-place'
        }
        const action = str(args.action)
        return render(await execute(api, ids[action] ?? 'list-places', args, context))
      }
    },
    {
      name: 'map_routes', description: 'List, save, or delete saved map routes.',
      parameters: schema({ action: { type: 'string', enum: ['list', 'save', 'delete'] }, name: text('Route name') }, ['action']),
      sideEffect: 'write', commandDispatch: 'dynamic', timeoutMs: 120_000,
      run: async (args, context) => {
        const ids: Record<string, string> = { list: 'list-routes', save: 'save-route', delete: 'delete-route' }
        return render(await execute(api, ids[str(args.action)] ?? 'list-routes', { name: str(args.name) }, context))
      }
    }
  ])
}
