---
title: Shared Brain — MVP Technical Specification
created: 2026-04-29
updated: 2026-04-30
status: in-progress
tags: [viaops-internal, product-vision, technical-spec]
related: "[[AI-Native PM Platform Vision]]"
---

# Shared Brain — MVP Technical Specification

> **Parent doc:** [[AI-Native PM Platform Vision]]
> **Status:** **In progress** — Phase 0 + Phase 1 shipped 2026-04-29 / 2026-04-30
> **Build target:** Keegan as solo user (guinea pig). ViaOps service offering post-proof-of-concept.
>
> **Supporting docs:**
> - [[Shared Brain/Build Log|Build Log]] — phase-by-phase narrative + divergences
> - [[Shared Brain/Decisions|Decisions]] — ADR-style log of architectural choices
> - [[Shared Brain/Runbook|Runbook]] — common ops tasks (rotate keys, debug, add tools)
>
> **Live URLs:**
> - Production app: https://shared-brain-ecru.vercel.app/
> - GitHub repo: https://github.com/keegan-pixel/shared-brain
> - Local repo: `/Users/keeganlamar/Documents/ViaOps/Projects/shared-brain/`

## Progress snapshot

| Phase | Status | Shipped |
|---|---|---|
| 0 — Foundation | ✅ Complete | 2026-04-29 |
| 1 — MCP Server | ✅ Complete | 2026-04-30 |
| 2 — Vault Sync Agent | ✅ Complete | 2026-04-30 |
| 3 — Kanban UI | ✅ Complete | 2026-04-30 |
| 4a — Connection Graph Foundations | ✅ Complete | 2026-04-30 |
| 4b — Background AI edges (keyword overlap, AI-suggested) | ⏳ Not started | — |
| 5a — Activity Feed UI | ✅ Complete | 2026-04-30 |
| File storage + extraction + previews (F1+F2+F3) | ✅ Complete | 2026-04-30 → 2026-05-01 |
| 5b — Built-in Claude chat panel | ✅ Complete | 2026-05-01 |
| 5c — Composio integration | ✅ Complete | 2026-05-01 |
| ~~5d — Live artifacts~~ | ❌ Dropped (ADR-022) | 2026-05-01 |
| 6 — Agent Operating Instructions | ⏳ Next up | — |
| F4 — Bidirectional ingestion (incl. F4d local-mirror pull-down) | ⏳ Queued | — |
| 7 — Mobile via Claude (Claude.ai mobile + remote MCP, no native) | ⏳ Queued | — |
| 8 — Multi-user readiness | 🅿️ Parked | — |

---

## What We're Building

**Shared Brain** — a cloud platform that mirrors the local Obsidian vault and exposes it to AI agents via MCP. Claude Desktop, Claude Code, and Cowork can all read from and write to it — making context persistent and queryable across all environments without rebuilding any existing workflow.

**The core loop:** Keegan works locally → vault changes → sync agent pushes to platform → Claude clients anywhere can query it and act on it → activity is visible in a clean UI.

---

## Source of Truth Decision

**Local Obsidian vault is the source of truth (MVP).**

- Platform mirrors the vault — not the other way around
- Sync direction: local → cloud
- Future state: bidirectional diff sync when mobile becomes a heavier part of the workflow (conflict resolution layer added at that point)

---

## Tech Stack

| Layer | Tool | Notes |
|-------|------|-------|
| Framework | Next.js 15 (App Router, TypeScript strict) | Consistent with other builds |
| Hosting | Vercel | Vercel Pro for longer function runtimes |
| Database | Neon (Postgres + pgvector) | Structured data + semantic search |
| Auth | Clerk | Single user MVP, multi-user ready |
| UI Components | shadcn/ui | Specified baseline throughout |
| AI SDK | Vercel AI SDK | Built-in Claude chat interface |
| LLM | Claude Sonnet 4.6 (default) / Opus 4.6 (deep reasoning) | Keegan's Anthropic API key |
| MCP Server | @modelcontextprotocol/sdk (TypeScript) | Exposes platform to Claude clients |
| Vault Sync Agent | Node.js + chokidar | Local file watcher → platform API |
| External Integrations | Composio | Single connector for all external tools — Gmail, Calendar, Drive, LinkedIn, Discord, QuickBooks, Granola, and any future tools |

