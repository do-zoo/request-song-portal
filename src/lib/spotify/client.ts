import type { SpotifyTrack } from '@/types/database'

const API = 'https://api.spotify.com/v1'

async function spotifyFetch(path: string, token: string, options: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  })
  if (!res.ok && res.status !== 204) {
    throw new Error(`Spotify API error ${res.status} on ${path}`)
  }
  return res
}

export async function searchTracks(query: string, token: string): Promise<SpotifyTrack[]> {
  const params = new URLSearchParams({ q: query, type: 'track', limit: '10' })
  const res = await spotifyFetch(`/search?${params}`, token)
  const data = await res.json()
  return data.tracks.items as SpotifyTrack[]
}

export async function addToQueue(spotifyTrackId: string, token: string): Promise<void> {
  const params = new URLSearchParams({ uri: `spotify:track:${spotifyTrackId}` })
  await spotifyFetch(`/me/player/queue?${params}`, token, { method: 'POST' })
}

export async function getCurrentlyPlaying(
  token: string
): Promise<{ trackId: string; isPlaying: boolean } | null> {
  const res = await fetch(`${API}/me/player/currently-playing`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 204 || !res.ok) return null
  const data = await res.json()
  if (!data.item) return null
  return { trackId: data.item.id as string, isPlaying: data.is_playing as boolean }
}

export async function skipToNext(token: string): Promise<void> {
  await spotifyFetch('/me/player/next', token, { method: 'POST' })
}
