import { React } from './runtime'
import type { FC, ReactElement } from 'react'
import type { MapSidebarBadge, MapSidebarJourney, MapSidebarJourneyDetail, MapSidebarLeg, MapSidebarRouteStop, MapSidebarSnapshot, MapSidebarTab, MapSidebarTile, MapSidebarTime, MapSidebarWhen } from './sidebarContract'
import { uiText } from './localization'
import { ChevronLeft, Crosshair, MapPin, SwapVertical, Walk, X } from './icons'

/** Does a sidebar tab use the journey-planner parts of the contract? */
export function isPlannerSnapshot(snapshot: MapSidebarSnapshot): boolean {
  return Boolean(snapshot.segments || snapshot.route || snapshot.journeys || snapshot.journey || snapshot.tiles)
}

/** The product pictograms of the SBB look: a white glyph on the blue square. */
const PICTOGRAMS: Partial<Record<MapSidebarBadge['kind'], string>> = {
  train: 'M5 2.5h6a2 2 0 0 1 2 2V10a2 2 0 0 1-2 2l1.2 1.5h-1.6L9.5 12h-3l-1.1 1.5H3.8L5 12a2 2 0 0 1-2-2V4.5a2 2 0 0 1 2-2Zm-.5 2.2v2.6h7V4.7Zm1 4.3a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Zm5 0a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Z',
  regional: 'M5 2.5h6a2 2 0 0 1 2 2V10a2 2 0 0 1-2 2l1.2 1.5h-1.6L9.5 12h-3l-1.1 1.5H3.8L5 12a2 2 0 0 1-2-2V4.5a2 2 0 0 1 2-2Zm-.5 2.2v2.6h7V4.7Zm1 4.3a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Zm5 0a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Z',
  bus: 'M2 4.2C2 3.5 2.5 3 3.2 3h8.3c.5 0 .9.2 1.1.6l1.2 2.2c.1.2.2.4.2.6V11c0 .4-.3.7-.7.7h-.6a1.6 1.6 0 0 1-3.1 0H6.4a1.6 1.6 0 0 1-3.1 0h-.6A.7.7 0 0 1 2 11Zm1.2.4v2.6h3V4.6Zm4 0v2.6h3V4.6Zm4 0v2.6h1.9l-1.2-2.6ZM4.8 10.7a.7.7 0 1 0 0 1.4.7.7 0 0 0 0-1.4Zm6.3 0a.7.7 0 1 0 0 1.4.7.7 0 0 0 0-1.4Z',
  tram: 'M6.5 1.5h3v1h-1v1h2a2 2 0 0 1 2 2V11a1.5 1.5 0 0 1-1.5 1.5l1 1.5H10.4l-1-1.5H6.6l-1 1.5H4l1-1.5A1.5 1.5 0 0 1 3.5 11V5.5a2 2 0 0 1 2-2h2v-1h-1Zm-1.8 4v3h6.6v-3ZM5.6 10a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Zm4.8 0a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Z',
  ship: 'M6 2h4v2h2v3.2l1.6.6-1.5 4.2H3.9L2.4 7.8 4 7.2V4h2Zm-.8 3.2v1.6L8 5.8l2.8 1V5.2ZM2 13h12v1H2Z',
  cableway: 'M2 2.5 14 1v1L8.6 2.7V4H11a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 11 13H5a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 5 4h2.4V2.8L2 3.5Zm2.7 3v3h6.6v-3Z'
}
const Pictogram: FC<{ kind: MapSidebarBadge['kind'] }> = ({ kind }) => {
  const path = PICTOGRAMS[kind]
  if (!path) return null
  return <svg className="map-line-picto" viewBox="0 0 16 16" aria-hidden="true"><path d={path} fill="currentColor" /></svg>
}

