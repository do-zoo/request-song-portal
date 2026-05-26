import { createServiceClient } from '@/utils/supabase/server'
import { QueueManager } from '@/components/admin/QueueManager'
import { SpotifySync } from '@/components/admin/SpotifySync'
import { redirect } from 'next/navigation'

export default async function AdminQueuePage() {
  const supabase = createServiceClient()

  const { data: event } = await supabase
    .from('events')
    .select('id, name, pin, status')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!event) redirect('/admin/setup')

  const eventId = event.id

  const { data: requests } = await supabase
    .from('song_requests')
    .select('*')
    .eq('event_id', eventId)
    .in('status', ['pending', 'playing'])
    .order('position')

  async function toggleStatus() {
    'use server'
    const supabase = createServiceClient()
    const { data: current } = await supabase
      .from('events')
      .select('status')
      .eq('id', eventId)
      .single()
    const newStatus = current?.status === 'open' ? 'paused' : 'open'
    await supabase.from('events').update({ status: newStatus }).eq('id', eventId)
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{event.name}</h1>
          <p className="text-sm text-zinc-500">PIN: <span className="font-mono font-bold text-zinc-900">{event.pin}</span></p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs px-2 py-1 rounded-full ${
              event.status === 'open'
                ? 'bg-green-100 text-green-800'
                : 'bg-yellow-100 text-yellow-800'
            }`}
          >
            {event.status}
          </span>
          <form action={toggleStatus}>
            <button
              type="submit"
              className="text-sm border rounded-lg px-3 py-1.5 hover:bg-zinc-50"
            >
              {event.status === 'open' ? 'Pause' : 'Open'}
            </button>
          </form>
          <a href="/admin/settings" className="text-sm text-zinc-500 hover:text-zinc-900">
            Settings →
          </a>
        </div>
      </div>

      <QueueManager eventId={eventId} initialRequests={requests ?? []} />
      <SpotifySync eventId={eventId} />
    </main>
  )
}
