import { publishMapDetails } from './workspaceDetails'
import type { MapSnapshot } from './store'
import type { PluginFileView } from '@valley/plugin-sdk'
import type { ComponentProps, FC } from 'react'
import { React, api, captureMapRenderOwner } from './runtime'
import { useMap } from './hooks'
import { createMapEngine } from './island'
import type { MapEngine } from './mapEngine'
import { hostAppearance, observeHostAppearance } from './mapStyle'
import { MapFileError, parseMapFile, summarizeMapFeature, type MapFileData, type MapFileFeature } from './mapFile'
import { mapPresentationSettings, parseMapPresentation, resolveSettings } from './settings'
import { uiText } from './localization'
import { formatDistance, formatDuration, formatLatLng, formatLength } from './format'
import type { ValleyUnits } from '@valley/plugin-sdk/units'
import { Crosshair, Minus, Plus, X } from './icons'

interface MapFileBookmark {
  v: 1
  path: string
  camera: MapSnapshot['camera']
  style: MapSnapshot['style']
  colorMode: 'light' | 'dark'
}
function fileBookmarks() {
  return api.runtime.getOrCreate('map.fileBookmarks', () => ({ views: new Map<string, MapFileBookmark>(), pending: new Map<string, MapFileBookmark>(), listeners: new Set<() => void>() }))
}
export const mapFileBookmark = (path: string): MapFileBookmark | undefined => fileBookmarks().views.get(path)
export function subscribeMapFileBookmarks(listener: () => void): () => void {
  const owner = fileBookmarks()
  owner.listeners.add(listener)
  return () => { owner.listeners.delete(listener) }
}
export function restoreMapFileBookmark(value: Record<string, unknown>): void {
  const state = value as unknown as MapFileBookmark
  if (state.v !== 1 || typeof state.path !== 'string' || !/\.(gpx|kml|geojson)$/i.test(state.path)) throw new Error('Invalid geographic file bookmark')
  const owner = fileBookmarks()
  owner.pending.set(state.path, structuredClone(state))
  owner.listeners.forEach(listener => listener())
}

type FileState = { path: string; status: 'loading' | 'error' | 'loaded'; data?: MapFileData; error?: string }

