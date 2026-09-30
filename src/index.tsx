/**
 * Map — a plugin for favorite places and route planning. Three views:
 * `map.panel` (left_sidebar: favourite places + routes), `map.page`
 * (main_workspace: the interactive MapLibre map) and `map.planner`
 * (right_sidebar: the A → B → via route planner with travel modes, distance/ETA
 * and an elevation profile). Renders on free OpenStreetMap data via MapLibre (no
 * token); a Mapbox token in settings upgrades tiles/geocoding/directions.
 *
 * It also contributes a `map` markdown code-block (inline mini-maps in notes) and
 * `map:*` command-bus commands (⌘P / CLI / assistant). All state lives in the
 * session-scoped store; everything registered here is dropped on unload.
 */
import { initializeMapIcons } from './pinIcons'
import codeBlockExamples from './codeBlockExamples.json'
import type { ValleyPluginApi, ValleyPluginModule } from '@valley/plugin-sdk'
import { AGENT_TOOL_PROVIDER_V1, GEO_NAVIGATOR_V1, GEO_SEARCH_V1, PLUGIN_METADATA_V1 } from '@valley/plugin-sdk'
import { mapMetadataProvider } from './metadata'
import { registerMapDetails } from './workspaceDetails'
import { registerMapSurfaces } from './surfaces'
import { registerMapAutomation } from './automation'
import { resolveSettings } from './settings'
import { captureMapRenderOwner } from './runtime'
import { injectStyles } from './styles'
import { createStore, disposeStore } from './store'
import { openOnMap, registerMapboxCommands } from './commands'
import { renderMapFence } from './mapEmbed'
import { MapDashboardRow } from './DashboardRow'
import { Panel } from './Panel'
import { Page } from './Page'
import { FileView } from './FileView'
import { Planner } from './Planner'
import { Settings } from './SettingsView'
import { initLocalization } from './localization'
import { mapAgentTools } from './agentTools'

export function register(api: ValleyPluginApi): () => Promise<void> {
  initLocalization(api)
  const disposeStyles = injectStyles()

  const disposeIcons = initializeMapIcons(api)
  const store = createStore(api)
  const renderOwner = captureMapRenderOwner(api)
  let disposal: Promise<void> | undefined
  const offOwnLink = api.workspace.onOpenOwnLink((state) => {
    store.applyLinkState(state)
  })

  api.registerView('map.panel', Panel)
  api.registerView('map.page', Page)
  api.registerView('map.file', FileView)
  api.registerView('map.planner', Planner)
  api.registerView('map.settings', Settings)

  const offCommands = registerMapboxCommands(api)
  const offAgentTools = api.interop.services.provide(AGENT_TOOL_PROVIDER_V1, mapAgentTools(api))
  const offFence = api.markdown.registerCodeBlockRenderer('map', (code, element, context) => renderMapFence(code, element, api, context.meta ?? ''), { examples: codeBlockExamples.map })
  const offDashRow = api.ui.registerDashboardRow('map', MapDashboardRow)

  // Which tile server, geocoder and router this map is really using — read at
  // render time, so changing the style in settings changes what Metadata says.
  const offMetadata = api.interop.extensions.provide(
    PLUGIN_METADATA_V1,
    mapMetadataProvider(() => resolveSettings(api.settings.get()))
  )

  const offDetails = registerMapDetails(api, store)
  const offSurfaces = registerMapSurfaces(api)
  const offAutomation = registerMapAutomation(api)
  const offGeoNavigator = api.interop.services.provide(GEO_NAVIGATOR_V1, { open: openOnMap(api) })
  const offLinkHandler = api.links.register({
    id: 'reveal', label: api.ui.t('manifest.name'), version: '1.0.0', categories: ['location'],
    open: async ({ value }) => {
      const protocol = /^(?:geo|maps):/i.test(value) ? new URL(value) : null
      const query = protocol ? protocol.searchParams.get('q') ?? (protocol.protocol === 'geo:' ? decodeURIComponent(protocol.pathname.split(';')[0]) : '') : value
      if (!query) return { status: 'failed' }
      await openOnMap(api)({ query })
      return { status: 'opened' }
    }
  })

  // The lookup half of the same capability: another plugin attaches a real
  // place to its own records without owning a geocoder, a token, or the CSP
  // entry for one. It rides on this plugin's configured provider, so a Mapbox
  // token set here upgrades every consumer at once.
  const offGeoSearch = api.interop.services.provide(GEO_SEARCH_V1, {
    search: async (query) => {
      try {
        return await store.lookupPlaces(query)
      } catch {
        // A geocoder outage or a 429 is not the consumer's problem to model —
        // no hits reads the same as no matches, and the field stays usable.
        return []
      }
    },
    reverse: async (lng, lat) => {
      const label = await store.lookupAddress(lng, lat)
      return label ? { name: label, lng, lat } : null
    }
  })
  const offPlaceResources = api.resources.provide({
    kinds: ['place'],
    search: async (request) => {
      if (!request.kinds.includes('place') || request.query.trim().length < 2) return []
      const places = await store.lookupPlaces(request.query)
      return places.map((place) => ({
        id: `${place.lng},${place.lat}`,
        kind: 'place',
        label: place.name,
        description: place.context,
        value: place.context ? `${place.name}, ${place.context}` : place.name,
        metadata: { longitude: place.lng, latitude: place.lat }
      }))
    }
  })

  return () => {
    if (disposal) return disposal
    disposeIcons()
    offOwnLink()
    offPlaceResources()
    offGeoSearch()
      offGeoNavigator()
      offLinkHandler()
    offDetails()
    offSurfaces()
    offAutomation()
    offMetadata()
    offDashRow()
    offFence()
    offCommands()
    offAgentTools()
    const drained = disposeStore(store)
    disposeStyles()
    return disposal = Promise.allSettled([drained, renderOwner.dispose()]).then(results => {
      const failed = results.find(result => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    })
  }
}

const plugin: ValleyPluginModule = { register }
export default plugin
