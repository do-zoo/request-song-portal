import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/proxy'

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname

  if (!path.startsWith('/admin') || path === '/admin/login') {
    return NextResponse.next()
  }

  const { supabase, response } = createClient(request)
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/admin/login', request.url))
  }

  return response
}

export const proxyConfig = {
  matcher: ['/admin/:path*'],
}
