---
title: Post-Mortem — Jake Leskovar's Install (First Real Multi-Tenant Test)
created: 2026-05-12
updated: 2026-05-12
status: living-document
tags: [viaops-internal, shared-brain, post-mortem, phase-8-v2, multi-tenancy]
related: "[[Build Log]] [[Decisions]] [[Phase 8 v2 — Multi-User + Onboarding Spec]]"
---

# Post-Mortem — Jake Leskovar's Install (2026-05-12)

> **Status:** First non-Keegan user installed end-to-end. 16 live bug
> fixes shipped during the call. Multi-tenancy is now working in
> production with real data.
> **Outcome:** Jake's brain is live; his Claude sees only his data;
> his daemon syncing files in the background; lead-agent patch in his
> AXIS system prompt; foundation in place for Richard Thursday.
> **What this doc is for:** capture every issue that hit, the fix
> shipped, the root cause, and the lessons. So Thursday is smoother
> and the next 10 users are smoother still.

---

## 1. Executive summary

Phase 8 v2 MVP shipped Monday 2026-05-11. Jake's install Tuesday
2026-05-12 noon was the first real multi-tenant test. **The MVP
scope (ADR-037) deferred several multi-tenancy items as parked.
Every single one of those bit us live.** Plus a handful of
genuinely new bugs around Composio's response shape and onboarding
UX.

**Severity classification of issues hit:**

