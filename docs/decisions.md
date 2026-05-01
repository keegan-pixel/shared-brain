---
title: Shared Brain — Architecture Decisions
created: 2026-04-30
updated: 2026-04-30
status: living-document
tags: [viaops-internal, shared-brain, decisions, adr]
related: "[[AI-Native PM Platform - MVP Spec]]"
---

# Shared Brain — Architecture Decisions

Running log of non-obvious choices made while building Shared Brain. Each
entry is a lightweight ADR — what we picked, what we rejected, and why.
Newest at the top.

> **Related:**
> - [[AI-Native PM Platform - MVP Spec]] — the original spec
> - [[Build Log]] — phase-by-phase narrative
> - [[Runbook]] — common ops tasks

---

## ADR-019 — Reverse course on ADR-018: back to `@composio/core` SDK with meta-tools

**Date:** 2026-05-01 · Phase 5c (revision)
**Decision:** Drop the `COMPOSIO_MCP_URL` integration from ADR-018.
Use `@composio/core` SDK instead, exposing four meta-tools to the chat:
`composio_search_tools`, `composio_get_tool_schema`, `composio_execute`,
`composio_list_connections`.

**Context:** Live testing revealed that Composio's static MCP URL
surface — what ADR-018 wired up — bakes a single `is_default`
connection per toolkit into every tool call. There is no parameter on
the exposed tools (`GMAIL_FETCH_EMAILS`, `GOOGLECALENDAR_EVENTS_LIST`,
etc.) for routing to a different account. With 6 Gmail / 6 calendar /
4 Drive accounts, that locks 14 of 19 connections out of the chat.

The surface that DOES support per-call routing is the meta-tool
pattern — `MULTI_EXECUTE_TOOL` with an `account` parameter. That's how
Claude Code / Desktop's Composio plugin works. We replicate it
ourselves on top of the SDK because the meta-tools live behind a
dynamic-mode MCP server we can't easily provision from a Vercel
deployment.

**Rejected:**
- Continue with the static MCP URL — would require setting Composio's
  `is_default` per toolkit and accepting that 14 accounts are silent.
- Multiple MCP URLs (one per persona) — possible but operationally
  messy and ties the chat's account list to Composio's dashboard
  state.

**Trade-off:** Two extra round trips per Composio task (search → get
schema → execute) vs. direct slug calls. In practice, search + schema
results cache well within a session, and the routing flexibility is
worth the latency.

**Status:** ADR-018 superseded.

---

## ADR-018 — Composio over MCP URL, not the `@composio/core` SDK *(superseded by ADR-019)*

**Date:** 2026-05-01 · Phase 5c
**Decision:** The chat connects to Composio via a single `COMPOSIO_MCP_URL`
using `@modelcontextprotocol/sdk`'s `Client` + `StreamableHTTPClientTransport`,
and adapts each MCP tool into an AI SDK `dynamicTool`. We removed
`@composio/core` and `@composio/vercel`.

**Context:** Composio offers two surfaces:
1. SDK (`@composio/core`) — `composio.tools.get(userId, { toolkits: [...] })`.
   Each connected account has its own user ID; you have to enumerate them
   to expose multiple Gmail / Calendar / Drive accounts to the chat.
2. MCP URL — one URL per Composio user that bundles every connected
   toolkit + account. Standard MCP `tools/list` + `tools/call` over
   streamable HTTP.

**Rejected:** Option 1. For a multi-account setup (6 Gmails, 6
calendars, 4 Drives, etc.), the SDK approach forces a per-connection
routing table baked into env vars or code. The MCP URL surface is
already scoped at the user level and lists every tool — the only thing
left is for Claude to pick the right `connection_id`/account-context
parameter when calling, which is what `Composio Mapping.md` is for.

**Trade-off:** AI SDK v6 dropped `experimental_createMCPClient`, so we
use the MCP SDK Client directly. That's already a dependency from the
platform's own MCP server, so net zero. Tool listings are cached for
5 minutes per cold start to keep chat init fast — adding a new
Composio connection takes up to 5 minutes (or a redeploy) to surface.
Worth it for the simplicity.

