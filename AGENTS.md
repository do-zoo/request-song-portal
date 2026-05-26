<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

## Commands

```bash
pnpm dev          # Start dev server
pnpm build        # Production build
pnpm lint         # ESLint
pnpm test         # Vitest (single run)
pnpm test:watch   # Vitest watch mode
pnpm db:push      # Push migrations to Supabase
pnpm db:reset     # Reset local Supabase DB
```

Run a single test file: `pnpm vitest run src/lib/rate-limit.test.ts`

## Architecture Overview

**Song request portal** — attendees at an event join via a 6-digit PIN, enter a nickname, and request songs from Spotify. The host manages the queue via an admin dashboard.

### Stack

- Next.js 16 (App Router) + React 19 + React Compiler (`reactCompiler: true`)
- Supabase (Postgres + Realtime + Auth)
- Tailwind CSS v4, shadcn/ui (radix-ui), Zod
- Vitest for unit tests

### Route structure

| Path                         | Role                                                     |
| ---------------------------- | -------------------------------------------------------- |
| `/`                          | Landing — join form (PIN + nickname)                     |
| `/event/[pin]`               | Participant view — search songs, see queue               |
| `/admin/setup`               | Host creates event and connects Spotify OAuth            |
| `/admin/queue`               | Host manages queue, pause/open portal                    |
| `/admin/settings`            | Configurable limits and track blacklist                  |
| `/admin/login`               | Supabase Auth login for admin                            |
| `/api/auth/spotify/callback` | Spotify OAuth callback                                   |
| `/api/spotify/sync`          | Polled every 5 s by admin to sync Spotify playback state |

### Supabase clients

- **`src/lib/supabase/server.ts`** — `createClient()` (anon key, respects RLS) and `createServiceClient()` (service role, bypasses RLS). All Server Actions and API routes use `createServiceClient`.
- **`src/lib/supabase/client.ts`** — `createClient()` browser client (anon key), used in Client Components for Realtime subscriptions.

RLS is enabled on all tables. Only `song_requests` and `blacklisted_tracks` have anon-readable policies (required for Realtime with the anon key). Everything else goes through the service role.

### Auth model (two separate systems)

1. **Admin auth** — Supabase Auth (email/password). The `proxy()` function in `src/proxy.ts` is the middleware guard; it redirects unauthenticated requests to `/admin/login`. This file exports `config.matcher` rather than living at `middleware.ts` — check how it's wired before modifying.

2. **Participant auth** — cookie-based session token (`session_token` cookie, `httpOnly`). On join, a UUID is inserted into `event_participants.session_token` and set as a cookie. Server Actions look up the participant via this token.

### Server Actions (`src/lib/actions/`)

All actions use `'use server'` and `createServiceClient`. Pattern:

1. Validate input with Zod
2. Look up session cookie to identify the participant
3. Enforce business rules (rate limits, cooldown, explicit content, blacklist, duplicate check)
4. Mutate DB
5. Fire-and-forget Spotify API call (non-fatal — wrapped in try/catch)

### Spotify integration (`src/lib/spotify/`)

- **`tokens.ts`** — `getValidToken()` refreshes expired tokens automatically; callers must persist `refreshed` tokens back to the DB when non-null.
- **`client.ts`** — thin wrappers over Spotify Web API: `searchTracks`, `addToQueue`, `getCurrentlyPlaying`, `skipToNext`.
- OAuth flow: `createEventAndConnectSpotify` (Server Action) → Spotify authorize URL → `/api/auth/spotify/callback` stores tokens and sets event `status = 'open'`.

### Rate limiting (`src/lib/rate-limit.ts`)

DB-backed (`rate_limits` table). Two use cases:

- `join_attempt` — 5 per IP per 10 min
- `search` — 20 per session token per 1 min

### Database schema highlights

- `events.settings` (JSONB) holds `{ max_requests, cooldown_minutes, max_duration_ms, allow_explicit }`. 0 means unlimited/disabled.
- `song_requests.position` is used for ordering; reorder swaps positions between two rows.
- `event_participants.request_count` is incremented on add and decremented on skip/remove/played.
- `event_participants.last_played_at` is set when a track transitions to `played`, enforcing the cooldown.

### Spotify sync polling

`SpotifySync` (Client Component, rendered on admin queue page) fires `POST /api/spotify/sync?eventId=…` every 5 seconds. The route compares `currently-playing` from Spotify against the DB queue and transitions statuses (`pending → playing → played`).

## User-facing strings

Error and status messages are in **Bahasa Indonesia** — keep them consistent.

## Environment variables required

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET
SPOTIFY_REDIRECT_URI
```
