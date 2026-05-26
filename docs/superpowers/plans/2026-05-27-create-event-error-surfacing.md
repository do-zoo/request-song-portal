# Create Event Error Surfacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface inline errors when `createEventAndConnectSpotify` fails, and add server-side logging so the root cause is visible in the dev server console.

**Architecture:** The Server Action adopts the `useActionState`-compatible signature and returns typed error states instead of silently returning. A new `CreateEventForm` Client Component wires the action via `useActionState` and renders inline errors and a pending state on the submit button. The setup page stays a Server Component and simply renders the new form component.

**Tech Stack:** Next.js 16 App Router, React 19 `useActionState`, TypeScript, Tailwind CSS

---

## File Map

| File | Change |
|---|---|
| `src/lib/actions/event.ts` | Modify — update action signature, add `console.error`, return `ActionState` |
| `src/app/admin/setup/CreateEventForm.tsx` | **Create** — Client Component with `useActionState` |
| `src/app/admin/setup/page.tsx` | Modify — replace raw `<form>` with `<CreateEventForm />` |

---

## Task 1: Update the Server Action

**Files:**
- Modify: `src/lib/actions/event.ts`

- [ ] **Step 1: Open the file and understand current shape**

  Current signature is `(formData: FormData) => Promise<void>`. It has two silent `return` statements that need to become typed error returns.

- [ ] **Step 2: Replace the full file contents**

  ```ts
  'use server'

  import { cookies } from 'next/headers'
  import { redirect } from 'next/navigation'
  import { createServiceClient } from '@/lib/supabase/server'
  import { generatePin, generateSessionToken } from '@/lib/validation'
  import { z } from 'zod'

  export type ActionState = { error?: string }

  const createEventSchema = z.object({
    name: z.string().min(1).max(100).trim(),
  })

  export async function createEventAndConnectSpotify(
    _prev: ActionState,
    formData: FormData
  ): Promise<ActionState> {
    const parsed = createEventSchema.safeParse({ name: formData.get('name') })
    if (!parsed.success) return { error: 'Nama event tidak valid.' }

    const supabase = await createServiceClient()
    const pin = generatePin()

    const { data: event, error } = await supabase
      .from('events')
      .insert({ name: parsed.data.name, pin, status: 'paused' })
      .select('id')
      .single()

    if (error || !event) {
      console.error('[createEvent] DB insert failed:', error)
      return { error: 'Gagal membuat event. Coba lagi.' }
    }

    const cookieStore = await cookies()
    cookieStore.set('pending_event_id', event.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    })

    const state = generateSessionToken()
    cookieStore.set('spotify_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    })

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.SPOTIFY_CLIENT_ID!,
      scope: 'user-modify-playback-state user-read-playback-state',
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
      state,
    })

    redirect(`https://accounts.spotify.com/authorize?${params}`)
  }
  ```

- [ ] **Step 3: Verify TypeScript compiles**

  ```bash
  pnpm build 2>&1 | grep -E "error TS|src/lib/actions/event"
  ```

  Expected: no TypeScript errors on that file.

- [ ] **Step 4: Commit**

  ```bash
  git add src/lib/actions/event.ts
  git commit -m "fix: add logging and typed error returns to createEventAndConnectSpotify"
  ```

---

## Task 2: Create the `CreateEventForm` Client Component

**Files:**
- Create: `src/app/admin/setup/CreateEventForm.tsx`

- [ ] **Step 1: Create the file**

  ```tsx
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
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  pnpm build 2>&1 | grep -E "error TS|CreateEventForm"
  ```

  Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/admin/setup/CreateEventForm.tsx
  git commit -m "feat: CreateEventForm client component with useActionState error display"
  ```

---

## Task 3: Wire `CreateEventForm` into the setup page

**Files:**
- Modify: `src/app/admin/setup/page.tsx`

- [ ] **Step 1: Replace the raw `<form>` block with `<CreateEventForm />`**

  Find this block in `page.tsx` (lines 44–65):

  ```tsx
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
  ```

  Replace it with:

  ```tsx
  <CreateEventForm />
  ```

- [ ] **Step 2: Update imports at the top of `page.tsx`**

  Remove the `createEventAndConnectSpotify` import and add `CreateEventForm`:

  ```tsx
  import { createServiceClient } from '@/lib/supabase/server'
  import { CreateEventForm } from './CreateEventForm'
  ```

- [ ] **Step 3: Full resulting file should look like this**

  ```tsx
  import { createServiceClient } from '@/lib/supabase/server'
  import { CreateEventForm } from './CreateEventForm'

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

          <CreateEventForm />
        </div>
      </main>
    )
  }
  ```

- [ ] **Step 4: Verify full build passes**

  ```bash
  pnpm build 2>&1 | tail -20
  ```

  Expected: `✓ Compiled successfully` or similar, no errors.

- [ ] **Step 5: Start dev server and test manually**

  ```bash
  pnpm dev
  ```

  1. Navigate to `http://localhost:3000/admin/setup`
  2. Submit the form with a valid name — if Supabase/Spotify env vars are missing, you should now see a red error message inline instead of nothing happening
  3. Check the terminal running `pnpm dev` — if the DB insert fails, `[createEvent] DB insert failed: ...` should appear in the server log with the actual error
  4. Fix whatever the log reveals (e.g. run `pnpm db:push` if migrations haven't been applied, or check `.env.local` for missing vars)

- [ ] **Step 6: Commit**

  ```bash
  git add src/app/admin/setup/page.tsx
  git commit -m "refactor: use CreateEventForm client component in admin setup page"
  ```
