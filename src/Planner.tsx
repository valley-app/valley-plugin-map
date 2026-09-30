import { React, api } from './runtime'
import type { FC } from 'react'
import { useMap } from './hooks'
import { ElevationProfile } from './ElevationProfile'
import { RouteCard } from './RouteCard'
import { routeToGpx, gpxToRoute } from './gpx'
import { routeToGeoJsonText, parseRouteFromGeoJson } from './geojson'
import type { Route } from './types'
import { Download, RouteIcon, Upload } from './icons'
import { uiText } from './localization'

const slug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'route'

export const Planner: FC = () => {
  const { store, snap } = useMap()
  const [importPath, setImportPath] = React.useState('')
  const [importing, setImporting] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)

  if (!store) return null
  const { plannerWaypoints: waypoints, plannerMode, plan } = snap

  const exportRoute = async (kind: 'gpx' | 'geojson'): Promise<void> => {
    const route: Route = {
      id: 'export',
      // The card has no name field; name the file after its endpoints, the same
      // way a saved route names itself.
      name: waypoints.length >= 2 ? `${waypoints[0].label} to ${waypoints[waypoints.length - 1].label}` : 'route',
      mode: plannerMode,
      waypoints,
      geometry: plan?.geometry,
      distanceM: plan?.distanceM,
      durationS: plan?.durationS,
      createdAt: new Date().toISOString()
    }
    const relPath = `Maps/${slug(route.name)}.${kind}`
    const content = kind === 'gpx' ? routeToGpx(route) : routeToGeoJsonText(route)
    const res = await api.drivers.files.writeFile(relPath, content)
    if (res.ok) {
      setNotice(uiText('auto.2a5ebd96b5aa', { p0: relPath }))
      api.workspace.openFile(relPath)
    } else {
      setNotice(uiText('auto.d6c17e9bd70b'))
    }
  }

  const runImport = async (): Promise<void> => {
    const path = importPath.trim()
    if (!path) return
    setImporting(true)
    setNotice(null)
    try {
      const res = await api.drivers.files.readFile(path)
      const text = res.data?.content ?? ''
      if (!text) {
        setNotice(uiText('auto.2000697df97f'))
        return
      }
      const parsed = path.toLowerCase().endsWith('.gpx') ? gpxToRoute(text) : parseRouteFromGeoJson(text)
      if (!parsed || parsed.waypoints.length === 0) {
        setNotice(uiText('auto.961c8c9a268f'))
        return
      }
      // Through the stop list, like every other edit — `setWaypoints` is the
      // back-fill funnel, not a second editing model.
      store.setStops(parsed.waypoints)
      setImportPath('')
      setNotice(uiText('auto.31e7d70e157c', { p0: parsed.waypoints.length }))
    } finally {
      setImporting(false)
    }
  }

  /** Everything the right sidebar adds below the shared card: the elevation
   *  profile, and the file round-trip (which owns `api.drivers.files`, so it
   *  stays here rather than in a card both sidebars share). */
  const extras = (
    <>
      {plan?.profile && plan.profile.length > 1 && (
        <ElevationProfile profile={plan.profile} ascentM={plan.ascentM} descentM={plan.descentM} />
      )}
      {plan && (
        <div className="map-export-row">
          <button className="map-btn" onClick={() => void exportRoute('gpx')}>
            <Download /> GPX
          </button>
          <button className="map-btn" onClick={() => void exportRoute('geojson')}>
            <Download /> GeoJSON
          </button>
        </div>
      )}
      <div className="map-import">
        <div className="map-import-row">
          <input
            className="map-input"
            placeholder={uiText('auto.61364855d61c')}
            value={importPath}
            onChange={(e) => setImportPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runImport()
            }}
          />
          <button className="map-btn" disabled={!importPath.trim() || importing} onClick={() => void runImport()}>
            <Upload /> {uiText('auto.d6fbc9d2bdd5')}
          </button>
        </div>
      </div>
      {notice && <div className="map-notice">{notice}</div>}
    </>
  )

  return (
    <div className="panel map-planner">
      <div className="panel-header">
        <span className="panel-title">{uiText('auto.4999528efe0f')}</span>
      </div>
      <div className="panel-body hidescrollbar">
        <RouteCard
          variant="planner"
          onClose={waypoints.length > 0 ? () => store.clearPlanner() : undefined}
          extras={extras}
        />
        {waypoints.length === 0 && !plan && (
          <div className="map-empty">
            <RouteIcon /> {uiText('auto.b11d61dd0ff7')}
          </div>
        )}
      </div>
    </div>
  )
}
