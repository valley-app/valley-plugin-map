import { describe, expect, it, vi } from 'vitest'
import { createMockValleyApi } from './harness'
import { initRuntime } from '../src/runtime'
import { mapIconSvg, refreshMapIcons, sanitizePinSvg } from '../src/pinIcons'

const fern = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M4 4L40 40" stroke="currentColor"/></svg>'

describe('vault map icons', () => {
  it('discovers user files and refreshes edited artwork', async () => {
    const mock = createMockValleyApi({ manifest: { id: 'map', drivers: ['files'] } })
    initRuntime(mock.api)
    let svg = fern
    const read = vi.spyOn(mock.api.backend, 'call').mockImplementation(async () => ({ icons: { pin: fern, fern: svg }, failed: [] }))
    await refreshMapIcons(mock.api)
    expect(mapIconSvg('fern', mock.api)).toContain('viewBox="0 0 48 48"')
    svg = fern.replace('M4 4L40 40', 'M8 8L32 32')
    await refreshMapIcons(mock.api)
    expect(mapIconSvg('fern', mock.api)).toContain('M8 8L32 32')
    expect(read).toHaveBeenCalledWith('pinIcons', {})
  })

  it('removes executable SVG content and rejects malformed or empty files', () => {
    const svg = sanitizePinSvg(fern.replace('<path', '<script>alert(1)</script><image href="https://example.com/a"/><path onclick="alert(1)" style="fill:red"'))
    expect(svg).not.toMatch(/script|image|href|onclick|style=/)
    expect(svg).toContain('width="24"')
    expect(() => sanitizePinSvg('<svg/>')).toThrow()
    expect(() => sanitizePinSvg(fern.replace('0 0 48 48', '0 0 0 48'))).toThrow()
    expect(() => sanitizePinSvg('<!DOCTYPE svg>'+fern)).toThrow()
  })

  it('isolates catalogs between vault sessions', async () => {
    const first = createMockValleyApi({ manifest: { id: 'map', drivers: ['files'] } })
    const second = createMockValleyApi({ manifest: { id: 'map', drivers: ['files'] } })
    expect(mapIconSvg('unknown', first.api)).toBe(mapIconSvg('pin', second.api))
  })
})
