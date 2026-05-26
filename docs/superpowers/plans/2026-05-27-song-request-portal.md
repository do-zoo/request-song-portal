# Song Request Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public song request portal where event audiences request songs that play live on the host's Spotify account, with real-time queue updates via Supabase Realtime.

**Architecture:** Next.js 16 App Router with Server Actions for all mutations, Supabase (Postgres + Auth + Realtime) for persistence and live updates, Spotify Web API for search and playback control. Admin browser drives Spotify sync by polling `/api/spotify/sync` every 5s.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, `@supabase/ssr`, `zod`, `vitest`, `@playwright/test`

> **Next.js 16 breaking changes to note:**
>
> - `middleware.ts` is deprecated — use `proxy.ts` instead
> - `cookies()`, `headers()`, and `params` are all **async** (must `await`)

---

## File Map

```
src/
├── app/
│   ├── page.tsx                          # Landing: PIN + nickname form
│   ├── layout.tsx                        # Root layout (minimal changes)
│   ├── event/[pin]/page.tsx              # Audience queue view + search
│   ├── admin/
│   │   ├── login/page.tsx                # Supabase Auth login form
│   │   ├── setup/page.tsx                # Event creation + Spotify OAuth
│   │   ├── queue/page.tsx                # Live queue management (admin)
│   │   └── settings/page.tsx             # Limits, blacklist, branding
│   └── api/
│       ├── auth/spotify/callback/route.ts  # Spotify OAuth callback
│       └── spotify/sync/route.ts           # Spotify currently-playing sync
├── components/
│   ├── JoinForm.tsx                      # PIN + nickname form (client)
│   ├── SearchBar.tsx                     # Search input + submit request (client)
│   ├── SearchResults.tsx                 # Song results list (client)
│   ├── QueueList.tsx                     # Live queue with Realtime (client)
│   └── admin/
│       ├── QueueManager.tsx              # Admin queue: skip/remove/reorder (client)
│       ├── SpotifySync.tsx               # Polls /api/spotify/sync every 5s (client)
│       └── SettingsForm.tsx              # Settings form (client)
├── lib/
│   ├── supabase/
│   │   ├── server.ts                     # Server Supabase client (cookies-aware)
│   │   └── client.ts                     # Browser Supabase client
│   ├── spotify/
│   │   ├── client.ts                     # Spotify API calls (search, queue, skip, now-playing)
│   │   └── tokens.ts                     # Token refresh + expiry logic
│   ├── actions/
│   │   ├── participant.ts                # joinEvent Server Action
│   │   ├── requests.ts                   # searchSongs + addRequest Server Actions
│   │   ├── queue.ts                      # skipRequest, removeRequest, reorderQueue Server Actions
│   │   └── settings.ts                   # updateSettings, updatePortalStatus, blacklist Server Actions
│   ├── validation.ts                     # Pure business logic (rate limit, cooldown, duration)
│   └── rate-limit.ts                     # DB-backed rate limiting utility
├── types/
│   └── database.ts                       # Shared TypeScript interfaces
├── proxy.ts                              # Admin route protection (replaces middleware.ts)
└── supabase/
    └── migrations/
        └── 0001_initial.sql              # Full DB schema
```

---

## Task 1: Install Dependencies and Configure Testing

**Files:**

- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `.env.local` (from template)

- [ ] **Step 1: Install runtime dependencies**

```bash
pnpm add @supabase/ssr @supabase/supabase-js zod
```

- [ ] **Step 2: Install dev dependencies**

```bash
pnpm add -D vitest @vitejs/plugin-react jsdom @playwright/test
```

- [ ] **Step 3: Add test script to package.json**

Open `package.json` and add `"test": "vitest run"` and `"test:watch": "vitest"` to the `scripts` object:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 5: Create `.env.local` template**

```bash
cat > .env.local << 'EOF'
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://localhost:3000/api/auth/spotify/callback
EOF
```

> **Fill in values:** Create a Supabase project at supabase.com (free tier). Copy URL + anon key + service role key from Project Settings → API. Create a Spotify app at developer.spotify.com, copy Client ID + Secret. Add `http://localhost:3000/api/auth/spotify/callback` to Redirect URIs in the Spotify app settings.

- [ ] **Step 6: Run vitest to confirm setup works**

```bash
pnpm test
```

Expected: `No test files found, exiting with code 0` (no tests yet — that's fine)

- [ ] **Step 7: Commit**

```bash
git add package.json vitest.config.ts pnpm-lock.yaml .env.local
git commit -m "feat: install Supabase, Zod, Vitest dependencies"
```

---

## Task 2: Database Schema

**Files:**

- Create: `supabase/migrations/0001_initial.sql`

- [ ] **Step 1: Create migration directory**

```bash
mkdir -p supabase/migrations
```

- [ ] **Step 2: Write migration**

Create `supabase/migrations/0001_initial.sql`:

```sql
-- Enable UUID generation
create extension if not exists "pgcrypto";

-- Events created by host
create type event_status as enum ('open', 'closed', 'paused');
create type request_status as enum ('pending', 'playing', 'played', 'skipped');

create table events (
  id            uuid primary key default gen_random_uuid(),
  pin           varchar(6) not null unique,
  name          varchar(100) not null,
  spotify_token jsonb,
  status        event_status not null default 'paused',
  settings      jsonb not null default '{"max_requests":3,"cooldown_minutes":10,"max_duration_ms":600000,"allow_explicit":true}',
  created_at    timestamptz not null default now()
);

-- Participant sessions per event
create table event_participants (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  nickname      varchar(30) not null,
  session_token varchar not null unique,
  request_count int not null default 0,
  last_played_at timestamptz,
  joined_at     timestamptz not null default now(),
  unique (event_id, nickname)
);

-- Song requests queue
create table song_requests (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references events(id) on delete cascade,
  participant_id    uuid not null references event_participants(id) on delete cascade,
  spotify_track_id  varchar not null,
  track_name        varchar not null,
  artist_name       varchar not null,
  album_art_url     varchar not null,
  duration_ms       int not null,
  requested_by      varchar not null,
  status            request_status not null default 'pending',
  position          int not null default 0,
  requested_at      timestamptz not null default now()
);

create index song_requests_event_status on song_requests(event_id, status);

-- Blacklisted tracks per event
create table blacklisted_tracks (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references events(id) on delete cascade,
  spotify_track_id  varchar not null,
  track_name        varchar not null,
  added_at          timestamptz not null default now(),
  unique (event_id, spotify_track_id)
);

-- IP/session rate limiting
create table rate_limits (
  id           uuid primary key default gen_random_uuid(),
  identifier   varchar not null,
  action       varchar not null,
  count        int not null default 1,
  window_start timestamptz not null default now()
);

create index rate_limits_lookup on rate_limits(identifier, action, window_start);

-- RLS: Enable on all tables, service role bypasses everything.
-- Anon key needs SELECT on song_requests for Realtime subscriptions.
alter table events enable row level security;
alter table event_participants enable row level security;
alter table song_requests enable row level security;
alter table blacklisted_tracks enable row level security;
alter table rate_limits enable row level security;

-- Allow anon to read song_requests (needed for Supabase Realtime with anon key)
create policy "anon can read song_requests"
  on song_requests for select using (true);

-- Allow anon to read blacklisted_tracks (needed in request validation client-side if ever)
create policy "anon can read blacklisted_tracks"
  on blacklisted_tracks for select using (true);
```

- [ ] **Step 3: Apply migration to your Supabase project**

In the Supabase dashboard: go to SQL Editor → paste the full contents of `0001_initial.sql` → Run.

> Alternatively, if you have Supabase CLI installed: `supabase db push`

Expected: All tables created, no errors.

- [ ] **Step 4: Enable Realtime for song_requests**

In Supabase dashboard: go to Database → Replication → enable `song_requests` table for Realtime.

- [ ] **Step 5: Commit**

```bash
git add supabase/
git commit -m "feat: add initial database schema"
```

---

## Task 3: TypeScript Types

**Files:**

- Create: `src/types/database.ts`

- [ ] **Step 1: Write the test**

Create `src/types/database.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { EventSettings, SpotifyTokens, SongRequest } from "./database";

describe("database types", () => {
  it("EventSettings has required fields", () => {
    const s: EventSettings = {
      max_requests: 3,
      cooldown_minutes: 10,
      max_duration_ms: 600000,
      allow_explicit: true,
    };
    expectTypeOf(s.max_requests).toBeNumber();
    expectTypeOf(s.allow_explicit).toBeBoolean();
  });

  it("SpotifyTokens has expires_at as number", () => {
    const t: SpotifyTokens = {
      access_token: "tok",
      refresh_token: "ref",
      expires_at: Date.now(),
    };
    expectTypeOf(t.expires_at).toBeNumber();
  });

  it("SongRequest status union is correct", () => {
    const r: SongRequest["status"] = "pending";
    expectTypeOf(r).toEqualTypeOf<
      "pending" | "playing" | "played" | "skipped"
    >();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm test
```

Expected: FAIL — `Cannot find module './database'`

- [ ] **Step 3: Create `src/types/database.ts`**

```ts
export type EventStatus = "open" | "closed" | "paused";
export type RequestStatus = "pending" | "playing" | "played" | "skipped";

export interface EventSettings {
  max_requests: number; // 0 = unlimited
  cooldown_minutes: number; // 0 = none
  max_duration_ms: number; // 0 = no limit
  allow_explicit: boolean;
}

export interface SpotifyTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp ms
}

export interface Event {
  id: string;
  pin: string;
  name: string;
  spotify_token: SpotifyTokens | null;
  status: EventStatus;
  settings: EventSettings;
  created_at: string;
}

export interface SongRequest {
  id: string;
  event_id: string;
  participant_id: string;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  album_art_url: string;
  duration_ms: number;
  requested_by: string;
  status: RequestStatus;
  position: number;
  requested_at: string;
}

export interface EventParticipant {
  id: string;
  event_id: string;
  nickname: string;
  session_token: string;
  request_count: number;
  last_played_at: string | null;
  joined_at: string;
}

export interface BlacklistedTrack {
  id: string;
  event_id: string;
  spotify_track_id: string;
  track_name: string;
  added_at: string;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  album: { images: Array<{ url: string }> };
  duration_ms: number;
  explicit: boolean;
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/ src/
git commit -m "feat: add shared TypeScript database types"
```

---

## Task 4: Supabase Client Helpers

**Files:**

- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/client.ts`

- [ ] **Step 1: Create `src/lib/supabase/server.ts`**

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {}
        },
      },
    },
  );
}

// Service role client — bypasses RLS. Use only in Server Actions and API routes.
export async function createServiceClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {}
        },
      },
    },
  );
}
```

- [ ] **Step 2: Create `src/lib/supabase/client.ts`**

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/
git commit -m "feat: add Supabase server and browser client helpers"
```

---

## Task 5: Business Logic Validation Utilities (TDD)

**Files:**

- Create: `src/lib/validation.ts`
- Create: `src/lib/validation.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  checkRateLimit,
  checkCooldown,
  checkDuration,
  generatePin,
  generateSessionToken,
} from "./validation";

