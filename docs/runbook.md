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
6. **Restart Claude Desktop / claude.ai** (Cmd-Q, reopen, or refresh the
   browser tab). The MCP tool list is fetched on connection start; new
   tools won't appear until the client reconnects.

---

## Built-in Claude chat panel (Phase 5b)

### Toggle and use
Click the message-square icon in the top right of the platform. The
slide-out chat panel hooks into Claude (default `claude-sonnet-4-5`)
with the platform's full read+write tool set. Persistence is
per-browser localStorage (`shared-brain.chat.messages`).

### Required env vars
- `ANTHROPIC_API_KEY` — server-side only. **Must be set in Vercel
  env vars** (Production / Preview / Development). Local `.env.local`
  doesn't matter for the deployed chat — only the Vercel side.
- `ANTHROPIC_MODEL_ID` (optional) — override the default model.
  Examples: `claude-sonnet-4-5`, `claude-opus-4-5`, `claude-haiku-4-5`.

### Tools the chat can call
Reads: `get_org`, `get_spaces`, `get_projects`, `get_items`, `search`,
`get_recent_activity`. Writes: `create_item`, `move_item_status`. Each
write logs an activity entry with `actor_agent: "claude-builtin"`.

Defined in `src/lib/chat/tools.ts`. To add a new tool:
1. Define it via `tool({ description, inputSchema, execute })`
2. Drop it into the returned object
3. Mirror it in `src/lib/mcp/tools.ts` if you also want Claude Desktop
   / Code / Cowork to have it (per ADR-017 we maintain both surfaces).

### Debugging
- 401 on `/api/chat`: not signed in to Clerk. Sign in.
- 500 "ANTHROPIC_API_KEY is not configured": add the key to Vercel
  env vars and redeploy.
- Chat returns stale data: the wiki page Claude searched is out of
  date. Re-sync the relevant vault file (`npm run sync:once`).

---

## Agent Operating Instructions (Phase 6)

The canonical user profile + standing instructions every Claude
agent reads at session start. Lives at
`Knowledge/Frameworks/Shared Brain/Profile.md` in the vault, mirrors
to a wiki page titled "Profile" via vault sync, served live by the
platform.

### Surfaces for consumption
- **In-platform chat** — system prompt instructs the model to call
  `get_operating_instructions` before non-trivial tasks. Tool defined
  in `src/lib/chat/tools.ts`.
- **MCP server** — exposes `get_operating_instructions` and
  `record_session_summary` so Claude Desktop / Code / Cowork / mobile
  can read the same doc (`src/lib/mcp/tools.ts`).
- **HTTP endpoint** — `GET /api/operating-instructions` returns the
  Profile as plain markdown (or JSON with `?format=json`). Bearer-auth
  with `MCP_API_KEY`. Used by the install-skill CLI.

### Editing the profile
- Edit `Knowledge/Frameworks/Shared Brain/Profile.md` in Obsidian.
- Save → vault sync agent pushes the new content to the platform.
- Next session pulls the updated version automatically.

### Install-skill CLI
Drops `~/CLAUDE.md` pointing at the live operating-instructions
endpoint, so any Claude Code / Cowork session inherits the latest
instructions globally.

```
cd shared-brain/
export MCP_API_KEY=...
npm run install-skill claude
```

The script verifies the endpoint responds before writing. Re-run
whenever the endpoint URL or API key changes — the file content
only updates if URL/key change, since instruction content is fetched
live each session.

### Recording session summaries
Standing rule: agents must call `record_session_summary` before
ending sessions with significant work. Behavior is enforced via the
operating instructions text and the chat system prompt. To verify
it's happening, check the activity feed for `session_summary` entries
or filter by the agent's actor name.

### Drift defense (Phase 6 + future)
Three layers:
1. **Operating Instructions** (this phase) — soft enforcement.
2. **Auto-capture from Composio signals** (Phase F4) — emails sent /
   meetings / docs created auto-generate brain entries.
3. **Drift detection cron** (post-Phase 8) — compares Composio
   activity to brain entries and surfaces gaps.

