// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { visibleTimer } from '../src/visibleTimer'

describe('visibleTimer', () => {
  let hidden = false
  const setHidden = (value: boolean): void => { hidden = value; document.dispatchEvent(new Event('visibilitychange')) }
  beforeEach(() => { hidden = false; Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden }); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); delete (document as { hidden?: boolean }).hidden })

  it('ticks while shown, arms nothing while hidden and refreshes when shown again', () => {
    const tick = vi.fn()
    const stop = visibleTimer(document, tick, 1000)
    expect(tick).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3000)
    expect(tick).toHaveBeenCalledTimes(4)
    setHidden(true)
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(60_000)
    expect(tick).toHaveBeenCalledTimes(4)
    setHidden(false)
    expect(tick).toHaveBeenCalledTimes(5)
    stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
