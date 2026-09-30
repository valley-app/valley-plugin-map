import { React, api } from './runtime'
import type { FC, ReactElement, ReactNode } from 'react'
import { useMap } from './hooks'
import { MODES } from './modes'
import { durationParts, formatDistance, formatDuration } from './format'
import { splitLabel } from './geocode'
import { sameSpot } from './geo'
import { paddedStops } from './store'
import type { GeoResult, Waypoint } from './types'
import { uiText } from './localization'
import {
  ChevronRight,
  FinishFlag,
  Navigation,
  PlusCircle,
  StartDot,
  Star,
  SwapVertical,
  ViaSquare,
  X
} from './icons'

/** What a stop is, which is also which glyph it wears. */
type StopKind = 'origin' | 'via' | 'dest'

const stopKind = (index: number, total: number): StopKind =>
  index === 0 ? 'origin' : index === total - 1 ? 'dest' : 'via'

/** Start ring at the top of the dashed spine, finish flag at the bottom, square
 *  for anything in between. */
const STOP_GLYPH: Record<StopKind, () => ReactElement> = {
  origin: () => <StartDot />,
  via: () => <ViaSquare />,
  dest: () => <FinishFlag />
}

/**
 * What a row shows for a filled stop. The live-position stop stores an English
 * `label` like every other record field, so the translation happens here, at the
 * one place it is chrome rather than data.
 */
const stopLabel = (stop: Waypoint): string =>
  stop.fromLiveLocation ? uiText('auto.37e3a3f3e023') : stop.label

/** Placeholder for an empty slot: start, destination, or a via in between. */
function stopPlaceholder(index: number, total: number): string {
  if (index === 0) return uiText('auto.de80b1147345')
  if (index === total - 1) return uiText('auto.d465aaf82e26')
  return uiText('auto.e014c93b23e1')
}

/**
 * Chromium's default drag image is a snapshot of the row's painted box, and the
 * row paints no background — which renders as a hard-edged white card. Hand it
 * an opaque, rounded clone instead (same trick as the chrome's chip drags).
 */
function setRowDragImage(dataTransfer: DataTransfer, el: HTMLElement): void {
  if (!dataTransfer.setDragImage) return
  const rect = el.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const ghost = el.cloneNode(true) as HTMLElement
  ghost.classList.add('map-drag-ghost')
  ghost.style.width = `${rect.width}px`
  ghost.style.height = `${rect.height}px`
  el.ownerDocument.body.appendChild(ghost)
  dataTransfer.setDragImage(ghost, rect.width / 2, rect.height / 2)
  el.ownerDocument.defaultView?.setTimeout(() => ghost.remove(), 0)
}

/**
 * One stop of the route: a filled label or a search box to fill it. Rows are
 * drag-reorderable (and ⌥↑/⌥↓ for keyboards), so the order can be shuffled
 * after the fact instead of being retyped.
 */