---

## External tools via Composio (Phase 5c)

The in-platform chat connects to Composio's **universal MCP endpoint**
(`https://connect.composio.dev/mcp`) authenticated with a **consumer
API key** (`ck_...`) from your Composio "For You" account. That gives
the chat the same meta-tool surface Claude Desktop gets when installed
via Composio's CLI: `COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_GET_TOOL_SCHEMAS`,
`COMPOSIO_MULTI_EXECUTE_TOOL`, `COMPOSIO_MANAGE_CONNECTIONS`, plus
workbench/wait/bash variants. The `account` parameter on
`MULTI_EXECUTE_TOOL` lets the chat route per call across all 19
connected accounts.

### Required env vars
- `COMPOSIO_CONSUMER_API_KEY` — the `ck_...` key from Composio's
  Sessions page. The chat falls back to platform-only tools without
  erroring if this is unset.
- `COMPOSIO_MCP_URL` (optional) — defaults to
  `https://connect.composio.dev/mcp`.

### Why not Composio's developer / Platform SDK?
Composio has two scopes:
- **"For You"** — your personal connections (the 19 accounts).
  Surfaced via the universal MCP endpoint with `x-consumer-api-key`.
- **"Platform"** — a developer multi-tenant project where YOU manage
  auth configs and orchestrate OAuth for other users. Different API
  key (`ak_...`), different scope, none of your personal connections.

The `@composio/core` SDK targets the Platform side, so it can't see
your "For You" connections. See ADR-020 for the full reasoning.

### Wiring
- `src/lib/chat/composio-tools.ts` — opens an MCP client via
  `@modelcontextprotocol/sdk`'s `StreamableHTTPClientTransport` with
  the `x-consumer-api-key` header set. Lists tools at cold start
  (5-min TTL cache) and adapts each into an AI SDK `dynamicTool`.
- `composioPromptHint()` injects a routing primer into the system
  prompt so Claude picks the right `account` per call.

### Adding/removing toolkits
- Connect or disconnect via Composio's "For You" dashboard
  (Connect Apps).
- The MCP endpoint reflects the change automatically; the chat picks
  it up on its next 5-min cache refresh (or restart).
- Update `Composio Mapping.md` with the new account IDs / routing rules.

### Debugging
- Chat falls back to "I don't have access": `COMPOSIO_CONSUMER_API_KEY`
  missing or wrong in Vercel. Check Settings → Environment Variables.
- MCP handshake errors: logged in Vercel as
  `[composio] MCP tools fetch failed: <message>`.
- Tool execute errors: surfaced inline in the chat (red error pill)
  and in Vercel logs as `[composio] tool '<NAME>' call failed: ...`.
- Wrong account picked: update the routing primer in
  `composioPromptHint()` and `Composio Mapping.md`.

---

## Onboarding a new user (Phase 8 v2 MVP)

The Thursday-install flow for a non-Keegan user. Walk in this order
(see ADR-037 for what's in scope and what's deferred):