---

## ADR-017 — In-platform chat tools defined directly, not via MCP roundtrip

**Date:** 2026-05-01 · Phase 5b
**Decision:** The built-in chat panel's tools are defined as AI SDK
`tool()` definitions inside the platform code (`src/lib/chat/tools.ts`),
calling the same Drizzle queries the MCP server uses — not by
connecting an MCP client to our own `/api/mcp` endpoint.

**Context:** Two ways to give the in-platform chat the same capabilities
as Claude Desktop's MCP connection:
1. Use `experimental_createMCPClient` from AI SDK to connect over HTTP
   to our own `/api/mcp` (with Bearer auth)
2. Define the tools directly server-side, sharing the same DB code

**Rejected:** Option 1. Roundtripping through HTTP for tools that already
have direct DB access in the same process is wasted latency. Bearer auth
inside the same Vercel function context is theatre. The MCP server stays
as the integration point for *external* clients (Claude Desktop, Code,
Cowork); the in-platform chat speaks directly to the same data layer.

**Trade-off:** Two definitions of the same tool surface — one in
`src/lib/mcp/tools.ts` (registers with `McpServer.tool()`), one in
`src/lib/chat/tools.ts` (AI SDK `tool()`). When we add a new tool, both
sides need it. Acceptable for the surface size; if it grows, extract a
shared core layer that both wrap.

---

## ADR-016 — Vercel Blob `get()` for private-blob streaming

**Date:** 2026-05-01 · Phase F3
**Decision:** Server-side proxy at `/api/files/[id]` uses
`get(url, { access: "private" })` from `@vercel/blob` to stream
private-blob bytes back to the authenticated client.

**Context:** First implementation tried `head(url)` to get a signed
`downloadUrl`, then plain `fetch()` against it. That doesn't work for
private blobs — the URLs lose their auth context outside the SDK.
Both PDF iframes and DOCX previews 502'd.

**Rejected:**
- `head()` + manual `fetch()` — broken (above).
- Manual `Authorization: Bearer ${BLOB_READ_WRITE_TOKEN}` header on
  fetch — undocumented, fragile.
- Switching the store to public access — would break the security
  model for invoices/MSAs ("URL-as-secret" is too weak for sensitive
  artifacts).

**Trade-off:** Each preview hits the SDK + a server-side fetch instead
of redirecting the browser to a signed URL — slightly more bandwidth
through the platform. Mitigated by 60s `Cache-Control: private`. Worth
it for a clean security story (private blobs, Clerk auth at the proxy,
URLs never reach the client).

---

## ADR-015 — Files are wiki entries, not a separate table

**Date:** 2026-04-30 · Phase F1
**Decision:** Non-markdown files (PDFs, DOCX, XLSX, images, etc.) sync
as `wiki_pages` rows with three new columns (`blob_url`,
`extracted_text`, `extracted_word_count`), not as a separate
`files` table.

**Context:** Two reasonable models:
- New `files` table with its own schema, lookups, UI surface, etc.
- Reuse `wiki_pages` — every node in the wiki tree is the same shape;
  files just have additional columns + a different content rendering.

**Rejected:** Separate table. It would mean parallel everything —
parallel sync log entries, parallel connection-graph plumbing, parallel
search, parallel UI. Doubling the surface for what is functionally "a
node in the wiki with a file attached."

**Trade-off:** `wiki_pages.content` for files is now synthetic markdown
(filename, type, size, Obsidian link, preview snippet) rather than
authored content. Acceptable; it gives users something glanceable in
the wiki tree without forcing a new view. Backlinks resolve naturally.

---

## ADR-014 — Meeting notes are wiki pages, not activity-feed entries

**Date:** 2026-04-30 · Phase C
**Decision:** `Meetings/*.md` and `Clients/[Name]/Meetings/*.md` map to
**wiki pages tagged `meeting`** (and the client slug, where applicable),
NOT to activity-feed entries.

