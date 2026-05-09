---
title: Phase 8 v2 — Multi-User + Onboarding Spec
created: 2026-05-09
updated: 2026-05-09
status: draft (under review)
tags: [viaops-internal, shared-brain, spec, phase-8-v2, onboarding, multi-user]
related: "[[Build Log]] [[Decisions]] [[Runbook]] [[AI-Native PM Platform - MVP Spec]]"
---

# Phase 8 v2 — Multi-User + Onboarding

> **Status:** Draft, awaiting Keegan's review.
> **Process:** Measure 3-4 times before cutting. No code until this is signed off.
> **Built on:** Phase 8 v1 (OAuth — ADR-034), Desktop migration (ADR-035), Binary storage discipline (ADR-036).

---

## Table of contents

0. [Executive summary](#0-executive-summary)
1. [North Star alignment](#1-north-star-alignment)
2. [Locked decisions](#2-locked-decisions)
3. [Data model](#3-data-model)
4. [Domain model](#4-domain-model)
5. [MCP surface changes](#5-mcp-surface-changes)
6. [Composio routing](#6-composio-routing)
7. [Local agent (daemon)](#7-local-agent-daemon)
8. [LLM API keys](#8-llm-api-keys)
9. [Onboarding flow](#9-onboarding-flow)
10. [Invitation flow](#10-invitation-flow)
11. [Profile.md hierarchy](#11-profilemd-hierarchy)
12. [Audit log UI](#12-audit-log-ui)
13. [Billing](#13-billing)
14. [Email notifications](#14-email-notifications)
15. [Support flow](#15-support-flow)
16. [Non-technical user docs](#16-non-technical-user-docs)
17. [Epics, features, user stories](#17-epics-features-user-stories)
18. [Test plan](#18-test-plan)
19. [Phased rollout within Phase 8 v2](#19-phased-rollout-within-phase-8-v2)
20. [Risk register](#20-risk-register)
21. [Backwards-compat plan](#21-backwards-compat-plan)
22. [Open questions](#22-open-questions)

---

## 0. Executive summary

**What we're building:** the multi-tenant data model + onboarding experience that lets ANY user — not just Keegan — self-serve onto Shared Brain in three modes: personal-only, joining an existing shared org, or creating a new team org. Each user can belong to multiple orgs simultaneously with selective routing of their Composio connections, local files, and synced content.

**Why now:** Phase 8 v1 (OAuth) shipped the connectivity that makes external AI clients usable. But the brain is still architecturally single-org — `ensureUserOrg()` hardcodes a 1:1 user-to-org assumption. To realize the brain-as-connectivity-layer thesis (ADR-026) for anyone other than Keegan, we need real multi-tenancy.

**Success criteria:**
1. Two new users can sign up, walk through onboarding, install the local daemon, connect Claude, and run an initial sync end-to-end without Keegan touching anything on the backend.
2. A user with multiple orgs (e.g., personal + shared-with-team) sees documents flow to the right places automatically based on configured routing — no per-document org selection at write time.
3. Existing single-org setup (Keegan's ViaOps data) migrates cleanly with no data loss and no AI-client reconnects required.
4. The spec is reviewed and signed off before any code lands.

**Non-goals (this phase):**
- Custom domains / subdomains — path-based routing only
- Item-level visibility within a space — space/project membership = full access to everything inside
- Dynamic Client Registration (RFC 7591) — pre-registered clients suffice for major AI platforms
- Detailed billing tier feature matrix — Stripe wiring + simple per-seat plan only
- Windows / Linux daemon installers — macOS only for v1

---

## 1. North Star alignment

Per ADR-026, **Shared Brain is a connectivity layer for project-management knowledge.** The competitive thesis: *"pick your AI platform of choice — it'll have your full working knowledge no matter where you are."*

Phase 8 v2 directly serves this thesis by extending it from "Keegan's working knowledge" to **"any user's or team's working knowledge."** The features in scope all map to this:

- **Multi-tenancy** — without it, only one human can have a brain. Defeats the connectivity thesis at scale.
- **Selective per-org routing** — a user is a whole person across multiple contexts (personal, work, side projects). The brain has to respect those boundaries the way the human does.
- **Onboarding wizard** — if every new user requires Keegan to configure their account, the platform is a service, not a product.
- **Local daemon installer** — the brain mirrors the user's local files. That requires a local component. If installing it is too friction-heavy, only engineers will use it.

What we're NOT building: AI features inside the platform. Per the North Star, the AI lives at the client (Claude/GPT/etc.), the brain is the substrate.

---

## 2. Locked decisions

These were settled in the planning conversation on 2026-05-09. Treat as constitutional for this phase.

| # | Decision | Rationale |
|---|---|---|
| 1 | **Multi-org token model: Venn diagram via doc-org membership** | Tokens are user-scoped, not org-scoped. Documents/items belong to one or more orgs based on **where they live + how the user has each org configured to "monitor" content**. Claude doesn't pick orgs; the brain routes based on document location/connection routing. |
| 2 | **Composio: per-user keys + per-org allowed-connection-ids** | User has their own Composio account. When configuring an org, user picks which of their existing connections feed that org. Cleanest separation of "I have this account" from "this org gets to see this account." |
| 3 | **LLM API keys: org-level, multi-provider** | The org pays for LLM/embedding tokens, not the brain. Org admin can store both an Anthropic key and an OpenAI key, with task-level routing (e.g., embeddings → OpenAI, filing decisions → Anthropic). |
| 4 | **Initial sync visibility: org-admin interview defines buckets first; defaults derive from sync config** | Onboarding for a shared org BEGINS with admin questions: what spaces/projects exist, what's shared by default, what's private. Then sync routes uploads into those buckets. Personal uploads default to uploader-only. |
| 5 | **Daemon multi-org topology: one daemon, multi-org config** | Single launchd / systemd / Windows-service process; config has `[{org_id, vault_root, include, exclude, path_routing}, ...]`. No process-per-org mess. |
| 6 | **Off-boarding: revoke tokens, preserve files locally, preserve brain content; reassign solely-owned docs** | When a user leaves an org, their OAuth scope to that org is revoked, daemon stops syncing files matching that org's routing, but local files and brain content stay. Documents solely owned by the leaving user become accessible to org admins for reassignment. |
| 7 | **Item-level visibility: NO** | Space/project membership = full access to everything inside. No "this one doc inside this space is hidden" UX. KISS. |
| 8 | **Custom domains: skip for v1** | Path-based routing only (`shared-brain.app/orgs/<slug>` or current domain). Subdomains / custom domains revisited as a paid-tier feature later. |

---

## 3. Data model

### 3.1 New tables

```sql
-- Org membership: many-to-many user ↔ org with a role
CREATE TABLE org_memberships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         text NOT NULL,                 -- Clerk user id
  role            text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  invited_by      text,                          -- Clerk user id of inviter
  invited_at      timestamptz,
  accepted_at     timestamptz NOT NULL DEFAULT now(),
  removed_at      timestamptz,                   -- soft delete on off-boarding
  removed_by      text,
  is_primary      boolean NOT NULL DEFAULT false, -- user's "default" org for new content
  UNIQUE (org_id, user_id)
);
CREATE INDEX org_memberships_user_idx ON org_memberships (user_id) WHERE removed_at IS NULL;
CREATE INDEX org_memberships_org_idx ON org_memberships (org_id) WHERE removed_at IS NULL;

-- Pending invites (consumed on accept)
CREATE TABLE org_invitations (
  token           text PRIMARY KEY,              -- signed JWT
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           text NOT NULL,
  role            text NOT NULL,
  invited_by      text NOT NULL,
  expires_at      timestamptz NOT NULL,
  accepted_at     timestamptz,
  accepted_by     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX org_invitations_email_idx ON org_invitations (email) WHERE accepted_at IS NULL;

-- User's Composio consumer key (one per user, used across all their orgs)
CREATE TABLE user_composio_keys (
  user_id         text PRIMARY KEY,
  api_key         text NOT NULL,                 -- TODO: encrypt at rest in v2.1
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Which Composio connection IDs feed which org for which user
-- (user has 30 connections; org X gets only 5; org Y gets only 3 different ones)
CREATE TABLE org_composio_routing (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         text NOT NULL,
  connection_id   text NOT NULL,                  -- Composio's connection id
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id, connection_id)
);

-- LLM provider config per org (multiple providers allowed)
CREATE TABLE org_llm_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN ('anthropic', 'openai', 'gemini')),
  api_key         text NOT NULL,                 -- TODO: encrypt at rest
  default_model   text NOT NULL,
  use_for         text[] NOT NULL DEFAULT '{}',  -- ['embeddings', 'filing', 'semantic', ...]
  monthly_token_cap_tokens bigint,                -- null = unlimited
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider)
);

-- User's local vault config(s) — they may have multiple machines or vaults
CREATE TABLE user_vault_configs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text NOT NULL,
  name            text NOT NULL,                 -- e.g. "MacBook personal vault"
  vault_root      text NOT NULL,                 -- absolute path on local machine
  include_globs   text[] NOT NULL DEFAULT '{**/*}',
  exclude_globs   text[] NOT NULL DEFAULT '{node_modules/**, .git/**}',
  agent_id        text,                          -- daemon's self-assigned id
  last_seen_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Path routing: which subpaths in this vault feed which orgs
CREATE TABLE vault_org_routing (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_config_id uuid NOT NULL REFERENCES user_vault_configs(id) ON DELETE CASCADE,
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  path_pattern    text NOT NULL,                 -- glob like "Clients/Trade Oracle/**"
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vault_config_id, org_id, path_pattern)
);
CREATE INDEX vault_org_routing_lookup_idx ON vault_org_routing (vault_config_id) WHERE enabled = true;

-- Onboarding state machine
CREATE TABLE onboarding_state (
  user_id         text PRIMARY KEY,
  current_step    text NOT NULL,                 -- 'mode_picker' | 'composio' | 'vault' | ...
  completed_steps text[] NOT NULL DEFAULT '{}',
  data            jsonb NOT NULL DEFAULT '{}',   -- intermediate values
  started_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

-- Support tickets (initial: form → email → row for record)
CREATE TABLE support_tickets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text NOT NULL,
  org_id          uuid REFERENCES organizations(id),
  subject         text NOT NULL,
  body            text NOT NULL,
  status          text NOT NULL DEFAULT 'open',
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### 3.2 Modified existing tables

```sql
-- Document multi-org membership (replaces wiki_pages.org_id direct FK)
CREATE TABLE wiki_page_orgs (
  wiki_page_id    uuid NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  added_at        timestamptz NOT NULL DEFAULT now(),
  added_via       text,                          -- 'sync' | 'mcp' | 'manual'
  PRIMARY KEY (wiki_page_id, org_id)
);
CREATE INDEX wiki_page_orgs_org_idx ON wiki_page_orgs (org_id);
-- During migration: copy wiki_pages.org_id rows into here, then drop the column

-- Items: same join pattern (cross-org items rare but supported)
CREATE TABLE item_orgs (
  item_id         uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  added_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, org_id)
);

-- Spaces: visibility flag (org-wide vs members-only vs private-to-creator)
ALTER TABLE spaces ADD COLUMN visibility text NOT NULL DEFAULT 'org_wide'
  CHECK (visibility IN ('org_wide', 'members', 'private'));
ALTER TABLE spaces ADD COLUMN created_by text;

-- Per-space membership (when visibility = 'members')
CREATE TABLE space_members (
  space_id        uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id         text NOT NULL,
  added_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, user_id)
);

-- Same for projects
ALTER TABLE projects ADD COLUMN visibility text NOT NULL DEFAULT 'inherit'
  CHECK (visibility IN ('inherit', 'org_wide', 'members', 'private'));
ALTER TABLE projects ADD COLUMN created_by text;

CREATE TABLE project_members (
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         text NOT NULL,
  added_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

-- Activity feed: events can be visible to multiple orgs (we write one row per
-- receiving org so org-scoped queries stay clean)
-- Existing schema is fine; the org_id column already scopes per-org. No change.

-- MCP request log: add user context
ALTER TABLE mcp_request_log ADD COLUMN user_id text;
ALTER TABLE mcp_request_log ADD COLUMN current_org_id uuid REFERENCES organizations(id);
```

### 3.3 Migration plan from current state

Single-shot migration on day-0 of v2.0 ship. Keegan is the only user today; future users hit the new schema natively.

**Migration steps (idempotent, run as one Drizzle migration):**

```
1. Create all new tables + columns (additive; no breaks).
2. Backfill org_memberships:
   INSERT INTO org_memberships (org_id, user_id, role, accepted_at, is_primary)
   SELECT id, owner_user_id, 'owner', created_at, true FROM organizations;

3. Backfill wiki_page_orgs:
   INSERT INTO wiki_page_orgs (wiki_page_id, org_id, added_via)
   SELECT id, org_id, 'migration' FROM wiki_pages;

4. Backfill item_orgs (similar).

5. Backfill onboarding_state for Keegan (status: completed):
   INSERT INTO onboarding_state (user_id, current_step, completed_at)
   VALUES (keegan_user_id, 'done', now());

6. Backfill user_composio_keys from current COMPOSIO_CONSUMER_API_KEY env var
   (one-time data move via a setup script, not a SQL migration — humans confirm).

7. Backfill org_composio_routing with all currently-routed connections enabled
   for ViaOps org.

8. Backfill org_llm_config with current ANTHROPIC_API_KEY at org level for ViaOps.

9. Backfill user_vault_configs with current VAULT_PATH for Keegan + a default
   vault_org_routing entry: pattern '**/*' → ViaOps org.

10. Add indexes (post-data-load for speed).

11. After app code is migrated to read new tables: drop wiki_pages.org_id and
    items.* org_id columns. (Two-deploy migration: deploy 1 = read both old +
    new, deploy 2 = drop old.)
```

### 3.4 Backwards-compatibility

Day 0 of v2.0 ship, what stays the same for Keegan:
- OAuth client_id (`Claude.ai web`) keeps working — same MCP endpoint
- Existing OAuth access tokens keep working — get auto-resolved to Keegan + ViaOps via new membership table
- `MCP_API_KEY` static auth keeps working for daemon + scripts (not deprecated yet)
- All vault docs stay where they are; they get a `wiki_page_orgs` row pointing at ViaOps
- All Composio connections stay routed to ViaOps via new `org_composio_routing`
- All env-var-based config (LLM keys, Composio keys) gets backfilled into the new tables; env vars become optional fallbacks

What's new he'll notice:
- Org switcher in nav (only ViaOps in it for now)
- "Add another org" option in account settings
- Onboarding state shows "completed" for him already
- New settings pages: Connections (Composio toggles), LLM Keys, Members

---

## 4. Domain model

### 4.1 Roles within an org

| Role | Permissions |
|---|---|
| **owner** | Everything: edit org settings, add/remove other owners, delete org, billing |
| **admin** | Add/remove members, manage invites, edit org settings (except billing + owner mgmt), edit Profile.md |
| **member** | Read all visible content, create new content, edit own content; cannot manage members |

Viewer role deferred to v2.1 — don't need it for the simple early team scenarios Keegan described.

### 4.2 Space and project visibility

`spaces.visibility`:
- `org_wide` (default) — every org member sees this space + all its content
- `members` — only users in `space_members` see this space
- `private` — only the creator sees this space (effectively a personal scratch space inside an org)

`projects.visibility`:
- `inherit` (default) — same as parent space
- `org_wide`, `members`, `private` — override the parent's visibility (must be MORE restrictive than parent — can't make a project org-wide if it's in a members-only space)

Items inside a project inherit the project's visibility. **No item-level overrides** (locked decision #7).

### 4.3 Multi-org doc membership (the Venn diagram)

A `wiki_page` row belongs to one or more orgs via `wiki_page_orgs`. When a doc has multiple org memberships:
- Each org's members can see/search/read the doc (subject to space visibility within their org)
- Edits to the doc propagate to all orgs that include it
- Activity feed gets one row per receiving org (so per-org queries stay tight)
- Backlinks work cross-org if both endpoints are visible to the same org

How docs get multi-org membership:
- **Sync agent**: file lives at path P; daemon checks `vault_org_routing` for user's vault; matches all orgs whose path_pattern covers P; writes wiki_page_orgs row for each
- **MCP `file_document`**: caller passes `target_path`; we resolve to user's primary vault; same routing logic
- **Explicit add via UI**: user clicks "share with org X"; admin of org X must accept the share (deferred to v2.1; not in v1 MVP)

### 4.4 Off-boarding flow

When a user is removed from an org (admin action, or self-leave):

1. Set `org_memberships.removed_at` = now() (soft delete; preserves audit history)
2. Revoke all OAuth access tokens issued for the (user, org) tuple — daemon and AI clients lose access on next call
3. Stop the user's daemon from syncing files matching that org's `vault_org_routing` (daemon polls for routing changes every N minutes)
4. Local files on user's machine are NOT touched (we can't delete user's data; they own it)
5. Brain content stays:
   - Docs the user CO-authored (multi-author or shared) → preserved in org as-is
   - Docs the user SOLELY owned → flagged for admin reassignment via `wiki_pages.metadata.orphaned_by` field
6. Admin gets an email + dashboard task: "X docs need new ownership"

---

## 5. MCP surface changes

### 5.1 Token resolution (`token → userId → orgIds`)

Today: `validateAccessToken(token) → { userId, clientId, scope, expiresAt }`.

After v2: also returns `{ orgIds: string[], primaryOrgId: string }` — derived from `org_memberships WHERE user_id = ... AND removed_at IS NULL`.

The resolved `orgIds` becomes the scope for all MCP tool queries.

### 5.2 Tool response shape

Every MCP tool that returns content adds `org_ids: string[]` per result so the caller knows which orgs each item belongs to.

```ts
// Old:
{ id, title, snippet, view_url, ... }

// New:
{ id, title, snippet, view_url, org_ids: ['viaops-uuid', 'trade-oracle-uuid'], ... }
```

`search` and `get_wiki_pages` query across all `orgIds` in the user's scope. Results may include the same wiki_page once with `org_ids` listing all orgs it belongs to (no duplication; deduped via `wiki_page_orgs`).

### 5.3 New-content destination logic

For tools that CREATE content (`file_document`, `create_item`, `create_wiki_page`, `create_space`, etc.):

- If caller passes `org_id`: validate user is a member; create with that org affiliation only
- Else if caller passes `target_path` (e.g., `file_document`): resolve via user's `vault_org_routing` → set of matching orgs; create with multi-org affiliation
- Else: default to user's `primary_org_id`

Response always includes `created_in_orgs: string[]` so the caller can confirm where it landed.

### 5.4 Tool description updates

Every tool that touches org-scoped data gets its description updated to mention multi-org awareness:

```
search:
"Searches Keegan's vault content across all orgs you're a member of.
Each result includes `org_ids` so you can see which org(s) own it.
Filter the displayed results to a single org if the user is asking
in a specific context."
```

### 5.5 Per-user Profile.md

`get_operating_instructions` (existing tool) gets an optional `org_id` param. When omitted, returns the org-level Profile concatenated with the user-level Profile (with user-level overrides taking precedence on conflicts; see §11).

---

## 6. Composio routing

### 6.1 User-level keys, per-org allowed connections

Each user stores ONE Composio consumer API key (`user_composio_keys` row). They use this same key across all their orgs. What CHANGES per org is which of their Composio connections are routed into that org's brain.

Example: Keegan has 30 connections (6 Gmail accounts, 6 Calendars, 4 Drives, 3 Notion workspaces, etc.). For ViaOps org he routes the work Gmail/Calendar/Drive/Notion. For a hypothetical "Trade Oracle Inc" shared org he routes only the Trade Oracle-specific Gmail. For a personal org he routes the personal Gmail/Calendar.

### 6.2 Routing table

`org_composio_routing` has rows for each (user, org, connection_id) where the connection is enabled for that org. UI surfaces a per-org checkbox grid.

### 6.3 Behavior in MCP calls

When the in-platform chat or external Claude makes a Composio call via the brain's MCP layer:

1. Resolve the user from the OAuth token
2. Get the user's Composio key from `user_composio_keys`
3. If the call specifies a `connection_id`: verify the user has that connection allowed for at least one of their accessible orgs (and ideally the active org for context)
4. If the call omits `connection_id` (e.g., the meta-tool routes by `account` parameter): pass through unchanged — Composio handles routing on its side using the user's key

For Composio-driven sync (cron `auto-sync` job), iterate per-org-routing-row → fetch new items via that connection → file via `file_document` with the correct org_id.

### 6.4 UI

Settings → Connections page:
- Lists user's Composio connections (fetched live from Composio's `MANAGE_CONNECTIONS` meta-tool)
- For each connection, a row of toggles — one toggle per org the user is a member of
- Save → writes to `org_composio_routing`
- Future: bulk actions ("disable all for this org", "copy from another org")

---

## 7. Local agent (daemon)

### 7.1 Multi-org config schema

YAML config at `~/.shared-brain/config.yaml`:

```yaml
user_id: clerk_user_xxx
auth:
  type: oauth                          # oauth | api_key (legacy)
  refresh_token_path: ~/.shared-brain/refresh
endpoint: https://shared-brain-ecru.vercel.app

vault_configs:
  - id: vault-uuid-1
    name: "Personal vault"
    root: /Users/keegan/Documents/Personal
    include: ["**/*"]
    exclude: ["node_modules/**", ".git/**", "*.tmp"]
    org_routing:
      - org_id: personal-org-uuid
        pattern: "**/*"

  - id: vault-uuid-2
    name: "ViaOps vault"
    root: /Users/keegan/Documents/ViaOps
    include: ["**/*"]
    exclude: ["node_modules/**", ".git/**"]
    org_routing:
      - org_id: viaops-org-uuid
        pattern: "**/*"
      - org_id: trade-oracle-org-uuid
        pattern: "Clients/Trade Oracle/**"
```

### 7.2 Daemon behavior

- Single chokidar instance per `vault_config` (multiple vault roots → multiple watchers)
- For each file event: match path against `org_routing` patterns → multi-org write
- Periodic poll (every 5 min in watch mode) for config changes from server (orgs added/removed, routing rules updated)
- Reports daemon health to server on heartbeat: agent_id, last_seen_at, last_sync stats

### 7.3 Installer story (macOS — v1 only)

**Mac:** Homebrew tap `brew install shared-brain/tap/shared-brain` installs:
- The `shared-brain` CLI (`/opt/homebrew/bin/shared-brain`)
- The `shared-brain-daemon` binary (or Node.js entrypoint) at `/opt/homebrew/bin/`
- The launchd plist template at `/opt/homebrew/etc/shared-brain/`

User runs `shared-brain init` interactively → walks them through OAuth login (browser pops open), vault folder picker, daemon install. Behind the scenes:
1. Generates a config.yaml at `~/.shared-brain/config.yaml`
2. Installs + loads launchd plist (`launchctl bootstrap`)
3. Verifies first heartbeat hits the platform
4. Reports success

`shared-brain status` shows: connection state, last sync per vault, daemon uptime.
`shared-brain config edit` opens the YAML.
`shared-brain logout` revokes tokens + uninstalls daemon.

Windows + Linux installers deferred to v2.1+. Until then, advanced users on those platforms can run `npx @shared-brain/agent` manually.

### 7.4 Why a local component is required

Document this clearly so we don't get asked "why can't this be cloud-only":
- Local file watcher (chokidar) can't run from cloud — it has to see local FS events
- Local-to-cloud diff requires reading local files (can't be done remote)
- File ownership stays with the user; we never store the original master copy in the cloud as the source of truth (vault is master)
- Future: serverless mode for users without a local vault who keep everything in Drive/Notion/etc. — different code path, deferred

---

## 8. LLM API keys

### 8.1 Org-level config with multi-provider support

Each org can have rows in `org_llm_config` per provider. The `use_for` array tells the platform which task types use which provider.

Example:
```
org=viaops, provider=openai, default_model=text-embedding-3-small,
  use_for=['embeddings'], cap=10M tokens/mo

org=viaops, provider=anthropic, default_model=claude-haiku,
  use_for=['filing', 'classification'], cap=50K tokens/mo

org=viaops, provider=anthropic, default_model=claude-sonnet,
  use_for=['semantic_reasoning', 'background_edges'], cap=200K tokens/mo
```

### 8.2 Recommended defaults during onboarding

The wizard suggests a "balanced cost-quality" preset:
- Embeddings: OpenAI `text-embedding-3-small` (~$0.02/1M tokens)
- Filing decisions / lightweight classification: Anthropic `claude-3-5-haiku` (cheap, fast)
- Semantic reasoning / connection graph LLM scoring: Anthropic `claude-sonnet-4-5`

Plus a "single-key" mode: paste one Anthropic key, use Anthropic for all task types. Slightly more expensive but simpler.

### 8.3 Quotas (org-admin-set caps)

Each `org_llm_config` row has `monthly_token_cap_tokens` (nullable = unlimited).

Enforcement:
- Before each LLM/embedding call, check current month's spend against cap
- If exceeded: return null + log a `quota_exceeded` activity row + email org admin
- Soft warn at 80% of cap
- For embeddings specifically: graceful degradation — fall back to text search instead of semantic search if embedding budget exhausted

We don't bill — that's between the org and their provider. We just enforce caps the org admin sets.

---

## 9. Onboarding flow

### 9.1 Sign-up entry

User lands at `/sign-up` (Clerk-handled). After email verification, hit `/onboarding`. The onboarding state machine starts.

### 9.2 Mode picker

First screen:
- **Personal account** — single-user org, named after you. Recommended for individual use.
- **Join an existing team** — paste invite link, or click "I have an email invite" to enter token
- **Create a new team org** — multi-user org you'll invite others to

Mode picker writes `onboarding_state.data.mode` → routes to appropriate step sequence.

### 9.3 Setup wizard steps (10 steps)

Each step has a clear UI, can be skipped (with consequences shown), and resumes-on-return.

| Step | Required? | What happens |
|---|---|---|
| 1. **Org guardrails (admin interview)** | Required for new shared-org admins; skipped for personal | Conversational form: name, default visibility, key spaces/projects to create up front, who's allowed to invite others. Populates org-level Profile.md content. |
| 2. **Connect Composio** | Optional but strongly recommended | Link out to Composio's onboarding to create a consumer key, paste back into our UI. Fetches connection list. |
| 3. **Select Composio connections per org** | Optional (can revisit later) | Toggle which connections feed this org. Show the user's full list with per-connection toggles. |
| 4. **Configure local vault** | Required for local-content sync | Folder picker (file picker dialog if Electron-style; otherwise paste path). Pick include/exclude globs from a quick template. Pick subfolders → orgs routing. |
| 5. **LLM API keys** | Required for embeddings + AI features to work | Paste Anthropic + OpenAI keys. Pick mode: balanced (recommended) or single-key. Set monthly cap. |
| 6. **Download daemon package** | Required for local sync | Detect OS → show install command (`brew install ...` for mac). After install, prompt to run `shared-brain init` which auto-OAuths + writes config. Wait for daemon's first heartbeat to confirm connection. |
| 7. **Connect Claude (Custom Connector)** | Required for AI client connectivity | Show the Claude Custom Connector setup link with our MCP URL pre-filled. User completes OAuth in claude.ai. We poll for first MCP request to confirm. |
| 8. **Initial sync** | Required | Daemon does fullScan; UI shows progress (file count, current file, errors). User can navigate elsewhere; sync continues async. Show estimated time + cost (embedding tokens) before starting. |
| 9. **First Claude interaction (try it!)** | Optional | Suggested prompt: "Ask Claude: what's in my brain?" — verifies end-to-end connectivity. |
| 10. **Done** | Always | Dashboard with status indicators + "what's next" suggestions. Mark `onboarding_state.completed_at`. |

### 9.4 State machine

Track with `onboarding_state.current_step` and `onboarding_state.completed_steps`. User can:
- Resume from where they left off (mid-sync, mid-Composio-config, etc.)
- Skip optional steps and return to them later
- Restart from a specific step if needed

Server-side: no premature side effects until step's data is committed.

### 9.5 Returning users

If `onboarding_state.completed_at IS NOT NULL` → skip wizard, send to dashboard.
If incomplete → resume at `current_step`, with a "Skip onboarding" option (state-of-world: nothing works yet, but they can click around).

---

## 10. Invitation flow

### 10.1 Sending an invite (admin-only action)

UI: Org settings → Members → Invite. Form:
- Email (required)
- Role (member / admin)
- Optional: which spaces (defaults to all org_wide; admin can restrict via space_members)
- Optional: personal note included in email

On submit:
1. Generate signed JWT containing `{ org_id, email, role, invited_by, expires_at: now + 7d }`
2. INSERT into `org_invitations` with token = JWT
3. Send email via Resend with link `https://shared-brain.app/invite/accept?token=xxx`

### 10.2 Accepting an invite

User clicks link → `/invite/accept`:
- If signed in: validate token, check email matches Clerk user, create `org_memberships` row (role from invite), redirect to onboarding wizard (skipping mode picker; jumps to step relevant for joining-existing-org)
- If not signed in: capture token in cookie, redirect to sign-up, on success process token

After acceptance: `org_invitations.accepted_at = now()`, admin gets email notification, new member's `is_primary` set to false (their existing primary stays primary).

### 10.3 Invite expiry / resend

- Tokens expire 7 days after creation
- Admins can resend (generates new token, invalidates old one if same email)
- Expired tokens show a clear "this invite expired; ask the admin to resend" page

---

## 11. Profile.md hierarchy

### 11.1 Storage

- **Org-level Profile**: stored as a wiki_page in the org with title `"Profile"` (current behavior). `accessRoles` = `['admin']` for write; readable by all org members.
- **User-level Profile**: stored as a wiki_page with title `"Profile"` in the user's primary org (or as a separate `user_profiles` table — see open question). Editable by user only.

### 11.2 Precedence on conflict

When `get_operating_instructions` runs, it resolves the active context (token → user → orgs → primary org or current org from request) and returns:

```
[org_profile_content]

---

## User-level overrides (Keegan)

[user_profile_content]
```

Merge rules (encoded in the API response prefix or as Claude's own reading order):
| Section type | Source of truth |
|---|---|
| Identity & tone | User-level wins |
| Standing rules / compliance | Org-level wins (admin sets) |
| Routing / connections / spaces | Org-level wins |
| Personal preferences (greeting style, jokes, etc.) | User-level wins |
| Triggered workflows | User-level allowed to add; can't override org's |

We don't enforce these splits programmatically — we let the AI client read both and apply common sense based on the conflict-resolution guidance encoded in Profile.md itself.

### 11.3 Editing UI

Settings → Operating Instructions:
- Two tabs: "Org-level" (admin-only) + "Personal" (always editable)
- Markdown editor with live preview
- Version history (optional v2.1)

---

## 12. Audit log UI

### 12.1 Page

`/orgs/<slug>/audit` — Org admin only.

Columns:
- Timestamp
- User (email)
- Action (action_type from activity_feed + http_method/status from mcp_request_log)
- Target (entity link)
- Source (web / claude.ai / desktop / mobile / cli)
- Status (ok / error)

Filters: user, action type, date range, source, status.

Export: CSV download for compliance / further analysis.

### 12.2 Data sources

- `mcp_request_log` (already capturing) — add `user_id` and `current_org_id` columns (see §3.2)
- `activity_feed` (already capturing per-org)
- Combine in a SQL view or app-layer join

### 12.3 Retention

- 90 days hot (queryable from the UI)
- Older rows → archive table or just keep in main table indexed

---

## 13. Billing

### 13.1 Plan structure (placeholder; refine when pricing locks)

| Plan | Per-user | Trial | Features |
|---|---|---|---|
| **Trial** | Free | 14 days | Full features, 1 org, 5 GB blob |
| **Personal** | $X/mo | — | 1 user, 1 org, 25 GB blob, 1M MCP calls/mo |
| **Team** | $Y/seat/mo | — | Unlimited orgs, unlimited members, 100 GB blob, 10M MCP calls/mo, audit log |
| **Enterprise** | Custom | — | SLA, custom integrations, dedicated support |

Pricing not finalized — placeholder. Validate with first paying customer.

### 13.2 Stripe integration

- Use Clerk's billing integration if available, otherwise direct Stripe
- Subscriptions are per-org (not per-user) for Team plan
- Per-seat metering: MAU count vs. paid seats
- Trial enforcement via `subscription_status` on org

### 13.3 Out of scope for v2.0 ship

- Discount codes
- Refund handling
- Annual billing
- Detailed plan tier feature matrix

Lands in v2.1 once we know what the market asks for.

---

## 14. Email notifications

### 14.1 System events that trigger email

| Event | Recipient | Provider |
|---|---|---|
| Invite sent | Invitee | Resend (system email) |
| Invite accepted | Inviter (org admin) | Resend |
| Sync failure (3 in a row) | Daemon owner | Resend |
| Sync failure persisting > 24 hours | Org admin | Resend |
| Quota approaching cap (80%) | Org admin | Resend |
| Quota cap exceeded | Org admin | Resend |
| Trial ending in 3 days | Org owner | Resend |
| Billing failure | Org owner | Resend (urgent) |
| New OAuth client connected | User | Resend |

### 14.2 Provider choice

- **Resend** for all system emails — simple, deliverable, decent free tier
- **Composio Gmail** is for user-initiated emails (e.g., invites where the admin wants the email to come from their Gmail) — feature flag for this; default to Resend

Templates stored under `src/lib/emails/templates/`.

---

## 15. Support flow

### 15.1 Initial MVP: contact form → email

`/support` page:
- Fields: subject, body (markdown), include logs/diagnostics? (checkbox)
- Submit: INSERT into `support_tickets` + send email to keegan@viaops.co with ticket details
- User gets a confirmation email with the ticket id

### 15.2 Future expansion (v2.1+)

- Discord integration — webhook into a `#support` channel for triage
- In-app status indicator if there's a known issue
- Help center articles deep-linked from common error messages
- Self-serve diagnostic tools (the existing `reconnect-mcp` CLI is the prototype)

---

## 16. Non-technical user docs

### 16.1 Routes

- `/help` — overview, getting started
- `/help/onboarding` — wizard walkthrough (with screenshots)
- `/help/connections` — connecting Composio + understanding routing
- `/help/local-agent` — installing the daemon, what it does, why it needs to run locally
- `/help/billing` — plans, trial, payment
- `/help/security` — what data is stored where, how to export, how to delete
- `/help/faq` — common questions

### 16.2 Voice and audience

- Plain English. No "MCP" / "OAuth" / "JWT" / "PKCE" jargon.
- Substitute words: "AI assistant", "secure login link", "the local helper app", "your sync key".
- Assume the user knows their way around their own laptop but isn't an engineer.
- Lots of screenshots. Short paragraphs. Bulleted action lists.
- Each page ends with "Still stuck? Get help" → `/support`.

### 16.3 Production process

- Drafts written in markdown in the repo
- Rendered to the public app at `/help/*` via a static-marketing-style route
- Updated each phase as features change
- Owned by Keegan + future TBD support engineer

---

## 17. Epics, features, user stories

Story IDs use prefix `SBV2` for Phase 8 v2.

### Epic 1 — Multi-tenant foundation

| Feature | Stories |
|---|---|
| **1.1 Org membership model** | SBV2-101 As a user, I want to belong to multiple orgs simultaneously, so I can keep personal and work contexts separate. <br>SBV2-102 As an admin, I want to invite users with a role, so I control access. <br>SBV2-103 As a user, I want to leave an org, so I can disconnect when I'm done. |
| **1.2 Visibility model on spaces / projects** | SBV2-110 As an admin, I want to mark spaces as members-only, so sensitive content is gated. <br>SBV2-111 As a member, I want to see only spaces I have access to, so the UI isn't cluttered. |
| **1.3 Multi-org doc membership** | SBV2-120 As a sync agent, I want to write a doc to multiple orgs based on path routing, so the doc is visible to every relevant org. <br>SBV2-121 As Claude, I want search results to indicate which orgs each doc belongs to, so I can scope my reply correctly. |
| **1.4 Migration of existing single-org data** | SBV2-130 As Keegan, I want my existing ViaOps data to keep working without manual fixups, so I'm not the testing dummy. |

**Acceptance criteria for SBV2-101 (representative):**
- Given I'm logged in as a member of two orgs (Org A and Org B), when I navigate to `/dashboard`, then I see an org switcher in the topbar showing both orgs.
- Given I switch to Org B, when I refresh, then the active org persists.
- Given I'm a member of Org A and Org B, when I make an MCP call without specifying an org, then the response includes data from both orgs (with `org_ids` populated per result).

### Epic 2 — Per-user identity in MCP

| Feature | Stories |
|---|---|
| **2.1 Token resolution** | SBV2-201 As a developer, I want `validateAccessToken` to resolve to a user + their orgs, so MCP tools scope correctly. |
| **2.2 Tool response routing** | SBV2-210 As Claude, I want every result to include `org_ids[]`, so I know what's where. |
| **2.3 New-content destination** | SBV2-220 As a user, I want `file_document` with a `target_path` to auto-route to the right org(s) based on my vault routing, so I don't have to specify org_id every time. |

### Epic 3 — Composio per-org routing

| Feature | Stories |
|---|---|
| **3.1 User keys storage** | SBV2-301 As a user, I want to store one Composio key, so I don't have to re-enter it per org. |
| **3.2 Per-org connection toggles** | SBV2-310 As a user, I want to choose which Composio connections feed each org, so my personal Gmail doesn't leak into the company brain. |
| **3.3 Routing in MCP calls** | SBV2-320 As Claude, I want Composio calls scoped to the active org's allowed connections, so I only see what's appropriate. |

### Epic 4 — Daemon multi-org config

| Feature | Stories |
|---|---|
| **4.1 Config schema + CLI** | SBV2-401 As a user, I want a YAML config the daemon reads, so I can audit/edit it. <br>SBV2-402 As a user, I want a `shared-brain config` CLI, so I don't hand-edit YAML. |
| **4.2 Multi-vault watcher** | SBV2-410 As a user, I want the daemon to watch multiple vault roots, so my Personal and Work vaults sync independently. |
| **4.3 Path → org routing** | SBV2-420 As a sync agent, I want to write a file to multiple orgs based on path patterns, so a `Clients/X/` doc lands in both my org and X's shared org. |

### Epic 5 — LLM API keys

| Feature | Stories |
|---|---|
| **5.1 Org-level key storage** | SBV2-501 As an admin, I want to store an Anthropic key, so AI tasks have funding. |
| **5.2 Multi-provider routing** | SBV2-510 As an admin, I want embeddings to use OpenAI and reasoning to use Anthropic, so I optimize cost. |
| **5.3 Quotas + caps** | SBV2-520 As an admin, I want a monthly token cap, so I don't get a surprise bill. |

### Epic 6 — Onboarding wizard

| Feature | Stories |
|---|---|
| **6.1 Mode picker** | SBV2-601 As a new user, I want to choose Personal / Join / Team, so I'm routed to the right setup. |
| **6.2 Step-by-step wizard** | SBV2-610 As a user, I want a guided 10-step setup, so I don't miss anything. |
| **6.3 Resume mid-flow** | SBV2-620 As a user, I want to leave and come back to the wizard, so I don't have to do everything in one sitting. |
| **6.4 Status indicators** | SBV2-630 As a user, I want to see where I am in setup, so I know what's next. |

### Epic 7 — Invitation flow

| Feature | Stories |
|---|---|
| **7.1 Send invite** | SBV2-701 As an admin, I want to invite by email, so I can grow my team. |
| **7.2 Accept invite** | SBV2-710 As an invitee, I want to click an email link and join, so it's frictionless. |
| **7.3 Invite expiry + resend** | SBV2-720 As an admin, I want to resend an invite, so I don't have to start over. |

### Epic 8 — Visibility & roles

| Feature | Stories |
|---|---|
| **8.1 Roles enforcement** | SBV2-801 As an admin, I want only admins to invite, so members can't grow the team without permission. |
| **8.2 Space-level visibility UI** | SBV2-810 As an admin, I want to mark a space as members-only with a member list, so HR docs stay in HR. |
| **8.3 Off-boarding** | SBV2-820 As an admin, I want to remove a member, so I can off-board them when they leave. |

### Epic 9 — Audit & support

| Feature | Stories |
|---|---|
| **9.1 Audit log UI** | SBV2-901 As an admin, I want to see who did what when, so I can debug or comply with policy. |
| **9.2 Support form** | SBV2-910 As a user, I want to submit a support ticket, so I get help when stuck. |

### Epic 10 — Daemon installer (mac)

| Feature | Stories |
|---|---|
| **10.1 Homebrew tap** | SBV2-1001 As a mac user, I want to `brew install shared-brain`, so setup is one command. |
| **10.2 `shared-brain init`** | SBV2-1010 As a mac user, I want a guided init that handles OAuth + config, so I don't read docs. |
| **10.3 Daemon health reporting** | SBV2-1020 As a user, I want to see daemon status in the web UI, so I know it's running. |

---

## 18. Test plan

### 18.1 Test layers

| Layer | What it covers |
|---|---|
| **Unit** | Pure functions: token resolution, routing rules, role checks, invite token signing/verification |
| **Integration** | DB-backed flows: invite → accept → membership; sync → multi-org write; daemon config reload |
| **End-to-end** | Onboarding wizard happy path; cross-org search returns expected results; off-boarding revokes access |
| **Manual** | Real claude.ai mobile/web/desktop test of a multi-org user; native installer on a fresh Mac |

### 18.2 Sample acceptance test for SBV2-101 (multi-org membership)

```
# Setup
- Create user U1
- Create orgs O1 and O2
- Add U1 to both as 'member'

# Test 1: Org switcher shows both
- GET /dashboard as U1
- Assert: response includes org switcher with O1 and O2

# Test 2: Active org persists
- POST /api/orgs/active { org_id: O2 }
- GET /dashboard as U1
- Assert: O2 is the active org

# Test 3: MCP search spans both
- Insert wiki_pages into both O1 and O2
- Call MCP search via U1's OAuth token
- Assert: results include both O1's and O2's pages with org_ids populated correctly
```

### 18.3 Critical regression tests for backwards-compat

- Keegan logs in: sees ViaOps as primary, all data intact, OAuth still works
- Existing Claude.ai web Custom Connector keeps working without re-OAuthing
- Existing daemon keeps syncing without reinstall (config auto-migrated)

---

## 19. Phased rollout within Phase 8 v2

| Sub-phase | Scope | Estimated effort | Ships |
|---|---|---|---|
| **v2.0 (MVP)** | Multi-org membership model + per-user OAuth identity in MCP + Composio per-org routing UI + LLM API keys (single-provider) + Onboarding wizard (happy path) + Invite flow + Daemon multi-org config + macOS Homebrew installer | ~3 weeks of focused work | First non-Keegan user |
| **v2.1** | Audit log UI + Email notifications + Multi-provider LLM keys with task routing + Quotas/caps + Visibility & roles UI + Off-boarding flow polish | ~1.5 weeks | Quality bar for paid tier |
| **v2.2** | Stripe billing + Non-technical docs + Support form → email + Help center articles | ~1 week | Charging for it |
| **v2.3** | Windows + Linux installers + DCR (RFC 7591, only if requested) + Custom subdomains + Item-level visibility (probably never) | ~2+ weeks (if all done) | Productization completeness |

Total: **~7-8 weeks of focused engineering** to fully complete Phase 8 v2. Realistic schedule depends on solo dev pace + how much we discover during build.

---

## 20. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Schema migration breaks Keegan's setup | Med | High | Test on staging clone first; one-shot migration with rollback script ready; backwards-compat for old code paths during v2.0 ship |
| 2 | Initial sync floods embedding API costs | Med | Med | Caps + dry-run estimate before commit; "estimated cost" preview in UI; default to text-only embedding-disabled mode for users who don't add an LLM key |
| 3 | Multi-org doc membership creates query complexity | High | Med | Index `wiki_page_orgs` carefully; EXPLAIN ANALYZE every search query; benchmark with synthetic 10k-doc, 5-org dataset |
| 4 | Daemon installation friction blocks non-technical users | High | High | Mac homebrew first (engineer-friendly enough); polish to .pkg installer in v2.1; clear docs; support form |
| 5 | OAuth token revocation on off-boarding leaves stale daemon connections | Med | Med | Daemon checks token validity periodically; force-refresh on 401; server-side revocation list checked on every MCP request |
| 6 | Composio rate limits break batch operations | Low | Med | Respect Composio's documented limits; queue at our layer; backoff on 429 |
| 7 | Multi-provider LLM key routing has bugs that silently use wrong provider | Med | High | Log provider+model on every LLM call; admin can audit which calls hit which provider |
| 8 | Onboarding state corruption mid-flow leaves user stuck | Med | Med | All wizard data is committable per-step (no all-or-nothing); admin can wipe state via API; "restart onboarding" button in user settings |
| 9 | Profile.md hierarchy resolution conflicts confuse Claude | Low | Med | Clear precedence rules documented in the Profile.md output itself; only ship the merged view to Claude (don't leak the resolution mechanism) |
| 10 | Cross-org doc visibility confuses users ("why is this in my company brain?") | Med | High | Strict opt-in routing; clear "this doc lives in: Org A, Org B" badges in UI; admin alert on first multi-org write |

---

## 21. Backwards-compat plan

### 21.1 What keeps working untouched on day-0 of v2.0 ship

- Existing OAuth client_id (`Claude.ai web` registered with `sb_client_9b156f0fb888551c`)
- Existing OAuth access tokens (resolve to Keegan + ViaOps via new membership)
- Existing static `MCP_API_KEY` Bearer auth (legacy path; not deprecated yet)
- Existing daemon plist (continues to send to ViaOps via auto-migrated `vault_org_routing` rule with `**/*` pattern)
- Existing claude.ai Desktop and web connectors (no reconnect needed)
- Existing Profile.md (becomes ViaOps's org-level Profile)
- Existing wiki_pages, items, projects, spaces (all preserved with their data)

### 21.2 What changes that Keegan will notice

- Org switcher in nav (just ViaOps in it for now)
- "Add another org" button in account settings
- New settings pages: Connections, LLM Keys, Members
- Slight delay on first MCP call (token resolution path adds one query) — should be < 5ms

### 21.3 What new features become available even before any other user joins

- Keegan can split his work into multiple orgs (e.g., separate ViaOps internal + a shared Trade Oracle org with himself as the only member, ready to invite Richard later)
- Keegan can set per-org Composio routing
- Keegan can set per-org LLM keys
- Onboarding wizard available for any new user signing up

### 21.4 Two-deploy migration strategy

To avoid hot-path issues during the transition:
1. **Deploy 1**: New tables + new code paths that read from BOTH old (`wiki_pages.org_id`) and new (`wiki_page_orgs`) sources. Backfill data. Existing code paths still work.
2. **Deploy 2**: Migrate writers to new sources only. Drop old `org_id` column on `wiki_pages` (and similar for items).

Each deploy is independently revertable. No big-bang cutover.

---

## 22. Open questions

These need Keegan's input before final lock. Each has a default I'll go with if no answer is given.

| # | Question | Default if no answer |
|---|---|---|
| 1 | **Encryption at rest for stored API keys** (Composio keys, LLM keys, OAuth refresh tokens). Adds ops complexity (KMS, key rotation). Worth it for v2.0? | Defer to v2.1. Plain DB columns for v2.0 with audit-log entries for any read. |
| 2 | **Org slug uniqueness** — global namespace? If two users name their org "Acme", one becomes `acme` and the other `acme-2`? Or domain-style segmentation? | Global unique, suffix on collision. Display name separate from slug. |
| 3 | **Cross-org doc deduping in search results** — same doc in 2 orgs returns 1 hit (with `org_ids[]`) or 2 hits? | 1 hit, deduped via `wiki_page_orgs`. UI badges to show. |
| 4 | **Org owner protection** — refuse to remove the last owner? What if owner abandons account? | Refuse to remove last owner; admin tool to transfer ownership. Account-abandonment recovery deferred (v2.1+ — manual via support). |
| 5 | **Migration timing** — single-shot day-0 vs. gradual rollout (Keegan first, others over weeks)? | Single-shot. Keegan is currently the only user; no per-user staging needed. |
| 6 | **User-level Profile.md storage** — separate `user_profiles` table, or wiki_page within user's primary org? | Wiki_page within primary org with title `"User Profile"`. Simpler. |
| 7 | **`is_primary` org for new users joining via invite** — set their existing primary as primary, or the new org? | Existing primary stays primary. New invite-accepted org gets `is_primary = false`. |
| 8 | **Daemon auth: new OAuth token type vs static `MCP_API_KEY`?** v2.0 plan keeps `MCP_API_KEY` for daemon. But long-term we want OAuth for everything. | v2.0: keep static key for daemon (simpler). v2.1: introduce daemon-flavored OAuth with a longer-lived refresh token. |
| 9 | **Documentation language localization** — English only for v1, or design help center to support i18n? | English only. i18n added when there's a non-English-speaking customer. |
| 10 | **GDPR-style data export** — JSON dump? PDF report? What format? | JSON dump (machine-readable + comprehensive). Future: human-readable report. |

---

## Sign-off section (for Keegan)

When this doc is ready to lock, replace this section with:

```
✅ Reviewed and approved by Keegan on [DATE]
Outstanding open questions resolved as follows:
1. [decision]
2. [decision]
...
```

After sign-off, ship goes into the implementation queue per §19's phased rollout.

---

## Document changelog

| Date | Author | Change |
|---|---|---|
| 2026-05-09 | Claude (main session) + Keegan (planning conversation) | Initial draft |
