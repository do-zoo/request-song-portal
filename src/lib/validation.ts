export function checkRateLimit(requestCount: number, maxRequests: number): boolean {
  if (maxRequests === 0) return true
  return requestCount < maxRequests
}

export function checkCooldown(
  lastPlayedAt: string | null,
  cooldownMinutes: number
): { ok: boolean; minutesLeft: number } {
  if (!lastPlayedAt || cooldownMinutes === 0) return { ok: true, minutesLeft: 0 }
  const elapsedMinutes = (Date.now() - new Date(lastPlayedAt).getTime()) / 60_000
  if (elapsedMinutes >= cooldownMinutes) return { ok: true, minutesLeft: 0 }
  return { ok: false, minutesLeft: Math.ceil(cooldownMinutes - elapsedMinutes) }
}

export function checkDuration(durationMs: number, maxDurationMs: number): boolean {
  if (maxDurationMs === 0) return true
  return durationMs <= maxDurationMs
}

export function generatePin(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export function generateSessionToken(): string {
  return crypto.randomUUID()
}
