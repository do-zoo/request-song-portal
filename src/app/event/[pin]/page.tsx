import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServiceClient } from '@/utils/supabase/server'
import { SearchBar } from '@/components/SearchBar'
import { QueueList } from '@/components/QueueList'

export default async function EventPage({
  params,
}: {
  params: Promise<{ pin: string }>
}) {
  const { pin } = await params
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get('session_token')?.value

  if (!sessionToken) {
    redirect(`/?pin=${pin}`)
  }

  const supabase = createServiceClient()

  const { data: event } = await supabase
    .from('events')
    .select('id, name, status')
    .eq('pin', pin)
    .single()

  if (!event) redirect('/?error=invalid_pin')

  const { data: participant } = await supabase
    .from('event_participants')
    .select('id, nickname')
    .eq('session_token', sessionToken)
    .eq('event_id', event.id)
    .single()

  if (!participant) redirect('/?error=invalid_session')

  const { data: requests } = await supabase
    .from('song_requests')
    .select('*')
    .eq('event_id', event.id)
    .in('status', ['pending', 'playing'])
    .order('position')

  return (
    <main className="max-w-lg mx-auto px-4 py-8 min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{event.name}</h1>
          <p className="text-sm text-zinc-500">Hi, {participant.nickname}!</p>
        </div>
        {event.status !== 'open' && (
          <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full">
            {event.status === 'paused' ? 'Paused' : 'Closed'}
          </span>
        )}
      </div>

      {event.status === 'open' ? (
        <div className="mb-8">
          <h2 className="font-semibold mb-3">Request Lagu</h2>
          <SearchBar eventId={event.id} />
        </div>
      ) : (
        <div className="mb-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          {event.status === 'paused'
            ? 'Request lagu sedang ditunda sementara oleh host.'
            : 'Portal request sudah ditutup.'}
        </div>
      )}

      <div>
        <h2 className="font-semibold mb-3">Queue</h2>
        <QueueList eventId={event.id} initialRequests={requests ?? []} />
      </div>
    </main>
  )
}
