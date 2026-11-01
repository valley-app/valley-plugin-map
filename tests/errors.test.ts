import { describe, expect, it } from 'vitest'
import { claimNetworkNotice, networkDisabled, readableError } from '../src/requests'

describe('Map error text', () => {
  it('drops repeated error prefixes and recognises the network refusal', () => {
    const refusal = new Error('Error: Error: Plugin network access is disabled in VALLEY_TEST_MODE')
    expect(readableError(refusal)).toBe('Plugin network access is disabled in VALLEY_TEST_MODE')
    expect(readableError('TypeError: Failed to fetch')).toBe('Failed to fetch')
    expect(networkDisabled(refusal)).toBe(true)
    expect(networkDisabled(new Error('Geocoding failed (500)'))).toBe(false)
    expect(claimNetworkNotice()).toBe(true)
    expect(claimNetworkNotice()).toBe(false)
  })
})
