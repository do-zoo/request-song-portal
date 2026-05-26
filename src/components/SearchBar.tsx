'use client'

import { useState, useTransition } from 'react'
import { searchSongs, addRequest } from '@/lib/actions/requests'
import { SearchResults } from './SearchResults'
import type { SpotifyTrack } from '@/types/database'

interface Props {
  eventId: string
}

export function SearchBar({ eventId }: Props) {
  const [query, setQuery] = useState('')
  const [tracks, setTracks] = useState<SpotifyTrack[]>([])
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    startTransition(async () => {
      const result = await searchSongs(query, eventId)
      if ('tracks' in result) {
        setTracks(result.tracks)
      } else {
        setMessage({ text: result.error, ok: false })
      }
    })
  }

  function handleSelect(track: SpotifyTrack) {
    setTracks([])
    setQuery('')
    startTransition(async () => {
      const result = await addRequest({
        eventId,
        spotifyTrackId: track.id,
        trackName: track.name,
        artistName: track.artists.map((a) => a.name).join(', '),
        albumArtUrl: track.album.images[0]?.url ?? '',
        durationMs: track.duration_ms,
        isExplicit: track.explicit,
      })
      setMessage({
        text: result.success ? '🎵 Lagu berhasil ditambahkan ke queue!' : result.error,
        ok: result.success,
      })
      setTimeout(() => setMessage(null), 4000)
    })
  }

  return (
    <div>
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari lagu atau artis..."
          className="flex-1 border rounded-lg px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={isPending || !query.trim()}
          className="bg-zinc-900 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {isPending ? '...' : 'Cari'}
        </button>
      </form>
      <SearchResults tracks={tracks} onSelect={handleSelect} />
      {message && (
        <p className={`mt-2 text-sm ${message.ok ? 'text-green-600' : 'text-red-500'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
