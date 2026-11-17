import { React } from '../../runtime'
import type { FC } from 'react'
import { useMap } from '../../hooks'
import { SearchHit, SearchStatus, SharedSearchBox } from '../../SearchBox'
import { uiText } from '../../localization'
import type { MapTabProps } from '../types'
import { PlaceCard } from './PlaceCard'
import { RouteCard } from './directions/RouteCard'

/** The default tab: one shared search whose result sticks around, and from it the A-to-B planner. */
export const SearchTab: FC<MapTabProps> = ({ focusToken }) => {
  const { store, snap } = useMap()
  if (!store) return null
  const showResults = !snap.selectedResult && Boolean(snap.searchQuery.trim())
  return (
    <>
    <div className="search-field-row">
      <SharedSearchBox placeholder={uiText('auto.d81a46a31fbd')} inline focusToken={focusToken} />
    </div>
    <div className="map-tab-body">
      {showResults && (
        <div className="map-result-list">
          <SearchStatus busy={snap.searchBusy} error={snap.searchError} results={snap.searchResults} />
          {snap.searchResults.map((r, i) => (
            <SearchHit
              key={`${r.lng},${r.lat},${i}`}
              result={r}
              active={i === snap.searchActiveIndex}
              onPick={() => store.pickSearchResult(r)}
            />
          ))}
        </div>
      )}

      {snap.selectedResult && <PlaceCard result={snap.selectedResult} />}
      {snap.directionsOpen && <RouteCard variant="panel" />}
    </div>
    </>
  )
}
