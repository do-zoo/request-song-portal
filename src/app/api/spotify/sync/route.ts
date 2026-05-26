import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/server'
import { getCurrentlyPlaying } from '@/lib/spotify/client'
import { getValidToken } from '@/lib/spotify/tokens'
import type { SpotifyTokens } from '@/types/database'

export async function POST(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get('eventId')
  if (!eventId) return NextResponse.json({ error: 'Missing eventId' }, { status: 400 })

  const supabase = createServiceClient()

  const { data: event } = await supabase
    .from('events')
    .select('spotify_token')
    .eq('id', eventId)
    .single()

  if (!event?.spotify_token) return NextResponse.json({ ok: true })

  try {
    const tokens = event.spotify_token as SpotifyTokens
    const { token, refreshed } = await getValidToken(tokens)
    if (refreshed) {
      await supabase.from('events').update({ spotify_token: refreshed }).eq('id', eventId)
    }

    const playing = await getCurrentlyPlaying(token)
    if (!playing) return NextResponse.json({ ok: true })

    // Find any currently-marked-playing request
    const { data: currentPlaying } = await supabase
      .from('song_requests')
      .select('id, spotify_track_id, participant_id')
      .eq('event_id', eventId)
      .eq('status', 'playing')
      .maybeSingle()

    // If track changed from what we marked as playing, mark it played
    if (currentPlaying && currentPlaying.spotify_track_id !== playing.trackId) {
      await supabase
        .from('song_requests')
        .update({ status: 'played' })
        .eq('id', currentPlaying.id)

      // Free participant slot + record play time for cooldown
      const { data: participant } = await supabase
        .from('event_participants')
        .select('id, request_count')
        .eq('id', currentPlaying.participant_id)
        .single()

      if (participant) {
        await supabase
          .from('event_participants')
          .update({
            request_count: Math.max(0, participant.request_count - 1),
            last_played_at: new Date().toISOString(),
          })
          .eq('id', participant.id)
      }
    }

    // Mark the currently playing track as 'playing' in our queue (if we have it as pending)
    if (!currentPlaying || currentPlaying.spotify_track_id !== playing.trackId) {
      const { data: pendingMatch } = await supabase
        .from('song_requests')
        .select('id')
        .eq('event_id', eventId)
        .eq('spotify_track_id', playing.trackId)
        .eq('status', 'pending')
        .maybeSingle()

      if (pendingMatch) {
        await supabase
          .from('song_requests')
          .update({ status: 'playing' })
          .eq('id', pendingMatch.id)
      }
    }
  } catch (err) {
    console.error('Spotify sync error:', err)
  }

  return NextResponse.json({ ok: true })
}
