# Gorshey · སྒོར་གཞས། — Agent Kit: Start Here

This kit turns Claude Code into a disciplined builder for Gorshey. You (Kunshe) stay the lead:
the agent works one milestone at a time, stops at checkpoints, and never touches secrets, uploads, or deploys.

## What's in the kit

```
CLAUDE.md                          rules the agent reads every session
PROGRESS.md                        shared progress log (agent updates it)
START-HERE.md                      this file
.claude/settings.json              permission allow/deny list (secrets, deploy commands blocked)
.claude/skills/gorshey-tibetan/    Tibetan rendering + text-data rules, checker script
.claude/skills/gorshey-audio-sync/ sync math, AudioEngine, iOS, service-worker rules
docs/ARCHITECTURE.md               every agreed decision
docs/SKILLS-SETUP.md               third-party skills to install + review checklist
docs/tasks/M00 … M11               one task file per milestone
```

## Step 1 — Human setup
Do everything in `docs/tasks/M00-human-setup.md`, including `docs/SKILLS-SETUP.md`.

## Step 2 — First session
In the repo folder run `claude`, then paste:

> Read CLAUDE.md, PROGRESS.md and docs/ARCHITECTURE.md. Summarize the project rules back to me in 10 lines,
> list the skills you can see, and tell me anything in the kit that looks inconsistent. Do not write code yet.

Fix anything it flags before continuing.

## Step 3 — The milestone loop (repeat for M0 → M11)

1. Start fresh: `/clear` (each milestone gets a clean context; CLAUDE.md and PROGRESS.md carry the memory).
2. Paste:
   > Execute docs/tasks/M<N>-<name>.md. First restate the goal, the skills you will load, and the files you will
   > create or change. Stop at any [checkpoint] for my approval.
3. Approve the plan (or correct it).
4. When it reports done, check yourself:
   - `npm run lint && npm run test && npm run build`
   - `git diff` — read it; ask the agent to explain anything unclear.
   - For M3 onward, actually listen in the browser.
5. Paste:
   > Run differential-review on this milestone's changes, fix anything high or medium, update PROGRESS.md, and commit.
6. Do any **[HUMAN]** steps in the task file. Push.

## Order and where you're needed

| Milestone | Agent | You |
| :--- | :--- | :--- |
| M00 Setup | — | Everything |
| M0 Scaffold | Builds | Approve dependency list |
| M1 Content pipeline | Scripts + tests | Fill track YAML, run upload |
| M2 Sync core | Pure logic + tests | Review tests |
| M3 Audio engine | Engine + harness | Listen on desktop + iPhone |
| M4 i18n | Catalogs + formatters | Native review of Tibetan strings (or find a reviewer) |
| M5 UI shell | Mock → real UI | Approve the static mock |
| M6 Presence | Client | Two-browser test |
| M7 Media Session | Lock-screen | Check on phones |
| M8 PWA | SW + manifest | Install on phone |
| M9 Polish | Theme | Visual sign-off |
| M10 QA & security | Automated checks | Device matrix |
| M11 Deploy | vercel.json + docs | Vercel import, domain |

The first audible milestone is **M3** — synced audio with a bare-bones page.

## Useful prompts during the build

- Stuck bug: "Use systematic debugging. Reproduce first, then form hypotheses; don't change code until you can explain the cause."
- Drift check: "Re-read CLAUDE.md invariants and check the current diff against each one."
- New finding on a device: "Add this to gorshey-audio-sync/references/pitfalls.md and fix it."
- Adding a language later: "Add French following ARCHITECTURE §5 — catalog, LOCALES entry, metadata fields, tests."

## Safety reminders
- Never paste keys into the chat. The agent is denied `.env*` and R2 credentials on purpose.
- Upload, deploy, DNS, and `git push` are yours. The agent writes the scripts; you run them.
- Any new third-party skill goes through the review checklist in `docs/SKILLS-SETUP.md` first.
