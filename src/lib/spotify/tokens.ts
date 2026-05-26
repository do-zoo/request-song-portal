import type { SpotifyTokens } from '@/types/database'

export function isExpired(tokens: SpotifyTokens): boolean {
  return Date.now() >= tokens.expires_at - 60_000
}

export async function refreshAccessToken(tokens: SpotifyTokens): Promise<SpotifyTokens> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: process.env.SPOTIFY_CLIENT_ID!,
      client_secret: process.env.SPOTIFY_CLIENT_SECRET!,
    }),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`)
  const data = await res.json()
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  }
}

// Returns a valid access token, refreshing if needed.
// Returns refreshed tokens when a refresh occurred so the caller can persist them.
export async function getValidToken(tokens: SpotifyTokens): Promise<{
  token: string
  refreshed: SpotifyTokens | null
}> {
  if (!isExpired(tokens)) return { token: tokens.access_token, refreshed: null }
  const refreshed = await refreshAccessToken(tokens)
  return { token: refreshed.access_token, refreshed }
}
