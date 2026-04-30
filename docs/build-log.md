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
| 2 — Vault Sync Agent | ⏳ Not started | — | Next up |
| 3 — Kanban UI | ⏳ Not started | — | Interim list view shipped in Phase 1 |
| 4 — Wiki + Backlinks | ⏳ Not started | — | |
| 5 — Activity Feed + Built-in Claude | ⏳ Not started | — | |

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

- **Sidebar links to a 404 if the user creates a space whose page hasn't
  built yet** — fixed in Phase 1 by adding interim space/project pages.
- **Spec at `~/Documents/ViaOps/Knowledge/Frameworks/AI-Native PM Platform - MVP Spec.md`
  is referenced from the repo README via absolute path** — should be
  copy-synced into the repo by Phase 2's vault sync agent. For now, both
  vault and repo have copies that we update manually.
- **Single shared `MCP_API_KEY`** — fine for solo, but per-client keys are
  needed before sharing with other humans. Open question: do we issue keys
  via a `/settings/mcp` UI or via MCP-OAuth dynamic client registration?

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
