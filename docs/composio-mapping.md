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

| Toolkit | Status | # accounts | Default account |
|---|---|---|---|
| `gmail` | ✅ Active | 6 | `keegan@theswingbays.com` |
| `googlecalendar` | ✅ Active | 6 | `keegan@theswingbays.com` |
| `googledrive` | ✅ Active | 4 | `keegan@simhouse.io` |
| `notion` | ✅ Active | 1 | `XPFlow` workspace |
| `linkedin` | ✅ Active | 1 | `k.lamar59@gmail.com` |
| `discord` | ✅ Active | 1 | `keegan5333` |
| `quickbooks` | ✅ Active | 1 | `keegan@lamarcoaching.com` |

**Not connected** (toolkit known to Composio but no auth done):
`googledocs`, `googlesheets`, `slack`, `github`, `outlook`, `googlemeet`,
`fireflies`, `granola`, `hubspot`, `linear`.

> Slack and Granola are conspicuously missing — both are in the
> `Knowledge/AI Research/Composio.md` "key integrations" list. If
> they're meant to be active, walk through the Composio dashboard to
> connect them, then re-run the mapping update procedure at the bottom
> of this doc.

---

## Per-toolkit detail

### Gmail (6 accounts)

| Account ID | Email | Role / context | Volume |
|---|---|---|---|
| `gmail_shady-beday` ★ | `keegan@theswingbays.com` | SwingBays — SimHouse client launch | 2 messages |
| `gmail_sorage-wavira` | `keegan@chiefofchaos.com` | XP Flow / Chief of Chaos work | 633 messages |
| `gmail_rubine-smell` | `keegan@simhouse.io` | SimHouse internal | 106 messages |
| `gmail_casper-nerium` | `keegan@lamarcoaching.com` | Coaching practice; QuickBooks billing | 46,102 messages |
| `gmail_theek-rush` | `k.lamar59@gmail.com` | Personal | 84,155 messages |
| `gmail_berret-drinn` | `keegan@viaops.co` | ViaOps internal — primary work address | 217 messages |

★ default account — Composio uses this when no explicit account is specified.

**Routing rules for Claude:**
- "Send a ViaOps email" / "from my work address" → `gmail_berret-drinn`
- "From SimHouse" → `gmail_rubine-smell`
- "Coaching client" / "Lamar Coaching" → `gmail_casper-nerium`
- "Chief of Chaos" / "XP Flow company" → `gmail_sorage-wavira`
- "SwingBays" → `gmail_shady-beday`
- "Personal" → `gmail_theek-rush`

---

### Google Calendar (6 accounts)

| Account ID | Calendar | Notes |
|---|---|---|
| `googlecalendar_servet-yaya` ★ | `keegan@theswingbays.com` | SwingBays scheduling |
| `googlecalendar_bowls-gandum` | `keegan@chiefofchaos.com` | XP Flow / CoC. **Also reads** `matt@chiefofchaos.com`, `patti@chiefofchaos.com` |
| `googlecalendar_whole-scrim` | `keegan@simhouse.io` | SimHouse |
| `googlecalendar_suave-saco` | `keegan@lamarcoaching.com` | Coaching |
| `googlecalendar_finn-septa` | `keegan@viaops.co` | ViaOps internal |
| `googlecalendar_prof-enlife` | `k.lamar59@gmail.com` | Personal |

**Routing rules for Claude:** same context map as Gmail above.

**Cross-calendar visibility:** the CoC calendar account (`bowls-gandum`)
has read access to Matt Frary's and Patti's calendars — useful for
"when is Matt free" queries without needing direct access.

---

### Google Drive (4 accounts)

| Account ID | Email | Workspace |
|---|---|---|
| `googledrive_thilly-backet` ★ | `keegan@simhouse.io` | simhouse.io domain |
| `googledrive_ahmed-charry` | `keegan@chiefofchaos.com` | chiefofchaos.com domain |
| `googledrive_tigger-robe` | `keegan@lamarcoaching.com` | lamarcoaching.com domain |
| `googledrive_tilaka-actian` | `keegan@viaops.co` | viaops.co domain |

> Drive is the only Google service NOT also connected for SwingBays
> and personal. Add the SwingBays Drive if you start storing client
> docs in it.

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

(Once Phase 5c ships, the platform Claude has Composio MCP access and
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

When Phase 5c ships, the in-platform chat panel will load Composio
tools at chat-init time using the user's `COMPOSIO_API_KEY`. The chat
will be able to:

- Read and send Gmail across all 6 accounts
- Check / create / edit calendar events across all 6 calendars
- Read / write to all 4 Google Drives
- Update Notion pages in the XPFlow workspace
- Post to LinkedIn, Discord, QuickBooks

Code paths:
- `src/lib/chat/composio-tools.ts` — fetches tools per request via
  `@composio/core` SDK
- `src/app/api/chat/route.ts` — merges Composio tools with platform
  tools and passes both to `streamText`

The system prompt will include a compressed version of the routing
rules above so Claude picks the right account without being told each
time.

---

## Open work

- [ ] **Connect Slack workspaces.** ViaOps, SimHouse, XP Flow, CoC,
      Partnership Lounge, PMA, Digital Good — none are in Composio yet.
- [ ] **Connect Granola.** Cowork still uses the standalone Granola MCP
      from `claude_desktop_config.json` — moving to Composio would let
      cloud routines hit Granola too.
- [ ] **Connect Fireflies.** Matt Frary's primary meeting-notes system;
      Composio supports it.
- [ ] **Connect SwingBays Google Drive.** Currently the only Google
      service we have for SwingBays is Calendar + Gmail.
- [ ] **Decide on Outlook.** Some clients (or future) might use Outlook
      — connect when needed.
