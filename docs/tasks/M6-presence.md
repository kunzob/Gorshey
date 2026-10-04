# M6 — Presence

**Goal:** live "N on the kora" count, failure-tolerant.
**Skills:** `supabase`.

## Files
`src/presence/presence.ts`, `tests/presence.test.ts`

## API
```ts
createPresence({ url, anonKey, channel = 'gorshey-kora' }): {
  connect(): void; track(): Promise<void>; untrack(): Promise<void>;
  onCount(cb: (n: number | null) => void): Unsubscribe; destroy(): void;
}
```
- Uses `@supabase/realtime-js` `RealtimeClient` directly (if the standalone client proves impractical, stop and
  propose `@supabase/supabase-js` with the size difference).
- Presence key: UUID from `crypto.randomUUID()` stored in `sessionStorage` (per tab).
- Count = number of keys in `presenceState()` on `sync`.
- `null` count on: missing env vars, `CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`. UI shows `badge.unknown` ("—").
- Wire: engine `playing` → `track()`, `paused`/`idle` → `untrack()`.

## Steps
1. Tests with a mocked client: sync counts, error → null, missing env → null without throwing.
2. Implement; manual test with two browsers against the real project (Kunshe's `.env.local`).

## Acceptance
- Count rises/falls within a few seconds as tabs play/pause.
- Blocking the Supabase domain in DevTools leaves playback fully working and the badge at "—".
- Only `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` appear in the built bundle (grep `dist/`).
