---
title: Shared Brain — Vault Reorganization Plan
created: 2026-04-30
updated: 2026-04-30
status: decisions-locked
tags: [viaops-internal, shared-brain, vault, reorg]
related: "[[AI-Native PM Platform - MVP Spec]]"
---

# Shared Brain — Vault Reorganization Plan

> **Status:** Audit + decisions complete 2026-04-30. Phase A cleanups
> executed (Archive deleted, stale plugin removed, root plugins moved
> into `Plugins/`). Phase B (Jason Webb folder, ViaOps Assistant
> consolidation, root `docs/`, `viaops-website/` local code clone)
> awaiting final go.

## ✅ Decisions locked

### Final platform space hierarchy
- **ViaOps Internal** (team) — internal umbrella
  - Project: **Shared Brain — AI PM Platform**
  - Project: **ViaOps Website Redesign**
- **SimHouse** (team)
  - Project: **PEAK Golf — Platform Instance**
  - Project: **SwingBays — Platform Instance**
- **Coaching** (dept) — *changed from team to dept per Keegan*
  - Project: **Emma Thyne — Coaching Engagement**
  - Project: **Nicole Brait — Coaching Engagement**
- **My Electric Home** (client)
- **Trade Oracle** (client)
- **XP Flow** (client)
  - Project: **Staff AI Builds**
    - Task: **Dustin Howes — AI Build** (in_progress)
    - Task: **Mark Abrams — XP Flow EA** (in_progress)
    - Task: **Jake Leskovar — AI Build** (backlog)

### Open question answers
| # | Question | Decision |
|---|---|---|
| 1 | Website folder | **Move to GitHub-only.** Repo already exists at `keegan-pixel/ViaOps-Website` (clean, in sync). Local code clone gets deleted; the three summary `.md` files stay in vault under `Website/`. |
| 2 | Dashboard/Daily Notes | **Local-only.** (Default kept.) |
| 3 | Meetings folder | **Centralized + tagged per client.** |
| 4 | LinkedIn folder | **Sync to platform.** |
| 5 | Coaching space type | **`dept`.** |
| 6 | Website Redesign scope | **Project under ViaOps Internal**, not its own space. |
| 7 | Client project structure | **One project per "build type" with tasks per build.** XP Flow → "Staff AI Builds" → tasks per person. Same pattern for clients with multiple builds. |

> **Related:**
> - [[AI-Native PM Platform - MVP Spec]] — overall plan
> - [[Build Log]] — current phase progress
> - [[Decisions]] — architectural choices

---

## Executive Summary

The vault is well-organized and intentional. It maps cleanly to the Shared Brain hierarchy with strategic grouping of spaces around business units (clients, internal projects, coaching, partnerships). Main reorganization opportunities: consolidating overlapping AI-config folders, clarifying the scope of a few large folders (Website, Projects), and establishing clean rules for meetings/daily notes. **No major restructuring required.**

---

## 1. Top-Level Folder Inventory

| Folder | Files | Current Purpose | Recommended Disposition |
|--------|-------|-----------------|------------------------|
| **Clients** | 143 | Active ViaOps client folders (My Electric Home, Trade Oracle, XP Flow) + stale Jason Webb | Space per client (3 real clients) |
| **Coaching** | 22 | Coaching practice (Emma Thyne, Nicole Brait clients + concepts/resources) | Space (Team) for Coaching |
| **Projects** | ~39K | Mostly shared-brain repo (37k files); also 1 other project | Stay in Projects; shared-brain is a real codebase |
| **SimHouse.io** | 38 | Platform build with PEAK Golf & SwingBays launch clients | Space (Team) for SimHouse |
| **Website** | ~17K | Framer redesign + antigravity repo (entire viaops-website folder) | Space (Team) — ViaOps Website Redesign |
| **Knowledge** | 183 | AI research, frameworks, templates, guides, scripts | Platform Wiki (not a space) |
| **Meetings** | 99 | Timestamped meeting notes across all projects | Activity/tags only; not a space |
| **Pipeline** | 67 | CRM: 50+ contact cards (Rolodex) | Wiki entries (one per person/company) |
| **Partners** | 1 | Kolossus partnership notes | Wiki entry for Kolossus |
| **LinkedIn** | 7 | Content library organized by theme | Wiki or stays local (lower priority) |
| **Dashboard** | 33 | Daily Notes folder + Home.md mission control | Local-only (Obsidian activity tracking) |
| **Admin** | 11 | Setup guides, vault audit, config docs | Local-only or deletable |
| **Archive** | 12 | Old client/pipeline docs marked archived | Deletable (stale, already marked) |
| **ViaOps Assistant** | 15 | Claude Code project folder + duplicate skills | Local-only (Claude integration) |
| **Assistant** | 2 | Personal assistant README + CLAUDE.md | Local-only (Claude integration) |
| **Skills** | 14 | Compiled .skill files for Claude workflows | Local-only (Claude integration) |
| **Plugins** | 3,901 | Node modules, plugin dependencies (mostly bloat) | Local-only; consider .gitignore or cleanup |
| **docs** | 1 | Next.js app documentation | Local-only; likely belongs inside shared-brain repo |
| **Personal** | 1 | README only; placeholder for personal notes | Local-only (non-shared) |
| `eod-wrap.plugin` (root) | — | Binary plugin file (duplicate in Plugins/) | Delete root copy; keep in Plugins/ |
| `vault-tools.plugin` (root) | — | Binary plugin file | Move to `Plugins/` |
| `vault-update.plugin` (root) | — | Binary plugin file | Move to `Plugins/` |

