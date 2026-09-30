/**
 * What the note panel shows while a **Map tab** is in front.
 *
 * The metadata panel's subject is normally the open file; a map is not a file,
 * so before the `pluginTabs` half of `metadataPanel.segment` existed the panel
 * said "No file open" beside a full-screen map. This is the answer to "what am I
 * actually looking at": where the camera is, what is selected, what the planned
 * route costs, how big the library is, and whether the device has a fix.
 *
 * Every value is read from the same store snapshot the map itself renders from,
 * so a reading here can never disagree with what is on screen. Service facts
 * resolve from the current map style and the same settings used by requests.
 */
import type { FC, ReactNode } from 'react'
import { React, api } from './runtime'
import { useMap } from './hooks'
import { mapColorMode, mapLayer, mapLayers } from './settings'
import { formatDistance, formatDuration, formatLatLng, formatLength } from './format'
import type { MapSnapshot } from './store'
import type { Place } from './types'
import { uiText } from './localization'
import { mapServiceFacts } from './metadata'
import { MapProviderSelect } from './ProviderPanel'

/** One label/value line. `mono` is for coordinates and other figures that should
 *  line up in a column rather than read as prose; `control` centres the label on
 *  a field instead of the text baseline. */
const Fact: FC<{ label: string; children: ReactNode; mono?: boolean; control?: boolean }> = ({
  label,
  children,
  mono,
  control
}) => (
  <div className={control ? 'props-info-row map-props-control-row' : 'props-info-row'}>
    <dt className="props-info-key">{label}</dt>
    <dd className="props-info-value" style={mono ? { fontVariantNumeric: 'tabular-nums' } : undefined}>{children}</dd>
  </div>
)

const Section: FC<{ title: string; children: ReactNode }> = ({ title, children }) => (
  <dl className="props-info-table" aria-label={title}>
    {children}
  </dl>
)

// Aliased rather than written inline as `MapSnapshot['locationStatus']`: the
// literal-localizer treats a `status`-named declaration as human text and would
// pull the indexed-access key into the catalog as a UI string.
type LocationStatusId = MapSnapshot['locationStatus']
type ModeId = MapSnapshot['plannerMode']

/** How long ago a fix arrived. A stale position is the one thing about live
 *  location worth knowing at a glance. */
const FixAge: FC<{ ts: number; now: number }> = ({ ts, now }) => {
  const seconds = Math.max(0, Math.round((now - ts) / 1000))
  if (seconds < 60) return <>{uiText('auto.59bfd0ed5123', { p0: seconds })}</>
  return <>{uiText('auto.8210b643017c', { p0: Math.round(seconds / 60) })}</>
}

const LocationStatus: FC<{ status: LocationStatusId }> = ({ status }) => {
  if (status === 'active') return <>{uiText('auto.e81a151bd050')}</>
  if (status === 'locating') return <>{uiText('auto.e46bab00ebd2')}</>
  if (status === 'denied') return <>{uiText('auto.f5c021daa3d0')}</>
  if (status === 'error') return <>{uiText('auto.2c9c1f79142d')}</>
  return <>{uiText('auto.e3de5ab0ca4c')}</>
}

export const MapProviderField: FC = () => <Fact label={uiText('surface.provider')} control><MapProviderSelect /></Fact>

export const MapColorModeField: FC = () => {
  const { store, snap } = useMap()
  const { SelectField } = api.ui.settings
  if (!store) return null
  return <Fact label={uiText('surface.colorMode')} control>
    <SelectField className="map-select-fill" ariaLabel={uiText('surface.colorMode')} value={snap.colorMode} disabled={Boolean(store.settings().offlineBasemapPath)} options={[
      { value: 'system', label: uiText('style.system') },
      { value: 'light', label: uiText('style.light') },
      { value: 'dark', label: uiText('style.dark') }
    ]} onChange={(value) => store.setColorMode(mapColorMode(value) ?? snap.colorMode)} />
  </Fact>
}

export const MapLayerField: FC = () => {
  const { store, snap } = useMap()
  const { SelectField } = api.ui.settings
  if (!store) return null
  const settings = store.settings()
  return <Fact label={uiText('surface.style')} control>
    <SelectField className="map-select-fill" ariaLabel={uiText('surface.style')} value={mapLayer(snap.style, settings)} disabled={Boolean(settings.offlineBasemapPath)} options={mapLayers(settings).map((choice) => ({
      value: choice.id, label: uiText(choice.labelKey)
    }))} onChange={(value) => store.setStyle(mapLayer(value, settings))} />
  </Fact>
}

/** The planner's own mode words (Drive / Walk / Bike), not a second vocabulary
 *  for the same three modes. Resolved at render time rather than through
 *  `MODES`, whose labels are built at module scope — before `initLocalization`
 *  has replaced the English fallback. */
const TravelMode: FC<{ mode: ModeId }> = ({ mode }) => {
  if (mode === 'walking') return <>{uiText('auto.e0c705d18e3f')}</>
  if (mode === 'cycling') return <>{uiText('auto.3a12a2c6c506')}</>
  return <>{uiText('auto.a02bb4593793')}</>
}

