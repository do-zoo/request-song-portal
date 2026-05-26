'use client'

import { useState, useTransition } from 'react'
import { updateSettings, removeFromBlacklist } from '@/lib/actions/settings'
import type { EventSettings, BlacklistedTrack } from '@/types/database'

interface Props {
  eventId: string
  settings: EventSettings
  blacklist: BlacklistedTrack[]
}

export function SettingsForm({ eventId, settings, blacklist }: Props) {
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await updateSettings(eventId, formData)
      if (result.success) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    })
  }

  function handleRemoveBlacklist(spotifyTrackId: string) {
    startTransition(async () => {
      await removeFromBlacklist(eventId, spotifyTrackId)
    })
  }

  return (
    <div className="space-y-8">
      <form onSubmit={handleSubmit} className="space-y-6">
        <h2 className="font-semibold text-lg">Request Limits</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Max requests per user
            </label>
            <input
              name="max_requests"
              type="number"
              min={0}
              max={100}
              defaultValue={settings.max_requests}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
            <p className="text-xs text-zinc-400 mt-1">0 = unlimited</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Cooldown (minutes)
            </label>
            <input
              name="cooldown_minutes"
              type="number"
              min={0}
              max={120}
              defaultValue={settings.cooldown_minutes}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
            <p className="text-xs text-zinc-400 mt-1">0 = no cooldown</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Max song duration (minutes)
            </label>
            <input
              name="max_duration_minutes"
              type="number"
              min={0}
              defaultValue={Math.floor(settings.max_duration_ms / 60_000)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
            <p className="text-xs text-zinc-400 mt-1">0 = no limit</p>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input
              id="allow_explicit"
              name="allow_explicit"
              type="checkbox"
              defaultChecked={settings.allow_explicit}
              className="w-4 h-4"
            />
            <label htmlFor="allow_explicit" className="text-sm font-medium">
              Allow explicit content
            </label>
          </div>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="bg-zinc-900 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saved ? 'Saved!' : isPending ? 'Saving...' : 'Save Settings'}
        </button>
      </form>

      <div>
        <h2 className="font-semibold text-lg mb-3">Blacklisted Tracks</h2>
        {blacklist.length === 0 ? (
          <p className="text-sm text-zinc-500">No blacklisted tracks.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 border rounded-lg overflow-hidden">
            {blacklist.map((track) => (
              <li key={track.id} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm">{track.track_name}</span>
                <button
                  onClick={() => handleRemoveBlacklist(track.spotify_track_id)}
                  disabled={isPending}
                  className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-zinc-400 mt-2">
          To blacklist a song, use the queue manager: hover a song and click &quot;Blacklist&quot;.
        </p>
      </div>
    </div>
  )
}
