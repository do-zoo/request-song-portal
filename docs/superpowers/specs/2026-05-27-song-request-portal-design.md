# Song Request Portal — Design Spec

**Date:** 2026-05-27  
**Status:** Approved

---

## Overview

A public-facing song request portal where event audiences can request songs that play on the host's Spotify account in real-time. Built with Next.js 16 App Router, Supabase (Postgres + Auth + Realtime), and Spotify Web API.

**Target use case:** Public events (concerts, parties, open gatherings) with potentially hundreds of concurrent users.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Next.js 16 App                    │
│                                                      │
│  /                 → Audience: enter PIN + nickname  │
│  /event/[pin]      → Song search + queue view        │
│  /admin            → Host dashboard + settings       │
│  /admin/setup      → Spotify OAuth + event creation  │
│                                                      │
│  Server Actions    → Mutations (add request, skip,   │
│                       update settings, call Spotify) │
└──────────────┬──────────────────────┬───────────────┘
               │                      │
       ┌───────▼────────┐    ┌────────▼────────┐
       │   Supabase     │    │   Spotify API   │
       │                │    │                 │
       │ • Postgres DB  │    │ • Search tracks │
       │ • Auth (admin) │    │ • Add to queue  │
       │ • Realtime     │    │ • Get currently │
       └────────────────┘    │   playing track │
                             └─────────────────┘
```

**Layers:**
- **Frontend** — React Server Components for static parts; Client Components only for interactive UI (search input, queue list with Realtime subscription)
- **Server Actions** — all mutations run server-side; Spotify API key never exposed to client
- **Supabase Realtime** — clients subscribe to channel `queue:[event_id]`; broadcast on every `song_requests` table change
- **Spotify sync** — server polls Spotify "Get Currently Playing" every 5 seconds; auto-marks songs as `played` when track changes

---

## Database Schema

```sql
-- Event created by host
events
  id                uuid PK
  pin               varchar(6) UNIQUE   -- 6-digit code shared with audience
  name              varchar(100)        -- displayed on portal
  spotify_token     jsonb               -- encrypted access/refresh token
  status            enum(open, closed, paused)
  settings          jsonb               -- { max_requests, cooldown_minutes, max_duration_ms, allow_explicit }
  created_at        timestamptz

-- Each song requested by audience
song_requests
  id                uuid PK
  event_id          uuid FK → events
  spotify_track_id  varchar
  track_name        varchar
  artist_name       varchar
  album_art_url     varchar
  duration_ms       int
  requested_by      varchar             -- nickname
  status            enum(pending, playing, played, skipped)
  position          int                 -- queue order, managed server-side
  requested_at      timestamptz

-- Participant session per event
event_participants
  id                uuid PK
  event_id          uuid FK → events
  nickname          varchar(30)
  session_token     varchar UNIQUE      -- stored in httpOnly cookie
  request_count     int DEFAULT 0
  last_played_at    timestamptz         -- for cooldown calculation
  joined_at         timestamptz

-- Blacklisted tracks per event
blacklisted_tracks
  id                uuid PK
  event_id          uuid FK → events
  spotify_track_id  varchar
  track_name        varchar
  added_at          timestamptz

-- Rate limiting (PIN brute-force + search abuse)
rate_limits
  id                uuid PK
  identifier        varchar             -- IP address or session_token
  action            varchar             -- 'join_attempt' | 'search'
  count             int DEFAULT 1
  window_start      timestamptz
```

**Notes:**
- `settings` stored as JSONB — host can change `max_requests`, `cooldown_minutes`, `allow_explicit`, `max_duration_ms` without schema migrations
- `position` in `song_requests` managed server-side on insert and reorder
- `session_token` in httpOnly cookie identifies participant without password

---

## Key Flows

### Flow 1 — Host Setup
1. Host opens `/admin/setup`
2. Clicks "Connect Spotify" → Spotify OAuth → callback saves token to `events.spotify_token`
3. Host fills event name → system generates 6-digit PIN
4. Host shares PIN with audience (displayed large on screen)
5. Portal active, host redirected to `/admin` dashboard

### Flow 2 — Audience Join & Request
1. Audience opens app → inputs PIN + nickname → Server Action validates PIN
2. Session token created, saved in httpOnly cookie
3. Audience searches song → Server Action calls Spotify Search API → returns results
4. Audience selects song → Server Action:
   - a. Checks `request_count` vs `settings.max_requests`
   - b. Checks cooldown (`last_played_at` + `cooldown_minutes`)
   - c. Checks blacklist
   - d. Checks song duration vs `settings.max_duration_ms`
   - e. Checks for duplicate pending request (same track already in queue)
   - f. Inserts into `song_requests` (status: pending)
   - g. Calls Spotify "Add to Queue" API
   - h. Broadcasts via Supabase Realtime to all clients
5. Audience sees song appear in queue in real-time

### Flow 3 — Spotify Sync
Admin client calls `GET /api/spotify/sync` every 5 seconds (client-driven polling from the admin dashboard tab). Vercel serverless does not support persistent background processes, so the admin browser drives the sync loop.

```
Admin client polls /api/spotify/sync every 5s:
  → Server Action calls Spotify "Get Currently Playing"
  → If track changed from last known track:
      - Mark previous song_request as played
      - Update event_participants.last_played_at for requester
      - Decrement request_count (slot freed)
      - Broadcast queue update via Supabase Realtime to all clients
