import { describe, it, expectTypeOf } from 'vitest'
import type { EventSettings, SpotifyTokens, SongRequest } from './database'

describe('database types', () => {
  it('EventSettings has required fields', () => {
    const s: EventSettings = {
      max_requests: 3,
      cooldown_minutes: 10,
      max_duration_ms: 600000,
      allow_explicit: true,
    }
    expectTypeOf(s.max_requests).toBeNumber()
    expectTypeOf(s.allow_explicit).toBeBoolean()
  })

  it('SpotifyTokens has expires_at as number', () => {
    const t: SpotifyTokens = {
      access_token: 'tok',
      refresh_token: 'ref',
      expires_at: Date.now(),
    }
    expectTypeOf(t.expires_at).toBeNumber()
  })

  it('SongRequest status union is correct', () => {
    const r: SongRequest['status'] = 'pending'
    expectTypeOf(r).toEqualTypeOf<'pending' | 'playing' | 'played' | 'skipped'>()
  })
})