---

## 2. Proposed Shared Brain Hierarchy

```
ViaOps (Organization)

├── SPACES — Clients
│   ├── My Electric Home (type: client)
│   ├── Trade Oracle (type: client)
│   └── XP Flow (type: client)
│       ├── Project: Dustin Howes — AI Build
│       ├── Project: Mark Abrams — XP Flow EA
│       └── Project: [Individual builds as added]
│
├── SPACES — Internal
│   ├── ViaOps Internal (type: team)
│   │   └── Project: Shared Brain — AI PM Platform
│   ├── SimHouse.io (type: team)
│   │   ├── Project: PEAK Golf — Platform Instance & Migration
│   │   └── Project: SwingBays — Platform Instance & Franchise Ops
│   ├── ViaOps Website Redesign (type: team)
│   │   └── Project: [Framer + Antigravity redesign]
│   └── Coaching (type: team)
│       ├── Project: Emma Thyne — Coaching Engagement
│       └── Project: Nicole Brait — Coaching Engagement
│
├── WIKI — Cross-cutting Knowledge
│   ├── AI Corner & Research
│   ├── Frameworks & Methodologies
│   ├── Agent Builder
│   ├── Guides & Operations
│   ├── Templates
│   ├── People & Partnerships  ← Pipeline + Partners flatten in here
│   ├── Content & Thought Leadership  ← LinkedIn
│   └── Personal (non-shared)
│
└── ACTIVITY — Local-only tracking
    ├── Dashboard/Daily Notes
    ├── Meetings/ (centralized; tagged by space)
    └── Admin/ (config docs)
```

---

## 3. Proposed Wiki Top-Level Categories

The current `Knowledge/` structure is already strong. Recommend these top-level categories for the platform Wiki:

1. **AI Corner & Research** — Tools, models, vendors, articles, RAG patterns. (Combine `AI Corner/` + `AI Research/`.)
2. **Frameworks & Methodologies** — Consulting approaches, client engagement models, ViaOps methodologies.
3. **Agent Builder** — Architecture patterns, prompt design, deployment.
4. **Guides & Operations** — Setup, how-tos, troubleshooting, best practices.
5. **Templates** — Reusable note templates for clients, meetings, engagements.
6. **People & Partnerships** — One wiki page per contact, vendor, or partner. (Pipeline + Partners.)
7. **Content & Thought Leadership** — LinkedIn posts, articles, essays organized by theme.
8. **Personal** — Non-shared life notes, stays at vault level only.

---

## 4. Move-List & Safety Assessment

### Clearly safe — high confidence

- **Delete** `Archive/` — contents already marked archived, low value
- **Delete or archive** `Clients/Jason Webb — Solomon's Edge/` — not a real client
- **Local-only or delete** `Admin/` — setup docs, not mission-critical
- **Delete** `eod-wrap.plugin` (root) — duplicate of `Plugins/eod-wrap.plugin`
- **Move into `Plugins/`** — `vault-tools.plugin` and `vault-update.plugin` from the root
- **Move into `Projects/shared-brain/docs/` (or delete)** — root-level `docs/` folder
- **Local-only** `Plugins/node_modules/` — gitignore-equivalent treatment in vault sync (already excluded)

