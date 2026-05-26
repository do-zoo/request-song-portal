import { describe, it, expect } from 'vitest'
import {
  checkRateLimit,
  checkCooldown,
  checkDuration,
  generatePin,
  generateSessionToken,
} from './validation'

describe('checkRateLimit', () => {
  it('returns true when max_requests is 0 (unlimited)', () => {
    expect(checkRateLimit(99, 0)).toBe(true)
  })
  it('returns true when under limit', () => {
    expect(checkRateLimit(2, 3)).toBe(true)
  })
  it('returns false when at limit', () => {
    expect(checkRateLimit(3, 3)).toBe(false)
  })
  it('returns false when over limit', () => {
    expect(checkRateLimit(5, 3)).toBe(false)
  })
})

describe('checkCooldown', () => {
  it('returns ok when lastPlayedAt is null', () => {
    expect(checkCooldown(null, 10)).toEqual({ ok: true, minutesLeft: 0 })
  })
  it('returns ok when cooldownMinutes is 0', () => {
    const recent = new Date().toISOString()
    expect(checkCooldown(recent, 0)).toEqual({ ok: true, minutesLeft: 0 })
  })
  it('returns ok when cooldown has elapsed', () => {
    const past = new Date(Date.now() - 11 * 60 * 1000).toISOString()
    expect(checkCooldown(past, 10)).toEqual({ ok: true, minutesLeft: 0 })
  })
  it('returns not ok with minutesLeft when still in cooldown', () => {
    const past = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const result = checkCooldown(past, 10)
    expect(result.ok).toBe(false)
    expect(result.minutesLeft).toBe(5)
  })
})

describe('checkDuration', () => {
  it('returns true when maxDurationMs is 0 (no limit)', () => {
    expect(checkDuration(99999999, 0)).toBe(true)
  })
  it('returns true when duration is under max', () => {
    expect(checkDuration(300000, 600000)).toBe(true)
  })
  it('returns false when duration exceeds max', () => {
    expect(checkDuration(700000, 600000)).toBe(false)
  })
  it('returns true when duration equals max', () => {
    expect(checkDuration(600000, 600000)).toBe(true)
  })
})

describe('generatePin', () => {
  it('generates a 6-digit numeric string', () => {
    const pin = generatePin()
    expect(pin).toMatch(/^\d{6}$/)
  })
  it('generates different pins each call', () => {
    const pins = new Set(Array.from({ length: 10 }, generatePin))
    expect(pins.size).toBeGreaterThan(1)
  })
})

describe('generateSessionToken', () => {
  it('generates a valid UUID v4', () => {
    const token = generateSessionToken()
    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })
  it('generates unique tokens each call', () => {
    const tokens = new Set(Array.from({ length: 5 }, generateSessionToken))
    expect(tokens.size).toBe(5)
  })
})
