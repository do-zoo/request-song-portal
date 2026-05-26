'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServiceClient } from '@/utils/supabase/server'
import { generatePin, generateSessionToken } from '@/lib/validation'
import { z } from 'zod'

export type ActionState = { error?: string }

const createEventSchema = z.object({
  name: z.string().min(1).max(100).trim(),
})

export async function createEventAndConnectSpotify(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = createEventSchema.safeParse({ name: formData.get('name') })
  if (!parsed.success) return { error: 'Nama event tidak valid.' }

  const supabase = await createServiceClient()
  const pin = generatePin()

  const { data: event, error } = await supabase
    .from('events')
    .insert({ name: parsed.data.name, pin, status: 'paused' })
    .select('id')
    .single()

  if (error || !event) {
    console.error('[createEvent] DB insert failed:', error)
    return { error: 'Gagal membuat event. Coba lagi.' }
  }

  const cookieStore = await cookies()
  cookieStore.set('pending_event_id', event.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  const state = generateSessionToken()
  cookieStore.set('spotify_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    scope: 'user-modify-playback-state user-read-playback-state',
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
    state,
  })

  redirect(`https://accounts.spotify.com/authorize?${params}`)
}
