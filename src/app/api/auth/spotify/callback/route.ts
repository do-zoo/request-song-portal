import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const oauthError = searchParams.get('error')

  const storedState = request.cookies.get('spotify_oauth_state')?.value
  const eventId = request.cookies.get('pending_event_id')?.value

  if (oauthError || !code || !state || state !== storedState || !eventId) {
    return NextResponse.redirect(
      new URL('/admin/setup?error=oauth_failed', request.url)
    )
  }

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
      client_id: process.env.SPOTIFY_CLIENT_ID!,
      client_secret: process.env.SPOTIFY_CLIENT_SECRET!,
    }),
  })

  if (!tokenRes.ok) {
    return NextResponse.redirect(
      new URL('/admin/setup?error=token_failed', request.url)
    )
  }

  const tokenData = await tokenRes.json()
  const tokens = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: Date.now() + tokenData.expires_in * 1000,
  }

  const supabase = await createServiceClient()
  await supabase
    .from('events')
    .update({ spotify_token: tokens, status: 'open' })
    .eq('id', eventId)

  const response = NextResponse.redirect(new URL('/admin/queue', request.url))
  response.cookies.delete('spotify_oauth_state')
  response.cookies.delete('pending_event_id')
  return response
}
