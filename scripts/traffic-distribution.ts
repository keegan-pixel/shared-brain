/**
 * Quick view of vault_sync_log writes grouped by hour over the last
 * 24h, so we can tell whether DB activity is:
 *   - A one-time burst (consistent with a daemon restart + full-scan)
 *   - Sustained (consistent with the runaway loop still happening)
 */

import "dotenv/config";
import { db } from "../src/lib/db/client";
import { vaultSyncLog } from "../src/lib/db/schema";
import { sql, gt } from "drizzle-orm";

async function main() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const buckets = await db
    .select({
      hour: sql<string>`to_char(date_trunc('hour', ${vaultSyncLog.lastSyncedAt}), 'YYYY-MM-DD HH24:00')`,
      count: sql<number>`count(*)::int`,
    })
    .from(vaultSyncLog)
    .where(gt(vaultSyncLog.lastSyncedAt, twentyFourHoursAgo))
    .groupBy(sql`date_trunc('hour', ${vaultSyncLog.lastSyncedAt})`)
    .orderBy(sql`date_trunc('hour', ${vaultSyncLog.lastSyncedAt})`);

  console.log("vault_sync_log writes per hour (UTC), last 24h:");
  console.log("");
  let total = 0;
  for (const row of buckets) {
    const bar = "█".repeat(Math.min(80, Math.floor(row.count / 25)));
    console.log(`  ${row.hour}  ${row.count.toString().padStart(5)}  ${bar}`);
    total += row.count;
  }
  console.log("");
  console.log(`Total: ${total}`);
  console.log("");
  console.log("Interpretation:");
  console.log("  - One concentrated burst = healthy (daemon restart + full-scan)");
  console.log("  - Even distribution = runaway still happening");
  console.log("  - Multiple bursts = multiple daemon restarts");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
