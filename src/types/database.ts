export type EventStatus = 'open' | 'closed' | 'paused'
export type RequestStatus = 'pending' | 'playing' | 'played' | 'skipped'

export interface EventSettings {
  max_requests: number      // 0 = unlimited
  cooldown_minutes: number  // 0 = none
  max_duration_ms: number   // 0 = no limit
  allow_explicit: boolean
}

export interface SpotifyTokens {
  access_token: string
  refresh_token: string
  expires_at: number  // Unix timestamp ms
}

export interface Event {
  id: string
  pin: string
  name: string
  spotify_token: SpotifyTokens | null
  status: EventStatus
  settings: EventSettings
  created_at: string
}

export interface SongRequest {
  id: string
  event_id: string
  participant_id: string
  spotify_track_id: string
  track_name: string
  artist_name: string
  album_art_url: string
  duration_ms: number
  requested_by: string
  status: RequestStatus
  position: number
  requested_at: string
}

export interface EventParticipant {
  id: string
  event_id: string
  nickname: string
  session_token: string
  request_count: number
  last_played_at: string | null
  joined_at: string
}

export interface BlacklistedTrack {
  id: string
  event_id: string
  spotify_track_id: string
  track_name: string
  added_at: string
}

export interface SpotifyTrack {
  id: string
  name: string
  artists: Array<{ name: string }>
  album: { images: Array<{ url: string }> }
  duration_ms: number
  explicit: boolean
}
