import { React, captureMapRenderOwner } from './runtime'
import type { DashboardRowProps, PluginRow } from '@valley/plugin-sdk'
import type { MapEngine } from './mapEngine'
import { hostAppearance } from './mapStyle'
import { createMapEngine } from './island'
import { getStore } from './store'
import { resolveSettings } from './settings'
import { overviewView } from './mapEmbed'
import { isValidLngLat } from './geo'
import type { LngLat } from './types'

interface MapDashboardRowSpec extends PluginRow {
  type: 'map'
  routeField?: string
  place?: string
  center?: { lat: number; lng: number }
  zoom?: number
  height?: number
}

/**
 * The `map` dashboard row (registered via `api.ui.registerDashboardRow`): a
 * lazily-mounted MapLibre tile inside a view folder's dashboard. Resolution
 * order — the most recent record's `routeField` name against the saved routes,
 * then `place`, then a fixed `center`, else an overview of all saved places.
 */
export function MapDashboardRow({ row: input, rows }: DashboardRowProps): JSX.Element {
  const [owner] = React.useState(() => captureMapRenderOwner())
  const [store] = React.useState(getStore)
  const row = input as MapDashboardRowSpec
  const containerRef = React.useRef<HTMLDivElement>(null)

  // The latest non-empty route name in the (timeframe-scoped) records — a
  // string key, so re-renders with identical data never remount the map.
  const routeField = row.routeField ?? 'route'
  const routeName = React.useMemo(() => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const value = String((rows[i] as Record<string, unknown>)[routeField] ?? '').trim()
      if (value) return value
    }
    return null
  }, [rows, routeField])

  const centerKey = row.center ? `${row.center.lat},${row.center.lng}` : ''

  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const snap = store?.getSnapshot()
    const routes = snap?.routes ?? []
    const places = snap?.places ?? []

    const matched = routeName
      ? routes.find((r) => r.name.toLowerCase() === routeName.toLowerCase())
      : undefined
    const line: LngLat[] | null = matched
      ? (matched.geometry ?? matched.waypoints.map((w) => [w.lng, w.lat] as LngLat))
      : null
    const namedPlace = row.place
      ? places.find((p) => p.name.toLowerCase() === row.place!.toLowerCase())
      : undefined

    const settings = store ? store.settings() : resolveSettings(owner.api.settings.get())
    const theme = hostAppearance(el.ownerDocument) ?? 'dark'
    let engine: MapEngine | null = null
    let disposed = false
    let mounting = false
    const lifetime = new AbortController()

    const mount = (): void => {
      if (engine || mounting || disposed) return
      mounting = true
      void createMapEngine({
        container: el,
        settings,
        theme,
        style: settings.defaultStyle,
        interactive: true,
        showControls: false,
        onReady: () => {
          if (line && line.length > 0) {
            engine?.setRoute(line)
            if (matched) engine?.setWaypoints(matched.waypoints)
            const fit = overviewView(
              line.map((c, i) => ({ id: String(i), name: '', lng: c[0], lat: c[1], createdAt: '' }))
            )
            if (fit) engine?.flyTo(fit.center, row.zoom ?? fit.zoom)
          } else if (namedPlace) {
            engine?.flyTo([namedPlace.lng, namedPlace.lat], row.zoom ?? 13)
            engine?.setPlaces([namedPlace])
          } else if (row.center && isValidLngLat(row.center.lng, row.center.lat)) {
            engine?.flyTo([row.center.lng, row.center.lat], row.zoom ?? 13)
          } else {
            const fit = overviewView(places)
            if (fit) {
              engine?.flyTo(fit.center, row.zoom ?? fit.zoom)
              engine?.setPlaces(places)
            }
          }
        }
      }, owner.api, lifetime.signal).then((value) => { if (disposed) value.destroy(); else engine = value }).catch((error) => { if (!disposed) el.textContent = error instanceof Error ? error.message : String(error) })
    }

    // WebGL contexts are scarce — mount only once the row nears the viewport.
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        mount()
        io.disconnect()
      }
    })
    io.observe(el)

    const close = (): void => {
      if (disposed) return
      disposed = true
      lifetime.abort()
      io.disconnect()
      engine?.destroy()
      engine = null
    }
    const offOwner = owner.onDispose(close)
    return () => { offOwner(); close() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the resolved config, not object identities
  }, [owner, store, routeName, row.place, centerKey, row.zoom])

  const subtitle = routeName ?? row.place ?? null

  return (
    <section className="map-dash-row">
      {(row.title || subtitle) && (
        <div className="map-dash-row-head">
          {row.title && <span className="map-dash-row-title">{row.title}</span>}
          {subtitle && <span className="map-dash-row-sub">{subtitle}</span>}
        </div>
      )}
      <div ref={containerRef} className="map-embed map-dash-map" style={{ height: row.height ?? 320 }} />
    </section>
  )
}
