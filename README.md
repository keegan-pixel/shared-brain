# Shared Brain

A connectivity layer for project-management knowledge. Mirrors your local
Obsidian vault to a cloud database, exposes it to any AI client via MCP, and
provides a web UI for browsing + editing. Use Claude / GPT / any future
AI from anywhere; the brain is the substrate.

**Live:** https://shared-brain-ecru.vercel.app/
**Status:** Phase 8 v2 MVP shipped (2026-05-11). Solo-user + 1 paid customer in
production. Multi-tenant proper (memberships, invites, visibility) parked
until there's a 3rd user.

## Documentation

All living docs are in [`docs/`](./docs/) and mirrored from the canonical
home in `~/Documents/ViaOps/Knowledge/Frameworks/Shared Brain/`:

- [`docs/spec.md`](./docs/spec.md) — MVP technical spec + status table
- [`docs/build-log.md`](./docs/build-log.md) — phase-by-phase narrative
- [`docs/decisions.md`](./docs/decisions.md) — ADR log (37 entries and counting)
- [`docs/runbook.md`](./docs/runbook.md) — ops procedures, including the
  Thursday-install flow for onboarding a new user
- [`docs/phase-8-v2-spec.md`](./docs/phase-8-v2-spec.md) — full multi-tenancy
  spec (the v2.1+ work, parked)
- [`docs/profile.md`](./docs/profile.md) — operating instructions every Claude
  agent reads at session start

**Documentation rule:** every milestone updates docs in both vault and repo.
See [`AGENTS.md`](./AGENTS.md).

## Stack

- **Next.js 16** (App Router, TypeScript strict)
- **Neon Postgres** + `pgvector` via `@neondatabase/serverless`
- **Drizzle ORM** + drizzle-kit for migrations
- **Clerk** for auth
- **Tailwind v4** + shadcn-style primitives
- **next-themes** for dark mode
- **Vercel** for deploy + Vercel Blob for binary file storage
- **MCP** via `mcp-handler` + `@modelcontextprotocol/sdk`

## What's shipped

- **MCP server** at `/api/mcp` — 20+ tools (read: search, get_document,
  get_org, get_spaces, get_projects, get_items, get_wiki_pages,
  get_activity_feed, get_backlinks, get_active_state,
  get_operating_instructions, get_document_url; write: create_*,
  update_wiki_page, file_document, move_item_status,
  record_session_summary, add_backlink)
- **OAuth 2.1 + PKCE** on `/api/mcp` — claude.ai web, Desktop, mobile all
  connect via native Custom Connectors (ADR-034). Static `MCP_API_KEY`
  fallback preserved.
- **Vault sync agent** — chokidar-based daemon, per-user plist
  namespacing, F2 content extraction (~150K words across 95 binary files),
  per-org sync keys (Build D / ADR-037).
- **Kanban UI** per project with dnd-kit, 6 swimlanes, detail drawer.
- **Wiki + backlinks** with inline `[[wikilink]]` rendering + connection
  graph (write-time + read-time + AI-driven background edges).
- **Activity feed** with per-space filters and topbar bell.
- **Composio** integration — universal MCP endpoint + per-org consumer key
  (Build C / ADR-037). All 20 default connections.
- **AI Filing Engine** (F4 v1/v2/v3) — Composio Gmail auto-sync, active-
  learning reconciliation via move detection.
- **Per-org LLM + Composio + sync keys** (Phase 8 v2 MVP, Builds A-F)
  — users bring their own Anthropic/OpenAI/Composio keys via the UI;
  validate-on-save; env-var fallback for backwards compat.
- **Onboarding** — dashboard checklist + `/settings/{org,llm-keys,connections,daemon,claude}` setup pages.
  Claude Project Instructions generator with embedded discovery interview
  (Build F).

## Connecting Claude

### claude.ai web / Desktop / mobile (recommended)

