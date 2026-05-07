/**
 * Phase F4 v2 — Cron handler for auto-sync.
 *
 * Walks all sync_configs with mode='auto', runs the toolkit-specific
 * adapter, files results via file_document. Per-config errors don't
 * abort the run; they get logged in last_sync_summary.
 *
 * Auth: same Bearer pattern as /api/cron/connections — accepts
 * CRON_SECRET (Vercel sets automatically) or MCP_API_KEY (manual).
 *
 * Schedule registered in vercel.json — daily for Hobby tier compat.
 */

import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { syncConfigs } from "@/lib/db/schema";
import { runGmailSync } from "@/lib/sync-watchers/gmail";
import type { SyncRunSummary } from "@/lib/sync-watchers/gmail";

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  if (!presented) return false;
  if (process.env.CRON_SECRET && presented === process.env.CRON_SECRET) return true;
  if (process.env.MCP_API_KEY && presented === process.env.MCP_API_KEY) return true;
  return false;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="shared-brain-cron"',
      },
    });
  }

  const start = Date.now();
  const auto = await db
    .select()
    .from(syncConfigs)
    .where(eq(syncConfigs.mode, "auto"));

  const results: Array<{ configId: string; summary: SyncRunSummary }> = [];

  for (const cfg of auto) {
    let summary: SyncRunSummary;
    try {
      switch (cfg.toolkit) {
        case "gmail":
          summary = await runGmailSync({ orgId: cfg.orgId, config: cfg });
          break;
        default:
          summary = {
            toolkit: cfg.toolkit,
            connection_id: cfg.connectionId,
            fetched: 0,
            filed: 0,
            filed_to_inbox: 0,
            errors: [`No adapter wired yet for toolkit '${cfg.toolkit}' — skipped`],
            cursor: new Date().toISOString(),
          };
      }
    } catch (err) {
      summary = {
        toolkit: cfg.toolkit,
        connection_id: cfg.connectionId,
        fetched: 0,
        filed: 0,
        filed_to_inbox: 0,
        errors: [(err as Error).message],
        cursor: new Date().toISOString(),
      };
    }

    // Update last_synced_at + summary on success-or-soft-fail. Hard
    // errors (like a thrown exception above) still get a summary
    // record so the UI shows what happened.
    await db
      .update(syncConfigs)
      .set({
        lastSyncedAt: new Date(summary.cursor),
        lastSyncSummary: summary as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(and(eq(syncConfigs.id, cfg.id), eq(syncConfigs.orgId, cfg.orgId)));

    results.push({ configId: cfg.id, summary });
    console.info(
      `[cron/auto-sync] ${cfg.label}: fetched=${summary.fetched} filed=${summary.filed} inbox=${summary.filed_to_inbox} errors=${summary.errors.length}`,
    );
  }

  return Response.json({
    ran_at: new Date().toISOString(),
    total_duration_ms: Date.now() - start,
    config_count: auto.length,
    results,
  });
}

export const POST = GET;
