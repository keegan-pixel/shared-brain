---
title: Shared Brain — Outstanding Items Roadmap
created: 2026-05-14
updated: 2026-05-14
status: living-document
tags: [viaops-internal, shared-brain, roadmap, post-richard-install]
related: "[[Post-Mortem 2026-05-12 Jake's Install]] [[Build Log]] [[Decisions]]"
---

# Outstanding Items Roadmap

> **Status:** Compiled 2026-05-14 after Richard Lackey's install.
> Two real users in 48 hours; 21 must-fixes shipped. This doc
> tracks everything we know is still broken, incomplete, or
> next-up — with severity, what bites, and a suggested plan.
> **Format:** Each item has a unique ID for cross-referencing in
> commit messages and post-mortems. Living doc — update as items
> ship or new ones emerge.

---

## Severity legend

| Marker | Meaning |
|---|---|
| 🔴 **Hit-this-week** | Already bit one or more users. Fix before next install. |
| 🟠 **Pre-#5** | Will bite users 3-5. Fix before then. |
| 🟡 **Pre-team** | Required when first multi-member org signs up. |
| 🟢 **Quality of life** | No user blocked; tech-debt or smoother experience. |
| ⚪ **Future** | Beyond v2.1 scope. |

---

## Section 1 — Hit-this-week (🔴)

### R5 — Clerk dev-mode signup 404 race (BIT BOTH JAKE AND RICHARD)

**What hits:** Brand new sign-up → Clerk redirects to `/` → user sees
404 → manual refresh → app loads fine. Happens because Clerk's
dev-mode requires a "dev browser" cookie that hasn't yet propagated
when the redirect lands. Clerk middleware sees no cookie →
`x-clerk-auth-reason: protect-rewrite, dev-browser-missing` →
rewrites to `/404`. Refresh sets cookie → middleware passes.

**Why it bites:** Every new user hits this on first sign-up. First
impression is "this is broken." If they don't think to refresh, they
bounce.

**Why our existing fix doesn't address it:** Commit `07bfdf7` catches
`UNAUTHENTICATED` *inside* the home page server component and
redirects to `/sign-in`. But Clerk's middleware rewrites at the edge
BEFORE the page component runs — our catch never fires.

**Plans (pick one):**

**Plan A — Switch to Clerk production instance (Recommended).** $25/mo
plan covers up to 10k MAUs. Production instances don't have the
dev-browser-cookie quirk. Migration steps:
1. Create production instance in Clerk dashboard
2. Update env vars in Vercel: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
   `CLERK_SECRET_KEY`, etc.
3. Migrate existing users (or accept that current users have to
   re-sign-up — only Keegan, Jake, Richard so far)
4. Update redirect URLs in Clerk dashboard for prod
5. Deploy

**Plan B — Patch middleware config to redirect instead of rewrite.**
In `src/middleware.ts`, change Clerk middleware to surface
`afterSignUpUrl` more aggressively / set a transition cookie.
Doesn't fully fix the underlying race; reduces but doesn't eliminate
the 404.

**Estimated effort:** Plan A ~2 hours. Plan B ~30 min but partial fix.

**Owner:** Keegan to decide (cost approval needed for Plan A).

---

### J7 — `/api/operating-instructions` returns 401 with current bearer token

**What hits:** New Claude sessions can't pull live Profile.md content
via the documented bearer-auth endpoint. They fall back to the local
vault copy, which works but means Profile.md changes don't propagate
to new sessions until manual update.

**Why it bites:** Affects every new user setting up the Claude Code
CLAUDE.md skill. The curl-with-bearer pattern in CLAUDE.md returns
401 against prod.

**Root cause:** Token mismatch — global `~/CLAUDE.md` has
`Olg4f1UxpmDXDql2w-TDc9ZqD8Cy4VMTGyTTNDJuVVI`, but Vercel's
`OPERATING_INSTRUCTIONS_TOKEN` env var doesn't match (rotation or
never set).

**Plan:**
1. Decide canonical token (either rotate in both places, or fetch the
   prod env value)
2. Update Vercel env if needed
3. Sync into `~/CLAUDE.md` via the install-skill flow
4. Add a smoke-test step to the Runbook pre-install checklist

**Estimated effort:** 15 min.

