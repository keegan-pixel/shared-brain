---
title: Shared Brain — Runbook
created: 2026-04-30
updated: 2026-04-30
status: living-document
tags: [viaops-internal, shared-brain, runbook, ops]
related: "[[AI-Native PM Platform - MVP Spec]]"
---

# Shared Brain — Runbook

How to do common operational and development tasks. Keep this practical —
copy-paste commands, exact paths, no theory.

> **Related:**
> - [[AI-Native PM Platform - MVP Spec]] — what we're building
> - [[Build Log]] — what's been built so far
> - [[Decisions]] — why things are the way they are

---

## Local development

**Run the dev server:**
```bash
cd /Users/keeganlamar/Documents/ViaOps/Projects/shared-brain
npm run dev
```
Open http://localhost:3000.

**Apply pending migrations:**
```bash
npm run db:migrate
```
Also runs `CREATE EXTENSION IF NOT EXISTS vector` on Neon.

**Generate a new migration after editing `src/lib/db/schema.ts`:**
```bash
npm run db:generate    # creates the .sql file
npm run db:migrate     # applies it
```

**Open Drizzle Studio (web UI for inspecting the DB):**
```bash
npm run db:studio
```

**Typecheck and build:**
```bash
npm run typecheck
npm run build
```

---

## Adding a new MCP tool

1. Edit `src/lib/mcp/tools.ts`. Add a `server.tool(name, description, schema, handler)`
   call inside `registerTools()`.
2. If the tool writes data, call `logActivity(...)` from `src/lib/activity.ts`
   so the action shows up in the activity feed.
3. Always validate the org scope via `assertSpaceInOrg`, `assertProjectInOrg`,
   or equivalent — never trust the client to pass IDs from the right org.
4. Run `npm run typecheck` to verify the Zod schema → handler types line up.
5. Commit, push. Vercel auto-deploys in ~2 min.
6. **Restart Claude Desktop** (Cmd-Q, reopen). The mcp-remote bridge re-fetches
   the tool list on connection start; new tools won't appear until restart.

---

## Adding a new database table

1. Edit `src/lib/db/schema.ts`. Define the table with `pgTable(...)`. Always
   include indexes for foreign keys you'll query on.
2. `npm run db:generate` — creates a new `drizzle/000N_name.sql` file. Inspect
   it before applying.
3. `npm run db:migrate` — applies to local Neon.
4. Commit the generated SQL file. Vercel doesn't run migrations automatically
   — you have to run `db:migrate` locally pointing at the same `DATABASE_URL`
   before users hit the deployed app.

---

## Rotating secrets

### MCP_API_KEY
1. Generate a new key:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
2. Update `.env.local` with the new value.
3. Update Vercel: Settings → Environment Variables → `MCP_API_KEY` → edit → save.
4. Redeploy (Vercel does this automatically on env change).
5. Update every connected client:
   - **Claude Desktop:** edit `~/Library/Application Support/Claude/claude_desktop_config.json`,
     change `AUTH_HEADER` env value, restart.
   - **Claude Code:** `claude mcp remove shared-brain && claude mcp add ...` with new key.

### Clerk keys (test → production)
See [[Build Log#Phase 1]] for the production-instance flow. TL;DR: Clerk
dashboard → Create production instance → re-add domains and providers →
copy `pk_live_…` and `sk_live_…` → update Vercel env vars → redeploy.
Test and production have separate user databases.

### Neon password
Neon dashboard → branches → `main` → reset password. Update `DATABASE_URL` in:
- `.env.local`
- Vercel env vars
- Anywhere else it's stored

### OpenAI key
platform.openai.com → API keys → revoke old → create new → update
`OPENAI_API_KEY` in `.env.local` and Vercel.

---

## Debugging

### Claude Desktop won't connect to shared-brain
1. Tail the logs:
   ```bash
   tail -n 100 ~/Library/Logs/Claude/mcp*.log
   ```
2. Most common causes:
   - **`401 Unauthorized`** — `MCP_API_KEY` mismatch. Check `.env.local` matches
     Vercel env. Check the Authorization header format in `claude_desktop_config.json`
     is `Bearer <key>` with a space.
   - **`500 MCP_API_KEY is not configured`** — Vercel env var missing. Add it
     and redeploy.
   - **Tools list empty** — restart Claude Desktop. mcp-remote caches the
     tool list per session.

### Vercel build fails with "DATABASE_URL is not set"
This shouldn't happen anymore (lazy-init Proxy in `src/lib/db/client.ts`,
see [[Decisions#ADR-007]]). If it does:
1. Verify `DATABASE_URL` is set in Vercel for the build environment.
2. Check no new file imports the DB client at module top-level with a
   guard that throws.

### "Space not found in this org" error from MCP tools
The tool is org-scoped. Check `MCP_USER_ID` env var on Vercel — if unset,
falls back to first org in the table. With multiple orgs, set it explicitly
to the Clerk userId of the org owner.

### Dev server crashes after deleting `.next`
Don't delete `.next` while `npm run dev` is running. Kill the dev server
first:
```bash
pkill -f "next dev"
rm -rf .next
npm run dev
```

---

## Documentation hygiene (the rule)

**After every milestone, update both:**
1. **Vault** at `~/Documents/ViaOps/Knowledge/Frameworks/Shared Brain/`:
   - `Build Log.md` — append phase section + update status table
   - `Decisions.md` — add any new ADRs
   - `Runbook.md` — add any new ops procedures discovered
   - `[[AI-Native PM Platform - MVP Spec]]` — mark completed checkboxes,
     add divergence notes
2. **Repo** at `Projects/shared-brain/docs/`:
   - Mirror the four files above
   - Commit with `docs:` prefix in the message

When Phase 2's vault sync agent ships, this becomes automatic. Until
then, do it by hand at the end of every phase.

---

## Quick reference

| Resource | Where |
|---|---|
| Production app | https://shared-brain-ecru.vercel.app/ |
| GitHub repo | https://github.com/keegan-pixel/shared-brain |
| Local repo | `/Users/keeganlamar/Documents/ViaOps/Projects/shared-brain/` |
| Spec | [[AI-Native PM Platform - MVP Spec]] |
| Vault docs folder | `~/Documents/ViaOps/Knowledge/Frameworks/Shared Brain/` |
| Repo docs folder | `Projects/shared-brain/docs/` |
| Vercel dashboard | https://vercel.com/dashboard |
| Neon dashboard | https://console.neon.tech/ |
| Clerk dashboard | https://dashboard.clerk.com/ |
| Local env file | `Projects/shared-brain/.env.local` |
| MCP endpoint | `https://shared-brain-ecru.vercel.app/api/mcp` |
| Claude Desktop config | `~/Library/Application Support/Claude/claude_desktop_config.json` |
