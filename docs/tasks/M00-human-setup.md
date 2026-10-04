# M00 — Human setup [HUMAN — Kunshe only]

The agent does not perform these steps. It may explain any of them on request.

## Tools on your machine
- Node.js 20 LTS or newer, npm, git
- ffmpeg (provides `ffprobe`, used to measure track durations)
- Claude Code (logged in)

## Accounts (free tiers)
- GitHub — create an empty private repo `gorshey`.
- Cloudflare — create R2 bucket `gorshey-media`; enable public access through a custom domain
  (e.g. `cdn.<your-domain>`). Create an R2 API token scoped to that bucket only (Object Read & Write).
  Save the keys in `tools/.r2-credentials.env` (gitignored, agent-denied). Never paste them into chat.
- Supabase — create project `gorshey`. Copy the Project URL and the **anon/publishable** key into `.env.local`
  as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Do not copy the service-role key anywhere.
- Vercel — sign in with GitHub (project import happens in M11).

## Repo bootstrap
1. Clone the empty repo, copy this kit's contents into it (including the hidden `.claude/` folder).
2. Follow `docs/SKILLS-SETUP.md`.
3. `git add -A && git commit -m "chore: agent kit and project rules"` and push.

## Content
- Put 5–10 audio files in `media/audio/` and artwork in `media/art/` (both gitignored).
- You will fill in `tools/tracks.source.yaml` during M1.

Done when: tools installed, accounts ready, `.env.local` exists, kit committed, skills verified.
