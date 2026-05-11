/**
 * Phase F4 v2 — Gmail source adapter.
 *
 * For an auto-mode Gmail sync_config, fetches messages received since
 * the last successful poll and pipes each through file_document for
 * AI classification + filing. Returns a summary so the cron handler
 * can update last_sync_summary.
 *
 * Conservative defaults:
 *   - max_results: 25 per run (cap blast radius)
 *   - confidence threshold for auto-classification: deferred to the
 *     classifier; this adapter just hands content + sender info to
 *     file_document with no target_path → routes to Inbox/ in v1.
 *     v2.x can add Haiku-based pre-classification here.
 */

import { fileDocument } from "@/lib/filing/file-document";
import type { SyncConfig } from "@/lib/db/schema";
import { executeComposioTool } from "./composio-mcp-call";

export type SyncRunSummary = {
  toolkit: string;
  connection_id: string;
  fetched: number;
  filed: number;
  filed_to_inbox: number;
  errors: string[];
  cursor: string;
};

type GmailMessage = {
  messageId?: string;
  threadId?: string;
  subject?: string;
  from?: string;
  to?: string;
  internalDate?: string | number;
  payload?: unknown;
  preview?: string;
  messageText?: string;
};

function safeString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function gmailMessageBody(msg: GmailMessage): string {
  if (msg.messageText) return safeString(msg.messageText);
  if (msg.preview) return safeString(msg.preview);
  return "";
}

function gmailQuery(args: {
  since: Date | null;
  filter: Record<string, unknown>;
}): string {
  const parts: string[] = [];
  // User-defined filter takes precedence; otherwise default to inbox.
  if (typeof args.filter.query === "string") parts.push(args.filter.query);
  else parts.push("in:inbox");
  if (args.since) {
    // Gmail's after: takes YYYY/MM/DD; we use day granularity to be
    // safe across timezone weirdness.
    const d = args.since;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    parts.push(`after:${y}/${m}/${day}`);
  }
  return parts.join(" ");
}

export async function runGmailSync(args: {
  orgId: string;
  config: SyncConfig;
  /** Cap on items processed per run. */
  maxItems?: number;
}): Promise<SyncRunSummary> {
  const { config, orgId } = args;
  const maxItems = args.maxItems ?? 25;
  const filter = (config.sourceFilter ?? {}) as Record<string, unknown>;
  const since = config.lastSyncedAt ? new Date(config.lastSyncedAt) : null;
  const query = gmailQuery({ since, filter });

  const summary: SyncRunSummary = {
    toolkit: config.toolkit,
    connection_id: config.connectionId,
    fetched: 0,
    filed: 0,
    filed_to_inbox: 0,
    errors: [],
    cursor: new Date().toISOString(),
  };

  const fetchResult = await executeComposioTool({
    toolSlug: "GMAIL_FETCH_EMAILS",
    arguments: {
      query,
      max_results: maxItems,
      verbose: false,
      include_payload: false,
    },
    account: config.connectionId,
    orgId,
  });

  if (!fetchResult.success) {
    summary.errors.push(`fetch: ${fetchResult.error}`);
    return summary;
  }

  // Composio's MULTI_EXECUTE wraps results — try a few unwrap paths.
  const data = fetchResult.data ?? {};
  const tools = (data as { results?: Array<{ data?: { messages?: GmailMessage[] } }> }).results ?? [];
  const messages: GmailMessage[] = tools[0]?.data?.messages ?? [];

  summary.fetched = messages.length;

  for (const msg of messages) {
    try {
      const subject = safeString(msg.subject) || "(no subject)";
      const from = safeString(msg.from);
      const dateMs = msg.internalDate
        ? typeof msg.internalDate === "number"
          ? msg.internalDate
          : Number(msg.internalDate)
        : null;
      const dateStr = dateMs
        ? new Date(dateMs).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      const title = `${dateStr} · ${from || "unknown"} · ${subject}`;
      const body = [
        `**From:** ${from || "unknown"}`,
        msg.to ? `**To:** ${msg.to}` : null,
        `**Date:** ${dateStr}`,
        `**Subject:** ${subject}`,
        "",
        "---",
        "",
        gmailMessageBody(msg),
      ]
        .filter(Boolean)
        .join("\n");

      // For v1 we don't pre-classify here — pass no target_path so
      // file_document routes to Inbox/ for the user (or Phase v3
      // reconciliation rules, when wired) to handle. Phase F4 v2.x
      // can add a Haiku classifier in front of this call.
      const result = await fileDocument({
        orgId,
        actorAgent: "cron-sync-watcher",
        title,
        content: body,
        source: `gmail:${config.connectionId}/${msg.messageId ?? "?"}`,
        frontmatter: {
          tags: ["email", "gmail-sync"],
          email_from: from,
          email_subject: subject,
          email_date: dateStr,
          gmail_message_id: msg.messageId,
          gmail_thread_id: msg.threadId,
        },
      });
      summary.filed++;
      if (result.routedToInbox) summary.filed_to_inbox++;
    } catch (err) {
      summary.errors.push(`file: ${(err as Error).message}`);
    }
  }

  return summary;
}