describe("checkRateLimit", () => {
  it("returns true when max_requests is 0 (unlimited)", () => {
    expect(checkRateLimit(99, 0)).toBe(true);
  });
  it("returns true when under limit", () => {
    expect(checkRateLimit(2, 3)).toBe(true);
  });
  it("returns false when at limit", () => {
    expect(checkRateLimit(3, 3)).toBe(false);
  });
  it("returns false when over limit", () => {
    expect(checkRateLimit(5, 3)).toBe(false);
  });
});

describe("checkCooldown", () => {
  it("returns ok when lastPlayedAt is null", () => {
    expect(checkCooldown(null, 10)).toEqual({ ok: true, minutesLeft: 0 });
  });
  it("returns ok when cooldownMinutes is 0", () => {
    const recent = new Date().toISOString();
    expect(checkCooldown(recent, 0)).toEqual({ ok: true, minutesLeft: 0 });
  });
  it("returns ok when cooldown has elapsed", () => {
    const past = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    expect(checkCooldown(past, 10)).toEqual({ ok: true, minutesLeft: 0 });
  });
  it("returns not ok with minutesLeft when still in cooldown", () => {
    const past = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const result = checkCooldown(past, 10);
    expect(result.ok).toBe(false);
    expect(result.minutesLeft).toBe(5);
  });
});

describe("checkDuration", () => {
  it("returns true when maxDurationMs is 0 (no limit)", () => {
    expect(checkDuration(99999999, 0)).toBe(true);
  });
  it("returns true when duration is under max", () => {
    expect(checkDuration(300000, 600000)).toBe(true);
  });
  it("returns false when duration exceeds max", () => {
    expect(checkDuration(700000, 600000)).toBe(false);
  });
  it("returns true when duration equals max", () => {
    expect(checkDuration(600000, 600000)).toBe(true);
  });
});

describe("generatePin", () => {
  it("generates a 6-digit numeric string", () => {
    const pin = generatePin();
    expect(pin).toMatch(/^\d{6}$/);
  });
  it("generates different pins each call", () => {
    const pins = new Set(Array.from({ length: 10 }, generatePin));
    expect(pins.size).toBeGreaterThan(1);
  });
});