### Needs confirmation — open questions

- **Dashboard/Daily Notes** → local-only or platform activity? (Recommend local-only.)
- **Meetings folder** → centralized + tagged or split per client? (Recommend centralized + tags.)
- **Website folder (~17K files)** → stay in vault or move to GitHub-only? (Recommend GitHub-only — the Next.js repo bloats the vault.)
- **LinkedIn folder** → sync-worthy or local? (Recommend local for now.)

---

## 5. Cross-Cutting Recommendations

**Pipeline → Wiki, not Space.** Each person/company becomes a single wiki page with metadata. One-way relationships, easy cross-linking with client pages, no project overhead.

**Partners → Wiki entries, promote later.** Currently only Kolossus. If a partner becomes a billable engagement, promote to Space + Project at that time.

**Personal → stays local-only.** Privacy/context preserved; not exposed to platform.

**Meetings unified rule:**
- `Meetings/` (centralized) — timestamped, searchable, tagged by attendee/space
- `Dashboard/Daily Notes/` — local-only personal log
- `Clients/.../Meetings/` — symlink/reference back to centralized to avoid duplication
- Platform sync: only centralized `Meetings/` → tagged Activity in each space

**Skills + Plugins + ViaOps Assistant + Assistant consolidation:**
1. Keep `Assistant/` as the canonical Cowork project entry point
2. **Archive or delete `ViaOps Assistant/`** — appears to be an older shadow copy
3. Keep `Skills/` as the skill library (eventually sync with platform skill repository)
4. Keep `Plugins/` but treat `node_modules/` as gitignore-equivalent
5. Consolidate root-level `.plugin` files into `Plugins/`

**ViaOps Vault Map** — not found in audit. If it exists, delete; the platform now provides hierarchy + search.

---

## 6. Things to Delete or Archive

| Item | Reason | Safety |
|------|--------|--------|
| `Archive/` (entire folder) | Contents already marked stale | Safe — designated archive |
| `Clients/Jason Webb — Solomon's Edge/` | Not a real client | Safe — confirmed |
| `Admin/` (entire folder) | Setup docs, not mission-critical | Safe long-term |
| `eod-wrap.plugin` (root) | Duplicate of one in `Plugins/` | Safe — clear duplicate |
| `docs/app/...` (root level) | Belongs in shared-brain repo | Safe; already mirrored |
| `ViaOps Assistant/` | Appears to be shadow copy of `Assistant/` | Needs Keegan's confirm |
| `ViaOps Vault Map` (if exists) | Local nav metadata; redundant | Safe |

---

## 7. Original open questions — RESOLVED

All seven open questions have been answered (see "Decisions locked" at
the top of this file). This section preserved as a record of the
resolution.

---

## 8. Execution status

### ✅ Phase A — done 2026-04-30
- Deleted `Archive/` (12 stale files, 196K)
- Deleted root `eod-wrap.plugin` (older duplicate, Apr 11; kept newer
  Apr 17 version in `Plugins/`)
- Moved `vault-tools.plugin` and `vault-update.plugin` from root to
  `Plugins/`
- Platform spaces + projects + tasks created via MCP to match the final
  structure (see "Decisions locked")

### ⏸ Phase B — awaiting final confirmation
- `Clients/Jason Webb — Solomon's Edge/` — not a real client; recategorize
  to Pipeline wiki entry then delete folder
- `ViaOps Assistant/` — appears to be a shadow copy of `Assistant/`;
  archive or delete after confirming nothing important is uniquely there
- Root `docs/` folder — vestigial; either delete or move into the
  shared-brain repo
- `Website/viaops-website/` — large local code clone (~17K files); already
  fully in sync with `keegan-pixel/ViaOps-Website` on GitHub; safe to
  delete locally. The three summary `.md` files at `Website/` root level
  (`PROJECT_LOG.md`, `VIAOPS_PROJECT_HANDOFF.md`,
  `ViaOps Website Redesign Plan.md`) stay.

### Phase C — once Phase B is clean
- Run full vault sync (`npm run sync:once`) to populate the platform
- Re-run `npm run backfill:connections` to rebuild edges across the
  newly-synced content
- Phase 5 work (activity feed UI + built-in Claude chat) starts
