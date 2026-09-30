import { React } from './runtime'
import type { FC } from 'react'
import type { ElevationPoint } from './types'
import { useMap } from './hooks'
import { formatDistance, formatLength } from './format'
import { uiText } from './localization'

const W = 280
const H = 88
const PAD = 4

/** A compact SVG area chart of elevation vs. cumulative distance. */
export const ElevationProfile: FC<{ profile: ElevationPoint[]; ascentM?: number; descentM?: number }> = ({
  profile,
  ascentM,
  descentM
}) => {
  const { snap } = useMap()
  const units = snap.units
  const [hover, setHover] = React.useState<ElevationPoint | null>(null)

  const geom = React.useMemo(() => {
    if (profile.length < 2) return null
    const maxDist = profile[profile.length - 1].distanceM || 1
    let minEle = Infinity
    let maxEle = -Infinity
    for (const p of profile) {
      if (p.elevationM < minEle) minEle = p.elevationM
      if (p.elevationM > maxEle) maxEle = p.elevationM
    }
    const span = Math.max(1, maxEle - minEle)
    const x = (d: number): number => PAD + (d / maxDist) * (W - 2 * PAD)
    const y = (e: number): number => PAD + (1 - (e - minEle) / span) * (H - 2 * PAD)
    const pts = profile.map((p) => `${x(p.distanceM).toFixed(1)},${y(p.elevationM).toFixed(1)}`)
    const line = `M${pts.join(' L')}`
    const area = `${line} L${x(maxDist).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`
    return { line, area, minEle, maxEle, maxDist, x, y }
  }, [profile])

  if (!geom) return null

  const onMove = (e: React.MouseEvent<SVGSVGElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const target = ratio * geom.maxDist
    let best = profile[0]
    for (const p of profile) if (Math.abs(p.distanceM - target) < Math.abs(best.distanceM - target)) best = p
    setHover(best)
  }

  return (
    <div className="map-elev">
      <div className="map-elev-head">
        <span className="map-elev-title">{uiText('auto.a514da1094ce')}</span>
        <span className="map-elev-stats">
          {ascentM != null && <span className="map-elev-up">↑ {formatLength(ascentM, units)}</span>}
          {descentM != null && <span className="map-elev-down">↓ {formatLength(descentM, units)}</span>}
        </span>
      </div>
      <svg
        className="map-elev-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <path d={geom.area} className="map-elev-area" />
        <path d={geom.line} className="map-elev-line" />
        {hover && (
          <g>
            <line
              x1={geom.x(hover.distanceM)}
              x2={geom.x(hover.distanceM)}
              y1={PAD}
              y2={H - PAD}
              className="map-elev-cursor"
            />
            <circle cx={geom.x(hover.distanceM)} cy={geom.y(hover.elevationM)} r={3} className="map-elev-dot" />
          </g>
        )}
      </svg>
      <div className="map-elev-foot">
        {hover ? (
          <span>
            {formatDistance(hover.distanceM, units)} · {formatLength(hover.elevationM, units)}
          </span>
        ) : (
          <span>
            {formatLength(geom.minEle, units)}–{formatLength(geom.maxEle, units)}
          </span>
        )}
      </div>
    </div>
  )
}