const StopRow: FC<{
  index: number
  total: number
  stop: Waypoint | null
  dropTarget: number | null
  onDragState: (index: number | null) => void
}> = ({ index, total, stop, dropTarget, onDragState }) => {
  const { store, snap } = useMap()
  const dragIndex = React.useRef<number | null>(null)
  const [query, setQuery] = React.useState('')
  if (!store) return null

  const pickFavourite = (target: HTMLElement): void => {
    if (snap.places.length === 0) return
    void api.ui
      .openMenu(
        snap.places.map((p) => ({ id: p.id, label: p.name })),
        { anchor: target, align: 'start' }
      )
      .then((id) => {
        const place = snap.places.find((p) => p.id === id)
        if (place) store.setStop(index, { lng: place.lng, lat: place.lat, label: place.name, placeId: place.id })
      })
  }

  const move = (delta: -1 | 1): void => {
    const to = index + delta
    if (to >= 0 && to < total) store.reorderStops(index, to)
  }

  const kind = stopKind(index, total)

  return (
    <div
      className={`map-dir-row ${dropTarget === index ? 'is-drop-target' : ''}`}
      draggable
      onDragStart={(e) => {
        dragIndex.current = index
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', String(index))
        setRowDragImage(e.dataTransfer, e.currentTarget)
        onDragState(null)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        onDragState(index)
      }}
      onDragLeave={() => onDragState(null)}
      onDragEnd={() => onDragState(null)}
      onDrop={(e) => {
        e.preventDefault()
        const from = Number(e.dataTransfer.getData('text/plain') || dragIndex.current)
        onDragState(null)
        dragIndex.current = null
        if (Number.isFinite(from) && from !== index) store.reorderStops(from, index)
      }}
      onKeyDown={(e) => {
        if (!e.altKey) return
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          move(-1)
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          move(1)
        }
      }}
      tabIndex={0}
      role="listitem"
      aria-label={stop ? stopLabel(stop) : stopPlaceholder(index, total)}
    >
      <span className="map-dir-glyph" data-kind={kind} aria-hidden="true">
        {STOP_GLYPH[kind]()}
      </span>
      {stop ? (
        <>
          <span className="map-dir-label" title={stopLabel(stop)}>
            {stopLabel(stop)}
          </span>
          <button
            className="map-row-action"
            title={uiText('auto.5e5dfbbe894d')}
            aria-label={uiText('auto.5e5dfbbe894d')}
            onClick={() => (total > 2 ? store.removeStop(index) : store.setStop(index, null))}
          >
            <X />
          </button>
        </>
      ) : (
        <div className="map-dir-field">
          <api.ui.ResourcePicker
            value={query}
            onChange={(value, result) => {
              setQuery(value)
              const lng = Number(result?.metadata?.longitude)
              const lat = Number(result?.metadata?.latitude)
              if (Number.isFinite(lng) && Number.isFinite(lat)) {
                store.setStop(index, { lng, lat, label: value })
                setQuery('')
              }
            }}
            kinds={['place']}
            allowCustom={false}
            placeholder={stopPlaceholder(index, total)}
            ariaLabel={stopPlaceholder(index, total)}
          />
          {snap.places.length > 0 && (
            <button
              className="map-row-action map-dir-fav"
              title={uiText('auto.5fc147d92720')}
              aria-label={uiText('auto.5fc147d92720')}
              onClick={(e) => pickFavourite(e.currentTarget)}
            >
              <Star />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The card's subtitle: where this route is going, as `name · region`.
 *
 * Prefers the picked search hit, whose halves the geocoder already split
 * properly; falls back to re-splitting the stop's own label. Returns null when
 * there is nothing to say — an empty muted line reads as a layout bug in a
 * 245px sidebar.
 */
function headingPlace(
  stops: (Waypoint | null)[],
  selected: GeoResult | null
): { name: string; context?: string } | null {
  const filled = stops.filter((s): s is Waypoint => s !== null)
  const target = filled[filled.length - 1]
  if (!target) return null
  if (selected && sameSpot(selected, target)) return { name: selected.name, context: selected.context }
  return splitLabel(target.label, '')
}

/**
 * The two ends of the route, once both are filled. The card titles itself with
 * them — "Birmenstorf → Sion" says what this plan is, where a static "Plan
 * route" said only what the panel is. Null while the form is half-filled, which
 * is when the static title still has to stand in.
 */
function routeEnds(stops: (Waypoint | null)[]): { from: string; to: string } | null {
  const from = stops[0]
  const to = stops[stops.length - 1]
  if (!from || !to || stops.length < 2) return null
  return { from: stopLabel(from), to: stopLabel(to) }
}

/** The big duration: numerals the card sets large, unit words it sets small.
 *  The units are JSX text so they reach the translation catalogs — a string
 *  returned from `format.ts` never would (the extractor only scans `.tsx`). */
const HeroTime: FC<{ durationS: number }> = ({ durationS }) => {
  const p = durationParts(durationS)
  if (!p.valid) return <div className="map-rc-time">—</div>
  return (
    <div className="map-rc-time" title={formatDuration(durationS)}>
      {p.hours > 0 && (
        <>
          <span className="map-rc-num">{p.hours}</span>
          <span className="map-rc-unit">{uiText('auto.27d5482eebd0')}</span>
        </>
      )}
      {p.seconds === 0 && (p.minutes > 0 || p.hours === 0) && (
        <>
          <span className="map-rc-num">{p.minutes}</span>
          <span className="map-rc-unit">{uiText('auto.b6c935d4f3c7')}</span>
        </>
      )}
      {p.seconds > 0 && (
        <>
          <span className="map-rc-num">{p.seconds}</span>
          <span className="map-rc-unit">{uiText('auto.a0f1490a20d0')}</span>
        </>
      )}
    </div>
  )
}

export interface RouteCardProps {
  /** `panel` nests inside the sidebar's place card (tighter, no frame of its
   *  own); `planner` draws the standalone card. */
  variant: 'panel' | 'planner'
  /** Heading. Omit where the surface already titles itself (`.panel-title`). */
  title?: string
  /** Renders the round ✕. Omit to hide it. */
  onClose?: () => void
  /** Appended below the footer — the right sidebar's elevation, export, import. */
  extras?: ReactNode
}

/**
 * The route planner, shared by both sidebars: stops, travel mode, the live
 * summary, save, and turn-by-turn. One component so the two surfaces cannot
 * drift — they previously rendered the same state through different markup, and
 * through two different editing models.
 */
export const RouteCard: FC<RouteCardProps> = ({ variant, title, onClose, extras }) => {
  const { store, snap } = useMap()
  const [dropTarget, setDropTarget] = React.useState<number | null>(null)
  /**
   * Which plan the step list was opened for. Comparing it to the live plan (and
   * not tracking a boolean) means any re-plan — a mode switch, an edited stop —
   * drops back to the form with no effect and no frame of a stale list.
   */
  const [stepsFor, setStepsFor] = React.useState<string | null>(null)
  if (!store) return null

  const { plan, planning, planError, plannerMode, units } = snap
  const stops = paddedStops(snap.plannerStops)
  const heading = headingPlace(stops, snap.selectedResult)
  const ends = routeEnds(stops)
  const planKey = plan ? `${plannerMode}:${plan.distanceM}:${plan.geometry.length}` : ''
  const showSteps = stepsFor !== null && stepsFor === planKey

  return (
    <div className={`map-rc map-rc--${variant}`}>
      {(title || onClose || heading || ends) && (
        <div className="map-rc-head">
          <div className="map-rc-headtext">
            {ends ? (
              // The arrow comes from CSS for the same reason the sub's middot
              // does — punctuation between two data values is never a literal
              // the catalogs have to carry.
              <span className="map-rc-title" title={`${ends.from} → ${ends.to}`}>
                {ends.from}
                <span className="map-rc-title-to">{ends.to}</span>
              </span>
            ) : (
              title && <span className="map-rc-title">{title}</span>
            )}
            {/* With both ends already in the title, the line under it keeps only
                the destination's region: repeating "Sion" directly beneath
                "… → Sion" is noise in a 245px sidebar. */}
            {ends
              ? heading?.context && <span className="map-rc-sub">{heading.context}</span>
              : heading && (
                  <span
                    className="map-rc-sub"
                    title={heading.context ? `${heading.name}, ${heading.context}` : heading.name}
                  >
                    {heading.name}
                    {heading.context && <span className="map-rc-sub-context">{heading.context}</span>}
                  </span>
                )}
          </div>
          {onClose && (
            <button
              className="map-rc-close"
              title={uiText('auto.719ea396ad92')}
              aria-label={uiText('auto.719ea396ad92')}
              onClick={onClose}
            >
              <X />
            </button>
          )}
        </div>
      )}

      <div className="map-segment map-mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`map-segment-btn ${plannerMode === m.id ? 'active' : ''}`}
            onClick={() => store.setPlannerMode(m.id)}
            title={uiText(m.labelKey)}
            aria-label={uiText(m.labelKey)}
          >
            <m.Icon />
          </button>
        ))}
      </div>

      {planError && <div className="map-error">{planError}</div>}
      {/* A re-plan changes the numbers in place — it must never unmount the row.
          Dropping it while the router works (and re-adding it after) collapsed
          the card by the row's full height and snapped it back, so every mode
          switch made the whole panel jump. `is-stale` is opacity only, for the
          same reason: it says "working" without costing a pixel of layout. */}
      {plan && (
        <div className={`map-rc-hero ${planning ? 'is-stale' : ''}`} aria-busy={planning}>
          <HeroTime durationS={plan.durationS} />
          <span className="map-rc-chip">{formatDistance(plan.distanceM, units)}</span>
        </div>
      )}
      {plan?.modeApproximated && <div className="map-hint">{uiText('auto.179de46d31ef')}</div>}

      {showSteps ? (
        <>
          <hr className="map-rc-rule" />
          <button className="map-rc-back" onClick={() => setStepsFor(null)}>
            <ChevronRight /> {uiText('auto.b52b36b7269f')}</button>
          {plan?.steps?.length ? (
            <ol className="map-rc-steps">
              {/* `instruction` is provider data — Mapbox and ORS return it already
                  localised, and OSRM's is synthesized in `routing.ts`. It must
                  never be routed through the UI catalogs. */}
              {plan.steps.map((step, i) => (
                <li className="map-rc-step" key={i}>
                  <span className="map-rc-step-no">{i + 1}</span>
                  <span className="map-rc-step-text">{step.instruction}</span>
                  <span className="map-rc-step-dist">{formatDistance(step.distanceM, units)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="map-hint">{uiText('auto.3437b669091f')}</div>
          )}
        </>
      ) : (
        <>
          <hr className="map-rc-rule" />
          {/* Stops and the ⇅ are siblings so `align-items:center` parks the swap
              against the middle of the whole block — between the two fields. */}
          <div className="map-rc-spine">
            <div className="map-dir-stops" role="list">
              {stops.map((stop, i) => (
                <StopRow
                  key={`stop-${i}`}
                  index={i}
                  total={stops.length}
                  stop={stop}
                  dropTarget={dropTarget}
                  onDragState={setDropTarget}
                />
              ))}
            </div>
            <button
              className="map-dir-swap"
              title={uiText('auto.f8667add92a9')}
              aria-label={uiText('auto.f8667add92a9')}
              onClick={() => store.swapDirections()}
            >
              <SwapVertical />
            </button>
          </div>

          <button className="map-add-stop-btn" onClick={() => store.addStop()}>
            <span className="map-dir-glyph" aria-hidden="true"><PlusCircle /></span>
            {uiText('auto.3fbed4b959d7')}</button>

          <hr className="map-rc-rule" />
          {/* Start is the only footer action: saving lives on the card above,
              where the bookmark switches from the place to the route while a
              route is open — one save affordance, not two. */}
          <div className="map-rc-foot">
            <button
              className="map-btn map-btn-primary map-rc-start"
              disabled={!plan}
              onClick={() => {
                store.fitPlan()
                setStepsFor(planKey)
              }}
            >
              <Navigation /> {uiText('auto.952f375412e8')}</button>
          </div>
          {extras}
        </>
      )}
    </div>
  )
}