```

If the admin tab is closed, sync pauses. This is acceptable — the host is always expected to have the dashboard open during an event.

### Flow 4 — Admin Controls
- **Skip song** → Server Action: mark skipped + call Spotify "Skip to Next" + decrement requester's `request_count`
- **Remove request** → delete from `song_requests` + broadcast
- **Reorder** → update position values + broadcast
- **Toggle portal** → update `events.status`
- **Edit settings** → update `events.settings` JSONB
- **Quick blacklist** → insert into `blacklisted_tracks` from queue item

---

## Admin Dashboard

### Routes
```
/admin                  → redirects to /admin/queue if authenticated
/admin/setup            → Spotify OAuth + create event
/admin/queue            → live queue management (main view)
/admin/settings         → request limits, blacklist, branding
/admin/analytics        → top requested songs, request history
```

### Auth
Supabase Auth (email/password) for host login. One admin account per event. All `/admin/*` routes protected by middleware checking Supabase session.

### `/admin/queue`
- Live queue list (Realtime subscription) with drag-to-reorder
- Per item: track info, album art, requester nickname, requested time, Skip/Remove buttons
- "Now Playing" indicator (from Spotify sync)
- Portal status toggle (Open / Paused / Closed) in header
- Quick-add to blacklist from queue item

### `/admin/settings`
```
Request Limits
  ├── Max requests per user: [3]  (0 = unlimited)
  └── Cooldown after played: [10] minutes  (0 = none)

Queue Rules
  ├── Max song duration: [10] minutes  (0 = no limit)
  ├── Allow explicit content: [toggle]
  └── Blacklisted tracks: [list with remove]

Portal Branding
  ├── Event name: [input]
  └── Welcome message: [input]
```

### `/admin/analytics`
- Top 10 most requested songs (this session)
- Total request count
- Active participant count
- Export as CSV (Server Action queries and returns file)

---

## Error Handling & Rate Limiting

### Request Validation (Server Action — in order)
1. Valid session token (httpOnly cookie) → else 401
2. Event exists + `status = 'open'` → else "Portal sedang tutup"
3. Song not blacklisted → else "Lagu ini tidak bisa di-request"
4. Song duration ≤ `max_duration_ms` → else "Lagu terlalu panjang"
5. `request_count < max_requests` → else "Limit reached, tunggu lagu kamu dimainkan"
6. Cooldown check → else "Tunggu X menit lagi"
7. Duplicate check (same song pending) → else "Lagu ini sudah ada di queue"

### Spotify API Failures
- **Token expired** → auto-refresh before call. If refresh fails → mark event `needs_reconnect`, notify host in dashboard.
- **Add to Queue fails** → request saved in DB as pending; host can manually play from admin. User sees no difference.
- **Rate limit (429)** → exponential backoff, retry up to 3x.

### Real-time Connection Loss
- Supabase Realtime auto-reconnects built-in
- Client offline >30s → show "Reconnecting..." banner, refetch full queue on reconnect

### Abuse Protection
- Max 5 JOIN attempts per IP per 10 minutes (PIN brute-force prevention)
- Max 20 Spotify search requests per participant per minute
- Implemented via `rate_limits` table + Server Action check

---

## Testing

### Unit Tests (Vitest)
- Server Action business logic — rate limit calculations, cooldown checks, blacklist validation
- Utility functions — PIN generation, session token creation, duration formatting

### Integration Tests (Vitest + Supabase local)
- Full request flow: join event → search → add request → verify DB state
- Rate limit enforcement: 3 requests → 4th blocked
- Spotify token refresh flow (Spotify API mocked)

### E2E Tests (Playwright)
- Audience happy path: PIN entry → search → request → see in queue
- Admin happy path: skip song → queue updates → participant slot freed
- Portal closed: audience gets correct error message

### Manual Checklist (pre-event)
- Spotify OAuth connect + reconnect flow
- Real-time queue updates across 3+ browser tabs simultaneously
- Mobile responsiveness (audience primarily on mobile)

---

## MVP Scope (v1)

**Include:**
- Song search + request flow
- Live queue visualization (Realtime)
- Host Spotify OAuth + event creation
- Admin queue management (skip, remove, reorder)
- Nickname + PIN join flow
- Configurable request limits (max requests + cooldown)
- Portal open/closed toggle
- Blacklist per event

**Exclude from v1:**
- Analytics dashboard
- Voting system
- Multiple simultaneous events per host
- Custom branding (logo upload)
- CSV export
- Notifications when song plays
