'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SongRequest } from '@/types/database'

interface Props {
  eventId: string
  initialRequests: SongRequest[]
}

export function QueueList({ eventId, initialRequests }: Props) {
  const [requests, setRequests] = useState<SongRequest[]>(initialRequests)
  const [isConnected, setIsConnected] = useState(true)

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
      .channel(`queue:${eventId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'song_requests',
          filter: `event_id=eq.${eventId}`,
        },
        () => fetchQueue()
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED')
        if (status === 'SUBSCRIBED') fetchQueue()
      })

    return () => { supabase.removeChannel(channel) }
  }, [eventId])

  if (requests.length === 0) {
    return (
      <p className="text-zinc-500 text-center py-8 text-sm">
        Queue kosong. Jadi yang pertama request!
      </p>
    )
  }

  return (
    <>
      {!isConnected && (
        <p className="text-xs text-yellow-600 mb-2">Reconnecting to live queue...</p>
      )}
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
              <p className="text-zinc-500 text-xs truncate">{req.artist_name}</p>
            </div>
            <span className="text-zinc-400 text-xs flex-shrink-0">{req.requested_by}</span>
          </li>
        ))}
      </ul>
    </>
  )
}
