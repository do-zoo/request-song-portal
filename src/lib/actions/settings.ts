'use server'

import { createServiceClient } from '@/utils/supabase/server'
import type { EventStatus } from '@/types/database'
import { z } from 'zod'

const settingsSchema = z.object({
  max_requests: z.coerce.number().int().min(0).max(100),
  cooldown_minutes: z.coerce.number().int().min(0).max(120),
  max_duration_ms: z.coerce.number().int().min(0),
  allow_explicit: z.boolean(),
})

export async function updateSettings(
  eventId: string,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const parsed = settingsSchema.safeParse({
    max_requests: formData.get('max_requests'),
    cooldown_minutes: formData.get('cooldown_minutes'),
    max_duration_ms: Number(formData.get('max_duration_minutes') ?? 0) * 60_000,
    allow_explicit: formData.get('allow_explicit') === 'on',
  })
  if (!parsed.success) return { success: false, error: 'Invalid settings values' }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('events')
    .update({ settings: parsed.data })
    .eq('id', eventId)

  return error ? { success: false, error: 'Failed to save' } : { success: true }
}

export async function updatePortalStatus(
  eventId: string,
  status: EventStatus
): Promise<void> {
  const supabase = createServiceClient()
  await supabase.from('events').update({ status }).eq('id', eventId)
}

export async function addToBlacklist(
  eventId: string,
  spotifyTrackId: string,
  trackName: string
): Promise<void> {
  const supabase = createServiceClient()
  await supabase
    .from('blacklisted_tracks')
    .upsert({ event_id: eventId, spotify_track_id: spotifyTrackId, track_name: trackName })
}

export async function removeFromBlacklist(
  eventId: string,
  spotifyTrackId: string
): Promise<void> {
  const supabase = createServiceClient()
  await supabase
    .from('blacklisted_tracks')
    .delete()
    .eq('event_id', eventId)
    .eq('spotify_track_id', spotifyTrackId)
}