---

### R6 — Cloud-vault detection at install time (NEW from Richard)

**What hits:** Users with Google Drive / Dropbox / iCloud vault paths
get "extract failed: unknown system error -11" on most binary files
during first sync. Have to fix cloud settings + restart daemon.

**Why it bites:** Cloud-synced vaults are the dominant real-world
pattern, not Obsidian-on-disk. Richard hit it. Most new users will.

**Plan:**
1. In `install-daemon.ts`, detect if vault path matches known cloud
   patterns (`Library/CloudStorage/`, `Dropbox/`, `Library/Mobile Documents/`,
   `OneDrive*/`).
2. If detected, print a clear pre-install warning with provider-
   specific instructions (Google Drive → Mirror files, Dropbox →
   Make available offline, iCloud → Optimize Mac Storage off).
3. Ask user to confirm cloud settings are set before proceeding.
4. Same warnings on `/settings/daemon` UI when path looks cloud-y.

**Estimated effort:** 1-2 hours. Pure paper-cut prevention, no DB
schema changes.

---

### R7 — Pre-install npm cache permission check (NEW from Richard)

**What hits:** `npm install` errors with `EACCES: permission denied`
because some users have ran `sudo npm install` in the past, leaving
files in `~/.npm/` owned by root.

**Why it bites:** Richard hit it. Common npm-on-macOS issue.

**Plan:**
1. Add a pre-flight check to the install command:
   `[ -w ~/.npm ] || { echo "npm cache owned by root. Run: sudo chown -R \$(whoami) ~/.npm"; exit 1; }`
2. Stick this before `npm install` in the install command UI generates.

**Estimated effort:** 5 minutes.

---

## Section 2 — Pre-#5 (🟠)

### J5 — Stuck-conflict daemon loop

**What hits:** Daemon's pull-down detects a file that differs locally
from platform → logs "will push local back up on next sync" → never
actually pushes (chokidar only fires on file-modify events, not
conflict-detection). Annoying log spam, no functional break, but
clutters diagnostics.

**Plan:**
1. In `agent/src/pull.ts`, on conflict-detected, EXPLICITLY trigger
   `syncOne(file, cfg, api)` once (force-push the local version).
2. Or surface to user via UI ("3 file conflicts pending review").

**Estimated effort:** 2 hours for the auto-push path. 4-6 hours for
the user-review UI.

---

### J6 — DCR registration_access_token (abuse prevention)

**What hits:** `/api/register` (Dynamic Client Registration) is
currently open — anyone with the URL can create OAuth clients. No
abuse prevention yet.

**Plan:** Add `registration_access_token` per RFC 7591 §3 — issue an
unguessable token on registration; require it for subsequent client
metadata updates / deletes. Doesn't prevent initial creation, but
prevents takeover of registered clients.

**Estimated effort:** 4-6 hours.

---

### R2 — Daemon hot-reload (poll config from platform)

**What hits:** When user changes vault paths via `/settings/daemon`
(MF-14), the change is persisted to DB but the running daemon doesn't
pick it up until the user re-runs the install command. Clunky.

**Plan:**
1. Add `GET /api/daemon/config` endpoint that returns the org's
   current vault_paths + other daemon-relevant config.
2. Daemon polls this endpoint every 60s during watch mode.
3. On config change detected, daemon closes existing chokidar
   watchers, opens new ones for the new path list.
4. Surface daemon's last-config-pull timestamp on `/settings/daemon`.

**Estimated effort:** 4-5 hours. Bigger because it touches both
sides + the polling-on-startup race needs care.

---

### J2 — Encryption at rest for keys (Composio, LLM, OAuth)

**What hits:** API keys stored plaintext in `org_composio_config`,
`org_llm_config`, `oauth_clients`. If DB dump leaks or insider threat,
all user keys exposed.

**Plan:**
1. Generate a master key per Vercel env (`ENCRYPTION_KEY`).
2. Wrap relevant columns with libsodium / Node crypto AES-256-GCM.
3. Migration to re-encrypt existing rows.
4. Resolver libs (`resolveOrgLlmKey`, etc.) decrypt on read.

**Estimated effort:** 4-6 hours.

---

### Production-Clerk migration (see R5)

