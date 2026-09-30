import type { MapSettings } from './types'
import { effectiveSearchProvider, parseAccountProviderChoice } from './settings'

export const GEOCODE_SEARCH_LIMIT = 8
export const PUBLIC_SEARCH_URL = 'https://nominatim.openstreetmap.org/search'
export const ACCOUNT_SEARCH_URL = 'https://api.mapbox.com/search/geocode/v6/forward'
export const PUBLIC_SEARCH_ID = JSON.stringify([1, PUBLIC_SEARCH_URL, 'jsonv2', GEOCODE_SEARCH_LIMIT])

export function searchProviderIdentity(settings: MapSettings): string {
  const choice = effectiveSearchProvider(settings)
  const account = parseAccountProviderChoice(choice)
  return account ? JSON.stringify([1, ACCOUNT_SEARCH_URL, GEOCODE_SEARCH_LIMIT, account.provider, account.connectionId]) : PUBLIC_SEARCH_ID
}
