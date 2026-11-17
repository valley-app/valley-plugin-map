import { React } from '../../../runtime'
import type { FC, ReactNode } from 'react'
import { useMap } from '../../../hooks'
import { MODES } from '../../../modes'
import { durationParts, formatDistance, formatDuration } from '../../../format'
import { splitLabel } from '../../../geocode'
import { sameSpot } from '../../../geo'
import { paddedStops, type MapStore } from '../../../store'
import { JourneyPanel } from '../../../JourneyPanel'
import type { GeoResult, Waypoint } from '../../../types'
import { uiText } from '../../../localization'
import { ChevronLeft, Navigation, X } from '../../../icons'
import { createDirectionsTab, type DirectionsTab } from './directionsTab'

/**
 * What a row shows for a filled stop. The live-position stop stores an English
 * `label` like every other record field, so the translation happens here, at the
 * one place it is chrome rather than data.
 */
const stopLabel = (stop: Waypoint): string =>
  stop.fromLiveLocation ? uiText('map.panel.currentLocation') : stop.label

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
  /** `panel` sits under the sidebar's place card; `planner` is the right sidebar's own view. */
  variant: 'panel' | 'planner'
  /** Renders the round ✕ beside the route's title. Omit to hide both. */
  onClose?: () => void
  /** Appended below the result — the right sidebar's elevation, export, import. */
  extras?: ReactNode
}

/** The planner's form provider for this view, and its latest snapshot. */
function useDirections(store: MapStore | null): { tab: DirectionsTab | null; snapshot: ReturnType<DirectionsTab['getSnapshot']> | null } {
  const tab = React.useMemo(() => store ? createDirectionsTab(store) : null, [store])
  const [snapshot, setSnapshot] = React.useState(() => tab?.getSnapshot() ?? null)
  React.useEffect(() => {
    if (!tab) return
    setSnapshot(tab.getSnapshot())
    const off = tab.subscribe(() => setSnapshot(tab.getSnapshot()))
    return () => { off(); tab.dispose() }
  }, [tab])
  return { tab, snapshot }
}

/**
 * The A-to-B planner, shared by both sidebars: travel mode, the journey form
 * (start, a via row that is always there, destination, swap, drag to reorder),
 * then either the route's time and distance with Start, or the reason there is
 * no route. One component so the two surfaces cannot drift.
 */
export const RouteCard: FC<RouteCardProps> = ({ variant, onClose, extras }) => {
  const { store, snap } = useMap()
  const { tab, snapshot } = useDirections(store)
  /**
   * Which plan the step list was opened for. Comparing it to the live plan (and
   * not tracking a boolean) means any re-plan — a mode switch, an edited stop —
   * drops back to the form with no effect and no frame of a stale list.
   */
  const [stepsFor, setStepsFor] = React.useState<string | null>(null)
  if (!store || !tab || !snapshot) return null

  const { plan, planning, planProblem, plannerMode, units } = snap
  const stops = paddedStops(snap.plannerStops)
  const heading = headingPlace(stops, snap.selectedResult)
  const ends = routeEnds(stops)
  const planKey = plan ? `${plannerMode}:${plan.distanceM}:${plan.geometry.length}` : ''
  const showSteps = stepsFor !== null && stepsFor === planKey
  // While a stop is being searched its suggestions own the space under the form.
  const suggesting = tab.suggesting()

  return (
    <div className={`map-rc map-rc--${variant}`}>
      {onClose && (
        <div className="map-rc-head">
          <div className="map-rc-headtext">
            {ends && (
              // The arrow comes from CSS: punctuation between two data values is
              // never a literal the catalogs have to carry.
              <span className="map-rc-title" title={`${ends.from} → ${ends.to}`}>
                {ends.from}
                <span className="map-rc-title-to">{ends.to}</span>
              </span>
            )}
            {ends && heading?.context && <span className="map-rc-sub">{heading.context}</span>}
          </div>
          <button className="map-rc-close" title={uiText('auto.719ea396ad92')} aria-label={uiText('auto.719ea396ad92')} onClick={onClose}>
            <X />
          </button>
        </div>
      )}

      <div className="map-segment map-mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`map-segment-btn ${plannerMode === m.id ? 'active' : ''}`}
            aria-pressed={plannerMode === m.id}
            onClick={() => store.setPlannerMode(m.id)}
            title={uiText(m.labelKey)}
            aria-label={uiText(m.labelKey)}
          >
            <m.Icon />
          </button>
        ))}
      </div>

      {!showSteps && (
        <JourneyPanel extension={tab} snapshot={snapshot} pending={false}
          run={(action, values) => { void tab.run(action, values ?? {}) }}
          onStopEnter={(id, text) => tab.enter(id, text)} onStopBlur={id => tab.blur(id)} />
      )}

      {!suggesting && planProblem && !planning && (
        <button className="map-btn map-rc-retry" onClick={() => { void store.computePlan() }}>{uiText('directions.retry')}</button>
      )}
      {/* A re-plan changes the numbers in place — it must never unmount the row.
          `is-stale` is opacity only: it says "working" without costing a pixel of layout. */}
      {!suggesting && plan && (
        <div className={`map-rc-hero ${planning ? 'is-stale' : ''}`} aria-busy={planning}>
          <HeroTime durationS={plan.durationS} />
          <span className="map-rc-chip">{formatDistance(plan.distanceM, units)}</span>
        </div>
      )}
      {!suggesting && plan?.modeApproximated && <div className="map-hint">{uiText('auto.179de46d31ef')}</div>}

      {showSteps ? (
        <>
          <button className="map-rc-back" onClick={() => setStepsFor(null)}>
            <ChevronLeft /> {uiText('auto.b52b36b7269f')}</button>
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
      ) : !suggesting && (
        <>
          {/* Start is the only action here: saving lives on the place card, where
              the bookmark switches from the place to the route while a route is open. */}
          {plan && (
            <button
              className="map-btn map-btn-primary map-rc-start"
              onClick={() => {
                store.fitPlan()
                setStepsFor(planKey)
              }}
            >
              <Navigation /> {uiText('auto.952f375412e8')}</button>
          )}
          {extras}
        </>
      )}
    </div>
  )
}