### Pre-Thursday (Richard's homework, sent Monday)
1. Sign up for an Anthropic API account → generate a key
2. Optional: sign up for OpenAI API (cheaper embeddings)
3. Think about: org name, main work buckets
4. Light file cleanup (notice the structure, don't reorganize)
5. Confirm Claude Desktop is installed

### Thursday day-of

| Step | Where | What |
|---|---|---|
| 1 | Email link | Send Richard the platform URL → he signs up via Clerk |
| 2 | Onboarding checklist | His dashboard shows 5-step checklist; we walk it top to bottom |
| 3 | `/settings/org` | Name his brain ("Trade Oracle Brain" or similar), optional Obsidian vault name |
| 4 | `/settings/llm-keys` | Paste Anthropic key, optionally OpenAI key. Validate-and-save runs a test API call before persisting. |
| 5 | `/settings/connections` | Composio walkthrough: sign up at app.composio.dev (link provided in UI), connect his services, copy consumer key, paste back. Validate-and-save hits Composio's MCP for confirmation. |
| 6 | `/settings/daemon` | Reveals his per-org sync key. Enter vault path. Page generates a copy-paste install command (git clone + npm install + install-daemon --user-tag <slug>). We run it in Terminal on his Mac. Daemon starts, initial sync begins in background. |
| 7 | `/settings/claude` | Copy MCP URL → paste into Claude Desktop → Custom Connectors → OAuth flow → approve. |
| 8 | `/settings/claude` | Click "Download Project Instructions" → personalized .md file. Paste into Claude Desktop → his new Project → Custom Instructions. |
| 9 | Claude Desktop | First conversation in his Project → Claude runs the discovery interview embedded in the Project Instructions → creates his spaces/projects/Profile via MCP primitives. |
| 10 | Claude Desktop | Demo prompt: *"Look at everything in my brain and tell me what I should focus on this week."* Verifies end-to-end. |

Total wall-clock: ~90 min of active steps + ~30-60 min of background
initial sync he can wander off during.

### Cloud-only mode (Path B)

If the user doesn't keep work docs on their Mac:
- Skip step 6 (no daemon)
- All content comes via Composio integrations (auto-sync from Gmail,
  Drive, etc.) + new docs created by Claude inside the brain
- The onboarding checklist's "daemon connected" step stays pending —
  user can dismiss it (manual; no UI for that yet) or leave it
  unchecked as a sign of "skipped, intentional"

### Org renaming after install

User can rename at `/settings/org`. Slug stays stable on rename so
URLs don't break. Changes propagate everywhere on next page load.

---

## Settings pages reference (Phase 8 v2 MVP)

| Page | What's there |
|---|---|
| `/settings` | Index — cards for everything below |
| `/settings/org` | Brain name, URL slug (read-only), Obsidian vault name |
| `/settings/llm-keys` | Per-provider cards (Anthropic / OpenAI / Gemini) with paste + validate + save. Recommended use_for per provider pre-filled. |
| `/settings/connections` | Composio consumer key with paste + validate. Per-connection routing deferred to v2.1. |
| `/settings/daemon` | Per-org sync key (reveal-on-tap), vault-path input, generated one-line install command. Cloud-only mode skip-note. |
| `/settings/claude` | MCP URL + Custom Connector setup steps + "Download Project Instructions" button. |
| `/settings/sync` | Existing Phase F4 v2 page — per-Composio-connection auto-sync toggle. |

---

## Key resolver libs (Phase 8 v2 MVP)

Each external-service key now has a per-org resolver with env-var
fallback. Call sites pass `orgId` to scope per-org; resolvers walk
the right table, fall back to env if no row exists.

| Lib | Resolver | Falls back to env |
|---|---|---|
| `lib/llm-keys.ts` | `resolveOrgLlmKey({orgId, useCase, provider?})` | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` |
| `lib/composio-keys.ts` | `resolveOrgComposioKey(orgId)` | `COMPOSIO_API_KEY`, `COMPOSIO_CONSUMER_API_KEY` |
| `lib/sync/auth.ts` | `requireSyncAuth(req) → {orgId}` | `MCP_API_KEY` (resolves to first org) |

When updating a call site that touches one of these services: pass
the orgId from the caller's context (Clerk session, MCP context, or
sync auth result). Resolvers are async; cache appropriately.

### Backfill scripts

| Script | What it does |
|---|---|
| `scripts/backfill-org-vault-name.ts` | Sets `vault_name = 'ViaOps'` on Keegan's org (idempotent). |
| `scripts/backfill-org-llm-keys.ts` | Promotes env-var ANTHROPIC/OPENAI keys to `org_llm_config` rows for Keegan's org. Skips providers without env vars set. |
| `scripts/backfill-org-sync-keys.ts` | Generates `mcp_api_key` for any org where it's null. Run once after migration 0011. |

---

## OAuth on `/api/mcp` (Phase 8 v1)

Native AI clients (claude.ai Custom Connectors, future GPT/Gemini)
connect to the brain via OAuth 2.1 Authorization Code + PKCE — no
`mcp-remote` stdio bridge required. The legacy `MCP_API_KEY` Bearer
auth still works in parallel for the local agent + scripts.

### Surface

- `GET /.well-known/oauth-authorization-server` — RFC 8414 metadata.
  Public + CORS-open. The AI platform's connector setup fetches this
  first to learn the authorize/token URLs.
- `GET /oauth/authorize?client_id=…&redirect_uri=…&response_type=code&code_challenge=…&code_challenge_method=S256&state=…`
  Clerk-protected consent page. Validates every param; on Approve,
  302s to the redirect with `code` + `state`.
- `POST /api/oauth/token` — Form- or JSON-encoded. Exchanges code +
  PKCE verifier for an access token. Accepts client credentials via
  HTTP Basic auth or body fields. Returns
  `{ access_token: "sb_at_…", token_type: "Bearer", expires_in: 2592000, scope }`.
- `/api/mcp` accepts either `Bearer <MCP_API_KEY>` (legacy) or
  `Bearer sb_at_…` (OAuth). Unauthed requests return a
  `WWW-Authenticate` header pointing at the discovery doc.

### Register a client

`npm run create-oauth-client -- --name "<display name>" --redirect <https-uri>`

Prints `client_id` + `client_secret` ONCE — save them in 1Password.
The secret is scrypt-hashed in the DB; if you lose it, re-register.

Multiple `--redirect` flags allowed. Non-https redirects are rejected
unless the host is `localhost`/`127.0.0.1`.

### Connect from claude.ai (web + Desktop)

1. claude.ai web → Settings → Custom Connectors → Add new
2. Server URL: `https://shared-brain-ecru.vercel.app/api/mcp`
3. claude.ai auto-discovers OAuth via `.well-known/oauth-authorization-server`
4. Approve the consent page (signed in as Keegan via Clerk)
5. claude.ai stores the 30-day access token. Re-auth required after
   expiry (no refresh tokens in v1).

**Claude Desktop inherits this connector via account state** — the
Custom Connector you set up in claude.ai web automatically appears in
Desktop after restart. As of 2026-05-08, Desktop's old `mcp-remote`
stdio entry in `claude_desktop_config.json` was removed (the bridge
was the dominant disconnect cause; OAuth replaces it with native HTTP).

### Which clients still need `MCP_API_KEY`?

OAuth (preferred):
- claude.ai web (Custom Connectors UI)
- Claude Desktop (inherits from claude.ai account)
- Future GPT/Gemini/etc.

Static `MCP_API_KEY` (legacy, still required for these):
- Local sync agent (chokidar daemon — `/api/sync/*` endpoints)
- Vercel Cron (`/api/cron/*`)
- Backfill + maintenance scripts under `scripts/`
- Anthropic Messages API direct callers (server-side, never sees a UI)

`npm run rotate-key` still rotates `MCP_API_KEY` in `.env.local` and
the daemon plist. The Desktop-config-update step it used to do is now
a no-op (Desktop has no shared-brain entry to update).

### Token TTLs

- **Authorization code**: 10 minutes, single-use
- **Access token**: 30 days, opaque `sb_at_…`, no refresh tokens
- **Revocation**: set `oauth_access_tokens.revoked_at` (no UI in v1 —
  do it via DB)

### What's NOT in v1

Per-user identity — every OAuth-issued token currently resolves to
the same default org as the legacy `MCP_API_KEY`. Phase 8 v2 wires
the validated token's `userId` through to `resolveOrgContext` and
per-user Composio keys.

---

## AI Filing Engine + sync configs (Phase F4 v1/v2/v3)

The platform pulls in external content (today: Gmail; later: Drive,
Granola, Calendar, etc.) and AI-files it into the right vault
location. Three layers:

- **v1 — `file_document` tool** — the writer + safety net. Caller
  (Claude agent or sync-watcher adapter) provides `target_path` +
  `confidence`; <0.7 routes to `Inbox/`. ADR-027.
- **v2 — sync configs + daily cron** — `/settings/sync` UI lets the
  user toggle off/manual/auto per Composio connection. Daily cron at
  `/api/cron/auto-sync` walks `mode='auto'` rows and pulls new items.
  Gmail adapter shipped; other toolkits accept the toggle but their
  adapters are stubbed. ADR-028.
- **v3 — active-learning reconciliation** — when user moves an
  Inbox-filed file to a real folder, the system records a
  `filing_rules` row keyed by the source pattern (currently
  `gmail_from`). Future calls bypass Inbox for matched patterns.
  ADR-029.

### Enabling auto-sync for a Composio account
1. Open `https://shared-brain-ecru.vercel.app/settings/sync`
2. Find the connection (e.g. "Gmail · ViaOps (keegan@viaops.co)")
3. Click `auto`. The next daily cron run (07:00 UTC) picks it up.

To trigger immediately for testing:
```bash
KEY=$(grep '^MCP_API_KEY=' /path/to/.env.local | cut -d= -f2 | tr -d '"')
curl -H "Authorization: Bearer $KEY" \
  https://shared-brain-ecru.vercel.app/api/cron/auto-sync
```

The response shows per-config `{fetched, filed, filed_to_inbox,
errors}` summaries. `last_synced_at` advances on success.

### Adding a new toolkit adapter
1. Create `src/lib/sync-watchers/<toolkit>.ts` — function takes
   `{ orgId, config }` and returns
   `{ toolkit, connection_id, fetched, filed, filed_to_inbox, errors, cursor }`.
2. Use `executeComposioTool` (in `composio-mcp-call.ts`) to fetch
   new items via `COMPOSIO_MULTI_EXECUTE_TOOL` with the
   connection's `account` parameter.
3. For each item: build `title` + `content` (markdown text — extract
   from binary if needed) + `source` (origin descriptor) + a
   `frontmatter` dict that includes any `gmail_from`-equivalent
   match-kind hints (`meeting_attendee`, `drive_folder_id`, etc.) so
   filing_rules can learn from moves.
4. Call `fileDocument()` per item. Don't pre-classify in the
   adapter; `applyFilingRules` already handles known-pattern
   short-circuits.
5. Add a `case '<toolkit>':` in `/api/cron/auto-sync/route.ts`
   dispatch.
6. Update the UI's `SUPPORTED_TOOLKITS` set in
   `src/app/(app)/settings/sync/client.tsx` so the "not yet wired"
   badge disappears.

### Filing rules — list / inspect / delete

```sql
-- list all rules for the org
SELECT match_kind, match_value, target_path, hit_count, last_matched_at
FROM filing_rules WHERE org_id = '<id>'
ORDER BY hit_count DESC;

-- delete a rule that's misfiring
DELETE FROM filing_rules WHERE id = '<id>';
```

A future v4 might add a UI for this, but for now Drizzle Studio
(`npm run db:studio`) is the management surface.

### Debugging filing decisions
Every `file_document` call writes an activity entry with action
`file_document` or `file_document_inbox`. The metadata includes the
caller's `suggestedPath`, `confidence`, `reasoning`, and any
`learned_rule` that matched. To trace why a doc landed where it did,
filter Activity by Action = `file_document*` and inspect.

### Common failures
- **"Composio call failed: ..." in cron summary** — the consumer
  API key is wrong or expired. Check `COMPOSIO_API_KEY` (or
  `COMPOSIO_CONSUMER_API_KEY`) in Vercel env vars.
- **All items routing to Inbox even with rules in place** — the
  `frontmatter.email_from` (or other match-kind value) the caller
  is passing doesn't exactly match the rule's `match_value`. Check
  case + whitespace.
- **Move from Inbox not learning a rule** — usually the contentHash
  doesn't match between the original write and the moved push.
  Verify ADR-031's invariants hold (SHA1, alphabetical key sort) in
  any new code path that hashes a body.

---

## File storage + previews (F1 / F2 / F3)

### Where files live
Synced binaries (PDF, DOCX, XLSX, images, code, etc.) upload to a
Vercel Blob store named `shared-brain-files` with `access: "private"`.
The store URL pattern is opaque to the client; the platform proxies via
`/api/files/[id]`.

### Required env vars
- `BLOB_READ_WRITE_TOKEN` — set automatically when you connect the
  blob store to the project in the Vercel Storage tab. Pull locally
  via `vercel env pull .env.local`.

### Re-extracting / re-uploading after upgrades
The agent's hash includes a version prefix (`v3|...`) and a blob
marker (`blob:1`) so when extraction logic or upload semantics change,
cached entries get reprocessed automatically on the next sync run.
Bump the version prefix in `agent/src/sync.ts` if you ever need to
force a full file re-process.

### Preview rendering
- **PDF** → browser native viewer in `<iframe src="/api/files/[id]" />`
- **DOCX** → server-side `mammoth.convertToHtml`, rendered with
  `.file-preview-html` styles
- **XLSX/XLS/CSV** → SheetJS `sheet_to_html` per sheet
- **Images** → `<img src="/api/files/[id]" />`
- **Other** → "no inline preview" placeholder + Download

### Privacy model
Private blobs + Clerk-gated proxy. Anyone signed in to the platform
(currently just Keegan) can fetch files from any device. The raw blob
URLs never reach the client. To share a file externally we'd need to
add a per-file signed-share-link feature.

### MCP results expose tappable URLs (mobile-friendly)
`search`, `get_wiki_pages`, `get_document`, and `get_document_url` all
return a `view_url` / `download_url` / `preview_url` set on every
binary-file result. These point at the Clerk-auth'd file proxy:

- `view_url` → `/api/files/<id>` — inline view (browser native viewer
  for PDFs, downloads / opens-in-app for DOCX/XLSX, displays for images)
- `download_url` → `/api/files/<id>?download=1` — forces attachment
- `preview_url` → `/api/files/<id>/preview` — HTML-rendered version
  (best mobile UX for DOCX/XLSX which phones don't render natively)

URLs are TAPPABLE (work in the user's signed-in browser) but NOT
fetchable server-side by AI clients — fetching them returns the Clerk
login HTML. Tool descriptions say this explicitly so Claude doesn't
chase fetch-paths through Composio Drive / Notion when an image or
DOCX comes back.

For prose pages (markdown), `view_url` points at `/wiki/<id>` —
download/preview are null.

### Binary upload contract (ADR-036)
Every wiki entry representing a binary vault file MUST have
`wiki_pages.blob_url` populated. A wiki entry without the binary is
metadata without a product — for shared/multi-user use, "the brain
has the metadata but the file is on someone's laptop" is an
unacceptable failure mode.

Two paths the daemon must keep clean:

1. **Watch mode** (`agent/src/index.ts`): chokidar event handler MUST
   NOT filter by extension — `mapper.ts` is the single source of truth
   for syncability. Filtering by `.md` here silently drops binaries
   added during a long-running watch session (this regressed once;
   ADR-036).
2. **launchd plist** (`scripts/install-daemon.ts`): plist MUST include
   `BLOB_READ_WRITE_TOKEN` in `EnvironmentVariables`. Without it,
   `isBlobConfigured()` returns false at upload time and the syncer
   writes wiki_pages rows with `blob_url = NULL`, silently. After any
   plist regeneration, grep for `BLOB_READ_WRITE_TOKEN` in the
   installed plist to confirm.

When you reinstall the daemon (`install-daemon`, `rotate-key`, or
manual edit), confirm both still hold.

### Backfill recovery: `npm run backfill:blob-urls`
Idempotent script that walks `wiki_pages WHERE blob_url IS NULL AND
metadata.tags @> '["file"]'::jsonb`, joins to `vault_sync_log` for
the canonical filesystem path, uploads to Vercel Blob, and patches
`blob_url` on the row. Safe to re-run; only touches rows that need
recovery.

```bash
# Always start with a dry-run to scope the damage
npm run backfill:blob-urls -- --dry-run

# Then commit
npm run backfill:blob-urls

# Optional: cap batch size to test against a slice first
npm run backfill:blob-urls -- --limit 25
```

Files missing locally (e.g. moved/renamed since their original sync)
will fail with `read failed: ENOENT` and be skipped. The script
reports `uploaded / missing locally / errors` totals at the end.

Production run on 2026-05-08 recovered 36 files (24 PNGs / 14 DOCX /
1 PDF / 1 SVG) after the regression described in ADR-036.

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

#### Easy way (one command)
```bash
cd /Users/keeganlamar/Documents/ViaOps/Projects/shared-brain
export MCP_API_KEY=$(grep "^MCP_API_KEY=" .env.local | cut -d= -f2 | tr -d '"')
npm run install-daemon
```

The script writes the plist (mode 0600 — contains your key), bootstraps it
with `launchctl`, and verifies it's running. Use `npm run install-daemon -- --dry-run`
to preview without writing.

To uninstall: `npm run install-daemon -- --uninstall`.

#### Manual way (legacy)

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

#### Easy way (one command)

```bash
cd /Users/keeganlamar/Documents/ViaOps/Projects/shared-brain
npm run rotate-key
```

The script:
1. Generates a new key (never echoed to stdout)
2. Updates `.env.local` (with backup at `.env.local.bak.<timestamp>`)
3. Touches Claude Desktop config — **legacy step, now a no-op**. Desktop
   migrated to OAuth on 2026-05-08 (ADR-035) and no longer has a
   `shared-brain` entry in `claude_desktop_config.json`.
4. Updates the launchd daemon plist (`MCP_API_KEY` env var; backup made)
   and reloads the daemon via `launchctl bootout + bootstrap` so the
   running watcher picks up the new value
5. Copies the new key to your clipboard for Vercel
6. Prints a short checklist of remaining manual steps (Vercel env var only)

After Desktop's OAuth migration, `MCP_API_KEY` is only used by the
local sync agent, Vercel Cron, and backfill scripts. Rotating it does
NOT affect any AI client connections.

Use `--dry-run` to preview what would change without writing.

#### Manual checklist (legacy — do this if the script can't auto-apply)

1. Generate a new key:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" | pbcopy && echo "✓ key on clipboard"
   ```
2. Update `.env.local` with the new value (paste from clipboard).
3. Update Vercel: Settings → Environment Variables → `MCP_API_KEY` → edit → save → redeploy.
4. Update every connected client:
   - **Claude Desktop:** edit `~/Library/Application Support/Claude/claude_desktop_config.json`,
     change `AUTH_HEADER` env value, then quit (Cmd-Q) + reopen.
   - **Claude Code:** `claude mcp remove shared-brain && claude mcp add ...` with new key.
   - **Claude Cowork:** app → Settings → MCP servers → Shared Brain → update auth header.
   - **Daemon plist** (if installed): edit
     `~/Library/LaunchAgents/com.viaops.shared-brain.sync.plist`, change
     `MCP_API_KEY`, then `launchctl bootout gui/$(id -u) <plist> && launchctl bootstrap gui/$(id -u) <plist>`.

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

### MCP "Server disconnected" — fast path

When any Claude client (Desktop / Code / Cowork) shows
`MCP shared-brain: Server disconnected`, **first run:**

```bash
cd /Users/keeganlamar/Documents/ViaOps/Projects/shared-brain
npm run reconnect-mcp -- --fix
```

The script walks the full decision tree (steps 1–4 below)
automatically, applies safe fixes (sync Claude Desktop config to
`.env.local`'s key if drifted, kill stale `mcp-remote` subprocesses),
and reports what it did. After it finishes, **Cmd-Q Claude Desktop
fully** and reopen.

If `reconnect-mcp` reports an issue it can't fix, work the relevant
step below to dig deeper.

This is a **P0 customer-facing failure mode** per ADR-026 (the brain
+ MCP IS the product). Treat tickets like a 5xx on a SaaS app.

### MCP "Server disconnected" — decision tree (manual)

#### Step 1 — Is the platform endpoint reachable?
```bash
KEY=$(grep '^MCP_API_KEY=' /Users/keeganlamar/Documents/ViaOps/Projects/shared-brain/.env.local | cut -d= -f2 | tr -d '"')
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $KEY" \
  https://shared-brain-ecru.vercel.app/api/operating-instructions
```

- `200` → server is healthy + auth is valid. The problem is client-side.
  Skip to step 3.
- `401` → key drift. The `MCP_API_KEY` in `.env.local` doesn't match
  Vercel's. Run `npm run rotate-key` to regenerate + sync everywhere
  (or manually update Vercel env var to match `.env.local`, then
  redeploy).
- `404` / `5xx` → Vercel issue. Check the latest deploy at
  vercel.com/dashboard → shared-brain → Deployments. If a recent
  deploy is stuck/failed, redeploy from the previous good commit.

#### Step 2 — Is the MCP handshake working?
```bash
curl -s -X POST \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"diagnostic","version":"1.0"}}}' \
  https://shared-brain-ecru.vercel.app/api/mcp