---

## MVP Scope

### In
- MCP server — Claude Cowork and Claude Code can read from and write to the platform
- Composio as the single external connector — covers Gmail, Calendar, Drive, LinkedIn, Discord, QuickBooks, Granola, and extensible to any future tool
- Vault sync — local Obsidian vault mirrored to platform information hub
- Full hierarchy: Org → Spaces → Projects → Items
- AI-assisted data entry for projects, tasks, wiki
- Wiki with bidirectional backlinks (AI-maintained), kept in sync local ↔ cloud
- shadcn/ui component baseline throughout
- Activity feed (who read/wrote what, when, on behalf of whom)
- Kanban board per project (6 swimlanes — see below)
- AI can move kanban cards via MCP

### Out (post-MVP)
- Smart glasses / smart device ingestion
- List view (add post-MVP once kanban is stable)
- Notion integration
- Multi-org support / multi-user (deferred to Phase 8 — parked)
- Live artifact rendering inside chat (cancelled per ADR-022)
- Native iOS/Android app (Phase 7 uses Claude.ai mobile + remote MCP instead — see ADR-025)

### Now in scope (added as roadmap evolved)
- Bidirectional vault sync (Phase F4d, ADR-024) — local Obsidian stays mirrored when entries are created from chat / mobile / other users
- Agent Operating Instructions (Phase 6, ADR-023) — standardized session-start context for every Claude agent so the brain stays updated automatically
- Mobile via Claude.ai + remote MCP (Phase 7, ADR-025) — workflow tools for one-shot mobile actions

---

## Data Model

### Hierarchy

```
Organization (ViaOps)
├── Wiki (org-level, cross-cutting)
│   └── Pages → backlinked to each other + to any item in any space
└── Space (= client / department / team)
    └── Project
        └── Item (task | note | file | decision | status update)
            └── Backlinks → wiki pages + other items
```

### Kanban Swimlanes (items.status)

| Status | Label |
|--------|-------|
| `backlog` | Backlog |
| `not_started` | Not Started |
| `research_planning` | Research / Planning |
| `in_progress` | In Progress |
| `review` | Review |
| `completed` | Completed |

AI can move items between any swimlane via `move_item_status` MCP tool.

### Core Database Tables

**organizations** — id, name, slug, created_at

**spaces** — id, org_id, name, type (client | dept | team), access_roles[], created_at

**projects** — id, space_id, name, description, created_at

**items** — id, project_id, type (task | note | file | decision), title, content, status, created_by_agent, created_at, updated_at

**wiki_pages** — id, org_id, title, content, access_roles[], embedding (pgvector), created_at, updated_at

**backlinks** — id, source_type, source_id, target_type, target_id, created_at

**activity_feed** — id, org_id, actor_agent, action, entity_type, entity_id, summary, created_at

**vault_sync_log** — id, file_path, last_synced_at, content_hash, status

---

## MCP Server Spec

The platform exposes an MCP server. Claude Desktop, Claude Code, and Cowork connect to it.

### Read Tools

| Tool | Args | Returns |
|------|------|---------|
| `get_org` | — | Org overview, spaces list |
| `get_spaces` | — | All spaces + project counts |
| `get_projects` | space_id | Projects in a space |
| `get_items` | project_id, status? | Items, optionally filtered by swimlane |
| `get_wiki_pages` | query? | Search or list wiki pages |
| `get_activity_feed` | limit?, space_id? | Recent activity, filterable |
| `get_backlinks` | entity_type, entity_id | All backlinks for an entity |
| `search` | query | Semantic search across all content (pgvector) |

### Write Tools

| Tool | Args | Effect |
|------|------|--------|
| `create_item` | project_id, type, title, content, status | New item, logged to activity feed |
| `update_item` | item_id, fields | Update any item field |
| `move_item_status` | item_id, new_status | Move a kanban card |
| `create_wiki_page` | title, content | New wiki page, auto-generates backlinks |
| `update_wiki_page` | page_id, content | Update wiki page content |
| `add_backlink` | source_type, source_id, target_type, target_id | Manual backlink creation |

All write operations log to the activity feed automatically (actor_agent = the Claude client that made the call).

---

## Vault Sync Architecture

### How It Works

A lightweight Node.js process runs locally and watches the vault for changes.