**Context:** The original spec table mapped meeting folders to "activity
log entries." On the first full sync that's what we did, and it was
wrong: tasks across the platform reference meetings via `[[2026-04-24 -
Richard Lackey - In-Person Meeting]]`, which only resolves if the
target is a wiki page (resolver queries `wiki_pages` table). With
meetings as activity entries, ~50% of task wikilinks were unresolved.

**Rejected:**
- Keep meetings as activity-only — breaks backlink graph for the
  highest-volume cross-reference pattern in the vault.
- Sync meetings as BOTH wiki pages AND activity entries — duplicate
  data, two sources of truth, complicates updates. Activity feed already
  fills up with `sync_wiki_create` / `sync_wiki_update` entries on every
  meeting sync, so the audit-trail intent is preserved.

**Trade-off:** Some "events that happened at a time" intent is lost
(meetings now look like content, not events). When Phase 5's activity
feed UI ships, we can add explicit `met_with` activity entries derived
from wiki page tags or frontmatter — but the wiki-page model wins for
backlink resolution today.

**Migration:** Re-syncing existing meeting files moves them from
activity → wiki via the upsert path in `/api/sync/wiki`. Old activity
entries from the first sync remain as historical noise; not worth
deleting.

---

## ADR-013 — Wikilink resolver matches by filename basename, not just title

**Date:** 2026-04-30 · Phase 4a
**Decision:** When resolving `[[Page Title]]` references during link
extraction, the resolver checks each wiki page against three candidate
keys: page title, filename basename (no `.md`), and full vault path
(no `.md`). All case-insensitive.

**Context:** Obsidian users write `[[Build Log]]` referring to the file
`Build Log.md` regardless of the H1 inside the file. Our wiki pages
have H1-derived titles like `Shared Brain — Build Log` that don't
match. First backfill resolved 0 of dozens of wikilinks because of this
mismatch.

**Rejected:**
- Title-only matching — wrong for Obsidian; doesn't match user
  expectation.
- Filename-only matching — would miss MCP-created pages that have no
  `metadata.filePath`.

**Trade-off:** A title may collide with a different page's basename in
unusual setups (e.g., title "Build Log" while another file is named
`Build Log.md`). First-match-wins ordering is title → basename → path,
so the most specific keys take priority. If collisions become a real
problem we can introduce explicit aliases in frontmatter.

---

## ADR-012 — 3-second polling for real-time kanban (not SSE) for now

**Date:** 2026-04-30 · Phase 3
**Decision:** The kanban board polls `GET /api/items?projectId=…` every 3
seconds (paused while tab is hidden) instead of subscribing to a server-sent
events stream.

**Context:** Spec says "Real-time strategy → SSE." On Vercel functions in
multi-instance mode, an SSE subscriber on instance A doesn't receive
events fired on instance B without a shared message bus (Vercel KV /
Redis pub/sub, or similar). Building a real bus before there's a real-
time use case beyond solo dogfooding is over-engineering.

**Rejected:**
- **Real SSE today** — needs Vercel KV or Redis as a pub/sub bus to be
  reliable across function instances. Worth doing when team mode lands;
  premature for solo.
- **Long-poll** — same complexity as SSE without the simplicity payoff.
- **No real-time** — fails the spec's Phase 3 "AI-triggered status
  updates via MCP reflected in real time" exit criterion.

**Trade-off:** 3s polling burns one tiny `GET /api/items` per active
kanban tab. At solo scale the cost is invisible (a few KB / 3s). At team
scale the cost becomes meaningful and we'll cut over to SSE + KV. The
user-visible latency on AI writes is at most one polling interval, which
is fine for "I asked Claude to move this card" workflows.

**Migration path:** Replace `useEffect` polling in `Board` with an
`EventSource` subscription pointed at `/api/events` once the pub/sub
backend exists. Server-side, every write to `items` already calls
`logActivity`; that's the natural fan-out point.

---

## ADR-011 — `Archive/` excluded from vault sync by default

**Date:** 2026-04-30 · Phase 2
**Decision:** The vault sync agent's `ignorePrefixes` includes `Archive/`.

**Context:** The vault has an `Archive/` folder for tomb files (old projects,
deprecated notes, etc.). Syncing them clutters the platform with stale
content that nobody wants AI agents to surface in search.

