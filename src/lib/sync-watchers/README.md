# Composio Source Adapters

Each file in this folder defines a Composio toolkit adapter that the
daily `/api/cron/auto-sync` cron uses to pull new items from external
services into the brain.

## Architecture

`adapter.ts` defines a generic `runComposioSyncAdapter()` that handles
the orchestration shared across all toolkits:

1. Compute a "since" cursor from `sync_configs.lastSyncedAt`
2. Call the toolkit's fetch tool via `executeComposioTool`
3. Unwrap Composio's MULTI_EXECUTE wrapping
4. Loop over items, skip filtered ones, file each via `fileDocument`
5. Return a `SyncRunSummary`

Each adapter is an `AdapterConfig<TItem>` object that plugs into the
generic runner. Per-toolkit logic lives in five callbacks:

| Callback | Purpose |
|---|---|
| `buildArgs(ctx)` | Construct the Composio tool's arguments (date format, filters, limits) |
| `extractItems(raw)` | Dig into Composio's response and return the items array |
| `shouldSkipItem(item)` | Optional — return true to skip an item (e.g. cancelled events) |
| `toDoc(item, ctx)` | Map an item to `{ title, content, source, frontmatter }` for fileDocument |
| `toolSlug` / `toolkit` / `defaultMaxItems` / `defaultLookbackMs` | Static config |

## Adding a new adapter

To wire up a new toolkit (say `googledrive`):

1. **Create the adapter file** — `googledrive.ts`. Copy the structure
   of `gmail.ts` or `calendar.ts` and adjust:
   - `toolSlug`: the Composio tool that fetches new items (e.g.
     `GOOGLEDRIVE_LIST_FILES`)
   - `buildArgs`: any time-range / folder-id / page-size args the tool
     needs. Use `ctx.since`, `ctx.now`, `ctx.maxItems`, `ctx.filter`.
   - `extractItems`: walk `unwrapComposioResults(raw)` to the items
     array. Verify the shape by hitting the endpoint in dev with
     `?debug=1`-style logging first if uncertain.
   - `toDoc`: build a useful title, body, and frontmatter for each
     item. Source should follow `{toolkit}:{connectionId}/{itemId}`
     convention so reconciliation can recognize the origin.
   - Optionally `shouldSkipItem` for filtering (deleted files, etc.)

2. **Wire it into the cron handler** — open
   `src/app/api/cron/auto-sync/route.ts` and add a case to the switch:
   ```ts
   case "googledrive":
     summary = await runDriveSync({ orgId: cfg.orgId, config: cfg });
     break;
   ```

3. **Add to SUPPORTED_TOOLKITS** in
   `src/app/(app)/settings/sync/client.tsx` so the UI drops the
   "not yet wired" amber chip:
   ```ts
   const SUPPORTED_TOOLKITS = new Set(["gmail", "googlecalendar", "googledrive"]);
   ```

4. **Update the status banner** copy on the same page if you want.

5. **Typecheck:** `npm run typecheck` from repo root.

6. **Test:** in dev, set a sync_config row to `mode='auto'` and hit
   `/api/cron/auto-sync` manually with the CRON_SECRET bearer.

## Currently shipped adapters

- `gmail.ts` — fetches Gmail messages via `GMAIL_FETCH_EMAILS`
- `calendar.ts` — fetches Calendar events via `GOOGLECALENDAR_EVENTS_LIST`

## Queued for follow-up (Richard's other Composio connections, 2026-05-15)

- `googledrive` — files in watched folders → wiki entries with extracted content
- `github` — issues, PRs, commits, comments → activity items
- `apify` — dataset items / run completions → wiki entries
- `zohomail` — inbox messages → file_document (mirror of Gmail adapter pattern)

## Discipline notes

- **Idempotent by design.** The cursor + content hashing on the
  fileDocument side means re-running an adapter doesn't duplicate
  filings. Safe to re-trigger.
- **Cancelled / deleted items** should be skipped via `shouldSkipItem`,
  not by filtering after the fact. Keeps `fetched` count honest.
- **No pre-classification** in adapters. Hand content to fileDocument
  with no `targetPath` — let the AI/filing-rules layer decide where
  it goes. Adapter's job is fetch + format, not routing.
- **Source descriptor format**: `{toolkit}:{connectionId}/{itemId}`.
  Reconciliation logic uses this to recognize origin and apply
  filing rules.