describe("generateSessionToken", () => {
  it("generates a valid UUID v4", () => {
    const token = generateSessionToken();
    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
  it("generates unique tokens each call", () => {
    const tokens = new Set(Array.from({ length: 5 }, generateSessionToken));
    expect(tokens.size).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm test
```

Expected: FAIL — `Cannot find module './validation'`

- [ ] **Step 3: Create `src/lib/validation.ts`**

```ts
export function checkRateLimit(
  requestCount: number,
  maxRequests: number,
): boolean {
  if (maxRequests === 0) return true;
  return requestCount < maxRequests;
}

export function checkCooldown(
  lastPlayedAt: string | null,
  cooldownMinutes: number,
): { ok: boolean; minutesLeft: number } {
  if (!lastPlayedAt || cooldownMinutes === 0)
    return { ok: true, minutesLeft: 0 };
  const elapsedMinutes =
    (Date.now() - new Date(lastPlayedAt).getTime()) / 60_000;
  if (elapsedMinutes >= cooldownMinutes) return { ok: true, minutesLeft: 0 };
  return {
    ok: false,
    minutesLeft: Math.ceil(cooldownMinutes - elapsedMinutes),
  };
}

export function checkDuration(
  durationMs: number,
  maxDurationMs: number,
): boolean {
  if (maxDurationMs === 0) return true;
  return durationMs <= maxDurationMs;
}

export function generatePin(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function generateSessionToken(): string {
  return crypto.randomUUID();
}
```

- [ ] **Step 4: Run tests — expect all PASS**

```bash
pnpm test
```

Expected: All 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation.ts src/lib/validation.test.ts
git commit -m "feat: add validation utilities with tests"
```

---

## Task 6: Spotify API Client and Token Management

**Files:**

- Create: `src/lib/spotify/client.ts`
- Create: `src/lib/spotify/tokens.ts`
- Create: `src/lib/spotify/tokens.test.ts`

- [ ] **Step 1: Write the failing test for tokens**

Create `src/lib/spotify/tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isExpired } from "./tokens";
import type { SpotifyTokens } from "@/types/database";

describe("isExpired", () => {
  it("returns false when token expires in the future (past buffer)", () => {
    const tokens: SpotifyTokens = {
      access_token: "tok",
      refresh_token: "ref",
      expires_at: Date.now() + 120_000, // 2 minutes from now
    };
    expect(isExpired(tokens)).toBe(false);
  });

  it("returns true when token expires within the 60s buffer", () => {
    const tokens: SpotifyTokens = {
      access_token: "tok",
      refresh_token: "ref",
      expires_at: Date.now() + 30_000, // 30s from now — inside 60s buffer
    };
    expect(isExpired(tokens)).toBe(true);
  });

  it("returns true when token is already expired", () => {
    const tokens: SpotifyTokens = {
      access_token: "tok",
      refresh_token: "ref",
      expires_at: Date.now() - 1000,
    };
    expect(isExpired(tokens)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm test
```

Expected: FAIL — `Cannot find module './tokens'`

- [ ] **Step 3: Create `src/lib/spotify/tokens.ts`**

```ts
import type { SpotifyTokens } from "@/types/database";

export function isExpired(tokens: SpotifyTokens): boolean {
  return Date.now() >= tokens.expires_at - 60_000;
}

export async function refreshAccessToken(
  tokens: SpotifyTokens,
): Promise<SpotifyTokens> {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: process.env.SPOTIFY_CLIENT_ID!,
      client_secret: process.env.SPOTIFY_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

// Returns a valid access token, refreshing if needed.
// Returns refreshed tokens when a refresh occurred so the caller can persist them.
export async function getValidToken(tokens: SpotifyTokens): Promise<{
  token: string;
  refreshed: SpotifyTokens | null;
}> {
  if (!isExpired(tokens))
    return { token: tokens.access_token, refreshed: null };
  const refreshed = await refreshAccessToken(tokens);
  return { token: refreshed.access_token, refreshed };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm test
```

Expected: All 3 token tests pass.

- [ ] **Step 5: Create `src/lib/spotify/client.ts`**

```ts
import type { SpotifyTrack } from "@/types/database";

const API = "https://api.spotify.com/v1";

async function spotifyFetch(
  path: string,
  token: string,
  options: RequestInit = {},
) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Spotify API error ${res.status} on ${path}`);
  }
  return res;
}

export async function searchTracks(
  query: string,
  token: string,
): Promise<SpotifyTrack[]> {
  const params = new URLSearchParams({ q: query, type: "track", limit: "10" });
  const res = await spotifyFetch(`/search?${params}`, token);
  const data = await res.json();
  return data.tracks.items as SpotifyTrack[];
}

export async function addToQueue(
  spotifyTrackId: string,
  token: string,
): Promise<void> {
  const params = new URLSearchParams({
    uri: `spotify:track:${spotifyTrackId}`,
  });
  await spotifyFetch(`/me/player/queue?${params}`, token, { method: "POST" });
}

export async function getCurrentlyPlaying(
  token: string,
): Promise<{ trackId: string; isPlaying: boolean } | null> {
  const res = await fetch(`${API}/me/player/currently-playing`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 204 || !res.ok) return null;
  const data = await res.json();
  if (!data.item) return null;
  return {
    trackId: data.item.id as string,
    isPlaying: data.is_playing as boolean,
  };
}

export async function skipToNext(token: string): Promise<void> {
  await spotifyFetch("/me/player/next", token, { method: "POST" });
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/spotify/
git commit -m "feat: add Spotify API client and token management"
```

---

## Task 7: Admin Auth (Supabase Auth + proxy.ts)

**Files:**

- Create: `src/app/admin/login/page.tsx`
- Create: `src/proxy.ts`

> **Why proxy.ts:** In Next.js 16, `middleware.ts` is deprecated. Route protection lives in `proxy.ts` at the project root (or `src/proxy.ts` if using the `src` directory).

- [ ] **Step 1: Create `src/proxy.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (!path.startsWith("/admin") || path === "/admin/login") {
    return NextResponse.next();
  }

  const response = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*"],
};
```

- [ ] **Step 2: Create `src/app/admin/login/page.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setError("Email atau password salah");
      } else {
        router.push("/admin/queue");
        router.refresh();
      }
    });
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm flex flex-col gap-4"
      >
        <h1 className="text-2xl font-bold">Admin Login</h1>
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={isPending}
          className="bg-zinc-900 text-white rounded-lg py-3 font-medium disabled:opacity-50"
        >
          {isPending ? "Logging in..." : "Login"}
        </button>
      </form>
    </main>
  );
}
```

> **To create the admin account:** In Supabase dashboard → Authentication → Users → Add user. Use the email and password you'll use to log in.

- [ ] **Step 3: Verify proxy.ts is picked up by Next.js**

```bash
pnpm dev
```

Open `http://localhost:3000/admin/queue` in the browser. Expected: redirect to `/admin/login`.

Stop dev server (`Ctrl+C`).

- [ ] **Step 4: Commit**

```bash
git add src/proxy.ts src/app/admin/
git commit -m "feat: add admin auth with Supabase Auth and proxy.ts route protection"
```

---

## Task 8: Spotify OAuth + Event Creation

**Files:**

- Create: `src/app/admin/setup/page.tsx`
- Create: `src/app/api/auth/spotify/callback/route.ts`
- Create: `src/lib/actions/event.ts`

- [ ] **Step 1: Create `src/lib/actions/event.ts`**

```ts
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { generatePin, generateSessionToken } from "@/lib/validation";
import { z } from "zod";

const createEventSchema = z.object({
  name: z.string().min(1).max(100).trim(),
});

export async function createEventAndConnectSpotify(formData: FormData) {
  const parsed = createEventSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return; // validation handled client-side

  const supabase = await createServiceClient();
  const pin = generatePin();

  const { data: event, error } = await supabase
    .from("events")
    .insert({ name: parsed.data.name, pin, status: "paused" })
    .select("id")
    .single();

  if (error || !event) return;

  // Store event ID in cookie so OAuth callback can link tokens
  const cookieStore = await cookies();
  cookieStore.set("pending_event_id", event.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 min to complete OAuth
    path: "/",
  });

  // Generate OAuth state for CSRF protection
  const state = generateSessionToken();
  cookieStore.set("spotify_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    scope: "user-modify-playback-state user-read-playback-state",
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
    state,
  });

  redirect(`https://accounts.spotify.com/authorize?${params}`);
}
```

- [ ] **Step 2: Create `src/app/api/auth/spotify/callback/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  const storedState = request.cookies.get("spotify_oauth_state")?.value;
  const eventId = request.cookies.get("pending_event_id")?.value;

  if (oauthError || !code || !state || state !== storedState || !eventId) {
    return NextResponse.redirect(
      new URL("/admin/setup?error=oauth_failed", request.url),
    );
  }

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
      client_id: process.env.SPOTIFY_CLIENT_ID!,
      client_secret: process.env.SPOTIFY_CLIENT_SECRET!,
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(
      new URL("/admin/setup?error=token_failed", request.url),
    );
  }

  const tokenData = await tokenRes.json();
  const tokens = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: Date.now() + tokenData.expires_in * 1000,
  };

  const supabase = await createServiceClient();
  await supabase
    .from("events")
    .update({ spotify_token: tokens, status: "open" })
    .eq("id", eventId);

  const response = NextResponse.redirect(new URL("/admin/queue", request.url));
  response.cookies.delete("spotify_oauth_state");
  response.cookies.delete("pending_event_id");
  return response;
}
```

- [ ] **Step 3: Create `src/app/admin/setup/page.tsx`**

```tsx
import { createServiceClient } from "@/lib/supabase/server";
import { createEventAndConnectSpotify } from "@/lib/actions/event";

export default async function AdminSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // Check if event already exists for this admin session
  const supabase = await createServiceClient();
  const { data: existingEvent } = await supabase
    .from("events")
    .select("id, name, pin, status")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

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
            {error === "oauth_failed"
              ? "Spotify authorization failed. Try again."
              : "Something went wrong."}
          </p>
        )}

        <form
          action={createEventAndConnectSpotify}
          className="flex flex-col gap-4"
        >
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
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Manual test — Spotify OAuth flow**

