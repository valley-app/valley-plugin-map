import { React } from './runtime'
import type { CSSProperties, FC } from 'react'
import { useMap } from './hooks'
import type { GeoResult } from './types'
import { Search, X } from './icons'
import { uiText } from './localization'

type FieldProps = {
  placeholder?: string
  autoFocus?: boolean
  query: string
  results: GeoResult[]
  busy: boolean
  error: string | null
  open: boolean
  /** Hidden when the surrounding chrome already draws a magnifier (map capsule). */
  hideIcon?: boolean
  /**
   * Float the result list out of its container: it is positioned against the
   * viewport, so a dropdown opened inside the (scroll-clipped, narrow) sidebar
   * can be wider than the panel instead of wrapping every hit over five lines.
   */
  float?: boolean
  /**
   * Drop the field's box entirely — border, background, padding. Used inside a
   * directions stop row, where the row's own hover is the affordance and a
   * second outline would fight the glyph column. Opt-in, so every other caller
   * (incl. the right-sidebar planner) keeps the boxed field.
   */
  flat?: boolean
  /** Hit the keyboard cursor sits on; −1 = none. Owned by whoever holds the query. */
  activeIndex?: number
  onActiveMove?: (delta: 1 | -1) => void
  onQueryChange: (value: string) => void
  onSubmit: () => void
  onDismiss: () => void
  onPick: (result: GeoResult) => void
  onClear: () => void
}

/**
 * Searching / no matches / geocoder error — one block for all three, so the two
 * surfaces that list hits (the dropdown and the sidebar's inline list) cannot
 * describe the same three states differently. Renders nothing when there is a
 * result set to show instead.
 */
export const SearchStatus: FC<{ busy: boolean; error: string | null; results: GeoResult[] }> = ({
  busy,
  error,
  results
}) => {
  if (!busy && !error && results.length > 0) return null
  return (
    <div className="map-search-status" role="status">
      {busy ? (
        <span className="map-spinner" aria-hidden="true" />
      ) : (
        <Search className="map-search-status-icon" />
      )}
      <span className="map-search-status-text">
        {busy ? uiText('auto.1a6a5ba8c23d') : (error ?? uiText('auto.cd0af6cfca75'))}
      </span>
      {!busy && !error && <span className="map-search-status-sub">{uiText('auto.2629b9c60ccc')}</span>}
    </div>
  )
}

/** One hit: the short name, with the geocoder's region/country under it. */
export const SearchHit: FC<{ result: GeoResult; active: boolean; onPick: () => void }> = ({
  result,
  active,
  onPick
}) => (
  <button
    className={`map-search-result ${active ? 'is-active' : ''}`}
    // The cursor can leave the visible slice of a scrolled list — follow it.
    ref={(el) => {
      if (active) el?.scrollIntoView({ block: 'nearest' })
    }}
    onClick={onPick}
  >
    <span className="map-search-result-name">{result.name}</span>
    {result.context && <span className="map-search-result-sub">{result.context}</span>}
  </button>
)

/** Minimum width a floating result list gets — addresses are long. */
const FLOAT_MIN_WIDTH = 320

/** Viewport-anchored position for the floating list, tracked while it is open. */
function useFloatPosition(open: boolean, float: boolean | undefined): {
  ref: React.MutableRefObject<HTMLDivElement | null>
  style: CSSProperties | undefined
} {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const [style, setStyle] = React.useState<CSSProperties | undefined>(undefined)
  React.useEffect(() => {
    if (!open || !float) {
      setStyle(undefined)
      return
    }
    const view = ref.current?.ownerDocument.defaultView
    if (!view) return
    const measure = (): void => {
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(Math.max(rect.width, FLOAT_MIN_WIDTH), view.innerWidth - 16)
      setStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: Math.max(8, Math.min(rect.left, view.innerWidth - width - 8)),
        right: 'auto',
        width,
        maxHeight: Math.max(160, view.innerHeight - rect.bottom - 20)
      })
    }
    measure()
    // Capture-phase: the panel body scrolls, not the window.
    view.addEventListener('scroll', measure, true)
    view.addEventListener('resize', measure)
    return () => {
      view.removeEventListener('scroll', measure, true)
      view.removeEventListener('resize', measure)
    }
  }, [open, float])
  return { ref, style }
}

/** The input + dropdown markup. Stateless: whoever renders it owns the query. */
export const SearchField: FC<FieldProps> = ({
  placeholder = 'Search places…',
  autoFocus,
  query,
  results,
  busy,
  error,
  open,
  hideIcon,
  float,
  flat,
  activeIndex = -1,
  onActiveMove,
  onQueryChange,
  onSubmit,
  onDismiss,
  onPick,
  onClear
}) => {
  const { ref, style } = useFloatPosition(open, float)
  return (
    <div className={`map-search ${flat ? 'is-flat' : ''}`} ref={ref}>
      <div className="map-search-field search-field">
        {!hideIcon && <Search className="map-search-icon search-field-icon" />}
        <input
          className="map-search-input search-field-input"
          placeholder={placeholder}
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              onActiveMove?.(1)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              onActiveMove?.(-1)
            } else if (e.key === 'Enter') {
              // ↑/↓ landed on a hit → take it; otherwise Enter still re-runs the query.
              const active = results[activeIndex]
              if (active) onPick(active)
              else onSubmit()
            } else if (e.key === 'Escape') onDismiss()
          }}
        />
        {query && (
          <button className="map-search-clear search-field-action" type="button" title={uiText('auto.719ea396ad92')} onClick={onClear}>
            <X />
          </button>
        )}
      </div>
      {open && (
        <div className={`map-search-results ${float ? 'is-float' : ''}`} style={style}>
          <SearchStatus busy={busy} error={error} results={results} />
          {results.map((r, i) => (
            <SearchHit key={`${r.lng},${r.lat},${i}`} result={r} active={i === activeIndex} onPick={() => onPick(r)} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The shared search: query, results and the picked place live in the store, so
 * the map capsule and the sidebar tab always show the same thing and nothing is
 * lost when either unmounts. Results render inline (not as a dropdown) wherever
 * `inline` is set — that's the sidebar's Google-style list.
 */
export const SharedSearchBox: FC<{
  placeholder?: string
  autoFocus?: boolean
  hideIcon?: boolean
  /** Sidebar mode: results are listed below the field by the panel, not in a dropdown. */
  inline?: boolean
}> = ({ placeholder, autoFocus, hideIcon, inline }) => {
  const { store, snap } = useMap()
  if (!store) return null
  const hasHits = snap.searchBusy || snap.searchResults.length > 0 || Boolean(snap.searchError)
  return (
    <SearchField
      placeholder={placeholder}
      autoFocus={autoFocus}
      hideIcon={hideIcon}
      query={snap.searchQuery}
      results={snap.searchResults}
      busy={snap.searchBusy}
      error={snap.searchError}
      open={!inline && Boolean(snap.searchQuery.trim()) && hasHits}
      activeIndex={snap.searchActiveIndex}
      onActiveMove={(delta) => store.moveSearchActive(delta)}
      onQueryChange={(v) => store.setSearchQuery(v)}
      onSubmit={() => void store.runSearch()}
      onDismiss={() => store.clearSearch()}
      onPick={(r) => store.pickSearchResult(r)}
      onClear={() => store.clearSearch()}
    />
  )
}
