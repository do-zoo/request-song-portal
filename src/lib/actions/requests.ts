'use server'

import { cookies } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/server'
import { getValidToken } from '@/lib/spotify/tokens'
import { searchTracks, addToQueue } from '@/lib/spotify/client'
import { checkRateLimit, checkCooldown, checkDuration } from '@/lib/validation'
import type { SpotifyTokens, EventSettings, SpotifyTrack } from '@/types/database'
import { z } from 'zod'

export async function searchSongs(
  query: string,
  eventId: string
): Promise<{ tracks: SpotifyTrack[] } | { error: string }> {
  if (!query.trim()) return { tracks: [] }

  const supabase = await createServiceClient()
  const { data: event } = await supabase
    .from('events')
    .select('spotify_token')
    .eq('id', eventId)
    .single()

  if (!event?.spotify_token) return { error: 'Spotify belum terhubung' }

  try {
    const { token, refreshed } = await getValidToken(event.spotify_token as SpotifyTokens)
    if (refreshed) {
      await supabase.from('events').update({ spotify_token: refreshed }).eq('id', eventId)
    }
    const tracks = await searchTracks(query, token)
    return { tracks }
  } catch {
    return { error: 'Pencarian gagal, coba lagi' }
  }
}

const addRequestSchema = z.object({
  eventId: z.string().uuid(),
  spotifyTrackId: z.string().min(1),
  trackName: z.string().min(1),
  artistName: z.string().min(1),
  albumArtUrl: z.string(),
  durationMs: z.number().positive(),
})

export type AddRequestResult = { success: true } | { success: false; error: string }

export async function addRequest(
  input: z.infer<typeof addRequestSchema>
): Promise<AddRequestResult> {
  const parsed = addRequestSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: 'Data tidak valid' }

  const { eventId, spotifyTrackId, trackName, artistName, albumArtUrl, durationMs } = parsed.data
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get('session_token')?.value
  if (!sessionToken) return { success: false, error: 'Sesi tidak valid, silakan masuk lagi' }

  const supabase = await createServiceClient()

  const [{ data: event }, { data: participant }] = await Promise.all([
    supabase
      .from('events')
      .select('status, settings, spotify_token')
      .eq('id', eventId)
      .single(),
    supabase
      .from('event_participants')
      .select('id, nickname, request_count, last_played_at')
      .eq('session_token', sessionToken)
      .eq('event_id', eventId)
      .single(),
  ])

  if (!event) return { success: false, error: 'Event tidak ditemukan' }
  if (event.status !== 'open') return { success: false, error: 'Portal sedang tutup' }
  if (!participant) return { success: false, error: 'Sesi tidak valid, silakan masuk lagi' }

  const settings = event.settings as EventSettings

  const { data: blacklisted } = await supabase
    .from('blacklisted_tracks')
    .select('id')
    .eq('event_id', eventId)
    .eq('spotify_track_id', spotifyTrackId)
    .maybeSingle()
  if (blacklisted) return { success: false, error: 'Lagu ini tidak bisa di-request' }

  if (!checkDuration(durationMs, settings.max_duration_ms)) {
    const maxMins = Math.floor(settings.max_duration_ms / 60_000)
    return { success: false, error: `Lagu terlalu panjang (max ${maxMins} menit)` }
  }

  if (!checkRateLimit(participant.request_count, settings.max_requests)) {
    return { success: false, error: 'Limit reached, tunggu lagu kamu dimainkan' }
  }

  const cooldown = checkCooldown(participant.last_played_at, settings.cooldown_minutes)
  if (!cooldown.ok) {
    return { success: false, error: `Tunggu ${cooldown.minutesLeft} menit lagi` }
  }

  const { data: duplicate } = await supabase
    .from('song_requests')
    .select('id')
    .eq('event_id', eventId)
    .eq('spotify_track_id', spotifyTrackId)
    .in('status', ['pending', 'playing'])
    .maybeSingle()
  if (duplicate) return { success: false, error: 'Lagu ini sudah ada di queue' }

  const { count } = await supabase
    .from('song_requests')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .in('status', ['pending', 'playing'])
  const position = (count ?? 0) + 1

  const { error: insertError } = await supabase.from('song_requests').insert({
    event_id: eventId,
    participant_id: participant.id,
    spotify_track_id: spotifyTrackId,
    track_name: trackName,
    artist_name: artistName,
    album_art_url: albumArtUrl,
    duration_ms: durationMs,
    requested_by: participant.nickname,
    status: 'pending',
    position,
  })

  if (insertError) return { success: false, error: 'Gagal menambahkan lagu' }

  await supabase
    .from('event_participants')
    .update({ request_count: participant.request_count + 1 })
    .eq('id', participant.id)

  // Add to Spotify queue (non-fatal if it fails)
  if (event.spotify_token) {
    try {
      const { token, refreshed } = await getValidToken(event.spotify_token as SpotifyTokens)
      if (refreshed) {
        await supabase.from('events').update({ spotify_token: refreshed }).eq('id', eventId)
      }
      await addToQueue(spotifyTrackId, token)
    } catch (err) {
      console.error('Spotify add to queue failed (non-fatal):', err)
    }
  }

  return { success: true }
}
