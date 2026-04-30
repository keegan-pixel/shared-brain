---
title: Shared Brain — Vault Reorganization Plan
created: 2026-04-30
updated: 2026-04-30
status: proposal-awaiting-decision
tags: [viaops-internal, shared-brain, vault, reorg]
related: "[[AI-Native PM Platform - MVP Spec]]"
---

# Shared Brain — Vault Reorganization Plan

> **Status:** Proposal generated 2026-04-30 by audit pass over `~/Documents/ViaOps`. Keegan reviews → answers the open questions at the bottom → we execute the agreed-on file moves and the platform's Shared Brain folder structure mirrors the vault 1:1.

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

## 7. Open Questions for Keegan

1. **Website folder (~17K files)** — keep in vault, or move to GitHub-only?
2. **Dashboard/Daily Notes** — local-only personal log, or platform activity?
3. **Meetings folder** — centralized + tagged, or per-client subfolders?
4. **LinkedIn folder** — sync-worthy now, or local for now?
5. **Coaching Space type** — `team` or `dept`? (Recommend `team`.)
6. **Website Redesign scope** — single project under ViaOps Internal, or its own space? (Recommend own space if codebase stays in vault.)
7. **Client Project structure** — multiple projects per build (current `Clients/XP Flow/Dustin Howes — AI Build/`), or one "Client Builds" project with items per build? (Current is more granular; either works.)

---

## 8. Summary & Next Steps

**No major restructuring required.** Vault is intentional and maps well.

**Immediate actions (before platform full sync):**
1. Delete: `Archive/`, root plugin duplicates, `Clients/Jason Webb/`, root `docs/`
2. Decide: website folder placement, meetings centralization
3. Consolidate AI-config folders (remove `ViaOps Assistant/`, keep `Assistant/`)
4. Answer the 7 open questions above

**Once answered:** vault path structure → platform 1:1 mapping is straightforward. Meetings sync as Activity; `Knowledge/` subfolders become Wiki categories; `Clients/` + `Coaching/` + `SimHouse.io/` + `Website/` + `Projects/` become Spaces with Projects underneath.