const Badge: FC<{ badge: MapSidebarBadge; sbb?: boolean }> = ({ badge, sbb }) => {
  if (!sbb) return <span className={`map-line-badge is-${badge.kind}`}>{badge.text}</span>
  // SBB draws long-distance categories as an italic tag in its red badge (`IR` then `36`).
  const split = badge.kind === 'train' && badge.category && badge.number
  return <span className="map-line" aria-label={badge.text}>
    <Pictogram kind={badge.kind} />
    <span className={`map-line-badge is-${badge.kind}`} aria-hidden="true">
      {split ? <><span className="map-line-cat">{badge.category}</span><span>{badge.number}</span></> : badge.text}
    </span>
  </span>
}

/** A clock time, with the provider's expected time beside it when the trip runs late. */
const Time: FC<{ time: MapSidebarTime; strong?: boolean }> = ({ time, strong }) => (
  <span className={`map-journey-time${strong ? ' is-strong' : ''}`}>
    {time.time}
    {time.late && time.expected && <span className="map-journey-late">{time.expected}</span>}
  </span>
)

/** The connection line between departure and arrival, one ring per change (placed in time when the provider says where). */
const Track: FC<{ changes: number; stops?: number[] }> = ({ changes, stops }) => (
  <span className={`map-journey-track${stops ? ' is-timed' : ''}`} aria-hidden="true">
    <span className="map-journey-track-dot is-end" />
    {stops
      ? stops.map((at, index) => <span key={index} className="map-journey-track-dot is-placed" style={{ left: `${(at * 100).toFixed(1)}%` }} />)
      : Array.from({ length: Math.min(changes, 4) }, (_, index) => <span key={index} className="map-journey-track-dot" />)}
    <span className="map-journey-track-dot is-end" />
  </span>
)

/** Three figures, as many filled as the forecast level. */
const Occupancy: FC<{ level: number; label: string }> = ({ level, label }) => (
  <span className="map-occupancy" title={`${label} ${level}/3`}>
    <span>{label}</span>
    {[1, 2, 3].map(index => (
      <svg key={index} viewBox="0 0 6 12" className={index <= level ? 'is-on' : ''} aria-hidden="true"><circle cx="3" cy="2" r="1.6" /><path d="M1 5h4v4H4v3H2V9H1Z" /></svg>
    ))}
  </span>
)

const JourneyCard: FC<{ journey: MapSidebarJourney; run: (action: string) => void; disabled: boolean; sbb: boolean }> = ({ journey, run, disabled, sbb }) => {
  const body = journey.arrival
    ? <>
      <span className="map-journey-head"><Badge badge={journey.badge} sbb={sbb} /><span className="map-journey-direction">{journey.direction}</span></span>
      <span className="map-journey-times"><Time time={journey.departure} strong /><Track changes={journey.changes ?? 0} stops={journey.stops} /><Time time={journey.arrival} strong /></span>
      <span className="map-journey-meta">
        <span className="map-journey-platform">{journey.platform}</span>
        {journey.occupancy && <span className="map-occupancies">
          {journey.occupancy.first && <Occupancy level={journey.occupancy.first} label="1." />}
          {journey.occupancy.second && <Occupancy level={journey.occupancy.second} label="2." />}
        </span>}
        {journey.note && <span className={journey.warn ? 'map-journey-warn' : ''}>{journey.note}</span>}
        <span className="map-journey-duration">{journey.duration}</span>
      </span>
    </>
    : <span className="map-journey-board">
      <Time time={journey.departure} strong />
      <Badge badge={journey.badge} sbb={sbb} />
      <span className="map-journey-direction">{journey.direction}</span>
      <span className="map-journey-board-end">
        {journey.note && <span className={journey.warn ? 'map-journey-warn' : ''}>{journey.note}</span>}
        <span>{journey.platform}</span>
      </span>
    </span>
  return journey.action
    ? <button type="button" className="map-journey-card" disabled={disabled} onClick={() => run(journey.action!)}>{body}</button>
    : <div className="map-journey-card is-static">{body}</div>
}

