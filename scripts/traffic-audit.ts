/**
 * Traffic audit — quick read of DB-level traffic signals to help
 * diagnose the Vercel edge-request spike. Reads from:
 *   - mcp_request_log (every /api/mcp call)
 *   - activity_feed (every DB write)
 *   - vault_sync_log (every daemon push)
 *
 * Doesn't replace Vercel dashboard analytics (those count edge
 * middleware hits including redirects + static asset requests),
 * but gives us a starting picture of which categories are noisy.
 *
 * Run: npm run traffic-audit
 */

import "dotenv/config";
import { db } from "../src/lib/db/client";
import { mcpRequestLog, activityFeed, vaultSyncLog } from "../src/lib/db/schema";
import { sql, gt, desc, and } from "drizzle-orm";

const now = Date.now();
const sixHoursAgo = new Date(now - 6 * 60 * 60 * 1000);
const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);

async function main() {
  console.log("=== Traffic audit (against production DB) ===\n");

  // 1. MCP request volume
  const mcpLast24h = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mcpRequestLog)
    .where(gt(mcpRequestLog.createdAt, twentyFourHoursAgo));
  const mcpLast6h = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mcpRequestLog)
    .where(gt(mcpRequestLog.createdAt, sixHoursAgo));

  console.log("MCP /api/mcp request log:");
  console.log(`  Last 24h: ${mcpLast24h[0]?.count ?? 0}`);
  console.log(`  Last 6h:  ${mcpLast6h[0]?.count ?? 0}`);

  // 2. MCP requests grouped by status to spot retry storms
  const mcpByStatus24h = await db
    .select({
      status: mcpRequestLog.status,
      count: sql<number>`count(*)::int`,
    })
    .from(mcpRequestLog)
    .where(gt(mcpRequestLog.createdAt, twentyFourHoursAgo))
    .groupBy(mcpRequestLog.status)
    .orderBy(desc(sql`count(*)`));
  console.log("\nMCP by status, last 24h:");
  for (const row of mcpByStatus24h) {
    console.log(`  ${row.status}: ${row.count}`);
  }

  // 3. MCP requests grouped by IP / user-agent to spot scanners
  const mcpByAgent24h = await db
    .select({
      userAgent: mcpRequestLog.userAgent,
      count: sql<number>`count(*)::int`,
    })
    .from(mcpRequestLog)
    .where(gt(mcpRequestLog.createdAt, twentyFourHoursAgo))
    .groupBy(mcpRequestLog.userAgent)
    .orderBy(desc(sql`count(*)`))
    .limit(10);
  console.log("\nMCP top user-agents, last 24h:");
  for (const row of mcpByAgent24h) {
    const ua = (row.userAgent ?? "(null)").slice(0, 80);
    console.log(`  ${row.count.toString().padStart(6)}  ${ua}`);
  }

  // 4. Activity feed volume (every DB write)
  const activityLast24h = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(activityFeed)
    .where(gt(activityFeed.createdAt, twentyFourHoursAgo));
  console.log(`\nActivity feed writes, last 24h: ${activityLast24h[0]?.count ?? 0}`);

  // 5. Activity feed grouped by action
  const activityByAction = await db
    .select({
      action: activityFeed.action,
      count: sql<number>`count(*)::int`,
    })
    .from(activityFeed)
    .where(gt(activityFeed.createdAt, twentyFourHoursAgo))
    .groupBy(activityFeed.action)
    .orderBy(desc(sql`count(*)`))
    .limit(15);
  console.log("\nTop activity actions, last 24h:");
  for (const row of activityByAction) {
    console.log(`  ${row.count.toString().padStart(6)}  ${row.action}`);
  }

  // 6. Vault sync volume (daemon pushes)
  const syncLast24h = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(vaultSyncLog)
    .where(gt(vaultSyncLog.lastSyncedAt, twentyFourHoursAgo));
  console.log(`\nVault sync log entries, last 24h: ${syncLast24h[0]?.count ?? 0}`);

  console.log("\n=== End ===");
  console.log("Note: Vercel edge requests count MORE than these — every");
  console.log("RSC payload load, redirect, static asset, middleware hit, etc.");
  console.log("If MCP/activity/sync numbers are reasonable but Vercel says");
  console.log("600k, the spike is likely public-page hits or bot scanning,");
  console.log("not our authenticated traffic.");

  process.exit(0);
}

main().catch((err) => {
  console.error("Traffic audit failed:", err);
  process.exit(1);
});