/** The selected feature in reading order: what it is and where, what it measures, then its own fields. */
const FeatureDetails: FC<{ feature: MapFileFeature; units: ValleyUnits; onClose: () => void }> = ({ feature, units, onClose }) => {
  const summary = summarizeMapFeature(feature)
  const kind = uiText(`file.kind.${summary.kind}`)
  const rows: Array<[string, string]> = [[uiText('file.geometry'), kind]]
  if (summary.position) {
    rows.push([uiText('file.coordinates'), formatLatLng(summary.position[1], summary.position[0])])
    if (typeof summary.position[2] === 'number') rows.push([uiText('auto.a514da1094ce'), formatLength(summary.position[2], units)])
  }
  if (summary.lengthMeters !== undefined) rows.push([uiText('auto.423208095dd7'), formatDistance(summary.lengthMeters, units)])
  if (summary.vertices > 1) rows.push([uiText('file.vertices'), String(summary.vertices)])
  if (summary.ascentMeters !== undefined && summary.descentMeters !== undefined) {
    rows.push([uiText('file.climb'), uiText('auto.f94ca293e064', { p0: formatLength(summary.ascentMeters, units), p1: formatLength(summary.descentMeters, units) })])
  }
  if (summary.start) {
    rows.push([uiText(summary.end && summary.end !== summary.start ? 'file.start' : 'file.time'), new Date(summary.start).toLocaleString()])
    if (summary.end && summary.end !== summary.start) {
      rows.push([uiText('file.end'), new Date(summary.end).toLocaleString()])
      rows.push([uiText('auto.1370004da76f'), formatDuration((Date.parse(summary.end) - Date.parse(summary.start)) / 1000)])
    }
  }
  return <aside className="map-file-details" aria-label={uiText('file.details')}>
    <div className="map-file-details-heading"><strong>{summary.name || kind}</strong><button className="map-row-action" aria-label={uiText('auto.70afe9eff3f2')} onClick={onClose}><X /></button></div>
    <dl>
      {[...rows, ...summary.properties].map(([label, value], index) => <React.Fragment key={`${index}:${label}`}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}
    </dl>
  </aside>
}

export const FileView: FC<ComponentProps<PluginFileView> & { embedded?: boolean; embedOptions?: readonly string[] }> = ({ relPath, tab, embedded = false, embedOptions = [] }) => {
  const [owner] = React.useState(() => captureMapRenderOwner(api))
  const { store, snap } = useMap()
  const [restoredPresentation, setRestoredPresentation] = React.useState<MapFileBookmark | null>(null)
  const [restoreRevision, requestRestore] = React.useReducer((value: number) => value + 1, 0)
  React.useEffect(() => embedded ? undefined : subscribeMapFileBookmarks(requestRestore), [embedded])
  const [detailCamera, setDetailCamera] = React.useState<MapSnapshot['camera']>(null)
  const container = React.useRef<HTMLDivElement | null>(null)
  const [engine, setEngine] = React.useState<MapEngine | null>(null)
  const [state, setState] = React.useState<FileState>({ path: relPath, status: 'loading' })
  const [mapError, setMapError] = React.useState(false)
  const [selected, setSelected] = React.useState<number | null>(null)
  const fittedPath = React.useRef<string | null>(null)
  const [rawSettings, setRawSettings] = React.useState(() => owner.api.settings.get())
  React.useEffect(() => owner.api.settings.subscribe(() => setRawSettings(owner.api.settings.get())), [owner])
  const presentation = mapPresentationSettings(rawSettings, 'embed', parseMapPresentation(embedOptions), snap.mapStyleConnections)
  const settings = embedded ? presentation.settings : store?.settings() ?? resolveSettings(rawSettings)
  React.useEffect(() => {
    const doc = container.current?.ownerDocument
    if (!doc || !store) return
    store.setHostAppearance(hostAppearance(doc))
    return observeHostAppearance(doc, mode => store.setHostAppearance(mode))
  }, [store])
  const hostTheme = hostAppearance(container.current?.ownerDocument ?? document) ?? 'dark'
  const theme = embedded ? presentation.theme === 'system' ? hostTheme : presentation.theme : restoredPresentation?.path === relPath ? restoredPresentation.colorMode : store ? snap.resolvedColorMode : hostTheme
  const style = embedded ? settings.defaultStyle : restoredPresentation?.path === relPath ? restoredPresentation.style : store ? snap.style : settings.defaultStyle
  const options = React.useRef({ settings, theme, style, units: snap.units })
  options.current = { settings, theme, style, units: snap.units }
  const current = state.path === relPath ? state : { path: relPath, status: 'loading' as const }
  const data = current.data
  const feature = selected === null ? null : data?.collection.features[selected]
  const selectedPosition = React.useMemo(() => {
    if (feature?.geometry.type !== 'Point') return undefined
    const [lng, lat, elevation] = feature.geometry.coordinates
    const name = feature.properties?.name ?? feature.properties?.title
    const address = feature.properties?.address
    return { lng, lat, elevation, ...(typeof name === 'string' ? { name } : {}), ...(typeof address === 'string' ? { context: address } : {}) }
  }, [feature])
  React.useEffect(() => embedded ? undefined : publishMapDetails(owner.api, { instanceId: tab?.id, filePath: relPath }, detailCamera, selectedPosition), [owner, tab?.id, relPath, detailCamera, selectedPosition, embedded])

  React.useEffect(() => {
    if (!container.current || !owner.isActive()) return
    let disposed = false
    let mounted: MapEngine | null = null
    const lifetime = new AbortController()
    void createMapEngine({
      container: container.current,
      ...options.current,
      showZoom: false,
      scrollZoom: !embedded,
      retainSnapshot: embedded,
      onCameraChange: ({ center, zoom, bearing, pitch }) => { if (!disposed) setDetailCamera({ lng: center[0], lat: center[1], zoom, bearing, pitch }) },
      onFileFeatureClick: index => { if (!disposed) setSelected(index) },
      onError: () => { if (!disposed) setMapError(true) }
    }, owner.api, lifetime.signal).then(value => {
      if (disposed) { value.destroy(); return }
      mounted = value
      setEngine(value)
    }).catch(() => { if (!disposed) setMapError(true) })
    const close = (): void => { disposed = true; lifetime.abort(); mounted?.destroy() }
    const offOwner = owner.onDispose(close)
    return () => { offOwner(); close() }
  }, [owner, embedded])

  React.useEffect(() => {
    let disposed = false
    let generation = 0
    const load = async (): Promise<void> => {
      const request = ++generation
      setState({ path: relPath, status: 'loading' })
      setSelected(null)
      try {
        const file = await owner.run(() => owner.api.vault.readFileBaseline(relPath))
        if (disposed || request !== generation || !owner.isActive()) return
        if (!file?.baseline) { setState({ path: relPath, status: 'error', error: 'file.unreadable' }); return }
        const parsed = parseMapFile(relPath, file.content)
        setState({ path: relPath, status: 'loaded', data: parsed })
      } catch (error) {
        if (!disposed && request === generation && owner.isActive()) setState({ path: relPath, status: 'error', error: error instanceof MapFileError ? error.key : 'file.unreadable' })
      }
    }
    const offChanged = owner.api.vault.onChanged(info => {
      if (info.full || info.changes.some(change => change.relPath === relPath || relPath.startsWith(`${change.relPath}/`))) void load()
    })
    const close = (): void => { disposed = true; generation++; offChanged() }
    const offOwner = owner.onDispose(close)
    void load()
    return () => { offOwner(); close() }
  }, [owner, relPath])

  React.useEffect(() => {
    if (!engine || !owner.isActive()) return
    engine.setFileData(data?.collection ?? { type: 'FeatureCollection', features: [] })
    if (data?.bounds && fittedPath.current !== relPath) { engine.fitTo(data.bounds); fittedPath.current = relPath }
  }, [data, engine, owner, relPath])

  React.useEffect(() => {
    if (embedded || !engine || !data || !owner.isActive()) return
    const pending = fileBookmarks().pending.get(relPath)
    if (!pending) return
    fileBookmarks().pending.delete(relPath)
    setRestoredPresentation(pending)
    if (pending.camera) {
      const camera = pending.camera
      engine.jumpTo([camera.lng, camera.lat], camera.zoom, camera.bearing, camera.pitch)
      setDetailCamera(camera)
    }
  }, [engine, data, relPath, owner, embedded, restoreRevision])
  React.useEffect(() => {
    if (embedded || current.status !== 'loaded') return
    const registry = fileBookmarks()
    const next: MapFileBookmark = { v: 1, path: relPath, camera: detailCamera, style, colorMode: theme }
    if (JSON.stringify(registry.views.get(relPath)) === JSON.stringify(next)) return
    registry.views.set(relPath, next)
    const timer = setTimeout(() => registry.listeners.forEach(listener => listener()), 120)
    return () => clearTimeout(timer)
  }, [embedded, current.status, relPath, detailCamera, style, theme])

  const settingsKey = JSON.stringify(settings)
  React.useEffect(() => {
    if (owner.isActive()) engine?.setStyle(style, theme, options.current.settings)
  }, [engine, owner, style, theme, settingsKey])
  React.useEffect(() => { if (owner.isActive()) engine?.setUnits(snap.units) }, [engine, owner, snap.units])

  return <div className={`map-page map-file${embedded ? ' map-file-embed' : ''}`} data-file-state={current.status}>
    <div className="map-body">
      <div className="map-canvas" ref={container} aria-label={uiText('file.map')} />
      <div className="map-overlay map-overlay-controls">
        <button className="map-round-btn" aria-label={uiText('auto.4fc05f2763ba')} title={uiText('auto.4fc05f2763ba')} onClick={() => engine?.zoomBy(1)}><Plus /></button>
        <button className="map-round-btn" aria-label={uiText('auto.a4ae4b24a1f5')} title={uiText('auto.a4ae4b24a1f5')} onClick={() => engine?.zoomBy(-1)}><Minus /></button>
        <button className="map-round-btn" aria-label={uiText('file.fit')} title={uiText('file.fit')} disabled={!data?.bounds} onClick={() => { if (data?.bounds) engine?.fitTo(data.bounds) }}><Crosshair /></button>
      </div>
      <div className="map-file-notices" aria-live="polite">
        {current.status === 'loading' && <p className="map-file-notice" role="status">{uiText('file.loading')}</p>}
        {current.error && <p className="map-file-notice" role="alert">{uiText(current.error)}</p>}
        {current.status === 'loaded' && !data?.bounds && <p className="map-file-notice" role="status">{uiText('file.empty')}</p>}
        {data?.unsupported && <p className="map-file-notice" role="status">{uiText('file.unsupportedKml')}</p>}
        {mapError && <p className="map-file-notice" role="alert">{uiText('file.mapError')}</p>}
      </div>
      {feature && <FeatureDetails feature={feature} units={snap.units} onClose={() => setSelected(null)} />}
    </div>
  </div>
}

export const FileInfo: FC<{ relPath: string }> = ({ relPath }) => {
  const [info, setInfo] = React.useState<Awaited<ReturnType<typeof api.vault.fileInfo>>>(null)
  React.useEffect(() => {
    let disposed = false, generation = 0
    const read = async () => {
      const request = ++generation
      try { const value = await api.vault.fileInfo(relPath); if (!disposed && request === generation) setInfo(value) }
      catch { if (!disposed && request === generation) setInfo(null) }
    }
    setInfo(null)
    void read()
    const off = api.vault.onChanged(change => { if (change.full || change.changes.some(file => file.relPath === relPath)) void read() })
    return () => { disposed = true; off() }
  }, [relPath])
  const entry = api.getState().indexEntries.find(file => file.relPath === relPath)
  const rows = [
    [uiText('file.info.path'), relPath],
    [uiText('file.info.type'), relPath.split('.').at(-1)?.toUpperCase() ?? ''],
    [uiText('file.access'), uiText('file.readOnly')],
    [uiText('file.info.size'), info ? `${new Intl.NumberFormat(api.ui.language(), { maximumFractionDigits: 2 }).format(info.size < 1024 ? info.size : info.size / 1024)} ${info.size < 1024 ? 'B' : 'KB'}` : '—'],
    ...(entry?.ctimeMs ? [[uiText('file.info.created'), new Date(entry.ctimeMs).toLocaleString(api.ui.language())]] : []),
    [uiText('file.info.modified'), info ? new Date(info.mtimeMs).toLocaleString(api.ui.language()) : '—']
  ]
  return <div className="right-panel-body props-info"><dl className="props-info-table">{rows.map(([label, value]) => <div className="props-info-row" key={label}><dt className="props-info-key">{label}</dt><dd className="props-info-value">{value}</dd></div>)}</dl></div>
}
