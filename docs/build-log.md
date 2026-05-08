---
title: Shared Brain — Build Log
created: 2026-04-30
updated: 2026-04-30
status: living-document
tags: [viaops-internal, shared-brain, build-log]
related: "[[AI-Native PM Platform - MVP Spec]]"
---

# Shared Brain — Build Log

Phase-by-phase narrative of what was built, what diverged from the spec, and
why. Updated at the end of each phase.

> **Related:**
> - [[AI-Native PM Platform - MVP Spec]] — the original spec
> - [[Decisions]] — ADR-style log of architectural choices
> - [[Runbook]] — common ops tasks

---

## Status snapshot

| Phase | Status | Shipped | Notes |
|---|---|---|---|
| 0 — Foundation | ✅ Complete | 2026-04-29 | Next.js 16, Neon + pgvector, Clerk, shadcn shell, CRUD API |
| 1 — MCP Server | ✅ Complete | 2026-04-30 | All read + write tools live, Claude Desktop connected |
| 2 — Vault Sync Agent | ✅ Complete | 2026-04-30 | Local agent + platform sync API; full vault scan dry-run clean (402 files mapped) |
| 3 — Kanban UI | ✅ Complete | 2026-04-30 | dnd-kit drag-and-drop, quick-add per column, detail drawer, 3s polling for AI/sync changes |
| 4a — Connection graph foundations | ✅ Complete | 2026-04-30 | Schema extension, write-time + read-time edge extraction, panel UI, inline `[[wikilink]]` rendering |
| Vault cleanup + full sync (Phase C) | ✅ Complete | 2026-04-30 | Vault reorg done; 440 wiki pages + 229 items synced across 6 spaces |
| All-file-type sync | ✅ Complete | 2026-04-30 | PDFs / DOCX / XLSX / images / etc. cataloged as wiki entries with metadata + Obsidian deep-link |
| F1 — Cloud storage (Vercel Blob) | ✅ Complete | 2026-04-30 | All 109 binary files uploaded to private blob store with auth-gated access |
| F2 — Content extraction + indexing | ✅ Complete | 2026-04-30 | 147,774 words extracted across 95 files (PDF/DOCX/XLSX/code); embedded for semantic search |
| F3 — Inline previews | ✅ Complete | 2026-05-01 | `/api/files/[id]` proxy + `/preview` converter; PDFs in iframe, DOCX/XLSX as rendered HTML, images inline |
| 5a — Activity Feed UI | ✅ Complete | 2026-04-30 | /activity page with filters + pagination, topbar bell with unread count, per-space activity surface |
| 5b — Built-in Claude chat panel | ✅ Complete | 2026-05-01 | Vercel AI SDK v6 + claude-sonnet-4-5; 8 platform tools wired in; localStorage persistence; current-page context |
| 5c — Composio integration | ✅ Complete | 2026-05-01 | Universal MCP endpoint + `x-consumer-api-key` (ADR-020): chat connects to `connect.composio.dev/mcp`, gets the meta-tool surface (SEARCH / EXECUTE / etc.), per-call routing across all 19 accounts |
| ~~5d — Live artifacts~~ | ❌ Dropped | 2026-05-01 | ADR-022: lookups/actions through nav are faster than chat-rendered duplicates; valuable subset (link previews + action confirmations) already covered by `[[wikilink]]` rendering + tool pills |
| 6 — Agent Operating Instructions | ✅ Complete | 2026-05-01 | Profile.md (13 sections), `get_operating_instructions` + `record_session_summary` MCP+chat tools, `/api/operating-instructions` Bearer-auth endpoint, `npm run install-skill claude` CLI; Assistant/CLAUDE.md now a short pointer (ADR-023). Awaiting Active State + Key People content from Keegan. |
| 4b — Background AI edges | ✅ v1 Complete | 2026-05-07 | Cron-driven `keyword_overlap` + `co_mention` edges (Vercel Cron, every 6h). `ai_suggested` deferred to v2 (needs LLM cost analysis). |
| F4d — Vault pull-down | ✅ Complete | 2026-05-07 | `/api/sync/pull` returns platform-only wiki pages (no vault_sync_log, no blob_url); agent's `pullDown()` materializes them at their filePath; pull endpoint also creates the log row server-side so round-trip is idempotent. Wired into agent fullScan + 5-min periodic in watch mode. End-to-end smoke test passed. |
| F4 v1 — AI Filing Engine | ✅ Complete | 2026-05-07 | `file_document` tool (MCP + chat). Caller-as-classifier — Claude uses `get_operating_instructions` + `get_active_state` + content to pick `target_path`; <0.7 confidence routes to `Inbox/`. Server writes to `wiki_pages` + `vault_sync_log` atomically; pull-down materializes locally with `metadata.platform_origin = file_document`. SHA1 hash matches agent for round-trip idempotence. Smoke-tested all 3 routing paths. |
| F4 v2 — Config UI + cron auto-sync | ✅ Shipped (Gmail) | 2026-05-07 | `sync_configs` table seeded with all 20 connections from Composio Mapping. `/settings/sync` page with per-connection off/manual/auto toggle. Daily cron at `/api/cron/auto-sync` (07:00 UTC) walks `mode='auto'` rows. Gmail adapter live (fetches via `GMAIL_FETCH_EMAILS` with `after:` cursor, pipes to `file_document`). Other toolkits accept the toggle but adapters land per-toolkit follow-ups — shape is generalizable (each adapter emits `{title, content, source}` per new item). |
| F4 v3 — Active-learning reconciliation | ✅ Shipped | 2026-05-07 | Move-detection in `/api/sync/wiki`: when an Inbox-routed `file_document` page gets pushed at a new path with matching title + contentHash, treat as a MOVE (consolidate, clear filed_to_inbox flag, learn `filing_rules` row keyed by recognizable source patterns — currently `gmail_from`; future kinds add easily). `file_document.applyFilingRules()` consults rules BEFORE confidence-based routing — match → high-confidence direct file, no Inbox. End-to-end smoke test verified the loop: file Email A → move A → rule learned → Email B auto-routes via rule. |
| ~~F4c — Manual upload UI~~ | ❌ Dropped | 2026-05-07 | Daemon already covers vault file ingestion; mobile case better served by a Phase 7 `file_document` workflow tool that uses Claude to auto-classify + file. A dumb-pipe web upload form is strictly worse than either path. |
| MCP Reliability Hardening | ✅ Complete | 2026-05-08 | `npm run reconnect-mcp` diagnostic CLI + `mcp_request_log` table + `/status` page + `/api/status` JSON. Native Custom Connectors deferred to Phase 8 since they require OAuth which Phase 8 needs anyway (ADR-032). |
| ~~7 — Mobile workflow tools~~ | ❌ Cancelled | 2026-05-08 | Workflow tools (`compose_invoice` etc.) violate ADR-026 + ADR-033: they're compositions of existing primitives, not primitives themselves. Mobile gap is OAuth (Phase 8), not platform-level workflows. The AI client composes workflows from primitives. |
| 8 v1 — OAuth on `/api/mcp` | ✅ Complete | 2026-05-08 | OAuth 2.1 Authorization Code + PKCE (S256). Discovery doc at `/.well-known/oauth-authorization-server`; consent page at `/oauth/authorize` (Clerk-protected); token exchange at `/api/oauth/token`. MCP handler accepts either `MCP_API_KEY` or `sb_at_…` access tokens; unauthenticated reqs return `WWW-Authenticate` pointing at the discovery doc. `npm run create-oauth-client` CLI for manual client registration. ADR-034. |
| 8 v2 — Multi-user readiness | 🅿️ Parked | — | Per-user identity (token → userId → org), per-user Composio consumer keys, settings UI for token revocation. Revisit when there's a 2nd real user or company onboard. |

