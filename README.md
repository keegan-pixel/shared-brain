# Shared Brain

AI-native project management platform. Mirrors a local Obsidian vault to a cloud
database, exposes it to AI agents over MCP, and provides a web UI for browsing
and editing.

This repo is currently at **Phase 0** — the foundation. See
`/Users/keeganlamar/Documents/ViaOps/Knowledge/Frameworks/AI-Native PM Platform - MVP Spec.md`
for the full multi-phase plan.

## Stack

- **Next.js 16** (App Router, TypeScript strict)
- **Neon Postgres** + `pgvector` via `@neondatabase/serverless`
- **Drizzle ORM** + drizzle-kit for migrations
- **Clerk** for auth
- **Tailwind v4** + shadcn-style primitives
- **next-themes** for dark mode
- **Vercel** for deploy

## Phase 1 scope

- **MCP server** mounted at `/api/mcp` (Streamable HTTP transport via
  `mcp-handler` + `@modelcontextprotocol/sdk`).
- All 8 read tools: `get_org`, `get_spaces`, `get_projects`, `get_items`,
  `get_wiki_pages`, `get_activity_feed`, `get_backlinks`, `search`.
- All 8 write tools: `create_space`, `create_project`, `create_item`,
  `update_item`, `move_item_status`, `create_wiki_page`, `update_wiki_page`,
  `add_backlink`. Every write logs an entry to `activity_feed` automatically.
- Bearer-token auth (`MCP_API_KEY`). Single shared key for personal use;
  per-client keys come later.
- Optional OpenAI embeddings for `search` (text-embedding-3-small). Without
  `OPENAI_API_KEY`, search and wiki pages fall back to text matching with no
  embeddings.

### Connecting Claude Desktop

In Claude Desktop → Settings → Developer → Edit Config, add the MCP server:

```json
{
  "mcpServers": {
    "shared-brain": {
      "url": "https://shared-brain-ecru.vercel.app/api/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_API_KEY>"
      }
    }
  }
}
```

Replace `<MCP_API_KEY>` with the value from your `.env.local`. Restart Claude
Desktop. You should see the 14 tools appear in the tools menu.

For local testing, use `http://localhost:3000/api/mcp` instead.

### Connecting Claude Code

```bash
claude mcp add --transport http shared-brain https://shared-brain-ecru.vercel.app/api/mcp \
  --header "Authorization: Bearer <MCP_API_KEY>"
```

## Phase 0 scope

- Next.js 16 scaffold, TS strict
- Full DB schema for Phase 0–5 (orgs, spaces, projects, items, wiki_pages,
  backlinks, activity_feed, vault_sync_log) — pgvector enabled
- Clerk auth (single user; multi-user-ready)
- App shell — sidebar (org → spaces → wiki), top bar (search stub, activity
  stub, Claude chat stub, theme toggle, user menu), main area
- Dark mode
- CRUD REST routes for orgs / spaces / projects / items (org-scoped)
- ViaOps org auto-bootstraps on first authenticated request

Not yet built (later phases): vault sync agent, kanban UI, wiki UI, activity
feed, built-in Claude chat.

## Getting started

### 1. Install deps

```bash
npm install
```

### 2. Set up env vars

```bash
cp .env.example .env.local
```

Fill in:

- **DATABASE_URL** — Neon connection string (Postgres 17, pgvector enabled).
  The migration script runs `CREATE EXTENSION IF NOT EXISTS vector` before
  applying tables, so you don't need to enable it manually.
- **NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY** + **CLERK_SECRET_KEY** — from
  https://clerk.com → API Keys.

### 3. Run migrations

```bash
npm run db:migrate
```

This creates all 8 tables and the `vector` extension on Neon.

### 4. Dev server

```bash
npm run dev
```

Open http://localhost:3000. You'll be redirected to `/sign-in`. After signing
in, your ViaOps org is auto-created.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a new SQL migration from `src/lib/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations to the database in `DATABASE_URL` |
| `npm run db:studio` | Open Drizzle Studio (web UI for the DB) |

## Project layout

```
src/
  app/
    (app)/                  Authenticated app shell — sidebar + topbar layout
      layout.tsx
      page.tsx              Home dashboard
    api/
      orgs/                 GET, PATCH
      spaces/               GET, POST
      spaces/[id]/          GET, PATCH, DELETE
      projects/             GET (?spaceId=), POST
      projects/[id]/        GET, PATCH, DELETE
      items/                GET (?projectId=&status=), POST
      items/[id]/           GET, PATCH, DELETE
    sign-in/
    sign-up/
    layout.tsx              Root layout — Clerk + theme providers
    globals.css
  components/
    ui/                     shadcn-style primitives (Button, Input)
    sidebar.tsx
    topbar.tsx
    theme-provider.tsx
    theme-toggle.tsx
  lib/
    db/
      schema.ts             Drizzle schema — all 8 tables
      client.ts             Drizzle + Neon HTTP client
    org.ts                  Auth helper + ViaOps org bootstrap
    api.ts                  ApiError, handle(), parseJson()
    utils.ts                cn()
  proxy.ts                  Clerk auth middleware (Next 16 "proxy" convention)
drizzle/                    Generated migration SQL (committed)
scripts/
  migrate.ts                Migration runner — also enables pgvector
```

## API surface (Phase 0)

All routes require Clerk auth. All queries are scoped to the user's
auto-created org.

| Method | Path | Body |
|---|---|---|
| GET | `/api/orgs` | — |
| PATCH | `/api/orgs` | `{ name }` |
| GET | `/api/spaces` | — |
| POST | `/api/spaces` | `{ name, type, accessRoles? }` |
| GET | `/api/spaces/[id]` | — |
| PATCH | `/api/spaces/[id]` | partial space |
| DELETE | `/api/spaces/[id]` | — |
| GET | `/api/projects?spaceId=...` | — |
| POST | `/api/projects` | `{ spaceId, name, description? }` |
| GET | `/api/projects/[id]` | — |
| PATCH | `/api/projects/[id]` | partial project |
| DELETE | `/api/projects/[id]` | — |
| GET | `/api/items?projectId=...&status=...` | — |
| POST | `/api/items` | `{ projectId, type, title, content?, status?, createdByAgent? }` |
| GET | `/api/items/[id]` | — |
| PATCH | `/api/items/[id]` | partial item |
| DELETE | `/api/items/[id]` | — |

`type` is one of: `task | note | file | decision`.
`status` is one of: `backlog | not_started | research_planning | in_progress | review | completed`.

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import the repo at https://vercel.com/new.
3. Add the env vars from `.env.local` to the Vercel project.
4. In Clerk dashboard, add your Vercel URL as an allowed origin.
5. Run `npm run db:migrate` locally pointing at the same `DATABASE_URL` (Vercel
   doesn't auto-run it).

## Next phases

- **Phase 2:** Vault sync agent (chokidar) — local Obsidian → platform.
- **Phase 3:** Kanban UI per project (6 swimlanes, dnd-kit).
- **Phase 4:** Wiki + backlinks UI.
- **Phase 5:** Activity feed + built-in Claude chat (Vercel AI SDK + Composio).
