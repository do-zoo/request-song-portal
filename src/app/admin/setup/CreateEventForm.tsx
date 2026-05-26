'use client'

import { useActionState } from 'react'
import { createEventAndConnectSpotify, type ActionState } from '@/lib/actions/event'

const initialState: ActionState = {}

export function CreateEventForm() {
  const [state, formAction, pending] = useActionState(
    createEventAndConnectSpotify,
    initialState
  )

  return (
    <form action={formAction} className="flex flex-col gap-4">
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

      {state.error && (
        <p className="text-red-500 text-sm" aria-live="polite">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-green-600 text-white rounded-lg py-3 font-medium hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {pending ? 'Memproses...' : 'Buat Event & Connect Spotify'}
      </button>
    </form>
  )
}
