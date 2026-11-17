import { React, api } from './runtime'
import type { FC } from 'react'
import { useMap } from './hooks'
import type { PanelTab } from './types'
import { uiText } from './localization'
import { ExtensionPanel, SidebarTabs, useSidebarExtensions } from './SidebarTabs'
import { BUILT_IN_TABS } from './tabs'

export const Panel: FC = () => {
  const { store, snap } = useMap()
  const extensions = useSidebarExtensions()
  // Bumped only by a click on the Search tab, so opening the panel never steals focus.
  const [searchFocus, setSearchFocus] = React.useState(0)
  // Child effects run first: the field has taken focus by now, so a later remount must not take it again.
  React.useEffect(() => { if (searchFocus) setSearchFocus(0) }, [searchFocus])
  if (!store) return null
  const extension = extensions.find(entry => entry.id === snap.panelTab)
  const active = snap.panelTab.startsWith('extension:') && !extension ? 'search' : snap.panelTab
  const builtIn = BUILT_IN_TABS.find(tab => tab.id === active)
  const tabs = [
    ...BUILT_IN_TABS.map(tab => ({ id: tab.id as string, icon: <tab.Icon />, label: uiText(tab.labelKey) })),
    ...extensions.map(({ id, provider }) => ({ id, label: provider.extension.label,
      icon: <svg width="1em" height="1em" viewBox={provider.extension.icon.viewBox} fill="currentColor" aria-hidden="true"><path d={provider.extension.icon.path} /></svg> }))
  ]

  return (
    <div className="panel map-panel">
      <div className="panel-header">
        <span className="panel-title">{uiText('auto.ab478f3efc84')}</span>
        <div className="map-header-actions">
          {snap.locationStatus !== 'off' && (
            <button
              className="map-locate-btn"
              disabled={snap.locationStatus === 'denied' || snap.locationStatus === 'error'}
              onClick={() => store.locateMe()}
              title={snap.locationStatus === 'denied' ? uiText('auto.aed7826804aa')
                : snap.locationStatus === 'error' ? uiText('auto.357e918caa34')
                : snap.locationStatus === 'locating' ? uiText('auto.db98b1470eef') : uiText('auto.08ceae86f774')}
            >{uiText('map.panel.currentLocation')}</button>
          )}
          <button
            className="plugin-open-page"
            onClick={() => api.workspace.openMainTab()}
            aria-label={uiText('auto.e56f29da2af3')}
            title={uiText('auto.e56f29da2af3')}
          />
        </div>
      </div>
      <SidebarTabs tabs={tabs} active={active} onSelect={id => store.setPanelTab(id as PanelTab)}
        onTabClick={id => { if (BUILT_IN_TABS.find(tab => tab.id === id)?.focusOnClick) setSearchFocus(token => token + 1) }} />
      <div className="panel-body hidescrollbar">
        {builtIn && <builtIn.Panel focusToken={builtIn.focusOnClick ? searchFocus : 0} />}
        {extension && <ExtensionPanel key={`${extension.provider.sessionId}:${extension.id}`} extension={extension.provider.extension} />}
      </div>
    </div>
  )
}
