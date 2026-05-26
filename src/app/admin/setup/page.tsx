import { createServiceClient } from '@/lib/supabase/server'
import { CreateEventForm } from './CreateEventForm'

export default async function AdminSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  const supabase = await createServiceClient()
  const { data: existingEvent } = await supabase
    .from('events')
    .select('id, name, pin, status')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6">Setup Event</h1>

        {existingEvent && (
          <div className="mb-6 p-4 bg-zinc-50 rounded-lg border">
            <p className="text-sm text-zinc-600">Event aktif:</p>
            <p className="font-semibold">{existingEvent.name}</p>
            <p className="text-sm text-zinc-500">PIN: {existingEvent.pin}</p>
            <a
              href="/admin/queue"
              className="mt-2 inline-block text-sm text-blue-600 underline"
            >
              Ke Dashboard →
            </a>
          </div>
        )}

        {error && (
          <p className="mb-4 text-red-500 text-sm">
            {error === 'oauth_failed'
              ? 'Otorisasi Spotify gagal. Coba lagi.'
              : error === 'token_failed'
              ? 'Gagal mendapatkan token Spotify. Coba lagi.'
              : 'Terjadi kesalahan. Coba lagi.'}
          </p>
        )}

        <CreateEventForm />
      </div>
    </main>
  )
}
