import { createServiceClient } from '@/lib/supabase/server'
import { createEventAndConnectSpotify } from '@/lib/actions/event'

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
            {error === 'oauth_failed' ? 'Spotify authorization failed. Try again.' : 'Something went wrong.'}
          </p>
        )}

        <form action={createEventAndConnectSpotify} className="flex flex-col gap-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-1">
              Nama Event
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              maxLength={100}
              placeholder="Birthday Party 2026"
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>
          <button
            type="submit"
            className="bg-green-600 text-white rounded-lg py-3 font-medium hover:bg-green-700"
          >
            Buat Event & Connect Spotify
          </button>
        </form>
      </div>
    </main>
  )
}
