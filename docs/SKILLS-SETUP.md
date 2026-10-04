# Skills Setup (one-time, done by Kunshe)

Install only from the publishers' own organizations. Forks and re-hosting directories are not trusted sources.

## A. Vendor plugins (official marketplaces) — run inside Claude Code

```
/plugin marketplace add supabase/agent-skills
/plugin install supabase@supabase-agent-skills

/plugin marketplace add cloudflare/skills
/plugin install cloudflare@cloudflare

/plugin marketplace add trailofbits/skills
# then from the /plugin menu install ONLY: differential-review, static-analysis

# optional — test-first workflow
/plugin install superpowers@claude-plugins-official
```

Do **not** connect the Supabase MCP server. The Cloudflare docs MCP (read-only documentation) is fine.

## B. Vendored skills (copied into this repo and committed)

```bash
cd /tmp && git clone --depth 1 https://github.com/anthropics/skills anthropic-skills
cd anthropic-skills && git rev-parse HEAD          # record below
cp -r skills/frontend-design skills/webapp-testing skills/skill-creator <repo>/.claude/skills/

cd /tmp && git clone --depth 1 https://github.com/vercel-labs/agent-skills vercel-skills
cd vercel-skills && git rev-parse HEAD
ls skills/                                         # find the web-design-guidelines folder
cp -r skills/<web-design-guidelines-folder> <repo>/.claude/skills/web-design-guidelines
```

Pinned commits:
- anthropics/skills: `________`
- vercel-labs/agent-skills: `________`

## C. Review checklist (before committing any third-party skill)
- [ ] Read `SKILL.md` end to end — nothing asks the agent to fetch-and-run remote code, disable checks, or send data anywhere unexpected.
- [ ] Read every file in `scripts/` — know what each one executes.
- [ ] Note any network access the skill performs (e.g. web-design-guidelines fetches its live guideline list).
- [ ] Commit the folder; future updates are reviewed as `git diff`.

## D. Project skills (already in this kit)
- `.claude/skills/gorshey-tibetan/`
- `.claude/skills/gorshey-audio-sync/`

## E. Verify
Start Claude Code in the repo and ask: "List the skills you have available." All of the above should appear.
