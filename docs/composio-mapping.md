---
title: Shared Brain — Composio Connection Mapping
created: 2026-05-01
updated: 2026-05-01
status: living-document
tags: [viaops-internal, shared-brain, composio, integrations, routing]
related: "[[AI-Native PM Platform - MVP Spec]]"
---

# Shared Brain — Composio Connection Mapping

> **Purpose:** Routing index for Claude (in-platform chat, Cowork, Code,
> Desktop) so it knows which Composio account to target for each task.
> Without this, Claude defaults to the first connected account per
> toolkit and can't disambiguate when you say "send from my SimHouse
> address" or "check the ChiefofChaos calendar."
>
> **Refresh cadence:** any time you connect or remove a Composio account.
> The Shared Brain platform also re-syncs this doc into its wiki on
> every vault sync, so the in-platform Claude always has the latest map.

> **Related:**
> - [[AI-Native PM Platform - MVP Spec]] — overall plan
> - [[Build Log]] — phase progress (Composio integration = Phase 5c)
> - [[Decisions]] — architectural decisions
> - [[Runbook]] — ops procedures
> - [[../../AI Research/Composio]] — generic knowledge about Composio

---

## Quick summary

**7 toolkits active · 19 connected accounts total.**

> **Routing default for Claude:** when the user's request doesn't specify
> an account, prefer `keegan@viaops.co` for any Google service. Composio's
> own `is_default` flag (currently set to SwingBays for Gmail+Calendar
> and SimHouse for Drive) is irrelevant for the in-platform chat — Claude
> follows the rules in this doc, not Composio's UI default.

| Toolkit | Status | # accounts | Claude routing default | Composio `is_default` |
|---|---|---|---|---|
| `gmail` | ✅ Active | 6 | **`keegan@viaops.co`** | `keegan@theswingbays.com` |
| `googlecalendar` | ✅ Active | 6 | **`keegan@viaops.co`** | `keegan@theswingbays.com` |
| `googledrive` | ✅ Active | 4 | **`keegan@viaops.co`** | `keegan@simhouse.io` |
| `notion` | ✅ Active | 1 | XPFlow workspace | XPFlow |
| `linkedin` | ✅ Active | 1 | k.lamar59@gmail.com | k.lamar59@gmail.com |
| `discord` | ✅ Active | 1 | keegan5333 | keegan5333 |
| `quickbooks` | ✅ Active | 1 | keegan@lamarcoaching.com | keegan@lamarcoaching.com |

**Not connected** (toolkit known to Composio but no auth done):
`googledocs`, `googlesheets`, `slack`, `github`, `outlook`, `googlemeet`,
`fireflies`, `granola`, `hubspot`, `linear`.

These are intentionally not in scope for the current Shared Brain
build — only the 7 active toolkits above are wired into the chat.
Add them to Composio when needed and re-run the mapping update
procedure at the bottom of this doc; the platform picks them up
automatically.

---

## Per-toolkit detail

### Gmail (6 accounts)

| Account ID | Email | Role / context | Volume |
|---|---|---|---|
| `gmail_berret-drinn` ★ | `keegan@viaops.co` | **ViaOps internal — primary work address** | 217 messages |
| `gmail_sorage-wavira` | `keegan@chiefofchaos.com` | XP Flow / Chief of Chaos work | 633 messages |
| `gmail_rubine-smell` | `keegan@simhouse.io` | SimHouse internal | 106 messages |
| `gmail_casper-nerium` | `keegan@lamarcoaching.com` | Coaching practice; QuickBooks billing | 46,102 messages |
| `gmail_theek-rush` | `k.lamar59@gmail.com` | Personal | 84,155 messages |
| `gmail_shady-beday` | `keegan@theswingbays.com` | SwingBays — rarely used | 2 messages |

★ Claude's preferred default. Composio's own `is_default` is set to
`gmail_shady-beday` (SwingBays) — irrelevant for this chat; Claude
follows the rules below.

**Routing rules for Claude:**
- **Default / unspecified / "send an email"** → `gmail_berret-drinn` (ViaOps)
- "From SimHouse" → `gmail_rubine-smell`
- "Coaching client" / "Lamar Coaching" → `gmail_casper-nerium`
- "Chief of Chaos" / "XP Flow company" → `gmail_sorage-wavira`
- "SwingBays" → `gmail_shady-beday` (rarely)
- "Personal" → `gmail_theek-rush`

---

### Google Calendar (6 accounts)

| Account ID | Calendar | Notes |
|---|---|---|
| `googlecalendar_finn-septa` ★ | `keegan@viaops.co` | **ViaOps internal — primary work calendar** |
| `googlecalendar_bowls-gandum` | `keegan@chiefofchaos.com` | XP Flow / CoC. **Also reads** `matt@chiefofchaos.com`, `patti@chiefofchaos.com` |
| `googlecalendar_whole-scrim` | `keegan@simhouse.io` | SimHouse |
| `googlecalendar_suave-saco` | `keegan@lamarcoaching.com` | Coaching |
| `googlecalendar_servet-yaya` | `keegan@theswingbays.com` | SwingBays — rarely used |
| `googlecalendar_prof-enlife` | `k.lamar59@gmail.com` | Personal |