**Live URLs:**
- Production: https://shared-brain-ecru.vercel.app/
- Repo: https://github.com/keegan-pixel/shared-brain
- Local repo: `/Users/keeganlamar/Documents/ViaOps/Projects/shared-brain/`

---

## Phase 0 — Foundation

**Shipped:** 2026-04-29
**Spec target:** Week 1–2

### What was built
- Next.js 16 scaffold (App Router, TypeScript strict, Tailwind v4)
- Drizzle schema for all 8 tables: `organizations`, `spaces`, `projects`,
  `items`, `wiki_pages`, `backlinks`, `activity_feed`, `vault_sync_log`
- `pgvector` extension auto-enabled by the migration runner
- Clerk auth wired through `src/proxy.ts`; sign-in / sign-up routes; ViaOps
  org auto-bootstraps on first authenticated request
- App shell: async sidebar (org → spaces → wiki), top bar (search, activity,
  Claude chat toggles, theme toggle, UserButton), dark mode via `next-themes`
- Org-scoped REST API for orgs / spaces / projects / items with Zod
  validation and a small `handle()` / `ApiError` / `parseJson()` helper
  layer
- Live on Vercel + Neon + Clerk (test keys for now)

### Divergences from spec
1. **Next 16, not 15.** `create-next-app@latest` shipped 16 by build day.
   App Router and TS strict are intact. See [[Decisions#ADR-003]].
2. **`proxy.ts`, not `middleware.ts`.** Next 16 deprecated the old name.
   See [[Decisions#ADR-002]].
3. **Drizzle, not Prisma.** Spec was tool-agnostic; chose Drizzle for TS-first
   ergonomics and serverless cold starts. See [[Decisions#ADR-004]].

### Friction encountered
- First Vercel deploy crashed at "Collecting page data" because the DB
  client threw on import when `DATABASE_URL` was missing during build.
  Fixed by lazy-init via Proxy. See [[Decisions#ADR-007]].
- pgvector wasn't visible in Neon's UI. Solved by scripting the
  `CREATE EXTENSION` in the migration runner. See [[Decisions#ADR-001]].

---

## Phase 6 — Agent Operating Instructions

**Shipped:** 2026-05-01
**Spec target:** new (post-MVP)

### Why this is the highest-leverage thing left
The Shared Brain only stays useful if every Claude session that
touches the user's work actually *updates* the brain afterward. Forcing
this technically is hard; making it socially-via-prompt is easy. We
standardize the operating context all agents read on connect.

### What gets built
- **User Profile wiki page** — preferences, work style, brand context,
  common workflows. Lives at `Profile.md` in vault, mirrors to wiki.
- **Two new MCP tools:**
  - `get_operating_instructions` — returns the merged user profile +
    standing instructions block. Every agent calls this at session
    start.
  - `record_session_summary({ summary, project?, related_items? })` —
    appends a structured "what I did" entry to the activity feed and
    creates a session-note wiki page. Agents call before ending.
- **Standing instructions text** baked into the operating-instructions
  response: "Before ending the session, call `record_session_summary`
  with what you did. Reference work as `[[Page Title]]` for autolinks.
  Default to ViaOps connection for Gmail/Calendar/Drive when
  unspecified..."
- **CLI install script** — `shared-brain --install-skill claude` adds a
  small skill file to Claude Desktop / Code / Cowork pointing at the
  live operating-instructions endpoint, so updates propagate without
  re-installing.

### Measurement of "did it work"
Vault sync log + activity feed should show session-summary entries
landing automatically as Claude agents finish work. If they aren't,
the standing instructions text needs strengthening or the CLI install
isn't placing the skill correctly.

### What was actually shipped
- **Profile.md** — 13 sections (identity, three businesses, Shared
  Brain platform, standing instructions, Composio routing, default
  behaviors, triggered workflows, skill invocation guide, quick
  skill-scan reference, active state TODO, key people TODO,
  communication style, self-improvement loop). Restructured from
  `Assistant/CLAUDE.md` + the Cowork lead-agent instructions.
- **`get_operating_instructions`** — both as an MCP tool
  (`src/lib/mcp/tools.ts`) for Desktop / Code / Cowork / mobile and
  as an AI-SDK tool (`src/lib/chat/tools.ts`) for the in-platform
  chat. Both look up the wiki page titled "Profile" and return its
  content.
- **`record_session_summary`** — same dual surface. Creates a
  session-note wiki page + activity feed entry, with best-effort
  backlink indexing for `[[refs]]` in the summary.
- **`/api/operating-instructions`** — Bearer-auth'd HTTP endpoint
  returning the Profile as plain markdown (or JSON with `?format=json`).
  Cache headers set to ~60s edge cache so high-frequency pulls don't
  hammer the DB.
- **`npm run install-skill claude`** — CLI that verifies the endpoint
  responds, then writes `~/CLAUDE.md` with a curl-back pointer +
  hard-coded standing rules (record_session_summary, read-before-
  write, confirm-before-destructive). Acts as the global fallback
  CLAUDE.md for any Claude Code / Cowork session.
- **`Assistant/CLAUDE.md`** — replaced with a short pointer
  documenting where the canonical instructions now live.
- **Chat system prompt updates** — now instructs the model to call
  `get_operating_instructions` before non-trivial tasks and
  `record_session_summary` before ending sessions.

### Path to actually using it
1. Profile.md is on the platform. ✅
2. Run `npm run install-skill claude` once on each device that uses
   Claude Code / Cowork. (Requires `MCP_API_KEY` in env.)
3. Open the in-platform chat — first non-trivial prompt should
   trigger a `get_operating_instructions` call.
4. After a real work session, model should call
   `record_session_summary`. If it doesn't, strengthen the wording in
   the chat route's system prompt.

### What's still TODO (Phase 6 inputs from Keegan)
- **Section 10 — Active State of the World** — needs current
  pipeline / clients / projects / pending intros / coaching list.
- **Section 11 — Key People Quick Reference** — needs current
  table.

Both currently have explicit TODO markers. Until refreshed, agents
fall back to platform `search` + `Pipeline/_Index` lookups.

---

## Phase 8 v1 — OAuth on `/api/mcp` (claude.ai-native connector path)

**Shipped:** 2026-05-08
**ADR:** [[Decisions#ADR-034]]

### What was built

- **Schema** (`drizzle/0006_fixed_sauron.sql`): `oauth_clients`,
  `oauth_authorization_codes`, `oauth_access_tokens`. Single-use codes
  with 10-minute TTL; access tokens with 30-day TTL + revocation
  column.
- **Core lib** (`src/lib/oauth/core.ts`): scrypt-based client-secret
  hashing, opaque random tokens (`randomBytes(32).base64url`), PKCE
  S256 verification, all CRUD helpers (`findClientById`,
  `authenticateClient`, `issueAuthorizationCode`,
  `consumeAuthorizationCode`, `issueAccessToken`,
  `validateAccessToken`).
- **Discovery** (`/api/.well-known/oauth-authorization-server`):
  RFC 8414 metadata. Public, CORS-open. Points at our authorize/token
  endpoints. claude.ai's connector setup fetches this first.
- **Consent page** (`/oauth/authorize`): Server component in `(app)`
  group so Clerk's middleware redirects to sign-in if needed. Validates
  every param (`response_type=code`, S256-only PKCE, redirect_uri
  whitelist). Approve/Deny forms wired to server actions that issue
  the auth code and 302 to the client's redirect.
- **Token exchange** (`/api/oauth/token`): Form- or JSON-encoded.
  Accepts client credentials via Basic auth header or body. PKCE
  verifier checked against stored challenge. Returns
  `{ access_token: "sb_at_…", token_type: "Bearer", expires_in, scope }`.
- **MCP middleware update**: `/api/mcp` now accepts either the
  legacy `MCP_API_KEY` or any valid OAuth access token. Unauthed
  requests get a `WWW-Authenticate: Bearer realm="…", authorization_uri="…/.well-known/oauth-authorization-server"`
  header so OAuth-aware clients can self-discover the flow.
- **Client registration CLI** (`npm run create-oauth-client`):
  Manually registers a client (no Dynamic Client Registration in v1).
  Generates id + secret, scrypt-hashes the secret, prints credentials
  ONCE.
- **Proxy update**: `/api/.well-known/oauth-authorization-server` and
  `/api/oauth/token` are public (per RFC); `/oauth/authorize` is
  intentionally NOT public (Clerk auth required).

### What's deferred to v2

Per-user identity in the MCP handler. Today the handler still resolves
to the default org via `DEFAULT_ACTOR`; v2 will use the validated
token's `userId` to pick the user's org and Composio key. Token
revocation UI also deferred. See ADR-034 for the full rationale.

### Setup flow (operator)

```bash
# 1. Register a client for claude.ai
npm run create-oauth-client -- \
  --name "Claude.ai web" \
  --redirect "https://claude.ai/api/mcp/auth_callback"
# (saves the printed client_id + client_secret somewhere safe)

# 2. In claude.ai → Settings → Custom Connectors → Add new
#    Server URL: https://shared-brain-ecru.vercel.app/api/mcp
#    OAuth metadata is auto-discovered via /.well-known/...
```

---

## Phase 7 — Cancelled (ADR-033)

The original Phase 7 was "Mobile via Claude — workflow tools." On
inspection, every proposed tool (`compose_invoice`,
`compose_proposal`, `log_thought`, `find_last_context`) was a
*workflow* — a composition of existing primitives — not a primitive
in its own right.

Per ADR-026 (the brain is connectivity, not features) and ADR-033
(primitives-only at the brain layer), workflow tools belong in the
AI client (Claude prompts, Projects, Cowork plugins, custom GPT
instructions, etc.), not the brain.

The actual mobile gap is **connectivity, not workflows**: claude.ai
mobile + Custom Connectors require OAuth (ADR-032), which Phase 8
ships. Once mobile Claude can connect natively to `/api/mcp`, it
composes its own workflows from existing primitives — `search`,
`get_active_state`, `composio_*`, `file_document`, etc.

`file_document` already shipped in F4 v1 as a true primitive. No
other Phase 7 tools are needed.

See ADR-033 for the primitive-vs-workflow filter and rationale.

---

## Phase 4b — Background AI Edges (v1)

**Shipped:** 2026-05-07
**Spec target:** Phase 4

### What was built
Two new edge kinds in the connection graph, computed on a Vercel
Cron schedule:

- **`keyword_overlap`** — every wiki_page + item gets a top-30
  keyword set extracted from `title + content + extracted_text`
  (stop-word filtered, ≥4-char tokens, no pure digits). Inverted-
  index lookup finds candidate pairs sharing ≥1 keyword; Jaccard
  scored; top-8 per entity above thresholds (Jaccard ≥0.15, shared
  ≥5) become edges. Stored as `backlinks` rows with
  `kind='keyword_overlap'`, `score=Jaccard`, `evidence={shared_keywords:[top 5]}`.
- **`co_mention`** — person/company pages identified by filePath
  (`Pipeline/`, `Partners/`, `SimHouse.io/Clients/`,
  `Coaching/Clients/`, `Clients/<X>/_Overview.md`). For each non-
  person doc, find which person pages it mentions via case-
  insensitive title-substring match in content. Pairs co-mentioned
  in ≥1 doc get edges with `score = 1 - 1/(1+doc_count)`,
  `evidence={docs:[top 5], doc_count}`.

Both are idempotent — delete kind-scoped edges for processed
entities, then re-insert. Safe to run any time.

### Cron + auth
- `vercel.json` schedules `/api/cron/connections` every 6 hours
  (`0 */6 * * *`).
- Route accepts `Authorization: Bearer <CRON_SECRET>` (Vercel sets
  automatically) OR `<MCP_API_KEY>` (manual invocation for testing).
- Allowed through Clerk middleware via the `/api/cron/(.*)` matcher.

### Verification (initial run, ViaOps org)
- 926 entities scanned (wiki + items)
- **2,345 keyword_overlap edges** generated
- **3 co_mention edges** generated (97 person pages, 5 docs with ≥2
  people)
- Total runtime: 3.8s (well under serverless timeout)

### Divergences from spec
- `ai_suggested` edges (third kind originally specced) deferred to
  v2. Schema field is in place; needs LLM cost analysis before
  enabling. Logged in parking lot.
- co_mention generated only 3 edges in initial run because the
  substring matcher requires full person-page titles to match
  verbatim ("Matt Frary"), not first-name shortcuts. This is a
  precision-over-recall trade-off; v2 should add nickname/alias
  resolution. Logged in parking lot.

### Files
- `src/lib/connections/background.ts` (compute logic)
- `src/app/api/cron/connections/route.ts` (handler)
- `vercel.json` (schedule)
- `src/proxy.ts` (allow `/api/cron/*` past Clerk)

---

## Phase 5c — Composio Integration (Universal MCP + consumer key)

**Shipped:** 2026-05-01
**Spec target:** Phase 5

### What was built
The chat connects to Composio's **universal MCP endpoint**
(`https://connect.composio.dev/mcp`) authenticated with a **consumer
API key** (`ck_...`) in the `x-consumer-api-key` header. That gives it
the same meta-tool surface Claude Desktop / Code see when installed
via the Composio CLI:
- `COMPOSIO_SEARCH_TOOLS` — find a tool slug
- `COMPOSIO_GET_TOOL_SCHEMAS` — inspect args
- `COMPOSIO_MULTI_EXECUTE_TOOL` — execute with per-call `account` routing
- `COMPOSIO_MANAGE_CONNECTIONS` — list/add/remove connections
- `COMPOSIO_REMOTE_BASH_TOOL` / `COMPOSIO_REMOTE_WORKBENCH` /
  `COMPOSIO_WAIT_FOR_CONNECTIONS` — bulk execution helpers

- `src/lib/chat/composio-tools.ts` — opens an MCP client via
  `@modelcontextprotocol/sdk` Client + `StreamableHTTPClientTransport`,
  lists tools at cold start with a 5-min cache, adapts each into an
  AI SDK `dynamicTool`.
- `composioPromptHint()` injects the routing primer (ViaOps default for
  Gmail/Calendar/Drive; brand-specific connection IDs for SimHouse,
  Chief of Chaos, Lamar Coaching, SwingBays, Personal).
- Soft-fail: missing `COMPOSIO_CONSUMER_API_KEY` → chat falls back to
  platform-only tools without erroring.

### Two earlier dead-ends before landing
First (ADR-018) wired the chat to whichever MCP URL Composio exposed
under custom server config. That surface bakes `is_default` per
toolkit into every call with no per-call routing knob — 14 of 19
accounts locked out.

Second (ADR-019) pivoted to `@composio/core` SDK assuming it'd unlock
multi-account routing via `connectedAccountId`. It does — but only on
Composio's *Platform* (developer) scope, not the *For You* scope where
the user's personal accounts live. Auth failed because the developer
project had no connections.

ADR-020 is the right answer: the universal MCP endpoint with
`x-consumer-api-key` (visible in Composio → Settings → Sessions) gives
the For You scope, the meta-tool surface, and per-call routing.

### Verification
- `npx tsc --noEmit` clean.
- `npm run build` clean.
- **Live smoke test passed (2026-05-01 16:59 UTC):** "what do my
  calendars show today" → `COMPOSIO_MULTI_EXECUTE_TOOL` called once,
  returned clean cross-account view (ViaOps, Coaching, plus
  shared-read CoC calendars for Matt + Patti). No rate limit, no
  hallucinations. Logs:
  ```
  [composio] tools/list returned 7 tools. meta-tools: 7.
    enabled (after whitelist): 4. surface: META (good)
  [composio] enabled tools: COMPOSIO_MANAGE_CONNECTIONS,
    COMPOSIO_MULTI_EXECUTE_TOOL, COMPOSIO_SEARCH_TOOLS,
    COMPOSIO_GET_TOOL_SCHEMAS
  ```

### Friction encountered (worth remembering)
- Composio's "API Key" terminology is overloaded across two surfaces
  with different prefixes and zero overlap (`ck_` consumer vs `ak_`
  platform vs `uak_` CLI session). UI doesn't disambiguate well.
- The right auth header was `x-consumer-api-key`, not the more obvious
  `Authorization: Bearer` we tried first.
- The same MCP endpoint serves two completely different surfaces — 7
  meta-tools (good) or 200+ static catalog (bad) — gated by the
  `clientInfo.name` field in the MCP `initialize` handshake. We send
  `"Claude"` to get the meta-tools surface; any other name gets the
  catalog dump (~30K tokens).
- AI SDK v6 dropped `experimental_createMCPClient`, so we use the MCP
  SDK's Client directly — already a dependency for the platform's own
  MCP server.
- Even with the meta-tools surface, Composio's tool descriptions are
  enormous (REMOTE_WORKBENCH alone is ~5K tokens of Python sandbox
  guidance). We whitelist 4 of the 7 and override descriptions with
  terse versions. See ADR-021 for the full token-efficiency strategy.

---

## Phase 5b — Built-in Claude Chat Panel

**Shipped:** 2026-05-01

### What was built
- **Server (`/api/chat`)** — Vercel AI SDK v6 + `@ai-sdk/anthropic`,
  default model `claude-sonnet-4-5` (override via `ANTHROPIC_MODEL_ID`
  env var). Returns `toUIMessageStreamResponse()` for streaming.
- **System prompt** auto-includes org name, today's date, capability
  summary, and current-page context (kind / path / id / title) so the
  user can say "this page" or "this thing" and Claude knows what they
  mean.
- **Tool set** — 8 platform tools defined via AI SDK `tool()`, reusing
  the same Drizzle queries the MCP server uses:
  - **Reads:** `get_org`, `get_spaces`, `get_projects`, `get_items`,
    `search` (semantic, hits extracted PDF/DOCX/XLSX text),
    `get_recent_activity`
  - **Writes:** `create_item`, `move_item_status`
  - Each write logs to `activity_feed` (`actor_agent: claude-builtin`)
    and runs link extraction on body content.
- **Multi-step tool loop** — capped at 8 steps via `stopWhen: stepCountIs(8)`.
  Claude can call a tool, see results, call another, then respond — all
  in one turn.
- **Client (`<ChatPanel>`)** — slide-out drawer (max-w-lg) on the right
  via the existing `Sheet` primitive. `useChat()` from
  `@ai-sdk/react` v6.
- **Persistence** — localStorage per browser
  (`shared-brain.chat.messages`). Hydrate on mount, save on every
  message change, "Clear" button wipes both.
- **Tool-call rendering** — compact pills (`toolName · ✓` /
  `toolName · running`) inside assistant messages, so the user sees
  what Claude did without it dominating the bubble.
- **Topbar wiring** — replaced the disabled `MessageSquare` button with
  the real `<ChatToggleButton>`. `<ChatProvider>` lives in the (app)
  layout, exposes open/setOpen/toggle.

### Divergences from spec
1. **No Composio yet.** Spec called for Composio in this phase; split
   it out as Phase 5c so 5b can ship now with platform-only tools.
2. **localStorage instead of DB-backed history.** Per-browser is fine
   for solo MVP; DB persistence comes when we go multi-device or
   multi-user.
3. **`claude-sonnet-4-5` instead of `claude-sonnet-4-6`.** 4-6 isn't an
   Anthropic model id we know exists; 4-5 is current Sonnet. Override
   trivially via `ANTHROPIC_MODEL_ID`.

### Verification
- Round-trip from chat: "where's the Shared Brain project at?" → Claude
  calls `get_spaces` → `search` → `get_projects` → `get_items` and
  returns a synthesized status. (Was inaccurate on first try because
  the synced Build Log wiki page was stale — see "Process notes" at
  the bottom of this doc; doc-sync discipline tightened up.)
- Build + typecheck clean, `/api/chat` in route output.

### Friction encountered
- AI SDK v6 dropped the v3-era `input` / `handleInputChange` from
  `useChat`; now you manage the textarea state manually and call
  `sendMessage({ text })`. Easy fix once spotted.
- `convertToModelMessages()` is async in v6; needed `await`.
- `stopWhen` takes a `StopCondition` not an arrow; use
  `stepCountIs(N)` helper.

---

## File Storage + Inline Previews (F1 + F2 + F3)

**Shipped:** 2026-04-30 → 2026-05-01

User flagged that ~118 binary files (PDFs, DOCX, XLSX, images, etc.)
weren't in the platform — only their markdown siblings were. Plus
"this is non-markdown, no semantic search" message was unacceptable
for a Shared Brain that needs to be a real source of truth.

Three sub-phases shipped together:

### F1 — Cloud storage (Vercel Blob)
- New `wiki_pages` columns: `blob_url`, `extracted_text`,
  `extracted_word_count` (migration 0003).
- Sync agent uploads bytes to Vercel Blob with `access: "private"`.
  All ~109 files now live in cloud storage; URLs gated to the project.
- Hash includes a "blob:0/1" marker so toggling the token invalidates
  cached entries — re-syncing picks up files that were synced before
  the token was set.

### F2 — Content extraction + semantic indexing
- Sync agent extracts plain text per file type:
  - **PDF** → `pdf-parse` v2 class API
  - **DOCX** → `mammoth.extractRawText`
  - **XLSX/XLS/CSV** → SheetJS `sheet_to_csv` per sheet
  - **txt/md/html/code** → utf8 read (HTML strips tags)
- Server-side `embed()` uses `extracted_text` (capped at 6K chars to
  fit the 8K-token limit of `text-embedding-3-small`) — files are now
  semantic-search citizens alongside markdown pages.
- Embed call wrapped in try/catch so a single bad input doesn't 500
  the whole sync run. Failed embeds log a warning; the page still gets
  created/updated.

### F3 — Inline previews
- New `/api/files/[id]` proxy. Clerk-auth'd (so signed-in users on
  any device — including mobile — can fetch). Uses
  `@vercel/blob.get(url, { access: "private" })` to stream bytes.
- New `/api/files/[id]/preview` converter: DOCX → `mammoth.convertToHtml`,
  XLSX/XLS/CSV → `sheet_to_html` per sheet. Returns `{ html, sheets }`.
- New `<FilePreview>` client component:
  - **Image** → `<img src={proxyUrl}>`
  - **PDF** → `<iframe src={proxyUrl}>` (browser native viewer)
  - **DOCX / XLSX / XLS / CSV** → fetched HTML with `.file-preview-html` CSS
  - **Other** → "no inline preview" + Download
  - Always: Download button, Open in browser, Open in Obsidian
- Wiki tree (`/wiki`) differentiates files visually — Paperclip /
  FileImage / FileSpreadsheet icons + uppercase ext chip.

### Stats after the run
- 109 files in private Vercel Blob
- 95 files with extracted text (147,774 words total)
- 4 XP Flow invoices: 314 / 120 / 686 / 116 words extracted
- Search "Dustin Howes APEX" hits the agent framework docs AND
  invoice INV-2026-003 (line-item match)

### Friction encountered
- First upload pass failed because the blob store was set to private
  and our agent used `access: "public"`. Switched to `private`.
- pdf-parse v2 has a class-based API (`new PDFParse({ data }).getText()`)
  not the v1 bare function we initially wrote against. Silent fail
  caused 0-word extractions until we switched.
- `head()` + manual `fetch()` of the returned URL doesn't work for
  private blobs (auth context lost). Fix: `get(url, { access: "private" })`
  which the SDK auths via `BLOB_READ_WRITE_TOKEN` and returns a real
  ReadableStream we pipe back.
- Vercel asked for an MFA recovery code to view the blob token in the
  dashboard. The CLI flow (`vercel env pull`) and Storage-tab
  `.env.local` reveal both worked without the code.

---

## Phase 5a — Activity Feed UI

**Shipped:** 2026-04-30

### What was built
- `GET /api/activity` — paginated, filterable by actor, action, space,
  since/until. Returns total count for pagination.
- `/activity` page — server-rendered, URL-state filter form (actor /
  action / space dropdowns + since/until date pickers), pagination
  controls. Distinct actor + action lists pulled from the DB so filters
  only show real values.
- `<ActivityRow>` component — actor badge color-coded by agent
  (claude-mcp purple, vault-sync blue, user gray, plus colors reserved
  for claude-desktop / claude-code / cowork when those land), action
  label, relative timestamp, summary, click-through to entity page.
- `<ActivityBell>` in the top bar — replaces the disabled stub. Polls
  `/api/activity?limit=25` every 15s, shows unread count badge based on
  `localStorage('shared-brain.activity.lastSeen')`. Click toggles a
  popover with the 12 most recent entries; opening marks all as seen.
- Sidebar gains an "Activity" link next to Home.
- Per-space `/spaces/[id]` now shows a "Recent activity" panel with the
  15 newest entries scoped to that space (matched via
  `metadata.spaceId` or `entity_type=space`).

### Helpers
- `src/lib/activity-display.ts` — `actorBadgeClass`, `actionLabel`
  (raw `sync_wiki_create` → "synced wiki page" etc.), `entityLink`,
  `relativeTime`. Centralized so the page, bell, and per-space panel
  all render rows identically.

### Verification
- Build + typecheck clean
- All sidebar links resolve (end-of-phase checklist)

---

## Phase C — Vault Reorganization + Full Sync

**Shipped:** 2026-04-30

### Vault cleanup
Cumulative across Phase A + Phase B + ViaOps Assistant reconciliation:
- ~700M reclaimed
- 4,500+ duplicate / subset files removed
- Vault root now has 17 canonical directories with no shadow workspaces
- Skills source files (`build_invoice.py`, `invoice-generator-SKILL.md`)
  preserved at new `Skills/invoice-generator-source/` next to the
  `.skill` bundle

### Full vault sync
- 444 markdown files mapped, 443 syncable, 1 ignored, 0 errors final
  (4 errors on first pass — bad YAML frontmatter + an item title >240
  chars; fixed by hardening `parser.ts` to fall back on YAML errors and
  truncate long titles)
- Platform state: **440 wiki pages, 229 items, 6 spaces, 7 projects,
  10+ space-owned tasks**

### Mapper expansion
Mapper now covers (in addition to spec table):
- LinkedIn (4 thought-leadership categories) → wiki tagged `linkedin`
- Coaching (Clients, Concepts, Resources subfolders) → wiki tagged
  `coaching` + sub-tag
- Partners → wiki tagged `partner`
- Website → wiki tagged `website`
- Catch-all for `Clients/[Name]/<other>.md` → wiki tagged with client
  slug (was being silently dropped)
- **Meetings now wiki pages** (was activity-only). Lets `[[wikilinks]]`
  from any other page resolve to meeting notes — see [[Decisions#ADR-014]].
- `Dashboard/Daily Notes` removed from default sync prefixes
  (local-only per Keegan)

### Connection backfill after full sync
- Many task wikilinks that pointed at `[[Meetings/...]]` were unresolved
  in the first run because meetings were activity-log entries, not wiki
  pages. After flipping meetings to wiki and re-syncing, references
  resolve.
- Some wikilinks remain unresolved — they reference items in folders we
  don't sync (`Strategic Memos/`, etc.) or use full-path notation
  (`[[Knowledge/AI Research/...]]`) where the full path doesn't match
  any candidate key. Acceptable noise; can iterate later.

---

## Phase 4a — Connection Graph Foundations

**Shipped:** 2026-04-30
**Spec target:** Week 5–6 (Phase 4 split into 4a + 4b)

### What was built

**Connection model:** Each entity (wiki page or item) carries a graph of
edges to other entities. Six edge kinds shipped, three deferred to 4b:

| Kind | When computed | UI badge |
|---|---|---|
| `explicit_link` ([[wikilinks]]) | At write time, persisted | direction arrow |
| `frontmatter_related` (YAML `related:`) | At write time, persisted | direction arrow |
| `tag_overlap` | At read time | shared tags |
| `folder_sibling` | At read time | folder path |
| `semantic_similar` (pgvector cosine) | At read time | similarity % |
| `hierarchy` (project↔space, item↔project) | Implicit, free | — |
| `keyword_overlap` | 4b, background cron | — |
| `co_mention` | 4b, on radar | — |
| `ai_suggested` | 4b, on radar | — |

**Schema (migration 0002):**
- `backlinks.kind`, `backlinks.score` (real, nullable), `backlinks.evidence` (jsonb)
- `BacklinkEntity` extended to include `space`, `project`, `activity`

**Extraction (write paths):** `[[Page Title]]` regex + frontmatter
`related:` parser. Wired into:
- `/api/sync/wiki` (vault sync)
- `/api/sync/item` (vault sync, parses task title + content)
- `/api/items` POST + `/api/items/[id]` PATCH (REST)
- MCP `create_item`, `update_item`, `create_wiki_page`, `update_wiki_page`

Resolver matches by **page title, filename basename, and full vault path
without `.md`** (Obsidian-compatible — `[[Build Log]]` resolves to the
file `Shared Brain/Build Log.md` even though its H1 title is
`Shared Brain — Build Log`). Self-links and unresolved targets are skipped.

**Read endpoint (`GET /api/connections?type=...&id=...`):** Returns
all edges for an entity, deduped (explicit > tag > folder > semantic),
with target titles and contexts. Org-scoped via `assertInOrg`.

**UI panel (`<ConnectionsPanel>`):** Sectioned by edge kind, with
explainability badges (shared tag names, similarity %, etc.). Wired into:
- `/wiki/[id]` — right-side sidebar (lg+ breakpoints)
- Item detail drawer (kanban) — appears below the content textarea

**Inline rendering:** `[[Page Title]]` in markdown bodies pre-rendered to
real `/wiki/<id>` links before `react-markdown` sees them. Unresolved
references render as italic text with a `⟂` glyph so they're visible
without 404'ing.

**Backfill script:** `npm run backfill:connections` reindexes every wiki
page and item across all orgs. Run once after migration. Re-running is
safe (delete + insert).

### Divergences from spec
- **Phase 4 split into 4a + 4b** — spec had wiki + backlinks as one phase,
  but the backlink graph is rich enough that the deterministic edges
  warrant their own ship. Background AI edges (keyword overlap, AI
  suggestions) become 4b once 4a stabilizes.
- **Filename-basename matching beyond title matching** — Obsidian users
  reference pages by filename, not by H1 title. Resolver handles both
  + intermediate path forms. Documented in [[Decisions#ADR-013]].

### Verification
- Backfill on the 13 existing surgical-sync wiki pages: cross-references
  among Build Log / Decisions / Runbook all resolve (3 each). Unresolved
  references (e.g. `[[AI-Native PM Platform Vision]]`) belong to pages
  outside the surgical-sync subset and will resolve when full sync runs.
- Typecheck + production build clean.

### Friction encountered
- First backfill ran with title-only matching — 0 resolved. Real Obsidian
  links use filenames. Fixed resolver to match against title, basename,
  and full path. Documented as ADR.

---

## Phase 3 — Kanban UI

**Shipped:** 2026-04-30
**Spec target:** Week 4–5

### What was built

- **Real kanban** at `/projects/[id]` — replaces the Phase 1 interim
  list-of-6-cards. Six columns (Backlog → Completed), horizontally
  scrollable.
- **Drag-and-drop** via `@dnd-kit/core` + `@dnd-kit/sortable`. Drop on
  a column or another card; status updates optimistically and persists
  via `PATCH /api/items/[id]`. Reverts on PATCH failure.
- **Quick-add per column** — `+` button reveals an inline input;
  Enter → `POST /api/items` with the column's status.
- **Detail drawer** — clicking a card slides out a right-side sheet
  with editable title, type, status, content (textarea, markdown
  supported), plus a guarded delete (two-click confirmation).
- **3s polling** for AI / sync-driven changes — when an MCP tool or
  the vault sync agent writes to the same project, the board picks up
  the change within ~3s without a page reload. Pauses while the tab
  is hidden.
- **Type badges** color-code task / note / file / decision so a
  glance at a column tells you the mix.

### Components added
- `src/components/ui/sheet.tsx` — minimal slide-out drawer (no radix,
  no extra deps; backdrop click + Esc close).
- `src/components/ui/textarea.tsx` — shadcn-style textarea primitive.
- `src/components/kanban/{board,column,card,detail-drawer,types}.tsx`.

### Divergences from spec
1. **Polling instead of SSE for real-time** — see [[Decisions#ADR-012]].
   Solo Vercel multi-instance has SSE delivery edge cases; 3s polling
   is robust now and indistinguishable from SSE at the user's
   experience level. SSE moves in when team mode + Vercel KV pub/sub
   land.
2. **No "inline AI: add 5 tasks" feature.** Spec mentioned it; that
   wires into Phase 5's Claude chat panel + Composio. Logged as a
   followup.
3. **Drawer instead of modal for detail edit.** Spec said "Card detail
   view (inline edit)." Slide-out feels lighter and lets users see the
   board state while editing — closer to Linear / Height than to a
   modal-heavy tool.

### Verification
- Typecheck + production build pass clean.
- All sidebar / topbar / page links resolve (end-of-phase checklist
  item #1 — verified by grepping every `Link href=` against the
  generated routes).

### Friction encountered
- dnd-kit sortable items need stable IDs and a configured pointer
  sensor activation distance (we use 4px) so click-to-open-drawer
  doesn't fire accidentally on drag start.
- Polling clobbering optimistic state during in-flight drags is a
  theoretical race; current `mergePreservingActiveDrag` just prefers
  server state. If drag corruption shows up, switch to a more careful
  diff-merge.

---

## Phase 2 — Vault Sync Agent

**Shipped:** 2026-04-30
**Spec target:** Week 3–4

### What was built

**Platform side (`src/`):**
- New `vault_sync_log` columns: `entity_type`, `entity_id` so the table doubles
  as a path → entity dispatch index for upserts. Migration `0001`.
- Six new HTTP endpoints under `/api/sync/*`, all Bearer-auth'd with the
  same `MCP_API_KEY`:
  - `POST /api/sync/wiki` — upsert wiki page (regenerates embedding)
  - `POST /api/sync/space` — find-or-create space by name
  - `POST /api/sync/project` — find-or-create project by (spaceId, name)
  - `POST /api/sync/item` — upsert item by (filePath, lineKey)
  - `POST /api/sync/activity` — append-only activity feed entry
  - `GET /api/sync/log` + `POST /api/sync/log` — list / record errors
- Sync paths added to the public route matcher in `src/proxy.ts` so Clerk
  doesn't try to validate them.
- All sync writes log to `activity_feed` with `actor_agent = "vault-sync"`.

**Agent side (`agent/`):**
- New subdirectory with its own `package.json`, `tsconfig.json`, and deps
  (chokidar, gray-matter, p-limit). Excluded from the Next root tsconfig.
- `src/config.ts` — vault root, include/ignore prefixes, concurrency cap.
- `src/parser.ts` — frontmatter parsing and `[ ]` / `[x]` task extraction.
- `src/mapper.ts` — vault-relative path → entity kind (per spec table):
  - `Knowledge/**/*.md` → wiki page
  - `Pipeline/*.md` → wiki page tagged `pipeline`
  - `Clients/[Name]/_Overview.md` → wiki + ensures space exists
  - `Clients/[Name]/_Tasks.md` → items (status from checkbox state)
  - `Clients/[Name]/Meetings/*.md`, `Meetings/**/*.md`,
    `Dashboard/Daily Notes/*.md` → activity log entries
  - `SimHouse.io/*.md` → wiki page
- `src/api.ts` — typed Bearer-auth fetch wrapper.
- `src/sync.ts` — file → entity sync logic, idempotent.
- `src/index.ts` — entrypoint with two modes:
  - `npm run sync:once` — full scan, exit (bootstrap)
  - `npm run sync:watch` — full scan + chokidar watcher (daemon)
  - `npm run sync:dry` — `--dry-run`, no API calls
- Concurrency capped at 5, errors per-file logged + `/api/sync/log` reports.
- `Projects/shared-brain/**` and `Archive/` are hard-ignored to prevent
  recursion and tomb-file noise.

### Divergences from spec
1. **Sync agent is server-to-server, not Clerk-authenticated.** Spec didn't
   specify; chose to share `MCP_API_KEY` so there's a single rotation point.
2. **launchd plist is a template in [[Runbook]], not committed as a file.**
   Auto-start persistence requires explicit user opt-in. Template provided
   for the user to install themselves.
3. **`Archive/` excluded by default.** Spec didn't mention it; obvious
   exclusion to avoid syncing tomb files.

### Verification
- Dry-run on full vault: 435 markdown files found, 402 mapped, 33 correctly
  ignored, zero errors.
- All sync routes typecheck and build cleanly. Vercel build passes.

### Friction encountered
- Next 16's typechecker tried to typecheck the agent subdir and failed on
  `.ts` extensions in imports. Fixed by adding `agent` to the root
  `tsconfig.json`'s `exclude` list. (Agent has its own tsconfig with
  `allowImportingTsExtensions`.)
- Harness blocked me from writing the launchd plist directly (correct call
  — auto-start service is persistence). Template moved to runbook for
  manual install.

---

## Phase 1 — MCP Server

**Shipped:** 2026-04-30
**Spec target:** Week 2–3

### What was built
- MCP server mounted at `/api/mcp` via `mcp-handler` + `@modelcontextprotocol/sdk`
  (Streamable HTTP transport)
- All **8 read tools** (per spec): `get_org`, `get_spaces`, `get_projects`,
  `get_items`, `get_wiki_pages`, `get_activity_feed`, `get_backlinks`, `search`
- **8 write tools** (spec listed 6, added 2 — see divergences):
  `create_space`, `create_project`, `create_item`, `update_item`,
  `move_item_status`, `create_wiki_page`, `update_wiki_page`, `add_backlink`
- Every write auto-logs an `activity_feed` entry (actor = `claude-mcp`)
- Bearer-token auth via `MCP_API_KEY` env var
- Optional OpenAI `text-embedding-3-small` for `search` and wiki pages —
  falls back to ILIKE text match if `OPENAI_API_KEY` is unset
- Org context resolved by `MCP_USER_ID` (or first org as fallback)
- Updated README with Claude Desktop and Claude Code config snippets
- Interim UI pages: `/spaces/[id]` (project list) and `/projects/[id]` (items
  grouped into 6 swimlanes) — cheap precursor to the Phase 3 kanban

### Divergences from spec
1. **`create_space` and `create_project` added as MCP tools.** Spec listed
   only `create_item`, `create_wiki_page`, `add_backlink` as MCP writes. First
   time a real workflow tried to create a space via Claude Desktop, the gap
   was obvious. Added both — agents need to manage the full hierarchy without
   tabbing back to the browser. See [[Decisions#ADR-008]].
2. **Bearer token auth, not OAuth.** Spec didn't specify an auth mechanism;
   chose API-key for solo MVP simplicity. See [[Decisions#ADR-006]].
3. **mcp-handler wrapper used.** Thin Vercel-compatible wrapper around the
   raw SDK. See [[Decisions#ADR-005]].

### Verification
- Local `initialize` handshake against `/api/mcp` returns proper JSON-RPC
  response with `tools.listChanged: true`.
- Claude Desktop connected via `mcp-remote` stdio bridge — all 16 tools
  visible.
- Round-trip end-to-end: created `My Electric Home` (client space) via MCP
  from Claude Desktop with auto-logged activity feed entry.

### Friction encountered
- Claude Desktop config doesn't accept URL-based MCP servers directly;
  required `mcp-remote` bridge in the `claude_desktop_config.json`.
- mcp-remote args needed `Authorization:${AUTH_HEADER}` env-var
  substitution because Claude Desktop's args parser sometimes mangles
  spaces in raw strings.

---

## Open issues / followups

### Resolved
- ~~Sidebar links to a 404 if the user creates a space whose page hasn't
  built yet~~ — fixed in Phase 1 by adding interim space/project pages.
- ~~`/wiki` 404'd~~ — fixed post-Phase 2 by adding interim wiki list +
  detail pages with markdown rendering, then upgraded to a folder-tree
  view based on `metadata.filePath`.

### Active design questions
These each live as `decision`-type items inside the `ViaOps Internal →
Shared Brain` project on the platform itself (dogfooding). Update both
places when one is resolved.

- **Wiki hierarchy strategy** — current tree-from-filePath is the cheap
  interim. Phase 4 picks the long-term: filesystem mirror vs. tag
  groups vs. hybrid vs. AI-curated. Sidebar restructure ("Wiki" stays
  as one entry vs. splits into Knowledge / Pipeline / Clients) depends
  on this answer.
- **AI-native UI create-flow ripple effects** — before we add UI buttons
  for creating spaces / projects / items / wiki pages, we need a design
  for vault drift, auto-fill policy ("you made a space, want me to
  scaffold projects?"), and rollback. Until then, all creates flow
  through MCP or vault sync only.
- **Homepage as personal dashboard** — see [[Dashboard Vision]]. The
  current Phase-0-text homepage is a placeholder until post-Phase 5
  when activity feed + built-in Claude exist as data sources.

### Operational followups
- **Spec at `~/Documents/ViaOps/Knowledge/Frameworks/AI-Native PM Platform - MVP Spec.md`
  is referenced from the repo README via absolute path** — fixed by the
  vault sync mirror; both vault and repo `docs/` now hold copies.
- **Single shared `MCP_API_KEY`** — fine for solo, but per-client keys
  are needed before sharing with other humans. Open question: issue
  keys via a `/settings/mcp` UI or via MCP-OAuth dynamic client
  registration?
- **Repo bloat from one bad commit** — git history contains
  `agent/node_modules` from commit `9cbf338` (~534k extra lines).
  Cosmetic; doesn't affect working tree. Clean up with
  `git filter-repo` + force-push if the repo size ever bothers us.

### Phase F4c — Manual upload UI (dropped)

**Date:** 2026-05-07
**Status:** Dropped before implementation; not built.

**What it would have been:** a drag-drop web form on the platform
that accepts a file, uploads to Vercel Blob, runs the same content
extraction pipeline the vault sync agent uses, and creates a wiki
page entry.

**Why dropped:**
- The launchd daemon already covers this for any file dropped into
  `~/Documents/ViaOps/`. Faster than opening a web form, picking a
  file, picking a destination space.
- The mobile use case (on-the-go file capture) is better served by
  a Phase 7 workflow tool (`file_document(source, hint?)`) that
  Claude can invoke from the mobile app. AI auto-classifies the
  document, applies routing rules from `Profile.md`, places it in
  the right vault path with correct tags. Strictly more useful than
  a dumb-pipe form.
- The only remaining persona is "user with no daemon, no Claude."
  Not Keegan today; not multi-user contributors realistically.

**Where the capability lives instead:** Phase 7 — Mobile via Claude.
The `file_document` workflow tool inherits the F4c value prop
(file → platform) but adds AI-driven classification and works from
mobile.

**Revisit if:** a real user emerges who has neither the daemon
running nor a Claude client, and needs to contribute files.

---

### Phase 4b v2 follow-ups (queued)

Items punted from the v1 ship of background AI edges. Revisit when
real-world usage reveals priority.

- **`ai_suggested` edges** — LLM-driven relationship suggestions for
  recently-updated entities. Schema field is in place. Needs:
  - Cost-budget analysis (how many entities × how often × token
    cost per call)
  - Rate-limit / batching strategy
  - Distinct value beyond `semantic_similar` (which already does
    embedding-similarity). Probably: structured "type of
    relationship" labels (e.g. *competitor*, *successor*, *alias*).
- **co_mention nickname resolution** — current substring matcher
  requires full title verbatim ("Matt Frary"). Real meeting notes
  use first names ("Matt"). v2: per-person alias list pulled from
  frontmatter `aliases:` field and/or generated from
  Pipeline/_Index.md. Disambiguate when multiple people share a
  first name.
- **Incremental cron pass** — current implementation re-scans every
  entity in every org on every cron tick. As the graph grows past
  ~10k entities this will hit timeout limits. v2: track
  `last_processed_at` per entity and only re-scan recently-modified
  ones, with a periodic full re-scan (e.g. weekly).

---

### Parking lot — post-MVP feedback (revisit after main build)

External feedback gathered as the platform takes shape. Captured for
later prioritization, not committed to scope. Revisit once Phase 4b /
F4 / 7 are shipped and decide which to pull forward, drop, or defer
further.

#### From Matt Reynolds (2026-05-03 Granola conversation, Trade Oracle architecture meeting)

**Maps to existing roadmap:**

- **Orgs / Spaces hierarchy with permissions tree** — left-nav as
  Global → Orgs → Spaces, with private-individual / private-org /
  global visibility scopes. Invite users by email to an org; org
  membership grants access to org spaces. Sharpens what Phase 8
  (multi-user readiness) means architecturally. Bonus angle: super-
  admin sees overlap across client orgs (conflict-of-interest /
  policy-mismatch detection) — sellable to consultants.
- **Agents + Chat as core left-nav items** — Agents = a CRUD where
  each agent is a markdown defining which Composio tools and
  collections it can access. Chat lets users pick an agent and kick
  off workflows. Pair with a CLI covering every API endpoint so
  agents can self-maintain (create spaces, add members). Overlaps
  Phase 7 mobile workflow tools; agents-as-markdown is a new sub-
  phase. Matt: *"if you add agents and chat, you'll have infinite
  things."*
- **Channels integrations (Discord / Telegram / Signal bots)** —
  surface Shared Brain via chat-platform bots so users don't depend
  on Claude's mobile app. Different channels can route to different
  agents/models. Adjacent to Phase 7. Discord first (already in use).
  Keegan's pushback: Claude-native first, chat-platform bots follow.

**Net-new direction (post-MVP):**

- **Composio replacement strategy** — Composio is an API-facade
  abstraction, not a moat; AI could rebuild equivalents in a week.
  Right tool today; plan for going direct on integrations longer-term
  to avoid vendor dependency.
- **Profile-based API key config (UI surface)** — already true under
  the hood (users plug in their own Composio + LLM keys). Needs a
  proper "Configure" panel in the user profile. Per-org choice of
  which LLM powers Shared Brain becomes a setting — *"are you paying
  the cloud AI or am I."*
- **Workflow Analyzer agent (productized consulting tool)** — drop in
  a client SOP markdown → agent recommends simplifications. Wire to
  client tools via Composio (Zoho example). Generate a mock refactored
  portal as deliverable. Sell as $500 consult or white-label to
  enterprises (e.g. Charter cited as "8 million workflows that need
  refactoring"). Concrete consulting upsell built on the platform.
- **Strategic moat framing** — *"rag with features + chat + agents"*
  is the universal software pattern; everyone can build the shell. The
  moat is specific data sources + custom widgets/dashboards. Informs
  how we prioritize differentiation work.
- **Invisible-PM thesis (validated)** — Matt strongly endorsed via
  home-automation analogy: *"the best home automation isn't a remote
  light switch — I don't want to interact with it at all."* Already
  aligned with our direction; worth keeping as a north-star quote.

**Validation (no action needed):**

- **Kanban column collapse** — Matt called it out as something he
  wants to copy into his AIST DLC visualizer. Genuine compliment;
  good signal that the small UI moves are landing.

---

### End-of-phase checklist (the rule)
At the end of every phase, before declaring it shipped:
1. ✅ All sidebar / topbar / page links resolve (no 404s)
2. ✅ Build Log status table updated
3. ✅ Any new ADRs added to Decisions
4. ✅ Runbook gains any new ops procedures
5. ✅ Spec checkboxes ticked + divergences linked to ADRs
6. ✅ docs/ in repo mirrors vault canonical
7. ✅ Phase task on the platform moved to `completed`
8. ✅ Followups added here for anything punted

---

## Process notes

- Each phase ends with: **(a)** updating this file's status snapshot table
  and adding a phase section, **(b)** appending any new entries to
  [[Decisions]], **(c)** marking the corresponding checkbox in
  [[AI-Native PM Platform - MVP Spec]] as complete.
- Commit messages narrate *why*, not just *what*. They're the most granular
  level of build history.
- Any decision that took more than 60 seconds to make becomes an ADR in
  [[Decisions]].
