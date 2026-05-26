'use server'

import { cookies, headers } from 'next/headers'
import { createServiceClient } from '@/utils/supabase/server'
import { generateSessionToken } from '@/lib/validation'
import { checkRateLimitDb } from '@/lib/rate-limit'
import { z } from 'zod'

const joinSchema = z.object({
  pin: z.string().length(6).regex(/^\d{6}$/),
  nickname: z.string().min(1).max(30).trim(),
})

export type JoinResult =
  | { success: true; pin: string }
  | { success: false; error: string }

export async function joinEvent(formData: FormData): Promise<JoinResult> {
  const parsed = joinSchema.safeParse({
    pin: formData.get('pin'),
    nickname: formData.get('nickname'),
  })
  if (!parsed.success) return { success: false, error: 'PIN harus 6 digit angka' }

  const { pin, nickname } = parsed.data
  const supabase = createServiceClient()

  const headersList = await headers()
  const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const { allowed } = await checkRateLimitDb(supabase, ip, 'join_attempt', 5, 10)
  if (!allowed) {
    return { success: false, error: 'Terlalu banyak percobaan. Coba lagi dalam 10 menit.' }
  }

  const { data: event } = await supabase
    .from('events')
    .select('id, status')
    .eq('pin', pin)
    .single()

  if (!event) return { success: false, error: 'PIN tidak valid' }
  if (event.status === 'closed') return { success: false, error: 'Portal ini sudah ditutup' }

  // Check for duplicate nickname in this event
  const { data: existingParticipant } = await supabase
    .from('event_participants')
    .select('id')
    .eq('event_id', event.id)
    .eq('nickname', nickname)
    .maybeSingle()

  if (existingParticipant) {
    return { success: false, error: 'Nickname sudah dipakai, pilih yang lain' }
  }

  const sessionToken = generateSessionToken()
  const { error: insertError } = await supabase.from('event_participants').insert({
    event_id: event.id,
    nickname,
    session_token: sessionToken,
  })

  if (insertError) return { success: false, error: 'Gagal bergabung, coba lagi' }

  const cookieStore = await cookies()
  cookieStore.set('session_token', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60,
    path: '/',
  })

  return { success: true, pin }
}