const Leg: FC<{ leg: MapSidebarLeg; sbb: boolean }> = ({ leg, sbb }) => leg.kind === 'walk'
  ? <div className="map-leg is-walk"><span className="map-leg-time">{leg.duration}</span><span className="map-leg-spine is-walk"><Walk /></span><span className="map-leg-body">{leg.text}</span></div>
  : <div className="map-leg">
    <div className="map-leg-call">
      <span className="map-leg-time"><Time time={leg.from.time} strong /></span>
      <span className="map-leg-spine"><span className="map-leg-dot" /></span>
      <span className="map-leg-station is-strong">{leg.from.name}</span>
      <span className="map-leg-platform is-strong">{leg.from.platform}</span>
    </div>
    <div className="map-leg-ride">
      <span className="map-leg-time" />
      <span className="map-leg-spine is-line" />
      <span className="map-leg-body"><span className="map-journey-head"><Badge badge={leg.badge} sbb={sbb} /></span>{leg.direction && <span className="map-leg-direction">{leg.direction}</span>}{leg.note && <span className="map-journey-warn">{leg.note}</span>}</span>
    </div>
    <div className="map-leg-call">
      <span className="map-leg-time"><Time time={leg.to.time} /></span>
      <span className="map-leg-spine"><span className="map-leg-dot" /></span>
      <span className="map-leg-station">{leg.to.name}</span>
      <span className="map-leg-platform">{leg.to.platform}</span>
    </div>
  </div>

const JourneyDetail: FC<{ detail: MapSidebarJourneyDetail; run: (action: string) => void; sbb: boolean }> = ({ detail, run, sbb }) => (
  <div className="map-journey-detail">
    <button type="button" className="map-journey-back" onClick={() => run(detail.back)}><ChevronLeft />{uiText('journey.back')}</button>
    <div className="map-journey-summary">
      <span className="map-journey-title">{detail.title}</span>
      <span className="map-journey-times"><Time time={detail.departure} strong /><Track changes={detail.legs.filter(leg => leg.kind === 'ride').length - 1} stops={detail.stops} /><Time time={detail.arrival} strong /></span>
      <span className="map-journey-meta"><span>{detail.summary}</span></span>
    </div>
    <div className="map-legs">{detail.legs.map((leg, index) => <Leg key={index} leg={leg} sbb={sbb} />)}</div>
  </div>
)

const TileIcon: FC<{ icon: MapSidebarTile['icon'] }> = ({ icon }) => icon === 'location' ? <Crosshair />
  : icon === 'origin' ? <span className="map-route-ring" /> : icon === 'destination' ? <span className="map-route-ring is-target" /> : <MapPin />

const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * The travel date and time sheet: departure or arrival, then day, hour and
 * minute columns. Drawn by the plugin, since native date inputs are not allowed.
 */
