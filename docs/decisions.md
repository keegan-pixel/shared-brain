---
title: Shared Brain — Architecture Decisions
created: 2026-04-30
updated: 2026-04-30
status: living-document
tags: [viaops-internal, shared-brain, decisions, adr]
related: "[[AI-Native PM Platform - MVP Spec]]"
---

# Shared Brain — Architecture Decisions

Running log of non-obvious choices made while building Shared Brain. Each
entry is a lightweight ADR — what we picked, what we rejected, and why.
Newest at the top.

> **Related:**
> - [[AI-Native PM Platform - MVP Spec]] — the original spec
> - [[Build Log]] — phase-by-phase narrative
> - [[Runbook]] — common ops tasks

---

## ADR-008 — `create_space` + `create_project` are MCP tools, not just REST

**Date:** 2026-04-30 · Phase 1
**Decision:** Expose space and project creation via MCP tools, not only via
the web REST API.

**Context:** The original spec listed only `create_item`, `create_wiki_page`,
and `add_backlink` as MCP write tools. Spaces and projects were "Phase 0
REST-only." First time the user tried to create a space via Claude Desktop,
the gap was obvious — agents naturally want to set up the full hierarchy
without tabbing back to the browser.

**Rejected:** Forcing browser-side creation. Worked technically but broke
the "AI-native" thesis that anything you can do in the UI you can do from
any Claude client.

**Trade-off:** Diverges from the spec, but the spec was incomplete. Updated
the [[Build Log]] to note this.

---

## ADR-007 — Lazy-init database client (Proxy pattern)

**Date:** 2026-04-30 · Phase 0 / fix during Vercel deploy
**Decision:** Wrap the Drizzle instance in a `Proxy` so the
`DATABASE_URL is not set` check fires on first query, not at module load.

**Context:** First Vercel build crashed at the "Collecting page data" step
because Next.js statically imports every route to extract config. Top-level
`throw` in `src/lib/db/client.ts` propagated through that import chain even
though the route was never executed.

**Rejected:**
- Setting `DATABASE_URL` at build time only — fragile and hides real config
  errors.
- Skipping the check entirely — silently 500's at runtime with a worse
  error.

**Trade-off:** Proxy wrapper has a tiny per-call overhead and makes type
inference slightly less direct, but the build is now resilient to missing
runtime env vars (build still passes; only requests fail, with a clear
error in logs).

---

## ADR-006 — Bearer-token auth for MCP, not OAuth

**Date:** 2026-04-30 · Phase 1
**Decision:** Single shared `MCP_API_KEY` env var. Claude clients send it
as `Authorization: Bearer <key>`.

**Context:** MCP spec supports OAuth 2.1 for remote servers. For a personal
single-user MVP, OAuth would mean implementing an authorization server,
DCR, scope handling — weeks of work for no real benefit when there's
exactly one user.

**Rejected:**
- OAuth — premature for solo use.
- Clerk session cookies — Claude Desktop doesn't speak Clerk; would
  require a custom OAuth bridge anyway.
- No auth — open MCP to anyone with the URL.

**Trade-off:** Single key means revoking access requires rotating the key
and updating every connected client. Acceptable at this scale (1 user,
3 clients). Move to per-client keys when we share with other humans.

---

## ADR-005 — `mcp-handler` package, not raw `@modelcontextprotocol/sdk`

**Date:** 2026-04-30 · Phase 1
**Decision:** Use Vercel's `mcp-handler` to wrap the SDK and expose it as
a Next.js Route Handler.

**Context:** The MCP TS SDK ships with `Server` + `StreamableHTTPServerTransport`
classes but no opinionated "deploy this on Vercel" wrapper. `mcp-handler`
provides `createMcpHandler()` that returns a Next-compatible `(req) => Response`
function and handles SSE / streamable-HTTP transport selection.

**Rejected:** Hand-rolling the transport adapter. Doable in ~50 lines but
duplicates work that `mcp-handler` already solves.

**Trade-off:** One more package dependency. Wrapper is thin enough that we
can drop down to the raw SDK if `mcp-handler` ever breaks.

---

## ADR-004 — Drizzle ORM, not Prisma

**Date:** 2026-04-29 · Phase 0
**Decision:** Drizzle for schema definition, queries, and migrations.

**Context:** Both work with Neon. Drizzle is TS-first (schema is plain TS),
plays well with Neon's HTTP serverless driver, and has zero runtime
overhead — which matters on Vercel functions where cold starts are
billed.

**Rejected:** Prisma — heavier runtime, separate schema language (.prisma),
worse cold-start behavior on serverless, and the "rust query engine"
deployment story on Vercel has historically been bumpy.

**Trade-off:** Drizzle has fewer tutorials and a smaller community than
Prisma. The TS ergonomics more than make up for it; queries read like
SQL with type safety.

---

## ADR-003 — Next 16, not Next 15

**Date:** 2026-04-29 · Phase 0
**Decision:** Use whatever `create-next-app@latest` installs (Next 16.x).

**Context:** The spec said Next 15. `create-next-app@latest` shipped Next
16 by the time we built. App Router and TS strict are intact; Next 16
mostly renamed `middleware.ts` → `proxy.ts` and continued the Turbopack
push. No breaking changes that affect us.

**Rejected:** Pinning to Next 15. Would mean fighting the default tooling
for no functional benefit.

**Trade-off:** Slight risk of bleeding-edge bugs. Mitigated by the small
surface area of our app (App Router + a handful of routes) and the
ease of pinning back if something breaks.

---

## ADR-002 — `src/proxy.ts` (not `middleware.ts`)

**Date:** 2026-04-29 · Phase 0
**Decision:** Use the Next 16 `proxy.ts` file convention.

**Context:** Next 16 deprecated `middleware.ts`. Build emits a deprecation
warning if we keep the old name. Functionally identical; same Clerk
helpers (`clerkMiddleware`, `createRouteMatcher`).

**Trade-off:** None — pure rename.

---

## ADR-001 — pgvector enabled by the migration runner, not by the user

**Date:** 2026-04-29 · Phase 0
**Decision:** `scripts/migrate.ts` runs `CREATE EXTENSION IF NOT EXISTS vector`
before applying Drizzle migrations.

**Context:** Neon doesn't surface a UI toggle for extensions in their
dashboard. Asking the user to manually `CREATE EXTENSION` in the SQL
editor is fragile (forgotten, run on the wrong branch, etc.).

**Rejected:** Documenting it as a manual step. Works but breaks for anyone
spinning up a new env (Preview deploys, future team members).

**Trade-off:** Runner needs `CREATE EXTENSION` privileges. Neon's default
`neondb_owner` role has them; if we ever lock down DB roles, we'd need to
move this to a separate admin step.
