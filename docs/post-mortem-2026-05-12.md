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