```bash
pnpm dev
```

1. Log in at `http://localhost:3000/admin/login`
2. Go to `http://localhost:3000/admin/setup`
3. Enter an event name and click "Buat Event & Connect Spotify"
4. Expected: redirect to Spotify authorization page
5. Authorize → expected: redirect back to `/admin/queue`
6. In Supabase dashboard → Table Editor → `events` → confirm a row exists with `spotify_token` and `status = 'open'`

Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/event.ts src/app/admin/setup/ src/app/api/auth/
git commit -m "feat: Spotify OAuth flow and event creation"
```

---

## Task 9: Participant Join Flow

**Files:**

- Create: `src/lib/actions/participant.ts`
- Create: `src/components/JoinForm.tsx`
- Create: `src/app/page.tsx` (replace existing)

- [ ] **Step 1: Create `src/lib/actions/participant.ts`**

```ts
"use server";

import { cookies, headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { generateSessionToken } from "@/lib/validation";
import { z } from "zod";

const joinSchema = z.object({
  pin: z
    .string()
    .length(6)
    .regex(/^\d{6}$/),
  nickname: z.string().min(1).max(30).trim(),
});

export type JoinResult =
  | { success: true; pin: string }
  | { success: false; error: string };

export async function joinEvent(formData: FormData): Promise<JoinResult> {
  const parsed = joinSchema.safeParse({
    pin: formData.get("pin"),
    nickname: formData.get("nickname"),
  });
  if (!parsed.success)
    return { success: false, error: "PIN harus 6 digit angka" };

  const { pin, nickname } = parsed.data;
  const supabase = await createServiceClient();

  const { data: event } = await supabase
    .from("events")
    .select("id, status")
    .eq("pin", pin)
    .single();

  if (!event) return { success: false, error: "PIN tidak valid" };
  if (event.status === "closed")
    return { success: false, error: "Portal ini sudah ditutup" };

  // Check for duplicate nickname in this event
  const { data: existingParticipant } = await supabase
    .from("event_participants")
    .select("id")
    .eq("event_id", event.id)
    .eq("nickname", nickname)
    .single();

  if (existingParticipant) {
    return { success: false, error: "Nickname sudah dipakai, pilih yang lain" };
  }

  const sessionToken = generateSessionToken();
  const { error: insertError } = await supabase
    .from("event_participants")
    .insert({
      event_id: event.id,
      nickname,
      session_token: sessionToken,
    });

  if (insertError)
    return { success: false, error: "Gagal bergabung, coba lagi" };

  const cookieStore = await cookies();
  cookieStore.set("session_token", sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 24 * 60 * 60,
    path: "/",
  });

  return { success: true, pin };
}
```

- [ ] **Step 2: Create `src/components/JoinForm.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { joinEvent } from "@/lib/actions/participant";

interface Props {
  defaultPin?: string;
}

