'use server'

import { createServiceClient } from '@/utils/supabase/server'
import { getValidToken } from '@/lib/spotify/tokens'
import { skipToNext } from '@/lib/spotify/client'
import type { SpotifyTokens } from '@/types/database'

export async function skipRequest(
  requestId: string,
  eventId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = createServiceClient()

  const { data: request } = await supabase
    .from('song_requests')
    .select('participant_id')
    .eq('id', requestId)
    .single()

  if (!request) return { success: false, error: 'Request not found' }

  await supabase.from('song_requests').update({ status: 'skipped' }).eq('id', requestId)

  // Free participant slot
  const { data: participant } = await supabase
    .from('event_participants')
    .select('id, request_count')
    .eq('id', request.participant_id)
    .single()

  if (participant && participant.request_count > 0) {
    await supabase
      .from('event_participants')
      .update({ request_count: participant.request_count - 1 })
      .eq('id', participant.id)
  }

  // Skip on Spotify (non-fatal)
  const { data: event } = await supabase
    .from('events')
    .select('spotify_token')
    .eq('id', eventId)
    .single()

  if (event?.spotify_token) {
    try {
      const { token, refreshed } = await getValidToken(event.spotify_token as SpotifyTokens)
      if (refreshed) {
        await supabase.from('events').update({ spotify_token: refreshed }).eq('id', eventId)
      }
      await skipToNext(token)
    } catch (err) {
      console.error('Spotify skip failed (non-fatal):', err)
    }
  }

  return { success: true }
}

export async function removeRequest(
  requestId: string
): Promise<{ success: boolean }> {
  const supabase = createServiceClient()

  const { data: request } = await supabase
    .from('song_requests')
    .select('participant_id')
    .eq('id', requestId)
    .single()

  if (!request) return { success: false }

  await supabase.from('song_requests').delete().eq('id', requestId)

  // Free participant slot
  const { data: participant } = await supabase
    .from('event_participants')
    .select('id, request_count')
    .eq('id', request.participant_id)
    .single()

  if (participant && participant.request_count > 0) {
    await supabase
      .from('event_participants')
      .update({ request_count: participant.request_count - 1 })
      .eq('id', participant.id)
  }

  return { success: true }
}

export async function reorderQueue(
  eventId: string,
  requestId: string,
  direction: 'up' | 'down'
): Promise<{ success: boolean }> {
  const supabase = createServiceClient()

  const { data: requests } = await supabase
    .from('song_requests')
    .select('id, position')
    .eq('event_id', eventId)
    .eq('status', 'pending')
    .order('position')

  if (!requests || requests.length < 2) return { success: false }

  const index = requests.findIndex((r) => r.id === requestId)
  const swapIndex = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || swapIndex < 0 || swapIndex >= requests.length) return { success: false }

  await supabase
    .from('song_requests')
    .update({ position: requests[swapIndex].position })
    .eq('id', requests[index].id)
  await supabase
    .from('song_requests')
    .update({ position: requests[index].position })
    .eq('id', requests[swapIndex].id)

  return { success: true }
}
