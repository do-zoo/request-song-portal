import { describe, it, expect } from 'vitest'
import { isExpired } from './tokens'
import type { SpotifyTokens } from '@/types/database'

describe('isExpired', () => {
  it('returns false when token expires in the future (past buffer)', () => {
    const tokens: SpotifyTokens = {
      access_token: 'tok',
      refresh_token: 'ref',
      expires_at: Date.now() + 120_000, // 2 minutes from now
    }
    expect(isExpired(tokens)).toBe(false)
  })

  it('returns true when token expires within the 60s buffer', () => {
    const tokens: SpotifyTokens = {
      access_token: 'tok',
      refresh_token: 'ref',
      expires_at: Date.now() + 30_000, // 30s from now — inside 60s buffer
    }
    expect(isExpired(tokens)).toBe(true)
  })

  it('returns true when token is already expired', () => {
    const tokens: SpotifyTokens = {
      access_token: 'tok',
      refresh_token: 'ref',
      expires_at: Date.now() - 1000,
    }
    expect(isExpired(tokens)).toBe(true)
  })
})