| Severity | Description | Count |
|---|---|---|
| **Critical** | Data isolation breach (Jake saw Keegan's data) | 1 |
| **Blocker** | User couldn't progress past a step | 6 |
| **High-friction** | User could progress but the path was broken or confusing | 5 |
| **Polish** | Cosmetic / UX nits | 4 |
| **Total** | | **16** |

**The single biggest learning:** the "Keegan-as-only-test-user trap"
shaped 8 of these 16 bugs. Anywhere I baked Keegan-specific
assumptions into code (folder names, business names, default
routing, system prompts, MCP context), it broke for Jake.

**Time impact:** Jake's install took ~3 hours instead of the planned
~45 min. Most of that was live-fixing. Without live fixes, Jake's
install would have FAILED at multiple points (no DCR for Custom
Connector setup; per-user MCP isolation would have shown him
Keegan's brain entirely).

---

## 2. The bugs, in order they hit

Each entry: what Jake saw → root cause → fix shipped → severity.

### 2.1 Sign-up server error (resolved on refresh)

- **What Jake saw:** Server error on first sign-up attempt; refresh
  resolved it.
- **Root cause:** Likely Clerk session-cookie race — auth() in the
  home page server component ran before Clerk's signup-redirect
  cookie propagated. Throws UNAUTHENTICATED → 500.
- **Fix shipped:** `07bfdf7` — catch UNAUTHENTICATED in home page,
  redirect to `/sign-in?redirect_url=/` instead of throwing.
- **Severity:** High-friction. Now silently re-auths and continues.

### 2.2 Onboarding signals showed global activity, not Jake's

- **What Jake saw:** Onboarding checklist showed "daemon connected"
  and "Claude connected" as ✓ before he'd installed anything.
- **Root cause:** `deriveOnboardingState()` checked global tables
  (`vault_sync_log`, `mcp_request_log`) for ANY recent activity
  rather than scoping to Jake's org / user. Keegan's daemon + MCP
  activity was making those flags green.
- **Fix shipped:** `cedffdb` — scope daemon-connected via
  `activity_feed` rows where `orgId = jake's`; scope claude-connected
  via `oauth_access_tokens` where `userId = jake's clerk id`.
- **Severity:** High-friction (didn't block, just lied).

### 2.3 Custom Connector wouldn't connect (DCR missing)

- **What Jake saw:** Adding the Custom Connector in Claude Desktop
  failed with "Couldn't reach the MCP server" + `ofid_…` error.
- **Root cause:** Claude Desktop attempts Dynamic Client Registration
  (RFC 7591) on first contact with a new MCP server. Our discovery
  doc didn't advertise `registration_endpoint`, and we had no
  `/api/register` route. Surfaces as generic "couldn't reach."
- **Fix shipped:** `5af980b` — implemented full DCR endpoint at
  `/api/register`. Accepts RFC 7591 client metadata, generates
  `client_id` + `client_secret`, persists to `oauth_clients`.
- **Severity:** Blocker. Every new Anthropic account hit this before
  the fix.
- **Note:** Keegan's account didn't hit it because the existing
  manually-registered "Claude.ai web" client covered his Desktop too
  via account state.

### 2.4 Chat panel system prompt called Jake "Keegan"

- **What Jake saw:** Hypothetically would have if he'd used the
  in-platform chat panel; caught proactively before he tried.
- **Root cause:** `buildSystemPrompt()` hardcoded "Keegan's
  AI-native PM system" and instructed Claude to load "Keegan's
  profile" and "the three businesses."
- **Fix shipped:** `cca9901` — replaced with generic "the user's"
  prose; instructs Claude to load operating instructions for context;
  handles empty Profile.md gracefully for new users.
- **Severity:** High-friction (would've confused but not blocked).

### 2.5 Composio routing hint was Keegan-specific

- **What Jake saw:** Hypothetically would have caused Claude to try
  routing Gmail calls to `gmail_berret-drinn` etc. — Keegan's
  connection IDs that don't exist on Jake's Composio account. Caught
  proactively.
- **Root cause:** `composioPromptHint()` hardcoded ViaOps's full
  routing table with specific connection IDs and business contexts
  (SimHouse, Chief of Chaos, etc.).
- **Fix shipped:** `cca9901` — runtime-discovery via
  `COMPOSIO_MANAGE_CONNECTIONS`; instruct Claude to read user's
  Profile.md for routing or call MANAGE_CONNECTIONS at runtime to
  discover real connection IDs. Never invent.
- **Severity:** High-friction (would've caused silent wrong-account
  routing).

### 2.6 Chat panel could bill Keegan for Jake's chat tokens

- **What Jake saw:** Hypothetically if he'd opened the chat panel
  before adding his Anthropic key — `resolveOrgLlmKey()` would
  fall back to `process.env.ANTHROPIC_API_KEY` (Keegan's) and bill
  Keegan's account.
- **Root cause:** Env-var fallback intended for Keegan's backwards-
  compat. For NEW users, it's a leak.
- **Fix shipped:** `040fd60` — gate chat panel UI on per-org
  Anthropic key being set. Empty → CTA to `/settings/llm-keys`. No
  way to fire the chat until a key is configured.
- **Severity:** Blocker for the chat panel, but didn't block install
  flow (Jake added his key in step 4 before trying chat).

### 2.7 Copy buttons didn't show "Copied!" feedback

- **What Jake saw:** Clicking Copy for the MCP URL / sync key /
  install command — no visible feedback. Confusing.
- **Fix shipped:** `009ce5d` — reusable `<CopyButton>` component
  with inline "Copied!" green checkmark for 1.5s. Three call sites
  updated.
- **Severity:** Polish.

### 2.8 `/settings/sync` was empty for new users

- **What Jake saw:** Settings → Sync had zero connections to toggle.
- **Root cause:** `sync_configs` rows were originally seeded for
  Keegan from the Composio Mapping doc. New users have no rows.
- **Fix shipped:** `dcc6385` — added "Fetch connections from
  Composio" button + `POST /api/orgs/sync-configs/refresh` endpoint.
- **Severity:** Blocker. Without it, Jake couldn't manage which
  Composio connections feed his brain.

### 2.9 Onboarding rows weren't fully clickable

- **What Jake saw:** Tried clicking onboarding step titles to navigate
  to setup pages — nothing happened. Only the tiny "Setup
  instructions →" text was a link.
- **Fix shipped:** `26512e2` — entire pending row is a `<Link>`; inner
  buttons (Mark as done, Undo) use stopPropagation.
- **Severity:** High-friction.

### 2.10 Onboarding rows had no manual override

- **What Jake saw:** "Install local sync daemon" stayed pending even
  after daemon was running (auto-detect lag); no way to mark it
  manually done.
- **Fix shipped:** `407fb19` — "Mark as done →" button per pending
  step + persistent dismissal via localStorage + "Refresh" button.
- **Severity:** High-friction.

### 2.11 Onboarding checklist disappeared post-completion

- **What Jake saw:** After completing all 5 steps, the checklist
  hid itself entirely — no path back to `/settings/claude` for the
  Project Instructions download.
- **Fix shipped:** `702f2ba` — added "Quick links" card on the
  post-onboarding dashboard with prominent links to Claude setup,
  Composio, LLM keys, Sync.
- **Severity:** High-friction.

### 2.12 Repo was private — daemon install needed GitHub auth

- **What Jake saw:** `git clone` step asked for username + password
  (which won't work — GitHub deprecated password auth).
- **Fix shipped:** Made the repo public on GitHub. (Tarball download
  is the proper long-term fix; see §4.)
- **Severity:** Blocker. Without the fix, Jake couldn't install the
  daemon without me adding him as a collaborator + setting up `gh`.

### 2.13 Daemon include list was Keegan-specific

- **What Jake saw:** Daemon log: `[sync] found 0 markdown files in
  included paths` after scanning his Documents folder.
- **Root cause:** `agent/src/config.ts` hardcoded include list:
  `Knowledge, Pipeline, Clients, Coaching, SimHouse.io, Website,
  LinkedIn, Partners, Meetings` — Keegan's vault structure. Jake's
  Documents folder doesn't have any of those.
- **Fix shipped:** `398ccb1` — `install-daemon.ts` adds `--include`
  flag, defaults to `"."` (whole vault root), writes `SYNC_INCLUDE`
  into the plist env vars.
- **Severity:** Blocker.

### 2.14 Mapper.ts rejected non-Keegan folder structures

- **What Jake saw:** Even after fix #13, daemon log: `1706 ignored,
  0 synced`.
- **Root cause:** `agent/src/mapper.ts` returned `{kind: "ignore",
  reason: "no mapping rule"}` for any path not matching Keegan's
  hardcoded folder prefixes (`Knowledge/`, `Pipeline/`, etc.).
- **Fix shipped:** `e465b21` — permissive default: any markdown or
  known-extension file falls through to `wikiOrFile(undefined)`
  instead of ignore. Keegan's specific mappings still produce
  tagged entries for HIS structure.
- **Severity:** Blocker.

### 2.15 syncOne's include check didn't handle `"."` sentinel

- **What Jake saw:** Even after fixes #13 and #14, still `0 synced`.
- **Root cause:** `agent/src/sync.ts` had `relative.startsWith(\`${p}/\`)`
  check. With `p="."`, `"MyFolder/file.md".startsWith("./")` is
  false. Files bailed BEFORE mapper.ts ran.
- **Fix shipped:** `ffb4733` — special-case `p === "." || p === ""`
  to mean "match anything."
- **Severity:** Blocker. Third bug in the daemon-include chain.

### 2.16 CRITICAL: MCP context leaked Keegan's data to Jake's Claude

- **What Jake saw:** His Claude reported "ViaOps with 7 spaces: XP
  Flow, Garden Hero, My Electric Home, Trade Oracle, SimHouse,
  ViaOps Internal, Coaching." Every space is Keegan's. Files,
  contracts, contact cards — all visible.
- **Root cause:** `resolveOrgContext()` module-cached `_cached`
  across all requests + had no concept of per-user. Every MCP call
  resolved to "first org" or `MCP_USER_ID` env var (Keegan's).
  This was the deferred ADR-037 §"Scope NOT shipped" item.
- **Fix shipped:** `595c1de` — AsyncLocalStorage. `runWithRequestContext({userId})`
  wraps `mcp(req)` so the setup callback (mcp-handler invokes it
  per-request — confirmed by reading their source) sees the right
  userId. `resolveOrgContext()` reads from ALS first, falls back to
  env / first org only when userId is null (legacy MCP_API_KEY path).
- **Severity:** **CRITICAL.** This was a data isolation breach. Jake
  could have read AND written to Keegan's vault via MCP. Caught
  ~2 hours into the install when Keegan ran the Project Instructions
  in Jake's AXIS and got back Keegan's org data.
- **Lesson:** The deferred-from-MVP item in ADR-037 was labeled as
  "not blocking" — it was very blocking. Multi-tenant data isolation
  is never deferrable.

### 2.17 Composio MANAGE_CONNECTIONS rejected by MULTI_EXECUTE wrapper

- **What Jake saw:** `/settings/sync` "Fetch connections" button
  returned 0.
- **Root cause:** `executeComposioTool()` always wraps in
  `COMPOSIO_MULTI_EXECUTE_TOOL`. Composio rejects:
  `"X is a Tool Router helper tool and cannot be executed inside
  COMPOSIO_MULTI_EXECUTE_TOOL."`
- **Fix shipped:** `2ee38f6` — new `callComposioToolDirect()` helper
  that bypasses MULTI_EXECUTE for meta-tools.
- **Severity:** Blocker.

### 2.18 MANAGE_CONNECTIONS required `toolkits` arg

- **What Jake saw:** After fix #17, debug returned
  `"Required at 'toolkits'"` validation error.
- **Fix shipped:** `b3501a5` — pass a comprehensive list of 30 common
  toolkits.
- **Severity:** Blocker.
- **Side effect:** Calling MANAGE_CONNECTIONS with toolkits the user
  doesn't have auto-initiates new auth flows (10-min expiry).
  Pollutes Composio dashboard temporarily. See §4 for the proper fix.

### 2.19 Response parser used wrong shape

- **What Jake saw:** After fix #18, debug returned a valid response
  but our parser found 0 connections.
- **Root cause:** Response is `data.results.<toolkit>.accounts[]`.
  Generic recursive parser looked for `id + app/toolkit` fields on
  the account objects, but accounts only have `id + status + alias`
  (toolkit name is the parent object key).
- **Fix shipped:** `cc28bb8` — specific parser for the confirmed
  shape, filters `status === "active"` to ignore the side-effect
  "initiated" entries.
- **Severity:** Blocker.

### 2.20 (Caught proactively, not shipped) Slugify produces `-s-`

- **What Keegan saw:** Jake's user-tag is `jake-leskovar-s-brain`.
  The `'s` in "Jake Leskovar's Brain" slugified to `-s-` instead of
  being stripped. Cosmetic but ugly.
- **Severity:** Polish. Not blocking but ugly for Richard
  (`richard-lackey-s-brain`). Fix scheduled tonight.

### 2.21 (Caught proactively, not shipped) `deriveSpaceIdFromPath` Keegan-hardcoded

- **What Jake saw:** Files synced as flat wiki entries; no spaces
  auto-created.
- **Root cause:** `/api/sync/wiki/route.ts` only recognizes
  `Clients/`, `SimHouse.io/`, `Coaching/` as space-creating prefixes.
- **Severity:** High-friction. Jake's vault has docs but no
  space groupings. Workaround: have Claude create spaces
  conversationally via `create_space`.
- **Fix scheduled:** tonight, before Thursday.

---

## 3. Root cause clustering — the meta-lessons

### 3.1 The "Keegan-as-only-test-user trap" (8 of 16 bugs)

Bugs 2.4, 2.5, 2.6, 2.8, 2.13, 2.14, 2.15, 2.21 all share the same
root cause class: **code that hardcoded Keegan-specific assumptions
because Keegan was the only test user**. Folder names, business
contexts, default routing, Composio connection IDs, system prompt
prose, env-var fallbacks.

**The pattern:** ship feature → test on Keegan's data → works → ship
to prod → first non-Keegan user fails.

**The encoded prevention** (Profile.md, Section 4 — added today):

> **Audit before claiming "ready for new users":** before shipping
> any feature that touches user-scoped data, search the codebase for:
> - References to "ViaOps", "Keegan", "keegan@", "viaops.co"
> - Specific folder names that aren't user-configurable
> - Hardcoded Composio connection IDs
> - Module-level caches that don't reset per user
> - Default env-var fallbacks that lean on Keegan's values

### 3.2 The "scope NOT shipped"-from-MVP item that actually shipped (bug #16)

ADR-037 explicitly scoped per-user MCP context as deferred. It
**said** the v2.0 MVP would resolve to the default org. That seemed
safe at the time — Keegan was the only user.

The error: as soon as a second user signed up, that "default org"
became a data isolation breach. **Deferring per-user data scoping
to "v2.1" was actually deferring trust + correctness.** Not optional
for any multi-user scenario.

**Lesson:** items labeled "deferred — not blocking" in MVP scope
should be re-audited specifically for trust/security implications
before any second user signs up. Encoded in §5.

### 3.3 Composio response-shape archaeology (bugs #17, #18, #19)

Composio's API surfaces don't match their documented shapes
exactly. We had to debug-mode our way to the real schema by reading
actual responses, not docs. **Three sequential fix iterations** to
get MANAGE_CONNECTIONS working.

**Lesson:** for external APIs, ship the debug-mode endpoint FIRST,
test against real data, then ship the real parser. Saves multiple
deploy cycles. Encoded in §5.

### 3.4 Onboarding UX papercuts (bugs #2.7, #2.9, #2.10, #2.11)

Small UX issues that compound. Each one is "obvious" in isolation
but I didn't think about them because I'm not a new user — I never
exercised the "I just signed up and I'm confused" path.

**Lesson:** for onboarding UI specifically, dogfood on a fresh
account before shipping. Keegan was going to do this Wednesday;
Jake replaced that test. Jake's friction WAS our dogfood. Without
him we'd have shipped these to Richard cold.

---

## 4. What's still broken / unaddressed

In priority order for Thursday (Richard's install at noon Thursday
2026-05-14).

### Must fix before Thursday

| # | Issue | Status |
|---|---|---|
| MF-1 | **`deriveSpaceIdFromPath` Keegan-hardcoded** (bug #2.21) — Richard's files won't group into spaces. Fix: drop it, let Claude create spaces conversationally via `create_space` (per ADR-026). | Fixing tonight |
| MF-2 | **Slugify produces `-s-`** (bug #2.20) — `Richard Lackey's Brain` → `richard-lackey-s-brain`. Strip apostrophes properly before slug split. | Fixing tonight |
| MF-3 | **Org-name placeholder says "ViaOps"** on `/settings/org` — confusing for non-Keegan. Generic placeholder. | Fixing tonight |
| MF-4 | **MANAGE_CONNECTIONS auto-initiates auth flows** for toolkits user doesn't have (bug #2.18 side effect). Clutters Composio dashboard. Use a different Composio endpoint that lists existing only, no initiation. | Investigating; if no clean endpoint, narrow the toolkit list to common ones + add UI warning. |
| MF-5 | **Obsidian deep-link in synthetic wiki bodies hardcoded `vault=ViaOps`** (caught by post-fix Keegan-audit grep — `agent/src/sync.ts`). For any user without an Obsidian vault named "ViaOps" the "Open in Obsidian" link silently 404s. Fix: thread `OBSIDIAN_VAULT_NAME` env var from install-daemon → plist → sync.ts; skip the link entirely when unset; install-command UI passes the user's configured `organizations.vault_name` as `--vault-name`. | Fixed tonight. |

### Nice-to-have for Thursday

| # | Issue | Why nice |
|---|---|---|
| NH-1 | **Tarball download for daemon install** (replaces `git clone`) — repo is public for now so unblocked, but tarball is cleaner. | Polish; repo-public works. |
| NH-2 | **macOS `.pkg` installer** — Richard runs Terminal anyway, this just makes it nicer. | Polish. |
| NH-3 | **Daemon-connected detection lag** (~30s after first sync) — auto-detect should fire faster. Manual override exists. | Polish. |
| NH-4 | **Composio adapters for non-Gmail toolkits** — Drive, Notion, Slack, etc. accept the sync toggle but don't actually pull. Richard might want Drive auto-sync. | Per-toolkit adapter work; F4 v2 follow-up. Not blocking for Thursday since he can use Composio via Claude manually. |

### Deferred — not for Thursday

| # | Issue | When |
|---|---|---|
| D-1 | **Encryption at rest** for Composio/LLM/OAuth keys. Today plaintext in DB. | v2.1 |
| D-2 | **`org_memberships` table + invite flow + visibility** — multi-member orgs. | v2.1+ |
| D-3 | **Multi-org doc membership** (Venn diagram from planning convo) — when a user is in 2+ orgs and a doc lives in both. | v2.1+ |
| D-4 | **Per-org Composio routing UI** (toggle which connections feed which org). | v2.1 |
| D-5 | **Stripe billing**. | Charging-time |
| D-6 | **Audit log UI**. | v2.1 |
| D-7 | **Email notifications**. | v2.1 |
| D-8 | **Off-boarding flow polish**. | v2.1 |
| D-9 | **DCR registration_access_token** for abuse prevention. Today anyone can register. | v2.1 |
| D-10 | **Windows + Linux daemon installers**. | v2.3 |

---

## 5. Encoded lessons (so this doesn't recur)

Added to Profile.md Section 4 as standing rules:

### 5.1 Keegan-hardcode audit before "ready for new users"

Before shipping any feature that touches user-scoped data:

```bash
# Run these greps from project root. Any hits get reviewed.
grep -rE "ViaOps|viaops|keegan@viaops|/Users/keeganlamar|Berret|Finn-Septa" src agent --include="*.ts" --include="*.tsx"
```

Manual checks:
- Are there default folder names hardcoded that aren't user-configurable?
- Are there module-level caches that don't reset per user?
- Are there env-var fallbacks that lean on Keegan-specific values?
- Are there Composio connection IDs anywhere in code?

If any found: either generalize, surface as user config, or scope per-user via AsyncLocalStorage / per-request context.

### 5.2 No "deferred" items that touch trust/data-isolation

When labeling an MVP scope item as "deferred — not blocking":
- If it touches multi-tenant data isolation → it IS blocking. Reclassify.
- If it touches authentication / authorization scoping → IS blocking.
- If it touches per-user credentials / API keys → IS blocking.

The list of "safe to defer" items: UI polish, secondary integrations,
optional features. Not anything in the trust path.

### 5.3 External-API integration: debug mode first

For Composio, Granola, future GPT/Gemini integrations:
- Ship a `?debug=1` endpoint variant that returns the raw API response shape.
- Use real data to confirm the shape BEFORE writing the parser.
- Document the shape in the code comments next to the parser.

Saves the "ship parser → wrong shape → debug → reship → wrong → debug → reship" loop we hit with Composio MANAGE_CONNECTIONS.

### 5.4 Dogfood EVERY new onboarding path on a fresh account

Even if you have one real user to test with: the fresh-account-FROM-SCRATCH walk is its own thing. Sign up with a throwaway account on production. Walk every step. Note every friction. Don't assume.

If a real user is doing the dogfood: pair with them live, watch every step, catch friction in real time.

---

## 6. Thursday (Richard) checklist

Run these before the noon Thursday call:

### Pre-call audit

- [ ] Repo state: confirm at `cc28bb8` or later, no broken commits since
- [ ] MF-1 through MF-4 shipped + deployed
- [ ] Sign up a fresh Google account, walk the full onboarding on the deployed platform end-to-end
- [ ] Confirm: Custom Connector setup works (DCR fires)
- [ ] Confirm: MCP returns the test account's org, not Keegan's
- [ ] Confirm: Composio Fetch button returns at least the test account's connections
- [ ] Confirm: daemon install command works on a fresh shell
- [ ] Confirm: lead-agent patch downloads + makes sense pasted into a new Claude Project

### During the call

- Send Richard the sign-up URL: `https://shared-brain-ecru.vercel.app/sign-up`
- Walk steps 1-8 of the Runbook §"Onboarding a new user (Phase 8 v2 MVP)"
- For lead-agent patch: drop into his existing AXIS-style setup if he has one, else use full Project Instructions for a fresh Project
- Verify with: *"Look at my brain and tell me what's there. What spaces have been set up?"*

### What's different from Jake

- Richard has fewer pre-existing Composio toolkits — flow is shorter
- Richard's vault probably differs in structure — but mapper.ts is now permissive so any folder structure works
- DCR is now in place → connector setup won't fail
- MCP per-user is in place → Richard sees only his data

---

## 7. Process improvements

### 7.1 Spawn_task discipline (already encoded, validated today)

The rule we added Monday — main session owns the doc pass for
spawn_task work — held up well today. All live fixes were
documented in commit messages with clear root-cause / fix-shipped
notes. Post-mortem assembly was easy because the trail existed.

### 7.2 Comprehensive doc pass after EVERY install

Same pattern: after Richard Thursday, do an immediate post-mortem
update (append a §"Richard's install" section to this doc). Capture
new failure modes. Update Profile.md rules if any new pattern
emerges.

### 7.3 Two-week buffer before next install attempt

After Richard Thursday: don't schedule a third user immediately.
Use the time to:
- Land the deferred v2.1 items that touch trust (encryption at rest, etc.)
- Build the macOS `.pkg` installer
- Wire more Composio adapters
- Add audit log UI
- Stripe + billing setup

When the third user signs up, the experience should be 30 minutes
of guided onboarding, not 3 hours of live-fixing.

---

## 8. What worked

Worth naming the wins too:

- **OAuth flow worked first time** for Jake (after we shipped DCR mid-call). The Phase 8 v1 + Desktop migration foundation was solid.
- **Daemon installed cleanly via `npm run install-daemon`** once we got past the include-prefix issues. The plist generation + launchctl flow is robust.
- **Per-org LLM keys + Composio keys + sync keys ARE properly isolated.** Once the per-user MCP context was fixed, end-to-end isolation worked.
- **`get_document` + URL-enriched search** worked perfectly on Jake's data. He was browsing his vault content within seconds of the initial sync starting.
- **Live-fix-and-redeploy loop was fast.** Vercel deploys in 60-90 seconds; tsx hot-reloads the daemon code on git pull + launchctl bootstrap. Total turnaround per fix: ~2-3 minutes. Without that velocity, this install would have taken a day instead of 3 hours.

---

## 9. Sign-off

This document is the source of truth for the Tuesday 2026-05-12
install retrospective. Updates: append new findings as they emerge,
mark Thursday checklist items as they're completed, append
Richard's install section after Thursday.

**Owners:** Keegan (product + execution), Claude (code + docs).

---

# Part Two — Richard Lackey's Install (2026-05-14)

> **Status:** Second non-Keegan install end-to-end. 5 new must-fixes
> shipped live during the call (MF-10 → MF-14). All Jake-era fixes
> held up — none of the 16 bugs from his install recurred for Richard.
> **Outcome:** Richard's brain live, three cloud-synced vault folders
> watched, custom connector connected, Composio connections imported
> and labeled. Install completed in well under Jake's 3-hour mark
> despite hitting an entirely new class of issues (cloud-offloaded
> files).
> **What this part is for:** capture the new failure modes that hit,
> the fixes shipped, and the lessons for future installs.

---

## 10. Executive summary — Richard's install

Phase 8 v2 MVP shipped Monday 2026-05-11. Jake's install Tuesday
caught 16 bugs. Tonight's MF-1 through MF-9 patches shipped Wednesday
covered every known Keegan-hardcode. **Richard's install Thursday
2026-05-14 caught zero Jake-era regressions** but uncovered a new
class of issues centered on cloud-synced vault folders and Composio
account labels.

**Severity classification:**

| Severity | Description | Count |
|---|---|---|
| Critical | Data isolation breach | **0** |
| Blocker | User couldn't progress past a step | 2 |
| High-friction | User could progress but path was broken or confusing | 2 |
| Polish | Cosmetic / UX nits | 1 |
| **Total** | | **5** |

**Time:** about 90 minutes of active install time. Down from Jake's
~3 hours. The Jake-era fixes (DCR, AsyncLocalStorage for MCP,
generic deriveSpaceIdFromPath, slug strips `'s`, MANAGE_CONNECTIONS
trim + warning, etc.) all paid off — none of those classes hit again.

**Single biggest learning:** **cloud-synced vault folders are the
dominant real-world pattern**, not the Obsidian-on-local-disk
pattern we'd built around. Richard's three vault paths are Google
Drive, Dropbox, and iCloud Drive — all of which dehydrate files
("Optimize Mac Storage" / "Stream files" / etc.) by default. The
daemon's chokidar watcher + extraction libraries assume materialized
local files.

---

## 11. The bugs (in order they hit)

Same format as Part One: what hit, root cause, fix, severity.

### 11.1 Multi-folder install command only watches the first folder

- **What Richard saw:** UI banner on `/settings/daemon` said
  "additional folders are passed through to the config and will be
  live-watched in the next update (v2.1)." He had 5 folders.
- **Root cause:** `agent/src/index.ts` used `loadConfig()` (single
  config) for the watch loop. `loadAllConfigs()` existed but wasn't
  wired up. EXTRA_VAULT_PATHS env var was being written to the plist
  but never read by chokidar.
- **Fix shipped:** `29a1e77` (MF-10) — refactored `fullScan` and
  `watch` to iterate `loadAllConfigs()`. Each config gets its own
  chokidar instance using ITS vaultRoot for relative-path
  computation. Shared ApiClient (extras inherit apiKey + apiBase).
  Pull-down still uses primary only (platform doesn't distinguish
  vault roots — v2.1 design question). SIGINT/SIGTERM close all
  watchers. UI banner flipped to emerald "all N folders watched."
- **Severity:** Blocker (claim-broken UX — multi-folder users
  couldn't actually use multi-folder).

### 11.2 npm install errored on cache permissions

- **What Richard saw:** `npm error code EEXIST` / `npm error EACCES:
  permission denied, mkdir '/Users/GFEGROUP1/.npm/_cacache/...'`
- **Root cause:** Generic npm-on-macOS issue — someone (probably
  Richard or his admin) had at some point run `sudo npm install`,
  leaving files in `~/.npm/` owned by root that non-root npm can't
  write to. Not our codebase.
- **Fix:** `sudo chown -R $(whoami) ~/.npm` (one-liner Richard ran).
- **Severity:** Blocker (full install dead until cache ownership
  fixed). **Worth documenting in the Runbook**.
- **Lesson:** add this to pre-install checklist or surface it as a
  detectable error during install. The error message npm gives is
  clear; we just need to tell users to expect it.

### 11.3 Cloud-offloaded files: "unknown system error -11, read"

- **What Richard saw:** First sync completed, but most binary file
  pages showed "file stored. extract failed: unknown system error
  -11, read." Files cataloged with metadata + Obsidian deep-link,
  but content not indexed.
- **Root cause:** macOS returns errno -11 (EAGAIN-ish) when you try
  to `fs.readFile()` a dehydrated cloud file. Richard's three vault
  paths (Google Drive, Dropbox, iCloud) all default to offloaded-by-
  default. The extraction libraries (pdf-parse, mammoth, xlsx)
  internally call `read()` which fails on dehydrated stubs.
- **Fix shipped:** `c83af7d` (MF-11) — two parts:
  - `agent/src/extract.ts` catches the cloud-offload error class
    and surfaces a useful message: "extract skipped: file offloaded
    to cloud. Set your sync folder to 'Always Keep on this Mac' /
    'Available Offline' / 'Mirror files'."
  - `agent/src/sync.ts` bumped the file_artifact contentHash salt
    from v3 → v4. Same pattern as when pdf-parse was fixed. Forces
    every binary file to re-hash → server sees them as changed →
    re-extracts. Users can fix their cloud settings, restart daemon,
    and re-extraction happens on the startup full-scan.
- **Remediation Richard did:** Google Drive → switched from "Stream
  files" to "Mirror files." Dropbox → "Make available offline."
  iCloud → turned off "Optimize Mac Storage." Re-ran install command
  → daemon restarted → re-extraction kicked off.
- **Severity:** Blocker for content search. Files were cataloged
  (search-by-title worked) but search-by-content didn't until fix +
  remediation.

### 11.4 Composio connection labels were cryptic IDs

- **What Richard saw:** `/settings/sync` showed connections as
  "gmail (gmail_xxx-yyy)" instead of "gmail — richard@..."
  for most of his accounts.
- **Root cause:** Composio's `MANAGE_CONNECTIONS` response for
  Richard's accounts didn't include the `alias` field that our
  parser looks for. Different shape from Keegan's accounts. We had
  no fallback enrichment.
- **Fixes shipped:**
  - `3d79873` (MF-12) — inline rename UI on `/settings/sync`. Click
    a label → input field → type new name → Enter saves. Plus a
    PATCH endpoint accepts `label` field. Quick win for any user
    whose Composio aliases are missing.
  - `c5db526` (MF-13) — per-toolkit profile-call enrichment. For
    each connection, the refresh endpoint now does a follow-up call
    to the toolkit's profile/whoami tool (`GMAIL_GET_PROFILE`,
    `GOOGLECALENDAR_LIST_CALENDARS`, `NOTION_GET_ABOUT_ME`, etc.)
    and uses the extracted email/username as the label. Existing
    cryptic-fallback rows get UPDATED on Refresh; user-renamed
    rows are preserved. Response reports `relabeled` count.
- **Severity:** High-friction (could progress but path was confusing
  — users have to remember which `gmail_xxx-yyy` is which account).

### 11.5 Daemon page didn't remember configured vault paths

- **What Keegan noticed (after Richard left):** the `/settings/daemon`
  page starts with a blank input every visit. The daemon is watching
  Richard's three folders (live, working), but if anyone wanted to
  add a 4th folder they'd have to remember and re-type all three.
- **Root cause:** Vault paths only lived in the user's launchd plist
  on disk. DB had no record. UI had nothing to display.
- **Fix shipped:** `a3b6e0f` (MF-14) — `organizations.vault_paths`
  jsonb column (migration `0012`); PATCH `/api/orgs` accepts
  `vaultPaths`; daemon page renders previously-saved paths;
  "Save folders" button persists changes. To actually apply changes
  to a running daemon, user still re-runs install command (hot-reload
  is a v2.1 feature — daemon would need to poll for config changes).
- **Severity:** High-friction (general UX paper-cut, not a bug per
  se — feature gap).

---

## 12. Root cause clustering — Richard's lessons

### 12.1 Cloud-synced vault is the real-world default (not Obsidian-on-disk)

We built the daemon assuming a local Obsidian vault folder on the
user's disk. **Richard's setup is more representative**: three
different cloud-sync apps holding work documents. This is going to
be the norm, not the exception, for non-developer users.

**What this means for the product:**
- Pre-install checklist must include "set cloud folders to keep-
  downloaded" guidance per provider (Google Drive Stream vs Mirror,
  Dropbox Local vs Online-Only, iCloud Optimize Mac Storage off).
- Long-term: detect cloud-synced paths at install time and warn the
  user. macOS exposes `xattr -p com.apple.metadata:com_apple_iCloudHasItem`
  and similar markers — we can detect and prompt.
- Even longer-term: an extraction-retry policy that materializes
  the file via `read()` and waits for it to fault in. Possible but
  finicky across three different cloud providers.

### 12.2 Composio response shape varies across users

Composio's MANAGE_CONNECTIONS response includes `alias` for some
users (Keegan's accounts have it because he set aliases in
Composio's web UI). Other users (Richard) get accounts without
aliases. **We can't rely on alias being present.**

The fix (MF-13's per-toolkit enrichment) is the right pattern: do a
follow-up call to the toolkit's own profile/whoami tool. Each
toolkit has one, and they reliably return the account's email or
identifier. Generalized in `PROFILE_ENRICHERS`.

**Encoded:** the discipline rule that comes out of this is —
**"don't trust Composio's account metadata; verify with a per-tool
profile call."** Belongs in the Runbook's "Adding a new toolkit
adapter" section.

### 12.3 Server-side state of truth needs to lead, not the plist

MF-14 is a specific example of a broader pattern: **the DB should
be the source of truth**, not the user's local plist. Vault paths,
sync key state, daemon mode (on/off), etc. — all should be
DB-canonical, with the daemon reading from a per-user config
endpoint at startup. This sets us up for hot-reload (daemon polls
config) and remote management (turn off a misbehaving daemon from
the dashboard).

For now: MF-14 brings vault paths into the DB. Future work: bring
the rest of the daemon config in too.

---

## 13. What's still broken / unaddressed (carry forward)

Still on the list from Part One (Jake) — none of these blocked Richard:

| # | Item | Severity for next install |
|---|---|---|
| D-1 | Encryption at rest for API keys (LLM, Composio, OAuth) | Low — internal threat model only |
| D-2 | `org_memberships` table + invites | Required when first multi-member org signs up |
| D-9 | DCR registration_access_token (abuse prevention) | Low — token-rotation handles it for now |
| Stuck-conflict daemon loop | Daemon keeps logging "will push local back up" but never does | Annoying log spam, not functional break |
| `/api/operating-instructions` 401 | Bearer token in global CLAUDE.md mismatches prod env var | Affects live Profile.md sync; users fall back to local copy |
| Clerk dev-mode in production | Free-tier dev instance still running prod | Worth switching before user #5 |
| No installer-package for non-technical users | Need Apple Developer cert ($99/yr) | Required when onboarding non-Terminal users |

New items from Richard:

| # | Item | Severity |
|---|---|---|
| R-1 | Cloud-offload detection at install time | High — every cloud-vault user will hit this |
| R-2 | Daemon hot-reload (poll config from platform) | Medium — install-to-apply-changes is clunky |
| R-3 | Cross-vault path collision handling | Medium — if same filename exists in two vault roots, platform sees them as the same file |
| R-4 | Pre-install npm cache permission check | Low — easy to fix when it hits |

---

## 14. Thursday lessons → discipline rules

Following ADR-038 Rule 5 (every install gets a post-mortem with new
pattern detection), here are candidate rules emerging from Richard's
install:

### 14.1 (Add to Runbook) Pre-install: cloud-vault setup

For users whose vault paths point at cloud-synced folders, surface
the keep-downloaded settings BEFORE the daemon install. This is the
single biggest friction class for non-Obsidian users.

### 14.2 (Add to ADR-038 or new ADR) Don't trust external API metadata

When integrating an external service that returns account metadata
(Composio's MANAGE_CONNECTIONS, future Linear API, etc.), don't
assume optional fields will be present. **Always have a fallback
enrichment path** using the service's own profile/whoami tool.

### 14.3 (Add to discipline rules) Server-side state of truth

Anything user-facing that's persisted somewhere (vault paths,
daemon mode, Composio routing prefs, etc.) should live in the DB
first, with daemon/client config DERIVED from that. Plist/local
config is a deployment artifact, not the source of truth.

---

## 15. What worked (Part Two)

Worth naming again:

- **Zero Jake-era regressions.** All 16 fixes from Tuesday + the
  MF-6 through MF-9 pre-Thursday batch held up. AsyncLocalStorage,
  DCR, deriveSpaceIdFromPath, slug strip, MANAGE_CONNECTIONS trim,
  multi-vault path argv — every one worked first time for Richard.
- **Live-fix-and-redeploy loop still fast.** Same 60-90s deploy
  cadence. Five fixes shipped during the call (~90 minutes total)
  vs. Jake's 19 fixes in ~3 hours. Velocity is improving.
- **Path picker (Local vault / Cloud-only) on the onboarding
  checklist worked as expected.** Richard picked local, daemon
  step stayed visible, others not affected.
- **Auto-polling on the onboarding checklist** ticked his daemon
  step green automatically once the first sync fired. No manual
  refresh needed.
- **The daemon's multi-vault support** (shipped live in MF-10)
  worked first time. All three of his vault roots got their own
  chokidar watcher. No code that needed iteration.
- **Inline rename UI** on `/settings/sync` shipped before the
  enrichment fix — useful immediate escape valve for users with
  cryptic labels.

---

## 16. Carry-forward to next install

If a third user signs up before we finish v2.1, the pre-install
checklist becomes:

1. **Cloud-vault setup** (NEW) — if their vault is in Google Drive,
   Dropbox, iCloud, or OneDrive, set the folder to keep-downloaded
   BEFORE running the install command.
2. npm cache permissions (NEW) — `sudo chown -R $(whoami) ~/.npm`
   is the standard fix for `EACCES` during install.
3. Run the Keegan-hardcode audit + fresh-account dogfood (per ADR-038
   Rules 1 + 4).
4. Confirm Vercel deploy is green + DCR endpoint healthy.

After-install:
1. Append a section to this doc (per ADR-038 Rule 5).
2. Watch the daemon log for the first 10 minutes of sync — flag any
   "extract skipped" / "extract failed" lines.
3. Verify search-by-content actually returns hits, not just
   search-by-title.

**Note for ourselves:** the velocity from Jake → Richard improved
because we'd already done the discipline-rule pass. The velocity
from Richard → Rafael (or whoever's next) will improve again because
we just added the cloud-vault + npm-cache rules. Each install adds
to the kit.

---

# Part Three — The 600k Vercel Edge Request Incident (2026-05-15)

> **Status:** Incident response. Post-Richard-install runaway daemon
> traffic detected ~18 hours after his install completed. Root cause
> identified + shipped. Lessons captured here as Part Three.
> **Outcome:** Two-tier defense (rate limiter at gate, root-cause fix
> in daemon) shipped within 90 minutes of detection.
> **What this part is for:** capture the new failure mode that hit,
> the diagnosis path, the fix, and the discipline rules.

---

## 17. Incident summary

**Detection:** Vercel emailed Keegan that the project had received
~600,000 edge requests that morning — astronomical vs. normal ~few
thousand. Keegan flagged this as a possible DDoS.

**Reality:** Not an attack. **Richard's daemon was in a false-positive
feedback loop with his cloud-sync apps** (Google Drive, Dropbox,
iCloud), generating ~12 POSTs/second to `/api/sync/wiki` for the
~18 hours since his install. ~12/sec × 18h ≈ 770k requests; Vercel's
~600k was a partial window.

**Severity:** **Blocker for sustained operation.** Hobby plan caps
at 1M edge middleware invocations/month — Richard's daemon alone
was burning the entire monthly cap in ~2 days. Keegan upgraded to
Pro mid-incident to buy headroom.

---

## 18. Root cause

The daemon's hash for binary files (file_artifact) was:

```
sha1('v4|<path>|<size>|<mtimeMs>|blob:<0|1>')
```

**mtime is the smoking gun.** Cloud-sync apps periodically touch
files for non-content reasons:
- Metadata updates from the cloud server (modified time, sharing
  permissions, etc.)
- Sync state changes (file moves between "offloaded" and "downloaded")
- Materialization when a previously-offloaded file gets pulled local
- App-level housekeeping (Dropbox's `.dropbox.cache` operations)

Every cloud touch → new mtime → new hash → daemon thinks "content
changed" → POSTs to `/api/sync/wiki`. Server-side dedup recognized
that the contentHash didn't match an existing vault_sync_log row
(because the hash literally was different), wrote a new row, and
returned 200. But on the next chokidar fire 80ms later, the same
file got POSTed again with a slightly-different mtime, repeat.

**Why this didn't bite Jake or Keegan:** Jake's daemon was watching
local Obsidian folders (no cloud sync). Keegan's daemon watches
`~/Documents/ViaOps` which is a regular local folder. Richard is
the first user with three cloud-synced vault paths.

**Why we shipped v4 yesterday and made it worse:** MF-11 yesterday
bumped the hash salt from v3 → v4 to force re-extraction after
fixing the cloud-offload error handling. That re-hash invalidated
all of Richard's prior vault_sync_log entries and triggered a fresh
mass-resync. The first wave was legitimate (~3,800 binary files);
every wave after that was the runaway feedback loop.

---

## 19. Diagnosis path (what worked, what didn't)

### 19.1 First attempt: Composio Vercel API (didn't work)

Keegan said he'd connected Vercel via Composio. Tried
`VERCEL_GET_DEPLOYMENT_LOGS2` (returned empty — build logs only,
not runtime), then `VERCEL_GET_DEPLOYMENT_EVENTS2` (returned build
events, not runtime request data). **Vercel's REST API does NOT
expose per-path runtime invocations on Hobby plan.** Composio can
inherit this limitation faithfully but can't bypass it.

### 19.2 Second attempt: our own DB-level signals (partial)

Wrote `scripts/traffic-audit.ts` to count:
- `mcp_request_log` rows (59 in 24h — normal)
- `activity_feed` rows (6,720 in 24h, dominated by `sync_wiki_create` + `sync_wiki_update`)
- `vault_sync_log` rows (3,794 in 24h)

This confirmed daemon traffic was HEAVY but didn't reveal the
runaway loop pattern. 3,794 DB-write counts is way less than 600k
edge requests — the mismatch hinted the issue was POST-but-dedup-
skipped, not actual writes. But couldn't see the rate from this
alone.

### 19.3 Third attempt: direct Vercel MCP server (worked)

Keegan added Claude's direct Vercel MCP connection (separate from
Composio's Vercel toolkit). It exposed `get_runtime_logs` which is
the right tool. Pulled 100 logs over the last 6 hours. Output
showed **49 POSTs to `/api/sync/wiki` in a single 4-second window**
(15:01:19 → 15:01:23). Pattern repeated across the log slice.

**Smoking gun.** ~12 req/sec sustained from one daemon = ~1M/day.
The 600k matched.

### 19.4 Lesson

**Direct Vercel MCP > Composio Vercel toolkit for our purposes.**
Composio is great for cross-app workflows but inherits whatever the
upstream API exposes. The direct Claude Vercel connector has a
larger surface (including `get_runtime_logs`). Keep both connected.

---

## 20. Fix shipped (MF-15 + MF-16)

### MF-15 — Defense layer (commit `8a0ae46`)

`src/proxy.ts` — Rate-limit middleware:
- 60 req/min/IP for unauthenticated public routes
- 600 req/min/IP for authenticated routes
- Skips `/api/sync/*` and `/api/cron/*` so legitimate daemon bursts
  aren't throttled
- In-memory sliding window (Map keyed by `scope:ip`)
- 429 with Retry-After header
- Lazy cleanup every 5 min
- **Limitation:** Vercel serverless model means each lambda instance
  has its own Map — state isn't shared across instances. Speed bump,
  not wall. Proper fix: Upstash or Vercel KV (see roadmap).

`src/components/onboarding-checklist.tsx` — Polling tightening:
- Interval bumped 8s → 30s (~25% of prior traffic)
- 5-min auto-stop so a forgotten tab can't generate thousands of
  requests overnight. User hits Refresh to re-arm.

`scripts/traffic-audit.ts` — Diagnostic script for future incidents.

### MF-16 — Root cause fix (commit `3d98d48`)

`agent/src/sync.ts`:

1. **Hash bumped v4 → v5, mtime removed:**
   ```
   sha1('v5|<path>|<size>|blob:<0|1>')
   ```
   Same path + same size + same blob-state = same hash regardless
   of how many times cloud-sync apps touch the file. Collision risk
   (same-path / same-size / different-content) is vanishingly rare
   for real-world docs — any meaningful edit changes byte count.

2. **Client-side in-memory dedup map:**
   `lastPushedHash: Map<absPath, hash>` lives for the daemon's
   session. Before any POST, check if current hash matches what
   we've already pushed. If yes, skip the POST entirely — saves the
   Vercel edge request before it leaves the daemon. `recordPush()`
   called at each successful `api.syncWiki/syncItem/syncActivity`
   call site. Resets on daemon restart (intentional — full-scan
   re-establishes the map on first sync after restart).

**For Richard:** he needs to re-run the install command from
`/settings/daemon`. Daemon restart will:
- Pick up v5 hash (one-time re-sync of his ~3,800 binary files)
- Initialize empty `lastPushedHash` map
- Run full-scan → populate the map
- Watch mode → only POST when content actually changes (size diff)

Expected traffic: from ~12/sec → essentially zero between real
edits.

---

## 21. Discipline lessons

### 21.1 mtime is unreliable for change detection in cloud-synced contexts

This was a Keegan-and-Jake-local-disk-only assumption baked in
since Phase 2. mtime works for Obsidian-on-disk; it's poisonous for
any cloud-synced folder. **For multi-tenant products, NEVER use
mtime as the primary change-detection signal.** Use content hash or
(if that's too expensive) size + content-hash-on-size-change.

### 21.2 "Server dedupes it anyway" is not enough

We had server-side dedup (`vault_sync_log` row match by path +
contentHash). We thought that was sufficient because "the server
returns skipped quickly." But every dedup-skipped POST still:
1. Hits the Vercel edge
2. Runs the auth middleware
3. Runs the route handler
4. Does at least one DB query (lookup before insert)

A POST that returns "skipped" still costs everyone (Vercel + DB +
network). **Client-side dedup is the real ratepayer.** Always
combine.

### 21.3 Watch your daemon traffic shape, not just the totals

3,794 DB writes in 24h looked reasonable in the audit. We almost
called it acceptable. The 600k Vercel-reported edge requests were
the actual signal — and the ratio (600k POSTs : 3,794 DB writes =
158x) was the smoking gun for "dedup-skipped storm." **Build a
metric for "POSTs that return skipped" so we'd catch this earlier
next time.** Could be a counter in vault_sync_log or a
`/api/status` field.

### 21.4 Add this to ADR-038 (multi-tenant discipline rules)

**Rule 6 — Don't use volatile filesystem metadata for change
detection.** mtime, ctime, atime, etc. can be churned by:
- Cloud sync apps
- Backup software
- Antivirus / spotlight indexing
- Container/VM clock drift

For change detection, use either:
- Content hash (best, but expensive for binaries)
- Size (cheap, catches >99% of real edits, but rare false negatives)
- Size + content hash on size-change (best balance)

NEVER mtime as the primary signal in a multi-tenant product.

---

## 22. Carry-forward

| # | Item | Severity |
|---|---|---|
| INC-1 | Upstash / Vercel KV migration for distributed rate-limiting (current in-memory is per-lambda) | 🟠 Pre-#5 |
| INC-2 | Add "dedup-skipped POST" counter to vault_sync_log so we'd catch the next runaway in monitoring | 🟢 Quality of life |
| INC-3 | Daemon-side circuit breaker: if POST rate exceeds N/sec for M minutes, log warning + back off | 🟢 Quality of life |
| INC-4 | Enable Web Analytics on Vercel Pro (now free for Keegan post-upgrade) so per-path data is always available | 🟢 Now-easy |
| INC-5 | Document the v5 hash format + the dedup map in the Runbook so future contributors don't accidentally regress | 🟢 Quality of life |

---

## 23. What worked

- **Direct Vercel MCP connection** — once Keegan added it, the
  diagnosis took 30 seconds. Without it we'd have been stuck.
- **In-memory dedup map** is a small change with huge impact.
  Sometimes the right fix is one Map.
- **Hash version-bumping** as a forced-replay mechanism continues
  to be the right pattern for daemon-side hash changes (v3 → v4
  → v5 all worked the same way).
- **Pro plan upgrade timing** — Keegan upgraded mid-incident, which
  was both the right call AND meant we could ship a fix without
  panicking about overages while doing it.
