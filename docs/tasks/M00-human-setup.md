# M00 — Human setup [HUMAN — Kunshe only]

The agent does not perform these steps. It may explain any of them on request.

## Tools on your machine
- Node.js 20 LTS or newer, npm, git
- ffmpeg (provides `ffprobe`, used to measure track durations)
- Claude Code (logged in)

## Accounts (free tiers)
- GitHub — create an empty private repo `gorshey`.
- Supabase — create project `gorshey`.
  - Copy the Project URL and the **anon/publishable** key into `.env.local` as `VITE_SUPABASE_URL` and
    `VITE_SUPABASE_ANON_KEY`. Do not copy the service-role key into `.env.local` — that file is used by the
    frontend build and must only ever hold the public anon key.
  - **Storage bucket for media (current backend, see ARCHITECTURE §0):** Storage → New bucket → name
    `gorshey-media` → **Public bucket: on**. No card required, 1 GB free (~200 tracks at 128–160 kbps).
  - For the upload script in M1, copy the **service-role** key separately into
    `tools/.supabase-service-key.env` (gitignored, agent-denied, never pasted into chat) — uploads to a
    bucket need more rights than the public anon key has.
- Cloudflare R2 — **skip for now.** Only needed when the library approaches ~200 tracks / ~800 MB (ARCHITECTURE §0).
  At that point: add a card, set a Cloudflare budget alert (Billing → Notifications, low threshold), create bucket
  `gorshey-media`, enable a custom domain, create a scoped API token, save keys in `tools/.r2-credentials.env`.
- Vercel — sign in with GitHub (project import happens in M11).

## Repo bootstrap
1. Clone the empty repo, copy this kit's contents into it (including the hidden `.claude/` folder).
2. Follow `docs/SKILLS-SETUP.md`.
3. `git add -A && git commit -m "chore: agent kit and project rules"` and push.

## Content
- Put 5–10 audio files in `media/audio/` and artwork in `media/art/` (both gitignored).
- You will fill in `tools/tracks.source.yaml` during M1.

Done when: tools installed, accounts ready, `.env.local` exists, kit committed, skills verified.