export function JoinForm({ defaultPin }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await joinEvent(formData);
      if (result.success) {
        router.push(`/event/${result.pin}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-sm flex flex-col gap-4"
    >
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
        {isPending ? "Memuat..." : "Masuk ke Event"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Replace `src/app/page.tsx`**

```tsx
import { JoinForm } from "@/components/JoinForm";

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ pin?: string; error?: string }>;
}) {
  const { pin, error } = await searchParams;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 bg-zinc-50">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-zinc-900">Song Request</h1>
        <p className="text-zinc-500 mt-2">
          Masukkan kode event untuk request lagu
        </p>
      </div>
      {error === "invalid_session" && (
        <p className="mb-4 text-red-500 text-sm">
          Sesi kamu expired, silakan masuk lagi.
        </p>
      )}
      <JoinForm defaultPin={pin} />
    </main>
  );
}
```

- [ ] **Step 4: Manual test — join flow**

```bash
pnpm dev
```

1. Open `http://localhost:3000`
2. Enter the PIN from the event created in Task 8, enter a nickname, submit
3. Expected: redirect to `/event/[pin]` (will 404 for now — that's fine, the session cookie is the thing being tested)
4. In browser DevTools → Application → Cookies → confirm `session_token` is set as httpOnly
5. Check Supabase `event_participants` table — confirm a row was inserted

Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/participant.ts src/components/JoinForm.tsx src/app/page.tsx
git commit -m "feat: participant join flow with session cookie"
```

---

## Task 10: Song Search Server Action

**Files:**

- Modify: `src/lib/actions/requests.ts` (create new)
- Create: `src/components/SearchResults.tsx`

- [ ] **Step 1: Create `src/lib/actions/requests.ts`** (search only for now)

```ts
"use server";

import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { getValidToken } from "@/lib/spotify/tokens";
import { searchTracks, addToQueue } from "@/lib/spotify/client";
import { checkRateLimit, checkCooldown, checkDuration } from "@/lib/validation";
import type {
  SpotifyTokens,
  EventSettings,
  SpotifyTrack,
} from "@/types/database";
import { z } from "zod";

export async function searchSongs(
  query: string,
  eventId: string,
): Promise<{ tracks: SpotifyTrack[] } | { error: string }> {
  if (!query.trim()) return { tracks: [] };

  const supabase = await createServiceClient();
  const { data: event } = await supabase
    .from("events")
    .select("spotify_token")
    .eq("id", eventId)
    .single();

  if (!event?.spotify_token) return { error: "Spotify belum terhubung" };

  try {
    const { token, refreshed } = await getValidToken(
      event.spotify_token as SpotifyTokens,
    );
    if (refreshed) {
      await supabase
        .from("events")
        .update({ spotify_token: refreshed })
        .eq("id", eventId);
    }
    const tracks = await searchTracks(query, token);
    return { tracks };
  } catch {
    return { error: "Pencarian gagal, coba lagi" };
  }
}

const addRequestSchema = z.object({
  eventId: z.string().uuid(),
  spotifyTrackId: z.string().min(1),
  trackName: z.string().min(1),
  artistName: z.string().min(1),
  albumArtUrl: z.string(),
  durationMs: z.number().positive(),
});

export type AddRequestResult =
  | { success: true }
  | { success: false; error: string };

export async function addRequest(
  input: z.infer<typeof addRequestSchema>,
): Promise<AddRequestResult> {
  const parsed = addRequestSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Data tidak valid" };

  const {
    eventId,
    spotifyTrackId,
    trackName,
    artistName,
    albumArtUrl,
    durationMs,
  } = parsed.data;
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("session_token")?.value;
  if (!sessionToken)
    return { success: false, error: "Sesi tidak valid, silakan masuk lagi" };

  const supabase = await createServiceClient();

  const [{ data: event }, { data: participant }] = await Promise.all([
    supabase
      .from("events")
      .select("status, settings, spotify_token")
      .eq("id", eventId)
      .single(),
    supabase
      .from("event_participants")
      .select("id, nickname, request_count, last_played_at")
      .eq("session_token", sessionToken)
      .eq("event_id", eventId)
      .single(),
  ]);

  if (!event) return { success: false, error: "Event tidak ditemukan" };
  if (event.status !== "open")
    return { success: false, error: "Portal sedang tutup" };
  if (!participant)
    return { success: false, error: "Sesi tidak valid, silakan masuk lagi" };

  const settings = event.settings as EventSettings;

  const { data: blacklisted } = await supabase
    .from("blacklisted_tracks")
    .select("id")
    .eq("event_id", eventId)
    .eq("spotify_track_id", spotifyTrackId)
    .maybeSingle();
  if (blacklisted)
    return { success: false, error: "Lagu ini tidak bisa di-request" };

  if (!checkDuration(durationMs, settings.max_duration_ms)) {
    const maxMins = Math.floor(settings.max_duration_ms / 60_000);
    return {
      success: false,
      error: `Lagu terlalu panjang (max ${maxMins} menit)`,
    };
  }

  if (!checkRateLimit(participant.request_count, settings.max_requests)) {
    return {
      success: false,
      error: "Limit reached, tunggu lagu kamu dimainkan",
    };
  }

  const cooldown = checkCooldown(
    participant.last_played_at,
    settings.cooldown_minutes,
  );
  if (!cooldown.ok) {
    return {
      success: false,
      error: `Tunggu ${cooldown.minutesLeft} menit lagi`,
    };
  }

  const { data: duplicate } = await supabase
    .from("song_requests")
    .select("id")
    .eq("event_id", eventId)
    .eq("spotify_track_id", spotifyTrackId)
    .in("status", ["pending", "playing"])
    .maybeSingle();
  if (duplicate)
    return { success: false, error: "Lagu ini sudah ada di queue" };

  // Get next position
  const { count } = await supabase
    .from("song_requests")
    .select("*", { count: "exact", head: true })
    .eq("event_id", eventId)
    .in("status", ["pending", "playing"]);
  const position = (count ?? 0) + 1;

  const { error: insertError } = await supabase.from("song_requests").insert({
    event_id: eventId,
    participant_id: participant.id,
    spotify_track_id: spotifyTrackId,
    track_name: trackName,
    artist_name: artistName,
    album_art_url: albumArtUrl,
    duration_ms: durationMs,
    requested_by: participant.nickname,
    status: "pending",
    position,
  });

  if (insertError) return { success: false, error: "Gagal menambahkan lagu" };

  await supabase
    .from("event_participants")
    .update({ request_count: participant.request_count + 1 })
    .eq("id", participant.id);

  // Add to Spotify queue (non-fatal if it fails)
  if (event.spotify_token) {
    try {
      const { token, refreshed } = await getValidToken(
        event.spotify_token as SpotifyTokens,
      );
      if (refreshed) {
        await supabase
          .from("events")
          .update({ spotify_token: refreshed })
          .eq("id", eventId);
      }
      await addToQueue(spotifyTrackId, token);
    } catch (err) {
      console.error("Spotify add to queue failed (non-fatal):", err);
    }
  }

  return { success: true };
}
```

- [ ] **Step 2: Create `src/components/SearchResults.tsx`**

```tsx
import type { SpotifyTrack } from "@/types/database";

interface Props {
  tracks: SpotifyTrack[];
  onSelect: (track: SpotifyTrack) => void;
}

export function SearchResults({ tracks, onSelect }: Props) {
  if (tracks.length === 0) return null;

  return (
    <ul className="border rounded-lg overflow-hidden mt-2 divide-y divide-zinc-100">
      {tracks.map((track) => (
        <li key={track.id}>
          <button
            type="button"
            onClick={() => onSelect(track)}
            className="w-full flex items-center gap-3 p-3 hover:bg-zinc-50 text-left transition-colors"
          >
            {track.album.images[0] && (
              <img
                src={track.album.images[0].url}
                alt=""
                className="w-10 h-10 rounded flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{track.name}</p>
              <p className="text-xs text-zinc-500 truncate">
                {track.artists.map((a) => a.name).join(", ")}
              </p>
            </div>
            {track.explicit && (
              <span className="text-xs bg-zinc-200 text-zinc-600 px-1 rounded flex-shrink-0">
                E
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/requests.ts src/components/SearchResults.tsx
git commit -m "feat: song search and add request Server Actions"
```

---

## Task 11: SearchBar Component

**Files:**

- Create: `src/components/SearchBar.tsx`

- [ ] **Step 1: Create `src/components/SearchBar.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { searchSongs, addRequest } from "@/lib/actions/requests";
import { SearchResults } from "./SearchResults";
import type { SpotifyTrack } from "@/types/database";

interface Props {
  eventId: string;
}

export function SearchBar({ eventId }: Props) {
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    startTransition(async () => {
      const result = await searchSongs(query, eventId);
      if ("tracks" in result) {
        setTracks(result.tracks);
      } else {
        setMessage({ text: result.error, ok: false });
      }
    });
  }

  function handleSelect(track: SpotifyTrack) {
    setTracks([]);
    setQuery("");
    startTransition(async () => {
      const result = await addRequest({
        eventId,
        spotifyTrackId: track.id,
        trackName: track.name,
        artistName: track.artists.map((a) => a.name).join(", "),
        albumArtUrl: track.album.images[0]?.url ?? "",
        durationMs: track.duration_ms,
      });
      setMessage({
        text: result.success
          ? "🎵 Lagu berhasil ditambahkan ke queue!"
          : result.error,
        ok: result.success,
      });
      setTimeout(() => setMessage(null), 4000);
    });
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
          {isPending ? "..." : "Cari"}
        </button>
      </form>
      <SearchResults tracks={tracks} onSelect={handleSelect} />
      {message && (
        <p
          className={`mt-2 text-sm ${message.ok ? "text-green-600" : "text-red-500"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SearchBar.tsx
git commit -m "feat: SearchBar component with search and request submission"
```

---

## Task 12: Queue Display with Supabase Realtime

**Files:**

- Create: `src/components/QueueList.tsx`

- [ ] **Step 1: Create `src/components/QueueList.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SongRequest } from "@/types/database";

interface Props {
  eventId: string;
  initialRequests: SongRequest[];
}

export function QueueList({ eventId, initialRequests }: Props) {
  const [requests, setRequests] = useState<SongRequest[]>(initialRequests);
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    async function fetchQueue() {
      const { data } = await supabase
        .from("song_requests")
        .select("*")
        .eq("event_id", eventId)
        .in("status", ["pending", "playing"])
        .order("position");
      if (data) setRequests(data);
    }

    const channel = supabase
      .channel(`queue:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "song_requests",
          filter: `event_id=eq.${eventId}`,
        },
        () => fetchQueue(),
      )
      .subscribe((status) => {
        setIsConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") fetchQueue();
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId]);

  if (requests.length === 0) {
    return (
      <p className="text-zinc-500 text-center py-8 text-sm">
        Queue kosong. Jadi yang pertama request!
      </p>
    );
  }

  return (
    <>
      {!isConnected && (
        <p className="text-xs text-yellow-600 mb-2">
          Reconnecting to live queue...
        </p>
      )}
      <ul className="divide-y divide-zinc-100">
        {requests.map((req, i) => (
          <li key={req.id} className="flex items-center gap-3 py-3">
            <span className="text-zinc-400 text-sm w-6 text-right flex-shrink-0">
              {req.status === "playing" ? "▶" : i + 1}
            </span>
            {req.album_art_url && (
              <img
                src={req.album_art_url}
                alt=""
                className="w-10 h-10 rounded flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{req.track_name}</p>
              <p className="text-zinc-500 text-xs truncate">
                {req.artist_name}
              </p>
            </div>
            <span className="text-zinc-400 text-xs flex-shrink-0">
              {req.requested_by}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/QueueList.tsx
git commit -m "feat: QueueList with Supabase Realtime live updates"
```

---

## Task 13: Audience Event Page

**Files:**

- Create: `src/app/event/[pin]/page.tsx`

- [ ] **Step 1: Create `src/app/event/[pin]/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { SearchBar } from "@/components/SearchBar";
import { QueueList } from "@/components/QueueList";

export default async function EventPage({
  params,
}: {
  params: Promise<{ pin: string }>;
}) {
  const { pin } = await params;
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("session_token")?.value;

  if (!sessionToken) {
    redirect(`/?pin=${pin}`);
  }

  const supabase = await createServiceClient();

  const { data: event } = await supabase
    .from("events")
    .select("id, name, status")
    .eq("pin", pin)
    .single();

  if (!event) redirect("/?error=invalid_pin");

  const { data: participant } = await supabase
    .from("event_participants")
    .select("id, nickname")
    .eq("session_token", sessionToken)
    .eq("event_id", event.id)
    .single();

  if (!participant) redirect("/?error=invalid_session");

  const { data: requests } = await supabase
    .from("song_requests")
    .select("*")
    .eq("event_id", event.id)
    .in("status", ["pending", "playing"])
    .order("position");

  return (
    <main className="max-w-lg mx-auto px-4 py-8 min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{event.name}</h1>
          <p className="text-sm text-zinc-500">Hi, {participant.nickname}!</p>
        </div>
        {event.status !== "open" && (
          <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full">
            {event.status === "paused" ? "Paused" : "Closed"}
          </span>
        )}
      </div>

      {event.status === "open" ? (
        <div className="mb-8">
          <h2 className="font-semibold mb-3">Request Lagu</h2>
          <SearchBar eventId={event.id} />
        </div>
      ) : (
        <div className="mb-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          {event.status === "paused"
            ? "Request lagu sedang ditunda sementara oleh host."
            : "Portal request sudah ditutup."}
        </div>
      )}

      <div>
        <h2 className="font-semibold mb-3">Queue</h2>
        <QueueList eventId={event.id} initialRequests={requests ?? []} />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Manual end-to-end test — full audience flow**

```bash
pnpm dev
```

1. Go to `http://localhost:3000`, enter event PIN + nickname → submit
2. Expected: redirect to `/event/[pin]`
3. Search for a song, click it
4. Expected: success message, song appears in queue
5. Open a second browser tab with the same event page
6. Expected: song appears in second tab within 1-2 seconds (Realtime)
7. Make sure Spotify is playing something — check that queue gets updated

Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add src/app/event/
git commit -m "feat: audience event page with search and live queue"
```

---

## Task 14: Admin Queue Management

**Files:**

- Create: `src/lib/actions/queue.ts`
- Create: `src/components/admin/QueueManager.tsx`
- Create: `src/app/admin/queue/page.tsx`

- [ ] **Step 1: Create `src/lib/actions/queue.ts`**

```ts
"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { getValidToken } from "@/lib/spotify/tokens";
import { skipToNext } from "@/lib/spotify/client";
import type { SpotifyTokens } from "@/types/database";

export async function skipRequest(
  requestId: string,
  eventId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createServiceClient();

  const { data: request } = await supabase
    .from("song_requests")
    .select("participant_id")
    .eq("id", requestId)
    .single();

  if (!request) return { success: false, error: "Request not found" };

  await supabase
    .from("song_requests")
    .update({ status: "skipped" })
    .eq("id", requestId);

  // Free participant slot
  const { data: participant } = await supabase
    .from("event_participants")
    .select("id, request_count")
    .eq("id", request.participant_id)
    .single();

  if (participant && participant.request_count > 0) {
    await supabase
      .from("event_participants")
      .update({ request_count: participant.request_count - 1 })
      .eq("id", participant.id);
  }

  // Skip on Spotify (non-fatal)
  const { data: event } = await supabase
    .from("events")
    .select("spotify_token")
    .eq("id", eventId)
    .single();

  if (event?.spotify_token) {
    try {
      const { token, refreshed } = await getValidToken(
        event.spotify_token as SpotifyTokens,
      );
      if (refreshed) {
        await supabase
          .from("events")
          .update({ spotify_token: refreshed })
          .eq("id", eventId);
      }
      await skipToNext(token);
    } catch (err) {
      console.error("Spotify skip failed (non-fatal):", err);
    }
  }

  return { success: true };
}

export async function removeRequest(
  requestId: string,
): Promise<{ success: boolean }> {
  const supabase = await createServiceClient();

  const { data: request } = await supabase
    .from("song_requests")
    .select("participant_id")
    .eq("id", requestId)
    .single();

  if (!request) return { success: false };

  await supabase.from("song_requests").delete().eq("id", requestId);

  // Free participant slot
  const { data: participant } = await supabase
    .from("event_participants")
    .select("id, request_count")
    .eq("id", request.participant_id)
    .single();

  if (participant && participant.request_count > 0) {
    await supabase
      .from("event_participants")
      .update({ request_count: participant.request_count - 1 })
      .eq("id", participant.id);
  }

  return { success: true };
}

export async function reorderQueue(
  eventId: string,
  requestId: string,
  direction: "up" | "down",
): Promise<{ success: boolean }> {
  const supabase = await createServiceClient();

  const { data: requests } = await supabase
    .from("song_requests")
    .select("id, position")
    .eq("event_id", eventId)
    .eq("status", "pending")
    .order("position");

  if (!requests || requests.length < 2) return { success: false };

  const index = requests.findIndex((r) => r.id === requestId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapIndex < 0 || swapIndex >= requests.length)
    return { success: false };

  await supabase
    .from("song_requests")
    .update({ position: requests[swapIndex].position })
    .eq("id", requests[index].id);
  await supabase
    .from("song_requests")
    .update({ position: requests[index].position })
    .eq("id", requests[swapIndex].id);

  return { success: true };
}
```

- [ ] **Step 2: Create `src/components/admin/QueueManager.tsx`**

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { skipRequest, removeRequest, reorderQueue } from "@/lib/actions/queue";
import type { SongRequest } from "@/types/database";

interface Props {
  eventId: string;
  initialRequests: SongRequest[];
}

export function QueueManager({ eventId, initialRequests }: Props) {
  const [requests, setRequests] = useState<SongRequest[]>(initialRequests);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const supabase = createClient();

    async function fetchQueue() {
      const { data } = await supabase
        .from("song_requests")
        .select("*")
        .eq("event_id", eventId)
        .in("status", ["pending", "playing"])
        .order("position");
      if (data) setRequests(data);
    }

    const channel = supabase
      .channel(`admin-queue:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "song_requests",
          filter: `event_id=eq.${eventId}`,
        },
        () => fetchQueue(),
      )
      .subscribe(() => fetchQueue());

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId]);

  function handleSkip(requestId: string) {
    startTransition(async () => {
      await skipRequest(requestId, eventId);
    });
  }

  function handleRemove(requestId: string) {
    startTransition(async () => {
      await removeRequest(requestId);
    });
  }

  function handleReorder(requestId: string, direction: "up" | "down") {
    startTransition(async () => {
      await reorderQueue(eventId, requestId, direction);
    });
  }

  if (requests.length === 0) {
    return <p className="text-zinc-500 text-center py-8">Queue kosong</p>;
  }

  return (
    <ul className="divide-y divide-zinc-100">
      {requests.map((req, i) => (
        <li key={req.id} className="flex items-center gap-3 py-3">
          <span className="text-zinc-400 text-sm w-6 text-right flex-shrink-0">
            {req.status === "playing" ? "▶" : i + 1}
          </span>
          {req.album_art_url && (
            <img
              src={req.album_art_url}
              alt=""
              className="w-10 h-10 rounded flex-shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{req.track_name}</p>
            <p className="text-zinc-500 text-xs truncate">
              {req.artist_name} · {req.requested_by}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => handleReorder(req.id, "up")}
              disabled={isPending || i === 0}
              className="p-1 text-zinc-400 hover:text-zinc-700 disabled:opacity-30 text-xs"
              title="Move up"
            >
              ▲
            </button>
            <button
              onClick={() => handleReorder(req.id, "down")}
              disabled={isPending || i === requests.length - 1}
              className="p-1 text-zinc-400 hover:text-zinc-700 disabled:opacity-30 text-xs"
              title="Move down"
            >
              ▼
            </button>
            <button
              onClick={() => handleSkip(req.id)}
              disabled={isPending}
              className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200 disabled:opacity-50"
            >
              Skip
            </button>
            <button
              onClick={() => handleRemove(req.id)}
              disabled={isPending}
              className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Create `src/app/admin/queue/page.tsx`**

```tsx
import { createServiceClient } from "@/lib/supabase/server";
import { QueueManager } from "@/components/admin/QueueManager";
import { redirect } from "next/navigation";

export default async function AdminQueuePage() {
  const supabase = await createServiceClient();

  const { data: event } = await supabase
    .from("events")
    .select("id, name, pin, status")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!event) redirect("/admin/setup");

  const { data: requests } = await supabase
    .from("song_requests")
    .select("*")
    .eq("event_id", event.id)
    .in("status", ["pending", "playing"])
    .order("position");

  async function toggleStatus() {
    "use server";
    const supabase = await createServiceClient();
    const { data: current } = await supabase
      .from("events")
      .select("status")
      .eq("id", event.id)
      .single();
    const newStatus = current?.status === "open" ? "paused" : "open";
    await supabase
      .from("events")
      .update({ status: newStatus })
      .eq("id", event.id);
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{event.name}</h1>
          <p className="text-sm text-zinc-500">
            PIN:{" "}
            <span className="font-mono font-bold text-zinc-900">
              {event.pin}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs px-2 py-1 rounded-full ${
              event.status === "open"
                ? "bg-green-100 text-green-800"
                : "bg-yellow-100 text-yellow-800"
            }`}
          >
            {event.status}
          </span>
          <form action={toggleStatus}>
            <button
              type="submit"
              className="text-sm border rounded-lg px-3 py-1.5 hover:bg-zinc-50"
            >
              {event.status === "open" ? "Pause" : "Open"}
            </button>
          </form>
          <a
            href="/admin/settings"
            className="text-sm text-zinc-500 hover:text-zinc-900"
          >
            Settings →
          </a>
        </div>
      </div>

      <QueueManager eventId={event.id} initialRequests={requests ?? []} />
    </main>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/queue.ts src/components/admin/ src/app/admin/queue/
git commit -m "feat: admin queue management with skip, remove, reorder"
```

---

## Task 15: Spotify Sync

**Files:**

- Create: `src/app/api/spotify/sync/route.ts`
- Create: `src/components/admin/SpotifySync.tsx`
- Modify: `src/app/admin/queue/page.tsx` (add SpotifySync)

- [ ] **Step 1: Create `src/app/api/spotify/sync/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentlyPlaying } from "@/lib/spotify/client";
import { getValidToken } from "@/lib/spotify/tokens";
import type { SpotifyTokens } from "@/types/database";

export async function POST(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("eventId");
  if (!eventId)
    return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

  const supabase = await createServiceClient();

  const { data: event } = await supabase
    .from("events")
    .select("spotify_token")
    .eq("id", eventId)
    .single();

  if (!event?.spotify_token) return NextResponse.json({ ok: true });

  try {
    const tokens = event.spotify_token as SpotifyTokens;
    const { token, refreshed } = await getValidToken(tokens);
    if (refreshed) {
      await supabase
        .from("events")
        .update({ spotify_token: refreshed })
        .eq("id", eventId);
    }

    const playing = await getCurrentlyPlaying(token);
    if (!playing) return NextResponse.json({ ok: true });

    // Find any currently-marked-playing request
    const { data: currentPlaying } = await supabase
      .from("song_requests")
      .select("id, spotify_track_id, participant_id")
      .eq("event_id", eventId)
      .eq("status", "playing")
      .maybeSingle();

    // If track changed from what we marked as playing, mark it played
    if (currentPlaying && currentPlaying.spotify_track_id !== playing.trackId) {
      await supabase
        .from("song_requests")
        .update({ status: "played" })
        .eq("id", currentPlaying.id);

      // Free participant slot + record play time for cooldown
      const { data: participant } = await supabase
        .from("event_participants")
        .select("id, request_count")
        .eq("id", currentPlaying.participant_id)
        .single();

      if (participant) {
        await supabase
          .from("event_participants")
          .update({
            request_count: Math.max(0, participant.request_count - 1),
            last_played_at: new Date().toISOString(),
          })
          .eq("id", participant.id);
      }
    }

    // Mark the currently playing track as 'playing' in our queue (if we have it as pending)
    if (
      !currentPlaying ||
      currentPlaying.spotify_track_id !== playing.trackId
    ) {
      const { data: pendingMatch } = await supabase
        .from("song_requests")
        .select("id")
        .eq("event_id", eventId)
        .eq("spotify_track_id", playing.trackId)
        .eq("status", "pending")
        .maybeSingle();

      if (pendingMatch) {
        await supabase
          .from("song_requests")
          .update({ status: "playing" })
          .eq("id", pendingMatch.id);
      }
    }
  } catch (err) {
    console.error("Spotify sync error:", err);
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Create `src/components/admin/SpotifySync.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";

interface Props {
  eventId: string;
}

export function SpotifySync({ eventId }: Props) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function sync() {
      try {
        await fetch(`/api/spotify/sync?eventId=${eventId}`, { method: "POST" });
      } catch {
        // Network errors are acceptable; sync will retry on next interval
      }
    }

    sync();
    intervalRef.current = setInterval(sync, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [eventId]);

  return null;
}
```

- [ ] **Step 3: Add SpotifySync to admin queue page**

In `src/app/admin/queue/page.tsx`, import and add `SpotifySync` just before the closing `</main>` tag:

```tsx
import { SpotifySync } from "@/components/admin/SpotifySync";

// Add inside the JSX, before closing </main>:
<SpotifySync eventId={event.id} />;
```

The full last section of the JSX should look like:

```tsx
      <QueueManager eventId={event.id} initialRequests={requests ?? []} />
      <SpotifySync eventId={event.id} />
    </main>
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/spotify/ src/components/admin/SpotifySync.tsx src/app/admin/queue/page.tsx
git commit -m "feat: Spotify sync polling via admin dashboard"
```

---

## Task 16: Admin Settings Page

**Files:**

- Create: `src/lib/actions/settings.ts`
- Create: `src/components/admin/SettingsForm.tsx`
- Create: `src/app/admin/settings/page.tsx`

- [ ] **Step 1: Create `src/lib/actions/settings.ts`**

```ts
"use server";

import { createServiceClient } from "@/lib/supabase/server";
import type { EventSettings, EventStatus } from "@/types/database";
import { z } from "zod";

const settingsSchema = z.object({
  max_requests: z.coerce.number().int().min(0).max(100),
  cooldown_minutes: z.coerce.number().int().min(0).max(120),
  max_duration_ms: z.coerce.number().int().min(0),
  allow_explicit: z.boolean(),
});

export async function updateSettings(
  eventId: string,
  formData: FormData,
): Promise<{ success: boolean; error?: string }> {
  const parsed = settingsSchema.safeParse({
    max_requests: formData.get("max_requests"),
    cooldown_minutes: formData.get("cooldown_minutes"),
    max_duration_ms: Number(formData.get("max_duration_minutes") ?? 0) * 60_000,
    allow_explicit: formData.get("allow_explicit") === "on",
  });
  if (!parsed.success)
    return { success: false, error: "Invalid settings values" };

  const supabase = await createServiceClient();
  const { error } = await supabase
    .from("events")
    .update({ settings: parsed.data })
    .eq("id", eventId);

  return error
    ? { success: false, error: "Failed to save" }
    : { success: true };
}

export async function updatePortalStatus(
  eventId: string,
  status: EventStatus,
): Promise<void> {
  const supabase = await createServiceClient();
  await supabase.from("events").update({ status }).eq("id", eventId);
}

export async function addToBlacklist(
  eventId: string,
  spotifyTrackId: string,
  trackName: string,
): Promise<void> {
  const supabase = await createServiceClient();
  await supabase.from("blacklisted_tracks").upsert({
    event_id: eventId,
    spotify_track_id: spotifyTrackId,
    track_name: trackName,
  });
}

export async function removeFromBlacklist(
  eventId: string,
  spotifyTrackId: string,
): Promise<void> {
  const supabase = await createServiceClient();
  await supabase
    .from("blacklisted_tracks")
    .delete()
    .eq("event_id", eventId)
    .eq("spotify_track_id", spotifyTrackId);
}
```

- [ ] **Step 2: Create `src/components/admin/SettingsForm.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { updateSettings, removeFromBlacklist } from "@/lib/actions/settings";
import type { EventSettings, BlacklistedTrack } from "@/types/database";

interface Props {
  eventId: string;
  settings: EventSettings;
  blacklist: BlacklistedTrack[];
}

export function SettingsForm({ eventId, settings, blacklist }: Props) {
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateSettings(eventId, formData);
      if (result.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  }

  function handleRemoveBlacklist(spotifyTrackId: string) {
    startTransition(async () => {
      await removeFromBlacklist(eventId, spotifyTrackId);
    });
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
          {saved ? "Saved!" : isPending ? "Saving..." : "Save Settings"}
        </button>
      </form>

      <div>
        <h2 className="font-semibold text-lg mb-3">Blacklisted Tracks</h2>
        {blacklist.length === 0 ? (
          <p className="text-sm text-zinc-500">No blacklisted tracks.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 border rounded-lg overflow-hidden">
            {blacklist.map((track) => (
              <li
                key={track.id}
                className="flex items-center justify-between px-3 py-2"
              >
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
          To blacklist a song, use the queue manager: hover a song and click
          "Blacklist".
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/app/admin/settings/page.tsx`**

```tsx
import { createServiceClient } from "@/lib/supabase/server";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { redirect } from "next/navigation";

export default async function AdminSettingsPage() {
  const supabase = await createServiceClient();

  const { data: event } = await supabase
    .from("events")
    .select("id, name, settings")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!event) redirect("/admin/setup");

  const { data: blacklist } = await supabase
    .from("blacklisted_tracks")
    .select("*")
    .eq("event_id", event.id)
    .order("added_at", { ascending: false });

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Settings — {event.name}</h1>
        <a
          href="/admin/queue"
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← Queue
        </a>
      </div>
      <SettingsForm
        eventId={event.id}
        settings={event.settings}
        blacklist={blacklist ?? []}
      />
    </main>
  );
}
```

- [ ] **Step 4: Add "Blacklist" button to QueueManager**

In `src/components/admin/QueueManager.tsx`, import `addToBlacklist` and add a button:

```tsx
// Add import
import { skipRequest, removeRequest, reorderQueue } from "@/lib/actions/queue";
import { addToBlacklist } from "@/lib/actions/settings";

// Add handler inside QueueManager:
function handleBlacklist(req: SongRequest) {
  startTransition(async () => {
    await addToBlacklist(eventId, req.spotify_track_id, req.track_name);
    await removeRequest(req.id);
  });
}

// Add button in the button group (after Remove button):
<button
  onClick={() => handleBlacklist(req)}
  disabled={isPending}
  className="px-2 py-1 text-xs bg-zinc-100 text-zinc-700 rounded hover:bg-zinc-200 disabled:opacity-50"
>
  Ban
</button>;
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/settings.ts src/components/admin/SettingsForm.tsx src/app/admin/settings/ src/components/admin/QueueManager.tsx
git commit -m "feat: admin settings page with configurable limits and blacklist"
```

---

## Task 17: Rate Limiting

**Files:**

- Create: `src/lib/rate-limit.ts`
- Create: `src/lib/rate-limit.test.ts`
- Modify: `src/lib/actions/participant.ts` (add join rate limit)
- Modify: `src/lib/actions/requests.ts` (add search rate limit)

- [ ] **Step 1: Write failing tests**

Create `src/lib/rate-limit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildRateLimitKey, isWithinWindow } from "./rate-limit";

describe("buildRateLimitKey", () => {
  it("combines identifier and action", () => {
    expect(buildRateLimitKey("1.2.3.4", "join_attempt")).toBe(
      "1.2.3.4:join_attempt",
    );
  });
});

describe("isWithinWindow", () => {
  it("returns true when window_start is within the window", () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(isWithinWindow(recent, 10)).toBe(true);
  });
  it("returns false when window_start is outside the window", () => {
    const old = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    expect(isWithinWindow(old, 10)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm test
```

Expected: FAIL — `Cannot find module './rate-limit'`

- [ ] **Step 3: Create `src/lib/rate-limit.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export function buildRateLimitKey(identifier: string, action: string): string {
  return `${identifier}:${action}`;
}

export function isWithinWindow(
  windowStart: string,
  windowMinutes: number,
): boolean {
  const elapsed = (Date.now() - new Date(windowStart).getTime()) / 60_000;
  return elapsed < windowMinutes;
}

export async function checkRateLimitDb(
  supabase: SupabaseClient,
  identifier: string,
  action: string,
  maxCount: number,
  windowMinutes: number,
): Promise<{ allowed: boolean }> {
  const windowStart = new Date(
    Date.now() - windowMinutes * 60_000,
  ).toISOString();

  const { data: existing } = await supabase
    .from("rate_limits")
    .select("id, count")
    .eq("identifier", identifier)
    .eq("action", action)
    .gte("window_start", windowStart)
    .order("window_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!existing) {
    await supabase.from("rate_limits").insert({ identifier, action, count: 1 });
    return { allowed: true };
  }

  if (existing.count >= maxCount) return { allowed: false };

  await supabase
    .from("rate_limits")
    .update({ count: existing.count + 1 })
    .eq("id", existing.id);

  return { allowed: true };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm test
```

Expected: All tests pass.

- [ ] **Step 5: Add IP rate limiting to `joinEvent` in `src/lib/actions/participant.ts`**

Add after the `joinSchema.safeParse` check, before the Supabase event lookup:

```ts
import { headers } from "next/headers";
import { checkRateLimitDb } from "@/lib/rate-limit";

// Inside joinEvent, after parsed.success check:
const headersList = await headers();
const ip =
  headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
const { allowed } = await checkRateLimitDb(supabase, ip, "join_attempt", 5, 10);
if (!allowed) {
  return {
    success: false,
    error: "Terlalu banyak percobaan. Coba lagi dalam 10 menit.",
  };
}
```

> Insert this block right after `const supabase = await createServiceClient()` and before the event lookup.

- [ ] **Step 6: Add session rate limiting to `searchSongs` in `src/lib/actions/requests.ts`**

Add search rate limiting inside `searchSongs`, after confirming the participant session:

```ts
import { checkRateLimitDb } from "@/lib/rate-limit";

// Inside searchSongs, after confirming event.spotify_token exists:
const cookieStore = await cookies();
const sessionToken = cookieStore.get("session_token")?.value ?? "anon";
const { allowed } = await checkRateLimitDb(
  supabase,
  sessionToken,
  "search",
  20,
  1,
);
if (!allowed) {
  return { error: "Terlalu banyak pencarian. Tunggu 1 menit." };
}
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/rate-limit.ts src/lib/rate-limit.test.ts src/lib/actions/participant.ts src/lib/actions/requests.ts
git commit -m "feat: IP and session-based rate limiting for join and search"
```

---

## Final Verification Checklist

- [ ] `pnpm test` — all unit tests pass
- [ ] `pnpm build` — production build succeeds with no TypeScript errors
- [ ] Manual: Full audience flow end-to-end (join → search → request → see in queue on another device)
- [ ] Manual: Admin flow (log in → view queue → skip → settings change)
- [ ] Manual: Spotify sync (play a requested song → see it marked as playing in queue)
- [ ] Manual: Rate limits (submit 4th request beyond limit → get correct error message)
- [ ] Manual: Blacklist (ban a song → try requesting it → get correct error)
- [ ] Manual: Portal toggle (pause portal → audience sees paused state)

---

## Out of Scope (v2+)

- Analytics dashboard (top songs, request counts, export CSV)
- Voting/upvote system
- Notifications when song plays
- Custom branding (logo upload)
- Multiple simultaneous events per host