Same item as R5. If we delay R5 it stays in 🟠 indefinitely until
someone bounces off the signup 404 and we lose them.

---

## Section 3 — Pre-team (🟡)

### D2 — `org_memberships` table + invites

**What hits:** Today, one org = one owner. Required when first
multi-member org (XP Flow team, ViaOps internal team) onboards.

**Plan (per ADR-037 v2.1 spec):**
1. New `org_memberships` table: `(org_id, user_id, role, invited_at, joined_at)`.
2. Invite flow: `/api/orgs/[id]/invite` creates pending membership +
   sends email with magic link.
3. Accept flow: clicking link resolves to user signup/sign-in →
   activates the membership.
4. UI: `/settings/team` for org owners to manage members.
5. Permissions: `ensureUserOrg` becomes `ensureUserOrgMembership` —
   checks role and org_id from the URL path.

**Estimated effort:** 1-2 days. Big lift; needs careful design for
the existing solo-org users (Jake, Richard, Keegan).

---

### D3 — Multi-org doc membership (the Venn diagram)

**What hits:** A doc that should belong to MULTIPLE orgs (e.g.
Keegan's Profile.md across his ViaOps personal + SimHouse team
when those become separate orgs). Today wiki_pages has a single
`org_id`.

**Plan:** Add a `doc_org_memberships` junction table or change
schema to nullable+derived ownership. Specced in ADR-037 §17.
Probably defer until first user needs it (no one does yet).

**Estimated effort:** Day+ once requirements concretize.

---

### D4 — Per-org Composio routing UI