1. **File watcher** (chokidar) monitors `/Users/keeganlamar/Documents/ViaOps` for any `.md` file change
2. On change: hash the file, compare to last-synced hash in `vault_sync_log`
3. On diff: parse markdown (frontmatter + body), map to platform data model, push via platform REST API
4. Log sync result to `vault_sync_log`

### Vault → Platform Mapping

| Vault path | Maps to |
|-----------|---------|
| `Clients/[Name]/_Overview.md` | Space overview + wiki page |
| `Clients/[Name]/_Tasks.md` | Items in the client's project (status inferred from `[ ]` / `[x]`) |
| `Clients/[Name]/Meetings/*.md` | Activity log entries + linked items |
| `SimHouse.io/*.md` | SimHouse space |
| `Pipeline/*.md` | Wiki pages (tagged: pipeline) |
| `Knowledge/**/*.md` | Wiki pages |
| `Dashboard/Daily Notes/*.md` | Activity log entries |
| `Meetings/*.md` | Activity log entries |

### Future: Bidirectional Sync

When platform writes need to flow back to local:
- Platform write → webhook fires → local sync agent receives diff → applies to vault file
- Conflict detection: hash comparison; if both sides changed, flag for manual resolution
- Triggered by: heavy mobile use, team collaboration

---

## UI — Key Views

All views use shadcn/ui components. Dark mode supported from day one.

### Global Layout
- **Left sidebar:** Org name → Spaces list → Wiki
- **Top bar:** Activity feed indicator, built-in Claude chat toggle, search
- **Main area:** Context-dependent view

### Space View
- Grid of project cards (name, item count by status, last activity)
- Space-level wiki pages listed below

### Project View — Kanban (MVP)
- 6 columns: Backlog | Not Started | Research/Planning | In Progress | Review | Completed
- Cards show: title, type badge, last updated, agent that last touched it
- Drag-and-drop to move cards
- AI can move cards via `move_item_status` MCP tool
- Quick-add card button at top of each column
- Inline AI: "Add 5 tasks for this project" → AI creates them via MCP

### Wiki View
- Left: page directory (hierarchical)
- Center: page content (markdown rendered)
- Right: backlinks panel — all pages/items linking to this page
- AI-suggested backlinks surface as inline prompts ("Link to Client Brief?")

### Activity Feed
- Global feed across all spaces
- Filterable by: space, agent, action type, date range
- Each entry: agent name | action | entity | timestamp | one-line summary
- Color-coded by agent (Cowork, Code, Desktop, Claude interface)

### Built-in Claude Interface
- Slide-out panel (right side, toggleable)
- Full context: current org, space, project, recent activity
- All external tools accessible via Composio (Gmail, Calendar, Drive, LinkedIn, Discord, QuickBooks, Granola, and more)
- Uses Keegan's Anthropic API key (claude-sonnet-4-6 default)

---

## Build Phases

