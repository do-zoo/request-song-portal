'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { joinEvent } from '@/lib/actions/participant'

interface Props {
  defaultPin?: string
}

export function JoinForm({ defaultPin }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await joinEvent(formData)
      if (result.success) {
        router.push(`/event/${result.pin}`)
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm flex flex-col gap-4">
      <div>
        <label htmlFor="pin" className="block text-sm font-medium mb-1">
          Kode Event
        </label>
        <input
          id="pin"
          name="pin"
          type="text"
          inputMode="numeric"
          maxLength={6}
          pattern="\d{6}"
          defaultValue={defaultPin}
          placeholder="123456"
          required
          className="w-full border rounded-lg px-3 py-2 text-center text-3xl tracking-widest font-mono"
        />
      </div>
      <div>
        <label htmlFor="nickname" className="block text-sm font-medium mb-1">
          Nickname
        </label>
        <input
          id="nickname"
          name="nickname"
          type="text"
          maxLength={30}
          placeholder="Your name"
          required
          className="w-full border rounded-lg px-3 py-2"
        />
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="bg-zinc-900 text-white rounded-lg py-3 font-semibold disabled:opacity-50"
      >
        {isPending ? 'Memuat...' : 'Masuk ke Event'}
      </button>
    </form>
  )
}