**Trade-off:** If something genuinely useful gets archived, it disappears
from the platform. Acceptable — archives are explicitly de-prioritized
content. If the user re-needs an archived file, move it out of `Archive/`
and the next sync picks it up.

---

## ADR-010 — `vault_sync_log` is the upsert dispatch index

**Date:** 2026-04-30 · Phase 2
**Decision:** Extend `vault_sync_log` with `entity_type` and `entity_id`
columns so it serves both as a sync state log and as the file_path → entity
lookup table for upserts.

**Context:** Sync needs idempotency: re-syncing the same file shouldn't
create duplicates. We need a way to map "I just parsed `Knowledge/foo.md`"
to "this is wiki page UUID xyz." Two options:
- Add a `metadata.filePath` indexed jsonb field to every syncable entity
  table — works but requires per-table indexes and complicates queries.
- Use the already-planned `vault_sync_log` table as a single dispatch
  index — file_path is unique and we just record `(entity_type, entity_id)`
  per row.

Picked option B. Cleaner — one table holds all sync state.

**Trade-off:** Cross-table foreign key isn't enforceable (entity_id points
into different tables based on entity_type). The status invariant is
maintained at the application layer in the sync route handlers.

---

## ADR-009 — Sync agent uses the same `MCP_API_KEY` as the MCP server

**Date:** 2026-04-30 · Phase 2
**Decision:** Both the MCP server (Claude clients) and the local sync agent
authenticate to the platform with the same `Authorization: Bearer
${MCP_API_KEY}` header.

**Context:** Sync agent is server-to-server (local Node daemon → Vercel),
not user-facing. Could have its own dedicated key (e.g. `SYNC_API_KEY`).

