import type { ReactNode } from 'react'
import { React, api } from './runtime'
import { MAP_SIDEBAR_TAB_V1, type MapSidebarTab } from './sidebarContract'
import { uiText } from './localization'

export function orderedTabs(saved: unknown, available: readonly string[]): string[] {
  const order = Array.isArray(saved) ? saved.filter((value): value is string => typeof value === 'string') : []
  return [...new Set([...order.filter(id => available.includes(id)), ...available])]
}

export function useSidebarExtensions() {
  const read = () => api.interop.extensions.providers(MAP_SIDEBAR_TAB_V1)
  const [providers, setProviders] = React.useState(read)
  React.useEffect(() => {
    const off = api.interop.extensions.subscribe(MAP_SIDEBAR_TAB_V1, () => setProviders(read()))
    setProviders(read())
    return off
  }, [])
  return providers.map(provider => ({ id: `extension:${provider.owner}:${provider.extension.id}` as const, provider }))
}

export function SidebarTabs({ tabs, active, onSelect }: { tabs: { id: string; label: string; icon: ReactNode }[]; active: string; onSelect(id: string): void }) {
  const [saved, setSaved] = React.useState(() => api.settings.get().sidebarTabOrder)
  const [error, setError] = React.useState(false)
  const [over, setOver] = React.useState<string | null>(null)
  const dragging = React.useRef<string | null>(null)
  const write = React.useRef(Promise.resolve())
  const generation = React.useRef(0)
  React.useEffect(() => api.settings.subscribe(() => setSaved(api.settings.get().sidebarTabOrder)), [])
  const order = orderedTabs(saved, tabs.map(tab => tab.id))
  const move = (id: string, index: number): void => {
    const next = order.filter(value => value !== id)
    next.splice(Math.max(0, Math.min(index, next.length)), 0, id)
    const retained = Array.isArray(saved) ? saved.filter(value => typeof value === 'string' && !order.includes(value)) : []
    const value = [...next, ...retained]
    const request = ++generation.current
    setSaved(value)
    setError(false)
    write.current = write.current.catch(() => {}).then(async () => {
      try { const result = await api.settings.set('sidebarTabOrder', value); if (!result.ok) throw new Error() }
      catch { if (request === generation.current) { setError(true); setSaved(api.settings.get().sidebarTabOrder) } }
    })
  }
  return <>
    <div className="map-tabs" role="tablist" aria-label={uiText('auto.ab478f3efc84')}>
      {order.map((id, index) => {
        const tab = tabs.find(tab => tab.id === id)!
        return <button key={id} className={`map-tab ${active === id ? 'active' : ''} ${over === id ? 'map-tab-drop' : ''}`}
          role="tab" aria-selected={active === id} aria-label={tab.label} title={`${tab.label} · ${uiText('sidebar.reorder')}`}
          draggable onClick={() => onSelect(id)}
          onDragStart={event => { dragging.current = id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id) }}
          onDragOver={event => { if (!dragging.current) return; event.preventDefault(); setOver(id) }}
          onDrop={event => { event.preventDefault(); if (dragging.current) move(dragging.current, index); dragging.current = null; setOver(null) }}
          onDragEnd={() => { dragging.current = null; setOver(null) }}
          onKeyDown={event => {
            if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
              event.preventDefault(); move(id, index + (event.key === 'ArrowLeft' ? -1 : 1)); return
            }
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
              event.preventDefault()
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? order.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + order.length) % order.length
              onSelect(order[next]); (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus()
            }
          }}>{tab.icon}</button>
      })}
    </div>
    {error && <p role="alert" className="map-empty">{uiText('surface.invalid')}</p>}
  </>
}

export function ExtensionPanel({ extension }: { extension: MapSidebarTab }) {
  const [snapshot, setSnapshot] = React.useState(() => extension.getSnapshot())
  const [error, setError] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [values, setValues] = React.useState<Record<string, string>>({})
  React.useEffect(() => {
    setSnapshot(extension.getSnapshot())
    return extension.subscribe(() => setSnapshot(extension.getSnapshot()))
  }, [extension])
  const root = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    const doc = root.current?.ownerDocument
    const update = () => extension.setActive?.(doc?.visibilityState !== 'hidden')
    update()
    doc?.addEventListener('visibilitychange', update)
    return () => { doc?.removeEventListener('visibilitychange', update); extension.setActive?.(false) }
  }, [extension])
  const fieldsKey = JSON.stringify(snapshot?.fields ?? [])
  React.useEffect(() => { setValues(Object.fromEntries((JSON.parse(fieldsKey) as { id: string; value: string }[]).map(field => [field.id, field.value]))) }, [fieldsKey])
  const run = async (action: string): Promise<void> => {
    setPending(true); setError(false)
    try { await extension.run(action, values) }
    catch { setError(true) }
    finally { setPending(false) }
  }
  if (!snapshot) return null
  return <div ref={root} className="map-extension-panel" aria-busy={snapshot.busy || pending}>
    <form className="map-extension-form" onSubmit={event => { event.preventDefault(); const first = snapshot.actions.find(action => !action.disabled); if (first) void run(first.id) }}>
      {snapshot.fields.map(field => <label key={field.id}>{field.label}<span className="search-field-row"><span className="search-field"><input value={values[field.id] ?? field.value}
        placeholder={field.placeholder} maxLength={200} onChange={event => setValues(current => ({ ...current, [field.id]: event.target.value }))} /></span></span></label>)}
      <div className="map-place-actions">{snapshot.actions.map(action => <button key={action.id} type="button" className="map-btn" disabled={action.disabled || snapshot.busy || pending} onClick={() => { void run(action.id) }}>{action.label}</button>)}</div>
    </form>
    {(snapshot.error || error) && <p role="alert" className="map-empty">{snapshot.error || uiText('sidebar.unavailable')}</p>}
    {snapshot.message && <p className="map-empty" role="status">{snapshot.message}</p>}
    {snapshot.rows.map(row => <button key={row.id} className="map-row map-extension-row" disabled={!row.action || pending || snapshot.busy} onClick={() => { if (row.action) void run(row.action) }}>
      <span className="map-row-meta"><span className="map-row-title">{row.title}</span>{row.detail && <span className="map-row-sub">{row.detail}</span>}</span>
    </button>)}
  </div>
}