const WhenSheet: FC<{ when: MapSidebarWhen; close: () => void; apply: (values: Record<string, string>) => void; now?: () => void }> = ({ when, close, apply, now }) => {
  const [arrival, setArrival] = React.useState(when.arrival)
  const [date, setDate] = React.useState(when.date)
  const [hour, setHour] = React.useState(Number(when.time.slice(0, 2)))
  const [minute, setMinute] = React.useState(Number(when.time.slice(3, 5)))
  const sheet = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    // Open with the chosen values in the middle of each column, like the app's wheels.
    sheet.current?.querySelectorAll<HTMLElement>('.map-when-column').forEach(column => {
      const chosen = column.querySelector<HTMLElement>('.active')
      if (!chosen) return
      const offset = chosen.getBoundingClientRect().top - column.getBoundingClientRect().top + column.scrollTop
      column.scrollTop = offset - column.clientHeight / 2 + chosen.offsetHeight / 2
    })
    sheet.current?.querySelector<HTMLElement>('.map-when-mode button.active')?.focus()
  }, [])
  const column = (label: string, items: { value: string; label: string; active: boolean; pick: () => void }[]) => (
    <div className="map-when-column" role="listbox" aria-label={label}>
      {items.map(item => <button key={item.value} type="button" role="option" aria-selected={item.active} className={item.active ? 'active' : ''} onClick={item.pick}>{item.label}</button>)}
    </div>
  )
  return (
    <div className="map-when-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
      <div ref={sheet} className="map-when-sheet" role="dialog" aria-label={when.text.title}>
        <div className="map-when-head">
          <span className="map-when-title">{when.text.title}</span>
          <button type="button" className="map-when-close" aria-label={when.text.close} title={when.text.close} onClick={close}><X /></button>
        </div>
        <div className="map-when-mode" role="radiogroup">
          <button type="button" role="radio" aria-checked={!arrival} className={!arrival ? 'active' : ''} onClick={() => setArrival(false)}>{when.text.departure}</button>
          <button type="button" role="radio" aria-checked={arrival} className={arrival ? 'active' : ''} onClick={() => setArrival(true)}>{when.text.arrival}</button>
        </div>
        <div className="map-when-wheels">
          {column(when.text.date, when.days.map(day => ({ value: day.value, label: day.label, active: day.value === date, pick: () => setDate(day.value) })))}
          {column('h', Array.from({ length: 24 }, (_, value) => ({ value: String(value), label: pad(value), active: value === hour, pick: () => setHour(value) })))}
          {column('min', Array.from({ length: 60 }, (_, value) => ({ value: String(value), label: pad(value), active: value === minute, pick: () => setMinute(value) })))}
        </div>
        <div className="map-when-actions">
          {now && <button type="button" className="map-when-now" onClick={now}>{when.text.now}</button>}
          <button type="button" className="map-when-apply" onClick={() => apply({ date, time: `${pad(hour)}:${pad(minute)}`, arrival: arrival ? '1' : '0' })}>{when.text.apply}</button>
        </div>
      </div>
    </div>
  )
}

/**
 * Station tiles that can be swiped from one to another, as in the SBB app's
 * Touch timetable. Resting on a third tile on the way (half a second) makes it
 * the via. A tap stays a plain click.
 */
type Point = [number, number]
type SwipeLine = { start: Point; via?: Point; end: Point }

function useTileSwipe(prefix: string | undefined, run: (action: string) => void) {
  const state = React.useRef<{ from: string; pointer: number; over: string; since: number; via?: string; viaAt?: Point; last: Point; moved: boolean; start: Point } | null>(null)
  const [marks, setMarks] = React.useState<{ from?: string; over?: string; via?: string; line?: SwipeLine }>({})
  const swallowClick = React.useRef(false)
  const tileAt = (doc: Document, x: number, y: number): string | undefined =>
    (doc.elementFromPoint(x, y)?.closest('[data-tile-id]') as HTMLElement | null)?.dataset.tileId
  /** The pointer in the grid's own coordinates, where the line is drawn. */
  const local = (event: React.PointerEvent<HTMLDivElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect()
    return [event.clientX - box.left, event.clientY - box.top]
  }
  if (!prefix) return { handlers: {}, marks, swallow: () => false }
  return {
    marks,
    swallow: () => { const swallow = swallowClick.current; swallowClick.current = false; return swallow },
    handlers: {
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return
        const from = (event.target as HTMLElement).closest<HTMLElement>('[data-tile-id]')?.dataset.tileId
        if (!from) return
        const at = local(event)
        state.current = { from, pointer: event.pointerId, over: from, since: performance.now(), moved: false, start: at, last: at }
        setMarks({ from, over: from })
      },
      onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
        const swipe = state.current
        if (!swipe || swipe.pointer !== event.pointerId) return
        const at = local(event)
        const over = tileAt(event.currentTarget.ownerDocument, event.clientX, event.clientY)
        if (over && over !== swipe.over) {
          // Leaving a tile the pointer rested on makes it the via, unless it is the start;
          // the line bends where the pointer rested.
          const now = performance.now()
          if (swipe.over !== swipe.from && now - swipe.since >= 500) { swipe.via = swipe.over; swipe.viaAt = swipe.last }
          if (!swipe.moved) { swipe.moved = true; event.currentTarget.setPointerCapture?.(event.pointerId) }
          swipe.over = over; swipe.since = now
        }
        swipe.last = at
        if (!swipe.moved) return
        setMarks({ from: swipe.from, over: swipe.over, via: swipe.via, line: { start: swipe.start, ...(swipe.viaAt ? { via: swipe.viaAt } : {}), end: at } })
      },
      onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
        const swipe = state.current
        state.current = null
        setMarks({})
        if (!swipe || swipe.pointer !== event.pointerId) return
        const to = tileAt(event.currentTarget.ownerDocument, event.clientX, event.clientY) ?? swipe.over
        if (!swipe.moved || to === swipe.from) return
        // The click that follows this pointerup belongs to the swipe; forget it if it never comes.
        swallowClick.current = true
        event.currentTarget.ownerDocument.defaultView?.setTimeout(() => { swallowClick.current = false }, 0)
        const via = swipe.via && swipe.via !== to ? `:${swipe.via}` : ''
        run(`${prefix}:${swipe.from}:${to}${via}`)
      },
      onPointerCancel: () => { state.current = null; setMarks({}) }
    }
  }
}

