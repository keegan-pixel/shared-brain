/**
 * Phase F4 v2 — Gmail source adapter.
 *
 * Refactored 2026-05-15 (MF-18) to use the shared adapter framework
 * in ./adapter.ts. The old hand-rolled `runGmailSync()` function had
 * the same orchestration as the Calendar adapter (and will have the
 * same as Drive / Zoho Mail / etc.) — extracted into a generic
 * runComposioSyncAdapter that takes a per-toolkit config.
 *
 * Behavior unchanged from the original — same arguments to
 * GMAIL_FETCH_EMAILS, same title/body construction, same tag set.
 */

import type {
  AdapterConfig,
  AdapterContext,
  SyncRunSummary,
} from "./adapter";
import { runComposioSyncAdapter, unwrapComposioResults } from "./adapter";
import type { SyncConfig } from "@/lib/db/schema";

// Re-export SyncRunSummary for back-compat with existing imports.
export type { SyncRunSummary } from "./adapter";

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

function gmailQuery(ctx: AdapterContext): string {
  const parts: string[] = [];
  // User-defined filter takes precedence; otherwise default to inbox.
  if (typeof ctx.filter.query === "string") parts.push(ctx.filter.query);
  else parts.push("in:inbox");
  if (ctx.since) {
    // Gmail's after: takes YYYY/MM/DD; we use day granularity to be
    // safe across timezone weirdness.
    const d = ctx.since;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    parts.push(`after:${y}/${m}/${day}`);
  }
  return parts.join(" ");
}

export const gmailAdapter: AdapterConfig<GmailMessage> = {
  toolkit: "gmail",
  toolSlug: "GMAIL_FETCH_EMAILS",
  defaultMaxItems: 25,
  defaultLookbackMs: null, // Gmail relies on `after:` query param; no fallback needed.

  buildArgs: (ctx) => ({
    query: gmailQuery(ctx),
    max_results: ctx.maxItems,
    verbose: false,
    include_payload: false,
  }),

  extractItems: (raw) => {
    const data = unwrapComposioResults(raw);
    const messages = (data as { messages?: GmailMessage[] })?.messages;
    return Array.isArray(messages) ? messages : [];
  },

  toDoc: (msg, ctx) => {
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

    return {
      title,
      content: body,
      source: `gmail:${ctx.connectionId}/${msg.messageId ?? "?"}`,
      frontmatter: {
        tags: ["email", "gmail-sync"],
        email_from: from,
        email_subject: subject,
        email_date: dateStr,
        gmail_message_id: msg.messageId,
        gmail_thread_id: msg.threadId,
      },
    };
  },
};

/**
 * Back-compat wrapper around the framework runner. Existing callers
 * (the cron handler) use this signature; under the hood it delegates
 * to runComposioSyncAdapter with the gmailAdapter config.
 */
export async function runGmailSync(args: {
  orgId: string;
  config: SyncConfig;
  maxItems?: number;
}): Promise<SyncRunSummary> {
  return runComposioSyncAdapter({
    orgId: args.orgId,
    config: args.config,
    adapter: gmailAdapter,
    maxItems: args.maxItems,
  });
}
