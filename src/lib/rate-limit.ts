import type { SupabaseClient } from '@supabase/supabase-js'

export function buildRateLimitKey(identifier: string, action: string): string {
  return `${identifier}:${action}`
}

export function isWithinWindow(windowStart: string, windowMinutes: number): boolean {
  const elapsed = (Date.now() - new Date(windowStart).getTime()) / 60_000
  return elapsed < windowMinutes
}

export async function checkRateLimitDb(
  supabase: SupabaseClient,
  identifier: string,
  action: string,
  maxCount: number,
  windowMinutes: number
): Promise<{ allowed: boolean }> {
  const windowStart = new Date(Date.now() - windowMinutes * 60_000).toISOString()

  const { data: existing } = await supabase
    .from('rate_limits')
    .select('id, count')
    .eq('identifier', identifier)
    .eq('action', action)
    .gte('window_start', windowStart)
    .order('window_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!existing) {
    await supabase.from('rate_limits').insert({ identifier, action, count: 1 })
    return { allowed: true }
  }

  if (existing.count >= maxCount) return { allowed: false }

  await supabase
    .from('rate_limits')
    .update({ count: existing.count + 1 })
    .eq('id', existing.id)

  return { allowed: true }
}
