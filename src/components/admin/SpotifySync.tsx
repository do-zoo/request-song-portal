'use client'

import { useEffect, useRef } from 'react'

interface Props {
  eventId: string
}

export function SpotifySync({ eventId }: Props) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    async function sync() {
      try {
        await fetch(`/api/spotify/sync?eventId=${eventId}`, { method: 'POST' })
      } catch {
        // Network errors are acceptable; sync will retry on next interval
      }
    }

    sync()
    intervalRef.current = setInterval(sync, 5000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [eventId])

  return null
}
