'use client'

import { useEffect, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { skipRequest, removeRequest, reorderQueue } from '@/lib/actions/queue'
import { addToBlacklist } from '@/lib/actions/settings'
import type { SongRequest } from '@/types/database'

interface Props {
  eventId: string
  initialRequests: SongRequest[]
}

export function QueueManager({ eventId, initialRequests }: Props) {
  const [requests, setRequests] = useState<SongRequest[]>(initialRequests)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const supabase = createClient()

    async function fetchQueue() {
      const { data } = await supabase
        .from('song_requests')
        .select('*')
        .eq('event_id', eventId)
        .in('status', ['pending', 'playing'])
        .order('position')
      if (data) setRequests(data)
    }

    const channel = supabase
      .channel(`admin-queue:${eventId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'song_requests', filter: `event_id=eq.${eventId}` },
        () => fetchQueue()
      )
      .subscribe(() => fetchQueue())

    return () => { supabase.removeChannel(channel) }
  }, [eventId])

  function handleSkip(requestId: string) {
    startTransition(async () => {
      await skipRequest(requestId, eventId)
    })
  }

  function handleRemove(requestId: string) {
    startTransition(async () => {
      await removeRequest(requestId)
    })
  }

  function handleReorder(requestId: string, direction: 'up' | 'down') {
    startTransition(async () => {
      await reorderQueue(eventId, requestId, direction)
    })
  }

  function handleBlacklist(req: SongRequest) {
    startTransition(async () => {
      await addToBlacklist(eventId, req.spotify_track_id, req.track_name)
      await removeRequest(req.id)
    })
  }

  if (requests.length === 0) {
    return <p className="text-zinc-500 text-center py-8">Queue kosong</p>
  }

  return (
    <ul className="divide-y divide-zinc-100">
      {requests.map((req, i) => (
        <li key={req.id} className="flex items-center gap-3 py-3">
          <span className="text-zinc-400 text-sm w-6 text-right flex-shrink-0">
            {req.status === 'playing' ? '▶' : i + 1}
          </span>
          {req.album_art_url && (
            <img src={req.album_art_url} alt="" className="w-10 h-10 rounded flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{req.track_name}</p>
            <p className="text-zinc-500 text-xs truncate">
              {req.artist_name} · {req.requested_by}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => handleReorder(req.id, 'up')}
              disabled={isPending || i === 0 || requests[i - 1]?.status !== 'pending'}
              className="p-1 text-zinc-400 hover:text-zinc-700 disabled:opacity-30 text-xs"
              title="Move up"
            >
              ▲
            </button>
            <button
              onClick={() => handleReorder(req.id, 'down')}
              disabled={isPending || i === requests.length - 1 || req.status === 'playing'}
              className="p-1 text-zinc-400 hover:text-zinc-700 disabled:opacity-30 text-xs"
              title="Move down"
            >
              ▼
            </button>
            <button
              onClick={() => handleSkip(req.id)}
              disabled={isPending}
              className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200 disabled:opacity-50"
            >
              Skip
            </button>
            <button
              onClick={() => handleRemove(req.id)}
              disabled={isPending}
              className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50"
            >
              Remove
            </button>
            <button
              onClick={() => handleBlacklist(req)}
              disabled={isPending}
              className="px-2 py-1 text-xs bg-zinc-100 text-zinc-700 rounded hover:bg-zinc-200 disabled:opacity-50"
            >
              Ban
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
