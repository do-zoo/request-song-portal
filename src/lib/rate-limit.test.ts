import { describe, it, expect } from 'vitest'
import { buildRateLimitKey, isWithinWindow } from './rate-limit'

describe('buildRateLimitKey', () => {
  it('combines identifier and action', () => {
    expect(buildRateLimitKey('1.2.3.4', 'join_attempt')).toBe('1.2.3.4:join_attempt')
  })
})

describe('isWithinWindow', () => {
  it('returns true when window_start is within the window', () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    expect(isWithinWindow(recent, 10)).toBe(true)
  })
  it('returns false when window_start is outside the window', () => {
    const old = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    expect(isWithinWindow(old, 10)).toBe(false)
  })
})
