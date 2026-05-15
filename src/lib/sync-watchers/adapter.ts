/**
 * Phase F4 v2 — Generalized Composio source adapter framework (MF-18).
 *
 * Before this: each toolkit (Gmail, Calendar) had its own ~150-line
 * runXSync() function with mostly-the-same orchestration: fetch via
 * Composio → unwrap response → loop → file each item via fileDocument →
 * return summary. The only toolkit-specific parts are:
 *   - Which Composio tool to call + how to build its arguments
 *   - How to unwrap the response to get the items array
 *   - How to map each item to a (title, content, source, frontmatter)
 *
 * This file abstracts the orchestration so each new toolkit is a
 * small config object instead of a full re-implementation.
 *
 * Decided 2026-05-15 after Richard added 4 more Composio connections
 * (Drive, GitHub, Zoho Mail, Apify) on top of his existing Gmail +
 * Calendar. Building each adapter separately would mean ~8 hours of
 * repeated work; this framework + small configs lands the same
 * functionality in ~3-4 hours total.
 */

import { fileDocument } from "@/lib/filing/file-document";
import type { SyncConfig } from "@/lib/db/schema";
import { executeComposioTool } from "./composio-mcp-call";

/**
 * The summary every adapter returns to the cron handler. Same shape as
 * the original Gmail adapter's so existing consumers don't change.
 */
export type SyncRunSummary = {
  toolkit: string;
  connection_id: string;
  fetched: number;
  filed: number;
  filed_to_inbox: number;
  errors: string[];
  cursor: string;
};

/**
 * Context passed to the per-adapter callbacks. Bundles everything the
 * adapter needs to compute its tool arguments and map items.
 */
export type AdapterContext = {
  /** Cursor for "since when" to fetch — null on first run. */
  since: Date | null;
  /** Effective cutoff for "up to when" — typically now. */
  now: Date;
  /** Cap on items processed per run (adapter can ignore if not relevant). */
  maxItems: number;
  /** User-defined per-config filter from sync_configs.source_filter. */
  filter: Record<string, unknown>;
  /** Composio connection ID to route the tool call to. */
  connectionId: string;
  /** Org ID for fileDocument calls. */
  orgId: string;
};

/**
 * Mapped output from a single item — what fileDocument will receive.
 */
export type AdapterDoc = {
  title: string;
  content: string;
  source: string;
  frontmatter?: Record<string, unknown>;
  /** Optional pre-classified target path. If unset, file_document routes via AI/rules. */
  targetPath?: string;
};

/**
 * Per-toolkit adapter config. Plug into runComposioSyncAdapter.
 *
 * Type parameter TItem is the shape of an individual item from the
 * Composio response (e.g. GmailMessage, CalendarEvent, DriveFile).
 */
export type AdapterConfig<TItem> = {
  /** Toolkit slug — matches sync_configs.toolkit (e.g. "gmail"). */
  toolkit: string;
  /** Composio tool to invoke (e.g. "GMAIL_FETCH_EMAILS"). */
  toolSlug: string;
  /** Default cap on items per run. Overridable per call. */
  defaultMaxItems: number;
  /**
   * Default lookback window in ms when there's no `lastSyncedAt` cursor.
   * Gmail uses Composio's own default (no time bound); Calendar uses 7 days.
   * Set to null if the adapter wants "no time bound" first-run behavior.
   */
  defaultLookbackMs: number | null;
  /**
   * Build the Composio tool arguments. Toolkit-specific.
   * Receives context (since, maxItems, filter, etc.) and returns the
   * args object Composio expects.
   */
  buildArgs: (ctx: AdapterContext) => Record<string, unknown>;
  /**
   * Extract the items array from Composio's MULTI_EXECUTE response.
   * Composio wraps responses inconsistently across toolkits — each
   * adapter knows how to dig into its own shape.
   */
  extractItems: (raw: unknown) => TItem[];
  /**
   * Optional filter — if returns true, item is skipped (e.g. cancelled
   * events, deleted messages). Defaults to "include everything".
   */
  shouldSkipItem?: (item: TItem) => boolean;
  /**
   * Map a Composio item to the args fileDocument needs. Toolkit-specific.
   */
  toDoc: (item: TItem, ctx: AdapterContext) => AdapterDoc;
};

/**
 * Unwrap Composio's MULTI_EXECUTE response wrapping. Most adapters
 * call this on the response data before drilling into toolkit-specific
 * fields. Shape:
 *   { results: [{ data: <ACTUAL_TOOLKIT_RESPONSE> }] }
 * Returns the inner toolkit response, or the input if it doesn't match
 * the expected wrapping.
 */
export function unwrapComposioResults(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const results = (raw as { results?: unknown }).results;
  if (!Array.isArray(results) || results.length === 0) return raw;
  const first = results[0] as { data?: unknown };
  return first?.data ?? raw;
}

/**
 * Run a generalized Composio source adapter. The cron handler picks the
 * right `AdapterConfig` for each sync_configs row and passes it here.
 *
 * Workflow:
 *   1. Compute `since` from config.lastSyncedAt or fallback lookback
 *   2. Call Composio tool with adapter.buildArgs(ctx)
 *   3. Unwrap response with adapter.extractItems(raw)
 *   4. For each item: optionally skip, otherwise file via fileDocument
 *   5. Return summary
 */
export async function runComposioSyncAdapter<TItem>(args: {
  orgId: string;
  config: SyncConfig;
  adapter: AdapterConfig<TItem>;
  /** Cap on items processed per run. Overrides adapter.defaultMaxItems. */
  maxItems?: number;
}): Promise<SyncRunSummary> {
  const { config, orgId, adapter } = args;
  const maxItems = args.maxItems ?? adapter.defaultMaxItems;
  const filter = (config.sourceFilter ?? {}) as Record<string, unknown>;
  const now = new Date();
  const since = config.lastSyncedAt
    ? new Date(config.lastSyncedAt)
    : adapter.defaultLookbackMs !== null
      ? new Date(Date.now() - adapter.defaultLookbackMs)
      : null;

  const ctx: AdapterContext = {
    since,
    now,
    maxItems,
    filter,
    connectionId: config.connectionId,
    orgId,
  };

  const summary: SyncRunSummary = {
    toolkit: config.toolkit,
    connection_id: config.connectionId,
    fetched: 0,
    filed: 0,
    filed_to_inbox: 0,
    errors: [],
    cursor: now.toISOString(),
  };

  // 1. Call Composio
  const fetchResult = await executeComposioTool({
    toolSlug: adapter.toolSlug,
    arguments: adapter.buildArgs(ctx),
    account: config.connectionId,
    orgId,
  });

  if (!fetchResult.success) {
    summary.errors.push(`fetch: ${fetchResult.error}`);
    return summary;
  }

  // 2. Extract items
  let items: TItem[] = [];
  try {
    items = adapter.extractItems(fetchResult.data);
  } catch (err) {
    summary.errors.push(`extract: ${(err as Error).message}`);
    return summary;
  }

  summary.fetched = items.length;

  // 3. Map + file each item
  for (const item of items) {
    if (adapter.shouldSkipItem?.(item)) continue;
    try {
      const doc = adapter.toDoc(item, ctx);
      const result = await fileDocument({
        orgId,
        actorAgent: "cron-sync-watcher",
        title: doc.title,
        content: doc.content,
        source: doc.source,
        targetPath: doc.targetPath,
        frontmatter: doc.frontmatter,
      });
      summary.filed++;
      if (result.routedToInbox) summary.filed_to_inbox++;
    } catch (err) {
      summary.errors.push(`file: ${(err as Error).message}`);
    }
  }

  return summary;
}