/** The swipe as the SBB app draws it: a dot where it started, a bend at the via, a ring at the pointer. */
const SwipeTrace: FC<{ line: SwipeLine }> = ({ line }) => {
  const points = [line.start, ...(line.via ? [line.via] : []), line.end]
  return (
    <svg className="map-swipe-line" aria-hidden="true">
      <polyline points={points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} />
      <circle cx={line.start[0]} cy={line.start[1]} r="6" />
      {line.via && <circle className="is-via" cx={line.via[0]} cy={line.via[1]} r="6" />}
      <circle className="is-end" cx={line.end[0]} cy={line.end[1]} r="7" />
    </svg>
  )
}

/**
 * The journey planner a sidebar tab can ask for: segments, a Von/Via/Nach form
 * with a stop spine and travel date, station suggestions, connection cards with
 * day headers and earlier/later loading, an opened connection as a timeline, or
 * station tiles. Every piece is optional; the provider decides what shows. With
 * `look: 'sbb'` the Map draws it in the SBB app's colours and badges.
 */
export function JourneyPanel({ extension, snapshot, run, pending }: {
  extension: MapSidebarTab
  snapshot: MapSidebarSnapshot
  run: (action: string, values?: Record<string, string>) => void
  pending: boolean
}): ReactElement {
  const sbb = snapshot.look === 'sbb'
  const stops = snapshot.route?.stops ?? []
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [picking, setPicking] = React.useState(false)
  const editing = React.useRef<string | null>(null)
  const inputs = React.useRef<Record<string, HTMLInputElement | null>>({})
  const typing = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const stopsKey = JSON.stringify(stops.map(stop => [stop.id, stop.value]))
  React.useEffect(() => {
    // Take the provider's text unless that field is being typed in right now.
    // A focused field is never rewritten under the caret: that is what doubles typed text.
    setValues(current => Object.fromEntries(stops.map(stop => {
      const field = inputs.current[stop.id]
      const typing = editing.current === stop.id && field !== null && field !== undefined && field.ownerDocument.activeElement === field
      return [stop.id, typing ? current[stop.id] ?? stop.value : stop.value]
    })))
  }, [stopsKey])
  React.useEffect(() => () => clearTimeout(typing.current), [])
  const segmentRow = React.useRef<HTMLDivElement>(null)
  // Bring the chosen segment into view when it changes, never on other updates.
  React.useEffect(() => {
    const row = segmentRow.current
    const active = row?.querySelector<HTMLElement>('.map-journey-segment.active')
    if (!row || !active) return
    if (active.offsetLeft < row.scrollLeft) row.scrollLeft = active.offsetLeft
    else if (active.offsetLeft + active.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = active.offsetLeft + active.offsetWidth - row.clientWidth
  }, [snapshot.segment])
  const busy = Boolean(snapshot.busy) || pending
  // A pick, swap or submit ends typing, so the provider's new text shows in the field.
  const act = (action: string, extra?: Record<string, string>): void => { editing.current = null; clearTimeout(typing.current); run(action, extra) }
  const change = (stop: MapSidebarRouteStop, value: string): void => {
    const next = { ...values, [stop.id]: value }
    setValues(next)
    clearTimeout(typing.current)
    typing.current = setTimeout(() => { void extension.run(`input:${stop.id}`, next).catch(() => {}) }, 250)
  }
  const swipe = useTileSwipe(snapshot.tileSwipe, action => act(action))
  const when = snapshot.route?.when
  const journeys = snapshot.journeys ?? []

  return (
    <div className={`map-journey${sbb ? ' is-sbb' : ''}`} aria-busy={busy}>
      {snapshot.segments && (
        <div ref={segmentRow} className="map-journey-segments" role="tablist"
          onWheel={(event) => {
            // A mouse wheel only scrolls vertically; turn it sideways here, like the other icon rows.
            const row = event.currentTarget
            if (row.scrollWidth > row.clientWidth && Math.abs(event.deltaY) > Math.abs(event.deltaX)) row.scrollLeft += event.deltaY
          }}>
          {snapshot.segments.map(segment => (
            <button key={segment.id} type="button" role="tab" className={`map-journey-segment${snapshot.segment === segment.id ? ' active' : ''}`}
              aria-selected={snapshot.segment === segment.id} disabled={segment.disabled}
              title={segment.disabled ? uiText('journey.soon') : segment.label}
              onClick={() => act(`segment:${segment.id}`)}>{segment.label}</button>
          ))}
        </div>
      )}
      <div className="map-journey-body">
        {snapshot.route && (
          <div className="map-route-card">
            <div className="map-route">
              <div className="map-route-stops">
                {stops.map((stop, index) => (
                  <label key={stop.id} className={`map-route-stop is-${stop.role}${stop.location ? ' is-location' : ''}`}>
                    <span className="map-route-spine" aria-hidden="true">
                      {index > 0 && <span className="map-route-link is-up" />}
                      {stop.location ? <span className="map-route-ring is-location" /> : <span className={`map-route-ring${stop.role === 'destination' ? ' is-target' : stop.role === 'via' ? ' is-via' : ''}`} />}
                      {index < stops.length - 1 && <span className="map-route-link is-down" />}
                    </span>
                    <input ref={element => { inputs.current[stop.id] = element }} value={values[stop.id] ?? ''} placeholder={stop.placeholder} aria-label={stop.label} maxLength={200}
                      onFocus={(event) => { editing.current = stop.id; if (stop.location) event.currentTarget.select(); run(`focus:${stop.id}`) }}
                      onBlur={() => { if (editing.current === stop.id) editing.current = null }}
                      onChange={(event) => change(stop, event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter' && snapshot.route?.submit && !snapshot.route.submit.disabled) { event.preventDefault(); act(snapshot.route.submit.action) } }} />
                  </label>
                ))}
              </div>
              {snapshot.route.swap && (
                <button type="button" className="panel-tool-btn map-route-swap" title={uiText('journey.swap')} aria-label={uiText('journey.swap')} disabled={busy}
                  onClick={() => act(snapshot.route!.swap!)}><SwapVertical /></button>
              )}
            </div>
            {when && (
              <div className="map-route-when">
                <button type="button" className="map-route-when-open" aria-haspopup="dialog" aria-label={`${when.text.date}: ${when.label} ${when.time} ${when.arrival ? when.text.arrivalShort : when.text.departureShort}`}
                  disabled={busy} onClick={() => setPicking(true)}>
                  <span>{when.label}</span><span className="map-route-when-sep" /><span>{when.time} {when.arrival ? when.text.arrivalShort : when.text.departureShort}</span>
                </button>
                {when.now && <button type="button" className="map-route-when-now" disabled={busy} title={when.text.now} aria-label={when.text.now} onClick={() => act(when.now!)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4v4.5H8M12 7.5V12l3 2" /></svg>
                </button>}
              </div>
            )}
          </div>
        )}
        {snapshot.route?.submit && (
          <button type="button" className="map-btn map-btn-primary map-route-submit" disabled={busy || snapshot.route.submit.disabled}
            onClick={() => act(snapshot.route!.submit!.action)}>{snapshot.route.submit.label}</button>
        )}
        {snapshot.rows.length > 0 && (
          <div className="map-journey-list">
            {snapshot.rowsTitle && <span className="map-journey-caption">{snapshot.rowsTitle}</span>}
            {snapshot.rows.map(row => (
              <button key={row.id} type="button" className="map-row map-extension-row map-journey-suggestion" disabled={!row.action}
                onMouseDown={(event) => event.preventDefault()} onClick={() => { if (row.action) act(row.action) }}>
                <span className="map-row-icon"><MapPin /></span>
                <span className="map-row-meta"><span className="map-row-title">{row.title}</span>{row.detail && <span className="map-row-sub">{row.detail}</span>}</span>
              </button>
            ))}
          </div>
        )}
        {(snapshot.error) && <p role="alert" className="map-journey-error">{snapshot.error}</p>}
        {snapshot.journey
          ? <JourneyDetail detail={snapshot.journey} run={run} sbb={sbb} />
          : <>
            {snapshot.route?.caption && <span className="map-journey-caption">{snapshot.route.caption}</span>}
            {journeys.length > 0 && (
              <div className="map-journey-list">
                {snapshot.earlier && <button type="button" className="map-journey-more" disabled={busy} onClick={() => act(snapshot.earlier!.action)}>{snapshot.earlier.label}</button>}
                {journeys.map((journey, index) => (
                  <React.Fragment key={journey.id}>
                    {journey.day && journey.day !== journeys[index - 1]?.day && <span className="map-journey-day">{journey.day}</span>}
                    <JourneyCard journey={journey} run={run} disabled={busy} sbb={sbb} />
                  </React.Fragment>
                ))}
                {snapshot.later && <button type="button" className="map-journey-more" disabled={busy} onClick={() => act(snapshot.later!.action)}>{snapshot.later.label}</button>}
              </div>
            )}
          </>}
        {snapshot.tiles && (
          <div className={`map-tiles${snapshot.tileSwipe ? ' is-swipe' : ''}${swipe.marks.line ? ' is-swiping' : ''}`} {...swipe.handlers}>
            {snapshot.tiles.map((tile, index) => {
              const size = tile.size ?? (tile.wide ? 'wide' : undefined)
              const marked = swipe.marks.from === tile.id ? ' is-from' : swipe.marks.via === tile.id ? ' is-via' : swipe.marks.over === tile.id ? ' is-over' : ''
              return (
                <button key={tile.id} type="button" data-tile-id={tile.id}
                  className={`map-tile${size ? ` is-${size}` : ''} is-tone-${index % 3}${tile.icon && tile.icon !== 'station' ? ' is-control' : ''}${tile.active ? ' active' : ''}${marked}`}
                  aria-pressed={tile.active} disabled={busy} onClick={() => { if (!swipe.swallow()) run(tile.action) }}>
                  {(!sbb || (tile.icon && tile.icon !== 'station')) && <span className="map-tile-icon"><TileIcon icon={tile.icon} /></span>}
                  <span className="map-tile-text">
                    {tile.place && <span className="map-tile-place">{tile.place}</span>}
                    <span className="map-tile-label">{tile.label}</span>
                    {tile.detail && <span className="map-tile-detail">{tile.detail}</span>}
                  </span>
                </button>
              )
            })}
            {swipe.marks.line && <SwipeTrace line={swipe.marks.line} />}
          </div>
        )}
        {snapshot.message && <p className="map-empty" role="status">{snapshot.message}</p>}
      </div>
      {picking && when && <WhenSheet when={when} close={() => setPicking(false)}
        apply={(next) => { setPicking(false); act(when.action, next) }}
        now={when.now ? () => { setPicking(false); act(when.now!) } : undefined} />}
    </div>
  )
}