★ Claude's preferred default. Composio's own `is_default` is set to
`googlecalendar_servet-yaya` (SwingBays) — irrelevant for this chat.

**Routing rules for Claude:** same context map as Gmail above
(default → ViaOps; brand-specific keywords pick a different
calendar).

**Cross-calendar visibility:** the CoC calendar account (`bowls-gandum`)
has read access to Matt Frary's and Patti's calendars — useful for
"when is Matt free" queries without needing direct access.

---

### Google Drive (4 accounts)

| Account ID | Email | Workspace |
|---|---|---|
| `googledrive_tilaka-actian` ★ | `keegan@viaops.co` | **viaops.co domain — primary work Drive** |
| `googledrive_ahmed-charry` | `keegan@chiefofchaos.com` | chiefofchaos.com domain |
| `googledrive_thilly-backet` | `keegan@simhouse.io` | simhouse.io domain |
| `googledrive_tigger-robe` | `keegan@lamarcoaching.com` | lamarcoaching.com domain |

★ Claude's preferred default. Composio's own `is_default` is set to
`googledrive_thilly-backet` (SimHouse) — irrelevant for this chat.

---

### Notion (1 account)

| Account ID | Workspace | Owner |
|---|---|---|
| `notion_erick-immix` ★ | `XPFlow` | `keegan@viaops.co` |

> Note: this is the **XPFlow** Notion workspace, not a personal
> Notion. ViaOps internal docs all live in the local Obsidian vault
> (synced to Shared Brain), so Notion access is mostly for
> viewing/editing client work that already lives in XPFlow Notion.

---

### LinkedIn (1 account)

| Account ID | Profile | Email of record |
|---|---|---|
| `linkedin_shiny-arigue` ★ | Keegan LaMar | `k.lamar59@gmail.com` |

---

### Discord (1 account)

| Account ID | Username | Email of record |
|---|---|---|
| `discord_ethine-acarus` ★ | `keegan5333` | `keegan@kadconsulting.it` |

> Composio's Discord toolkit covers the standalone MCP server we
> previously had at `Plugins/discord-mcp-server/` (deleted in the vault
> reorg — superseded by this Composio connection).

---

### QuickBooks (1 account)

| Account ID | Realm | Owner |
|---|---|---|
| `quickbooks_frail-album` ★ | Lamar Coaching | `keegan@lamarcoaching.com` |

> Used for invoicing and bookkeeping for the coaching practice. Other
> business entities (ViaOps, SimHouse) bill separately and are not in
> QuickBooks (yet).

---

## How to refresh this mapping

Either ask the platform Claude:

> "Update the Composio mapping — list all my connected accounts and
> save the new state to `Composio Mapping.md`."

(Phase 5c shipped — the platform Claude has Composio MCP access and
can do this in-place.)

Or manually:

1. From Claude Desktop or Cowork, ask:
   > "List all my Composio connections via `COMPOSIO_MANAGE_CONNECTIONS`
   > with `action: list` for `gmail, googlecalendar, googledrive,
   > googledocs, googlesheets, slack, notion, linkedin, discord,
   > github, outlook, googlemeet, fireflies, granola, quickbooks,
   > hubspot, linear`."
2. Diff the JSON it returns against this doc's tables.
3. Update the tables. Set `updated:` in the frontmatter to today.
4. Commit (or just save — vault sync mirrors to platform automatically).

## How Composio is wired into the platform (Phase 5c)

The in-platform chat connects to a single **Composio MCP URL**
(`COMPOSIO_MCP_URL` env var). That URL is scoped to your Composio user
and bundles every toolkit + connection in one feed — no per-connection
user IDs needed. The chat lists tools at cold start (5-min TTL cache)
and can:

- Read and send Gmail across all 6 accounts
- Check / create / edit calendar events across all 6 calendars
- Read / write to all 4 Google Drives
- Update Notion pages in the XPFlow workspace
- Post to LinkedIn, Discord, QuickBooks

Code paths:
- `src/lib/chat/composio-tools.ts` — opens an MCP client with
  `@modelcontextprotocol/sdk`'s `StreamableHTTPClientTransport`,
  lists tools, and adapts each one into an AI SDK `dynamicTool`.
- `src/app/api/chat/route.ts` — merges Composio tools with platform
  tools and passes both to `streamText`.

The system prompt includes a compressed version of the routing rules
above so Claude picks the right account without being told each time,
and points to this wiki page for full account IDs.

---

## Open work

- [ ] **(Optional) Update Composio dashboard defaults** to match the
      Claude routing defaults above (ViaOps for Gmail / Calendar /
      Drive). The chat works either way; this only affects external
      integrations or batch jobs that don't go through Claude.
- [ ] **Future: connect more toolkits as needed** — Slack, Granola,
      Fireflies, SwingBays Drive, etc. Out of scope for the current
      build; pick up when a real workflow demands them.