### Phase 0 — Foundation (Week 1–2) — ✅ Shipped 2026-04-29
- [x] Next.js 15 + Neon + Clerk scaffold on Vercel *(used Next 16, see [[Shared Brain/Decisions#ADR-003]])*
- [x] Database schema + migrations (all tables above)
- [x] shadcn/ui layout: sidebar, top bar, main area shell
- [x] Auth (Clerk, single user)
- [x] Basic org/space/project/item CRUD via API routes

### Phase 1 — MCP Server (Week 2–3) — ✅ Shipped 2026-04-30
- [x] MCP server scaffold (TypeScript, @modelcontextprotocol/sdk + mcp-handler — see [[Shared Brain/Decisions#ADR-005]])
- [x] All read tools implemented and tested
- [x] All write tools implemented and tested *(plus `create_space` and `create_project` added beyond spec — see [[Shared Brain/Decisions#ADR-008]])*
- [x] Connect Claude Desktop to platform via MCP *(via mcp-remote stdio bridge)*
- [x] **Exit criterion met:** Claude Desktop created the "My Electric Home" space via MCP with auto-logged activity feed entry

### Phase 2 — Vault Sync Agent (Week 3–4) — ✅ Shipped 2026-04-30
- [x] chokidar file watcher setup
- [x] Markdown parser (frontmatter + body) *(plus `[ ]` / `[x]` task extraction for `_Tasks.md` files)*
- [x] Vault → platform mapping logic *(per spec table; see [[Shared Brain/Decisions#ADR-010]] for upsert dispatch)*
- [x] Sync status logging *(via `vault_sync_log` table; queryable through `GET /api/sync/log`)*
- [x] **Exit criterion met:** dry-run mapped 402 of 435 vault markdown files cleanly with zero errors; real sync gated on user confirmation to avoid an unintended bulk write

### Phase 3 — Kanban UI (Week 4–5) — ✅ Shipped 2026-04-30
- [x] Project kanban view (6 swimlanes, shadcn cards)
- [x] Drag-and-drop (dnd-kit)
- [x] Card detail view *(slide-out drawer instead of modal — see [[Shared Brain/Build Log#Phase 3 — Kanban UI]] divergence note)*
- [x] AI-triggered status updates via MCP reflected in real time *(via 3s polling — see [[Shared Brain/Decisions#ADR-012]] for the polling-vs-SSE choice)*

### Phase 4 — Wiki + Backlinks (Week 5–6) — split into 4a (✅ Shipped 2026-04-30) and 4b (queued)
- [x] Wiki page view + directory *(Phase 2 + tree view post-Phase 2)*
- [x] Markdown renderer *(react-markdown + remark-gfm; inline `[[wikilink]]` resolution shipped in 4a)*
- [x] **Backlink engine — Phase 4a** *(deterministic edges: explicit_link, frontmatter_related, tag_overlap, folder_sibling, semantic_similar, hierarchy. Phase 4b adds keyword_overlap, co_mention, ai_suggested via background cron — see [[Shared Brain/Decisions#ADR-013]])*
- [x] Wiki sync from vault (`Knowledge/` + `Pipeline/` folders) *(Phase 2)*

### Phase 5 — Activity Feed + Built-in Claude (Week 6–7) — ✅ Shipped 2026-05-01
- [x] Activity feed (global + per-space, filterable) — Phase 5a
- [x] Built-in Claude chat panel (Vercel AI SDK v6) — Phase 5b
- [x] Composio wired into built-in Claude interface — Phase 5c (universal MCP endpoint, ADR-020; token-efficiency optimizations, ADR-021)
- ❌ ~~Live artifact rendering~~ — dropped (ADR-022). Valuable subset (link previews, action confirmations) already covered by `[[wikilink]]` rendering and tool pills.
- [x] **Exit criterion met:** Can ask "what's on my plate for XP Flow this week?" from inside the platform and get a real answer.

---

### Phase 6 — Agent Operating Instructions (next)
**Goal:** Every Claude agent that connects to Shared Brain via MCP reads a standardized operating-instructions block at session start and is given tools to record what it did.

- [ ] User Profile wiki page (`Profile.md`) — preferences, brand context, work style, common workflows
- [ ] MCP tool `get_operating_instructions` — returns merged user profile + standing instructions
- [ ] MCP tool `record_session_summary({ summary, project?, related_items? })` — appends to activity feed + creates session-note wiki page
- [ ] CLI install script `shared-brain --install-skill claude` — drops a skill file into Claude Desktop / Code / Cowork pointing at the live operating-instructions endpoint
- [ ] **Exit criterion:** Activity feed shows session-summary entries auto-landing as Claude agents finish work, without the user remembering to ask.

See ADR-023 for the architecture rationale (three-layer drift defense: standing instructions + auto-capture + drift detection).

---

### Phase F4 — Bidirectional Ingestion (after Phase 6)
**Goal:** Expand the brain's input surface (auto-pull from external sources) AND keep the local Obsidian vault as a complete mirror of platform-originated entries.

- [ ] **F4a:** Composio Drive watcher — auto-pull new files from connected Drives into the brain
- [ ] **F4b:** Gmail attachment auto-ingest — important emails with attachments → wiki entries
- [ ] **F4c:** Manual upload UI in the platform
- [ ] **F4d (NEW per ADR-024):** Vault pull-down — local agent gets a sync feed and materializes platform-created entries as markdown into the vault, so Obsidian stays a complete local mirror
- [ ] **Exit criterion:** Working from any surface (chat, mobile, another user) creates entries that propagate to your local Obsidian vault automatically.

---

### Phase 7 — Mobile via Claude (after F4)
**Goal:** Claude.ai mobile + Shared Brain remote MCP becomes the on-the-go interface. No native app, no PWA.

- [ ] Workflow tool `compose_invoice({ client, items?, send_to? })` — composes pulling client + applying template + emailing
- [ ] Workflow tool `compose_proposal({ client, template_name? })`
- [ ] Workflow tool `log_thought({ text, project? })` — quick capture
- [ ] Workflow tool `find_last_context({ person_or_company })` — searches emails + meeting notes + brain
- [ ] Workflow tool `file_document({ source, hint? })` — accepts a file (upload, URL, or email-attachment ref), runs the existing F1/F2/F3 extraction pipeline, uses operating instructions + active state to auto-classify the right vault location, applies tags + frontmatter. Inherits the dropped F4c capability and adds AI-driven filing. Mobile-first.
- [ ] User profile (Phase 6) feeds workflow defaults — invoice template style, tone, brand
- [ ] Workflow tools return brief confirmations + entity links (mobile-friendly response shape)
- [ ] **Exit criterion:** "Generate a new XPFlow invoice and send it to Mark, Deanna, Matt" from phone → one prompt → one MCP roundtrip → done.

See ADR-025 for why no native app.

---

### Phase 4b — Background AI Edges (parallel; can ship anytime)
**Goal:** Connection graph keeps getting smarter on a cron schedule.

- [ ] Cron job — keyword overlap edge extraction
- [ ] Cron job — AI-suggested connections (model proposes related entities)
- [ ] **Exit criterion:** Connection panel surfaces non-obvious related entries that weren't explicitly linked.

---

### Phase 8 — Multi-user readiness (PARKED)
Triggered when there's a second real user or company onboarding. Scope: per-user Clerk accounts, per-user Composio consumer keys, org-scoped data isolation, per-user operating instructions.

---

## ViaOps Service Tiers

### Tier 1 — Shared Brain (Full Platform)
The full build described in this spec. For individuals with deep workflows and for companies needing team-wide AI coordination. Keegan's vault build is the proof of concept.

**Who it's for:** Power users, consultants, small teams, companies doing AI implementation.
**Pricing model (TBD):** Setup fee ($2,500–5,000) + monthly retainer for maintenance and updates.

### Tier 2 — Shared Brain Lite (Artifact-Based)
A lighter-weight version for individuals who don't need a full platform. Built on top of a Claude Project with good global instructions, Composio MCP connections, and a set of live artifacts as their "dashboard" — no platform infrastructure required.

**What it includes:**
- Claude Project configured with client's context, priorities, and working style
- Composio wired up for the tools they already use (email, calendar, drive, etc.)
- 2–4 live artifacts as persistent dashboards (e.g., project status board, weekly priority view, pipeline tracker) — these are interactive HTML views that pull from connected tools each time they open
- No vault sync, no MCP server, no web app to maintain

**Who it's for:** Individuals who live in Claude and want better structure and visibility without a full platform build. Great entry point for people who might eventually upgrade to the full Shared Brain.
**Pricing model (TBD):** Setup fee ($500–1,500) + optional light monthly retainer.

**Key distinction:** Artifacts are the UI surface only — they don't store data, they fetch it fresh from connected tools on open. This works well for individuals; it breaks down for teams (no shared state, no persistent writes, no activity feed).

---

## Open Decisions

All open decisions resolved as of 2026-04-29:

- [x] **Real-time strategy** → SSE (Server-Sent Events). Simple one-way server → browser push. Right for solo MVP; upgrade to Vercel KV pub/sub when team members are added.
- [x] **Sync agent deployment** → Mac launchd service. Always-on background daemon watching the vault.
- [x] **Semantic search model** → OpenAI `text-embedding-3-small`. Fast, cheap, good enough for vault-scale content.
- [x] **Product name** → **Shared Brain**. Internal working name and ViaOps service offering name.
- [x] **External connector strategy** → Composio only. Single MCP connector covers all external tools (Gmail, Calendar, Drive, LinkedIn, Discord, QuickBooks, Granola). No separate Granola MCP needed.

---

## Related Files

- [[AI-Native PM Platform Vision]] — original concept and thesis
- [[Richard Lackey/Richard Lackey]] — potential co-venture partner, flagged as interested
- [[Knowledge/AI Research/ViaOps Mobile Assistant Architecture]] — mobile access layer (future)