```

Expected: `event: message\ndata: {"result":{"protocolVersion":...}}`.
Anything else → server broken even though step 1 passed; capture
output and dig.

#### Step 3 — Is `mcp-remote` running and reachable on the client?
Claude Desktop spawns `mcp-remote` as a stdio subprocess. When this
proxy crashes/hangs, "disconnected" shows even though server +
client are both healthy.

```bash
# Is mcp-remote alive?
ps aux | grep "mcp-remote" | grep -v grep
# Look at Claude Desktop's MCP logs — server-name shows up here
tail -n 200 ~/Library/Logs/Claude/mcp-server-shared-brain.log
```

Common patterns in the log:
- `MaxListenersExceeded` / silently exits → process leak between
  restarts. Fix: full Cmd-Q (NOT just close window) + reopen Claude
  Desktop. Sometimes needs two restarts because the first doesn't
  fully kill the lingering subprocess.
- `Authorization: ${AUTH_HEADER}` literal (no substitution) → env
  expansion broke. Re-run `npm run rotate-key` to regenerate the
  config with a fresh AUTH_HEADER value.
- `connect ECONNREFUSED` → DNS / network blip; usually resolves on
  retry.

#### Step 4 — Force a clean reconnect
```bash
# 1. Kill any lingering mcp-remote processes
pkill -f "mcp-remote" 2>/dev/null
# 2. Verify the config still has a valid Bearer key
python3 -c "import json; print(json.load(open('/Users/keeganlamar/Library/Application Support/Claude/claude_desktop_config.json'))['mcpServers']['shared-brain']['env']['AUTH_HEADER'][:15] + '...')"
# 3. Quit Claude Desktop completely (Cmd-Q)
# 4. Reopen Claude Desktop
```

If still disconnected after this → escalate. Capture
`~/Library/Logs/Claude/mcp-server-shared-brain.log` + the curl output
from steps 1+2.

#### Step 5 — Other clients (Claude Code / Cowork)
- **Code:** `claude mcp remove shared-brain && claude mcp add shared-brain "https://shared-brain-ecru.vercel.app/api/mcp" --header "Authorization: Bearer $KEY"`
- **Cowork:** App → Settings → MCP servers → Shared Brain → toggle off/on.

#### When you can't get it back
If steps 1–5 don't bring MCP back, the user can still:
- Use the in-platform chat panel at shared-brain-ecru.vercel.app/
- Continue working in their vault — daemon keeps syncing
- Use Composio MCP directly (their own AI client probably has
  Composio set up independently)

The brain's data is never lost when MCP is disconnected. Worst case
is a temporary loss of "ask my AI to act on the brain" while we
diagnose.

### Other connection issues
- **`Tools list empty` after a successful connect** — restart
  Claude Desktop. mcp-remote caches the tool list per session and
  doesn't re-fetch on schema changes.

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
