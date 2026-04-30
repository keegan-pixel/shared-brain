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
| 4b — Background AI edges (keyword overlap, AI-suggested) | ⏳ Not started | — | Cron-driven; queued |
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