export const MetadataSegment: FC = () => {
  const { store, snap } = useMap()
  // The fix age has to move on its own — nothing else in the snapshot changes
  // while a position simply gets older. One tick a second, only while a fix is
  // on screen: an unselected panel segment is unmounted, so a background tab
  // costs nothing.
  const [now, setNow] = React.useState(() => Date.now())
  const hasFix = snap.liveLocation !== null
  React.useEffect(() => {
    if (!hasFix) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [hasFix])

  if (!store) return null

  const { camera, plan, plannerStops, savedRouteId, selectedResult, units } = snap
  const selectedPlace: Place | null =
    snap.places.find((place) => place.id === snap.selectedPlaceId) ?? null
  const stops = plannerStops.filter((stop): stop is NonNullable<typeof stop> => stop !== null)
  const visibleSources = snap.pinSources.filter((source) => !source.hidden).length

  return (
    <div className="props-info">
      <Section title={uiText('auto.5e99cfe83bb4')}>
        <MapProviderField />
        <MapColorModeField />
        <MapLayerField />
        {camera ? (
          <>
            <Fact label={uiText('auto.16e5447a8046')} mono>
              {formatLatLng(camera.lat, camera.lng)}
            </Fact>
            <Fact label={uiText('auto.9b3cbed5c490')} mono>
              {camera.zoom.toFixed(1)}
            </Fact>
            {(camera.bearing !== 0 || camera.pitch !== 0) && (
              <Fact label={uiText('auto.86e4e3875420')} mono>
                {uiText('auto.0d20f6696a9c', { p0: Math.round(camera.bearing), p1: Math.round(camera.pitch) })}
              </Fact>
            )}
          </>
        ) : (
          <div className="map-meta-empty">{uiText('auto.b3d6096fa965')}</div>
        )}
      </Section>

      {(selectedPlace || selectedResult) && (
        <Section title={uiText('auto.d1f8e5ea93b2')}>
          {selectedPlace ? (
            <>
              <Fact label={uiText('auto.74c59ad06d47')}>{selectedPlace.name}</Fact>
              <Fact label={uiText('auto.8ebebca01959')} mono>
                {formatLatLng(selectedPlace.lat, selectedPlace.lng)}
              </Fact>
              {selectedPlace.category && (
                <Fact label={uiText('auto.a3c686e711e4')}>{selectedPlace.category}</Fact>
              )}
              {selectedPlace.note && <Fact label={uiText('auto.7cc501fe489b')}>{selectedPlace.note}</Fact>}
            </>
          ) : (
            selectedResult && (
              <>
                <Fact label={uiText('auto.88a9b07d73a2')}>{selectedResult.name}</Fact>
                {selectedResult.context && <Fact label={uiText('auto.0f217179940c')}>{selectedResult.context}</Fact>}
                <Fact label={uiText('auto.8ebebca01959')} mono>
                  {formatLatLng(selectedResult.lat, selectedResult.lng)}
                </Fact>
              </>
            )
          )}
        </Section>
      )}

      {(plan || stops.length > 0) && (
        <Section title={uiText('auto.4999528efe0f')}>
          <Fact label={uiText('auto.f9e60b508698')}>
            <TravelMode mode={snap.plannerMode} />
          </Fact>
          {stops.length > 0 && (
            <Fact label={uiText('auto.0e648419ea80')}>{stops.map((stop) => stop.label).join(' → ')}</Fact>
          )}
          {plan && (
            <>
              <Fact label={uiText('auto.423208095dd7')} mono>
                {formatDistance(plan.distanceM, units)}
              </Fact>
              <Fact label={uiText('auto.1370004da76f')} mono>
                {formatDuration(plan.durationS)}
              </Fact>
              {plan.ascentM !== undefined && plan.descentM !== undefined && (
                <Fact label={uiText('auto.a514da1094ce')} mono>
                  {uiText('auto.f94ca293e064', { p0: formatLength(plan.ascentM, units), p1: formatLength(plan.descentM, units) })}
                </Fact>
              )}
              {plan.steps && plan.steps.length > 0 && (
                <Fact label={uiText('auto.f4c3d25386a1')} mono>
                  {plan.steps.length}
                </Fact>
              )}
            </>
          )}
          <Fact label={uiText('auto.c0ae8f6ea841')}>{savedRouteId ? uiText('auto.5397e0583f14') : uiText('auto.3d56409d02fb')}</Fact>
          {plan?.modeApproximated && (
            <div className="map-meta-empty">
              {uiText('auto.bba3ad3ea062')}</div>
          )}
        </Section>
      )}

      <Section title={uiText('auto.b8100f5ba8bd')}>
        <Fact label={uiText('auto.364519ea990b')} mono>
          {snap.places.length}
        </Fact>
        <Fact label={uiText('auto.7da3c8a1a3fd')} mono>
          {snap.routes.length}
        </Fact>
        <Fact label={uiText('auto.adc1a3bbeae6')} mono>
          {uiText('auto.aaad3f45e0a8', { p0: snap.sourcePins.length, p1: visibleSources })}
        </Fact>
      </Section>

      <Section title={uiText('auto.37e3a3f3e023')}>
        <Fact label={uiText('auto.bae7d5be7082')}>
          <LocationStatus status={snap.locationStatus} />
        </Fact>
        {snap.liveLocation && (
          <>
            <Fact label={uiText('auto.cf1c85adba54')} mono>
              {formatLatLng(snap.liveLocation.lat, snap.liveLocation.lng)}
            </Fact>
            <Fact label={uiText('auto.12a3a4f498b2')} mono>
              {`± ${formatDistance(snap.liveLocation.accuracy, units)}`}
            </Fact>
            <Fact label={uiText('auto.4cff3d9735e9')} mono>
              <FixAge ts={snap.liveLocation.ts} now={now} />
            </Fact>
          </>
        )}
      </Section>
      <Section title={uiText('surface.services')}>
        {mapServiceFacts(store.settings(), snap.style).filter(fact => fact.id !== 'map.provider').map((fact) => (
          <Fact key={fact.id} label={uiText(fact.labelKey)}>{fact.value}</Fact>
        ))}
      </Section>
    </div>
  )
}