**Rejected:** Per-component keys. Doubles the rotation surface and gives
near-zero security benefit when both components run on the same trust
boundary (Keegan's machine).

**Trade-off:** Compromising the single key means both surfaces are
exposed. Acceptable at MVP scale. When we go multi-user, both will move
to per-user issuance and this becomes moot.

---

## ADR-008 — `create_space` + `create_project` are MCP tools, not just REST

**Date:** 2026-04-30 · Phase 1
**Decision:** Expose space and project creation via MCP tools, not only via
the web REST API.

**Context:** The original spec listed only `create_item`, `create_wiki_page`,
and `add_backlink` as MCP write tools. Spaces and projects were "Phase 0
REST-only." First time the user tried to create a space via Claude Desktop,
the gap was obvious — agents naturally want to set up the full hierarchy
without tabbing back to the browser.

**Rejected:** Forcing browser-side creation. Worked technically but broke
the "AI-native" thesis that anything you can do in the UI you can do from
any Claude client.

**Trade-off:** Diverges from the spec, but the spec was incomplete. Updated
the [[Build Log]] to note this.

---

## ADR-007 — Lazy-init database client (Proxy pattern)

**Date:** 2026-04-30 · Phase 0 / fix during Vercel deploy
**Decision:** Wrap the Drizzle instance in a `Proxy` so the
`DATABASE_URL is not set` check fires on first query, not at module load.

**Context:** First Vercel build crashed at the "Collecting page data" step
because Next.js statically imports every route to extract config. Top-level
`throw` in `src/lib/db/client.ts` propagated through that import chain even
though the route was never executed.

**Rejected:**
- Setting `DATABASE_URL` at build time only — fragile and hides real config
  errors.
- Skipping the check entirely — silently 500's at runtime with a worse
  error.

**Trade-off:** Proxy wrapper has a tiny per-call overhead and makes type
inference slightly less direct, but the build is now resilient to missing
runtime env vars (build still passes; only requests fail, with a clear
error in logs).

---

## ADR-006 — Bearer-token auth for MCP, not OAuth

**Date:** 2026-04-30 · Phase 1
**Decision:** Single shared `MCP_API_KEY` env var. Claude clients send it
as `Authorization: Bearer <key>`.

**Context:** MCP spec supports OAuth 2.1 for remote servers. For a personal
single-user MVP, OAuth would mean implementing an authorization server,
DCR, scope handling — weeks of work for no real benefit when there's
exactly one user.

**Rejected:**
- OAuth — premature for solo use.
- Clerk session cookies — Claude Desktop doesn't speak Clerk; would
  require a custom OAuth bridge anyway.
- No auth — open MCP to anyone with the URL.

**Trade-off:** Single key means revoking access requires rotating the key
and updating every connected client. Acceptable at this scale (1 user,
3 clients). Move to per-client keys when we share with other humans.

---

## ADR-005 — `mcp-handler` package, not raw `@modelcontextprotocol/sdk`

**Date:** 2026-04-30 · Phase 1
**Decision:** Use Vercel's `mcp-handler` to wrap the SDK and expose it as
a Next.js Route Handler.

**Context:** The MCP TS SDK ships with `Server` + `StreamableHTTPServerTransport`
classes but no opinionated "deploy this on Vercel" wrapper. `mcp-handler`
provides `createMcpHandler()` that returns a Next-compatible `(req) => Response`
function and handles SSE / streamable-HTTP transport selection.

**Rejected:** Hand-rolling the transport adapter. Doable in ~50 lines but
duplicates work that `mcp-handler` already solves.

**Trade-off:** One more package dependency. Wrapper is thin enough that we
can drop down to the raw SDK if `mcp-handler` ever breaks.

---

## ADR-004 — Drizzle ORM, not Prisma

**Date:** 2026-04-29 · Phase 0
**Decision:** Drizzle for schema definition, queries, and migrations.

**Context:** Both work with Neon. Drizzle is TS-first (schema is plain TS),
plays well with Neon's HTTP serverless driver, and has zero runtime
overhead — which matters on Vercel functions where cold starts are
billed.

**Rejected:** Prisma — heavier runtime, separate schema language (.prisma),
worse cold-start behavior on serverless, and the "rust query engine"
deployment story on Vercel has historically been bumpy.

**Trade-off:** Drizzle has fewer tutorials and a smaller community than
Prisma. The TS ergonomics more than make up for it; queries read like
SQL with type safety.

---

## ADR-003 — Next 16, not Next 15

**Date:** 2026-04-29 · Phase 0
**Decision:** Use whatever `create-next-app@latest` installs (Next 16.x).

**Context:** The spec said Next 15. `create-next-app@latest` shipped Next
16 by the time we built. App Router and TS strict are intact; Next 16
mostly renamed `middleware.ts` → `proxy.ts` and continued the Turbopack
push. No breaking changes that affect us.

**Rejected:** Pinning to Next 15. Would mean fighting the default tooling
for no functional benefit.

**Trade-off:** Slight risk of bleeding-edge bugs. Mitigated by the small
surface area of our app (App Router + a handful of routes) and the
ease of pinning back if something breaks.

---

## ADR-002 — `src/proxy.ts` (not `middleware.ts`)

**Date:** 2026-04-29 · Phase 0
**Decision:** Use the Next 16 `proxy.ts` file convention.

**Context:** Next 16 deprecated `middleware.ts`. Build emits a deprecation
warning if we keep the old name. Functionally identical; same Clerk
helpers (`clerkMiddleware`, `createRouteMatcher`).

**Trade-off:** None — pure rename.

---

## ADR-001 — pgvector enabled by the migration runner, not by the user

**Date:** 2026-04-29 · Phase 0
**Decision:** `scripts/migrate.ts` runs `CREATE EXTENSION IF NOT EXISTS vector`
before applying Drizzle migrations.

**Context:** Neon doesn't surface a UI toggle for extensions in their
dashboard. Asking the user to manually `CREATE EXTENSION` in the SQL
editor is fragile (forgotten, run on the wrong branch, etc.).

**Rejected:** Documenting it as a manual step. Works but breaks for anyone
spinning up a new env (Preview deploys, future team members).

**Trade-off:** Runner needs `CREATE EXTENSION` privileges. Neon's default
`neondb_owner` role has them; if we ever lock down DB roles, we'd need to
move this to a separate admin step.