**What hits:** Currently, Composio routing is implicit (a Gmail call
routes to whatever connection_id matches based on Composio's defaults).
For multi-org users, they'll want explicit routing rules ("this org's
chat → this Composio connection").

**Plan:** UI on `/settings/connections` to set per-org default
connection per toolkit. Backend: new table `org_composio_routing`.

**Estimated effort:** Half-day.

---

## Section 4 — Quality of life (🟢)

### R3 — Cross-vault path collision handling

**What hits:** When user has multiple vault paths (Richard has 3), if
two roots contain a file with the same relative path (e.g.
`/Vault1/README.md` and `/Vault2/README.md`), platform sees them as
the same file (`filePath: "README.md"`) and they overwrite each
other.

**Plan:** Prefix the filePath with a vault discriminator. Or store
`vault_root_index` alongside filePath. Schema change required.

**Estimated effort:** Half-day. Not urgent (no one's reported a
collision yet).

---

### Backfill script for re-extracting cloud-offloaded files

**What hits:** Referenced in the MF-11 error message but not built.
Users who fix cloud settings AFTER initial sync currently have to
either wait for chokidar to retry (won't happen for unchanged files)
or re-run the install command (forces v4 hash bump, re-extracts).

**Plan:** Standalone script `npm run resync-failed-extracts` that:
1. Queries wiki_pages where content contains "extract skipped" or
   "extract failed"
2. Deletes the matching vault_sync_log entries
3. Triggers a full-scan via daemon (`npm run sync:once`)

**Estimated effort:** 1-2 hours.

---

### Daemon log rotation

**What hits:** `/tmp/shared-brain-sync.<tag>.log` grows unboundedly.
After enough watch cycles + pull-down logs, can hit GBs.

**Plan:** Rotate logs daily or at 50MB. Use macOS's `newsyslog` or
roll our own in the daemon.

**Estimated effort:** 1-2 hours.

---

### J3 — Audit log UI

**What hits:** Currently no way for an org owner to see "who did
what in my brain when" beyond the activity feed (which is content-
focused, not auth-focused).

**Plan:** New table `audit_log`. Surface on `/settings/audit`.

**Estimated effort:** Half-day.

---

### J4 — Email notifications

**What hits:** No emails sent today (signup, daemon alerts, key
rotations, etc.). Users have to come back to the dashboard to learn
state changes.

**Plan:** Resend / Postmark integration. Per-event templates. Send
on: signup welcome, sync key rotation, daemon-offline-for-Nh,
invite (if/when D2 lands).

**Estimated effort:** Half-day per template.

---

### More Composio adapters (Drive, Notion, Slack, HubSpot...)

**What hits:** Currently only Gmail + Google Calendar wired for
cron auto-sync. Other toolkits accept the toggle but the cron skips
them with "No adapter wired yet for toolkit X."

**Plan per toolkit:**
- **Google Drive:** poll for new files in watched folders → file_document
  with extracted content. Heavier — content extraction pipeline.
- **Notion:** poll for new/updated pages in watched workspaces.
- **Slack:** recent DMs / channel mentions → activity items.
- **HubSpot:** new contacts / deals → entity creation.

**Estimated effort:** 2-4 hours per adapter following the Gmail/
Calendar pattern.

---

### J1 — macOS `.pkg` installer (non-technical users)

**What hits:** Today's install requires Terminal. Non-technical
users bounce off this. Need Apple Developer cert ($99/year) for
proper codesigning.

**Plan:**
1. Get Apple Developer cert.
2. Build `.pkg` with `pkgbuild` + `productbuild`.
3. Bundle Node 20+ runtime to avoid version dependency.
4. Sign + notarize.
5. UI download link on `/settings/daemon`.

**Estimated effort:** 1-2 days once cert is in hand.

---

## Section 5 — Future (⚪)

### D5 — Stripe billing
### D6 — More-than-audit-log UI (paid feature gating)
### D7 — Off-boarding flow polish (export brain, delete account)
### D10 — Windows + Linux daemon installers
### Granola adapter, LinkedIn adapter, etc.

All deferred until v2.1+ or paid tier launch.

---

## Section 6 — Quick reference: severity matrix

| ID | Item | Severity | Effort | Plan? |
|---|---|---|---|---|
| R5 | Clerk dev-mode signup 404 | 🔴 | 2hr (A) / 30min (B) | ✓ |
| J7 | Operating-instructions 401 | 🔴 | 15min | ✓ |
| R6 | Cloud-vault detection at install | 🔴 | 1-2hr | ✓ |
| R7 | Pre-install npm cache check | 🔴 | 5min | ✓ |
| J5 | Stuck-conflict daemon loop | 🟠 | 2hr | ✓ |
| J6 | DCR registration_access_token | 🟠 | 4-6hr | ✓ |
| R2 | Daemon hot-reload | 🟠 | 4-5hr | ✓ |
| J2 | Encryption at rest | 🟠 | 4-6hr | ✓ |
| D2 | org_memberships + invites | 🟡 | 1-2 days | ✓ |
| D3 | Multi-org doc membership | 🟡 | day+ | partial |
| D4 | Per-org Composio routing UI | 🟡 | half-day | ✓ |
| R3 | Cross-vault path collision | 🟢 | half-day | ✓ |
| — | Backfill re-extract script | 🟢 | 1-2hr | ✓ |
| — | Daemon log rotation | 🟢 | 1-2hr | ✓ |
| J3 | Audit log UI | 🟢 | half-day | ✓ |
| J4 | Email notifications | 🟢 | half-day per template | ✓ |
| — | More Composio adapters | 🟢 | 2-4hr each | ✓ |
| J1 | macOS .pkg installer | 🟢 | 1-2 days | needs cert |

---

## Section 7 — Suggested order

If we're picking what to tackle next, this is the order I'd suggest
based on what bites the most:

**Tonight or tomorrow (90 min total):**
1. **J7** (operating-instructions 401) — 15min
2. **R7** (npm cache check in install command) — 5min
3. **R6** (cloud-vault detection at install time) — 1-2hr

**This weekend (3-4 hours):**
4. **R5 Plan A** (Clerk production migration) — 2hr
5. **J5** (stuck-conflict daemon push) — 2hr

**Next week (1-2 days):**
6. **R2** (daemon hot-reload) — half-day
7. **More Composio adapters** — Drive first, then Notion (4-6hr)
8. Backfill re-extract script — 1-2hr

**Before user #5 (1 week):**
9. **J2** (encryption at rest) — 4-6hr
10. **J6** (DCR registration_access_token) — 4-6hr

**Before first team-org user:**
11. **D2** (org_memberships + invites) — 1-2 days

---

## Sign-off

**Owner:** Keegan (priorities + scope), Claude (execution + docs).
**Updates:** Add new items as they emerge during installs or
discovery. Move items to the post-mortem when shipped. Mark severity
shifts when actual user hits change the priority.
