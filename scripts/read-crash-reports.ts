/**
 * Quick read of daemon_crash_report rows from activity_feed.
 * Used after MF-21 deploy to see what Richard's daemon was crashing on.
 */
import "dotenv/config";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { activityFeed, organizations } from "../src/lib/db/schema";

const ORG_SLUG = process.argv[2] || "richard-lackey-brain";
const HOURS = Number(process.argv[3] ?? "1");

async function main() {
  const [org] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.slug, ORG_SLUG))
    .limit(1);
  if (!org) {
    console.error(`No org with slug='${ORG_SLUG}'`);
    process.exit(1);
  }
  console.log(`Org: ${org.name} (${org.id})\n`);

  const since = new Date(Date.now() - HOURS * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(activityFeed)
    .where(
      and(
        eq(activityFeed.orgId, org.id),
        eq(activityFeed.action, "daemon_crash_report"),
        gt(activityFeed.createdAt, since),
      ),
    )
    .orderBy(desc(activityFeed.createdAt))
    .limit(5);

  console.log(`Found ${rows.length} crash report(s) in the last ${HOURS}h:\n`);
  for (const row of rows) {
    const m = row.metadata as { errLog?: string; stdoutLog?: string; errMtime?: string };
    console.log("─".repeat(80));
    console.log(`  Time: ${row.createdAt.toISOString()}`);
    console.log(`  Summary: ${row.summary}`);
    console.log(`  Err mtime: ${m.errMtime ?? "(none)"}`);
    console.log("\n--- errLog (last 200 lines) ---");
    console.log(m.errLog ?? "(empty)");
    if (m.stdoutLog) {
      console.log("\n--- stdoutLog (last 100 lines) ---");
      console.log(m.stdoutLog);
    }
    console.log("");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
