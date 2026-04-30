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

## Vault sync

### Run a one-time full scan (no daemon, just sync once and exit)
```bash
cd /Users/keeganlamar/Documents/ViaOps/Projects/shared-brain/agent
set -a && source ../.env.local && set +a
npm run sync:once
```

### Run as a daemon (full scan + watch for changes)
```bash
cd /Users/keeganlamar/Documents/ViaOps/Projects/shared-brain/agent
set -a && source ../.env.local && set +a
npm run sync:watch
```
Terminal must stay open. For background auto-start see "Install as launchd
service" below.

### Dry run (see what would sync without touching the API)
```bash
cd /Users/keeganlamar/Documents/ViaOps/Projects/shared-brain/agent
set -a && source ../.env.local && set +a
npm run sync:dry
```

### Check what's in the vault sync log
```bash
curl -sS https://shared-brain-ecru.vercel.app/api/sync/log?limit=50 \
  -H "Authorization: Bearer $MCP_API_KEY" | jq
```
Status values: `synced`, `error`, `pending`. The `error_message` column has
details when status is `error`.

### Re-sync a single file by force (clear its log entry)
1. Open Drizzle Studio: `cd /Users/keeganlamar/Documents/ViaOps/Projects/shared-brain && npm run db:studio`
2. Find the row in `vault_sync_log` where `file_path` matches.
3. Delete it. The next sync will treat the file as new.

### Install as launchd service (auto-start on login)

**This auto-starts the watcher on every login.** Only install when you're
ready for that.

1. Save this to `~/Library/LaunchAgents/com.viaops.shared-brain.sync.plist`,
   replacing `REPLACE_ME` with your `MCP_API_KEY`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.viaops.shared-brain.sync</string>
  <key>WorkingDirectory</key>
  <string>/Users/keeganlamar/Documents/ViaOps/Projects/shared-brain/agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-l</string>
    <string>-c</string>
    <string>cd /Users/keeganlamar/Documents/ViaOps/Projects/shared-brain/agent &amp;&amp; npm run sync:watch</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>SHARED_BRAIN_API_BASE</key>
    <string>https://shared-brain-ecru.vercel.app</string>
    <key>MCP_API_KEY</key>
    <string>REPLACE_ME</string>
    <key>VAULT_PATH</key>
    <string>/Users/keeganlamar/Documents/ViaOps</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/keeganlamar/Library/Logs/shared-brain-sync.out.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/keeganlamar/Library/Logs/shared-brain-sync.err.log</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
```

2. Load it:
   ```bash
   launchctl load ~/Library/LaunchAgents/com.viaops.shared-brain.sync.plist
   ```
3. Verify it's running:
   ```bash
   launchctl list | grep shared-brain
   tail -f ~/Library/Logs/shared-brain-sync.out.log
   ```
4. Stop / unload:
   ```bash
   launchctl unload ~/Library/LaunchAgents/com.viaops.shared-brain.sync.plist
   ```

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