In any Claude surface → Settings → Connectors → Add new → paste:

```
https://shared-brain-ecru.vercel.app/api/mcp
```

OAuth flow runs automatically. Once connected on one surface (Desktop, web,
or mobile), the connector is available on every surface — they share
account state via your Anthropic account.

For new users: register a client first via `npm run create-oauth-client`
(or use the existing `Claude.ai web` client which covers all surfaces).

### Claude Code

```bash
claude mcp add --transport http shared-brain https://shared-brain-ecru.vercel.app/api/mcp
```

Claude Code drives its own OAuth flow.

### Legacy static-key path (still works)

```bash
claude mcp add --transport http shared-brain https://shared-brain-ecru.vercel.app/api/mcp \
  --header "Authorization: Bearer <MCP_API_KEY>"
```

`MCP_API_KEY` from `.env.local`. Used by the local sync daemon + scripts.
No longer needed for AI client connections.

## Getting started (developer)

### 1. Install deps

```bash
npm install
```

### 2. Set up env vars

```bash
cp .env.example .env.local
```

Fill in (minimum to run):

- **DATABASE_URL** — Neon connection string. The migration runner enables
  pgvector automatically.
- **NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY** + **CLERK_SECRET_KEY** — from
  https://clerk.com → API Keys.
- **MCP_API_KEY** — random string. Used as the static-auth fallback for
  the local sync daemon. New users get per-org keys via the UI; this stays
  for backwards-compat with Keegan's existing setup.

Optional (everything has a per-org-config path via the UI now):
- **ANTHROPIC_API_KEY** — chat / filing fallback when an org hasn't set
  their own.
- **OPENAI_API_KEY** — embeddings fallback.
- **COMPOSIO_API_KEY** — Composio consumer key fallback.
- **BLOB_READ_WRITE_TOKEN** — set automatically when you connect the
  Vercel Blob store to the project.

### 3. Run migrations

```bash
npm run db:migrate
```

### 4. Dev server

```bash
npm run dev
```

Open http://localhost:3000. You'll be redirected to `/sign-in`. After
signing in, your own org is auto-created (named `{your first} {your last}'s Brain`),
and you land on the onboarding dashboard.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a new SQL migration from `src/lib/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Drizzle Studio (web UI for the DB) |
| `npm run install-daemon` | Install the macOS launchd daemon. `--user-tag <slug>` for per-user namespacing; omit for legacy label. |
| `npm run install-skill` | Install the Shared Brain skill into Claude Code / Desktop. |
| `npm run rotate-key` | Rotate `MCP_API_KEY` (legacy single-key flow) |
| `npm run reconnect-mcp` | Diagnostic CLI for MCP connection issues |
| `npm run create-oauth-client` | Register a new AI client for OAuth |
| `npm run backfill:connections` | One-time backfill of connection edges |
| `npm run backfill:activity-spaces` | Backfill space_id metadata in activity feed |
| `npm run backfill:blob-urls` | Re-upload binaries whose `blob_url` is null (ADR-036) |
| `npm run dedupe:activity` | Dedupe noisy activity feed rows |

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import the repo at https://vercel.com/new.
3. Add env vars to the Vercel project (mirror your `.env.local`).
4. Connect a Neon DB + Vercel Blob store via the Storage tab.
5. In Clerk dashboard, add your Vercel URL as an allowed origin.
6. Run `npm run db:migrate` locally pointing at the same `DATABASE_URL`
   (Vercel doesn't auto-run it).

## What's next

See `docs/spec.md` for the live status table and `docs/phase-8-v2-spec.md`
for the full multi-tenancy spec (parked until 3rd user).

Active priorities:
- Polish onboarding based on Wednesday dogfood + Thursday install findings
- Multi-tenancy proper (memberships, invites, visibility) — pulled in
  when a team-org user signs up
- Stripe billing — when there's a paying user via the platform (vs
  invoiced directly)
