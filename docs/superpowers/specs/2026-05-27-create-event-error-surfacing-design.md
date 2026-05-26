# Design: Create Event Error Surfacing

**Date:** 2026-05-27  
**Status:** Approved

## Problem

`createEventAndConnectSpotify` in `src/lib/actions/event.ts` has two silent failure paths:

```ts
if (!parsed.success) return        // silent — user sees 200, nothing happens
if (error || !event) return        // silent — user sees 200, nothing happens
```

When either check fails in local dev (e.g. Supabase not running, wrong credentials, constraint violation), the user gets a 200 response with no redirect and no error message. There is also no server-side logging, making the root cause impossible to diagnose.

## Goals

1. Surface errors inline in the form so the user knows what went wrong.
2. Add `console.error` logging so the server log shows the actual failure during debugging.

## Architecture

### 1. Action signature change (`src/lib/actions/event.ts`)

Change from `(formData: FormData) => Promise<void>` to the `useActionState`-compatible signature:

```ts
type ActionState = { error?: string }

export async function createEventAndConnectSpotify(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState>
```

Each silent `return` becomes a logged, named error return:

| Failure point | Log | Return |
|---|---|---|
| Zod validation fails | — | `{ error: 'Nama event tidak valid.' }` |
| DB insert fails | `console.error('[createEvent] DB insert failed:', error)` | `{ error: 'Gagal membuat event. Coba lagi.' }` |

On success, `redirect()` is called — it throws Next.js's special redirect exception and never reaches the return type, which is the correct pattern.

### 2. New Client Component (`src/app/admin/setup/CreateEventForm.tsx`)

A new `'use client'` component that owns the form interaction:

- Calls `useActionState(createEventAndConnectSpotify, {})` to wire the action and capture returned state
- Renders the existing form fields (name input + submit button)
- Shows `state.error` as an inline red error message when present
- Uses `useFormStatus` inside a child `SubmitButton` component to show a pending/disabled state while the action runs

### 3. Updated setup page (`src/app/admin/setup/page.tsx`)

The page stays a Server Component. The raw `<form action={...}>` block is replaced with `<CreateEventForm />`. The existing event display block and `?error` OAuth error handling are untouched.

## Data flow

```
User submits form
  → CreateEventForm (client) calls action via useActionState
  → createEventAndConnectSpotify runs on server
      → validation fails → returns { error: '...' } → shown inline
      → DB insert fails  → console.error + returns { error: '...' } → shown inline
      → success          → redirect() to Spotify OAuth
```

## Files to change

| File | Change |
|---|---|
| `src/lib/actions/event.ts` | Update action signature, add logging, return error states |
| `src/app/admin/setup/CreateEventForm.tsx` | **New** — Client Component with `useActionState` |
| `src/app/admin/setup/page.tsx` | Replace raw `<form>` with `<CreateEventForm />` |

## Out of scope

- Fixing any underlying root cause (e.g. missing env vars, Supabase config) — the logging will expose it
- Changes to the Spotify OAuth callback or other admin pages
