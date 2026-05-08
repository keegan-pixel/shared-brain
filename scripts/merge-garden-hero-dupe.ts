/**
 * One-off merge script for the Garden Hero space duplicate.
 *
 * Plan:
 *   1. Update activity_feed rows pointing at A → set metadata.spaceId to B.
 *   2. Delete the empty "General" project under A (0 items).
 *   3. Delete space A (cascade — project already gone).
 *
 * Idempotent: re-running after the merge is a no-op (A and its project
 * no longer exist, so all queries return 0 rows).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";
import { db } from "../src/lib/db/client";

const A = "eff03afd-9728-4d1a-83aa-291b8889bf4e"; // duplicate (delete)
const B = "1465944c-13b0-4b05-bd18-3b04be94cf0f"; // primary (keep)
const PROJECT_A = "3dea61b9-b214-4d3c-9e24-ec2a2b3c8ec6"; // empty "General" under A

async function main() {
  console.log("=== Merging Garden Hero duplicate ===\n");
  console.log(`Source (delete): ${A}`);
  console.log(`Target (keep):   ${B}\n`);

  // Pre-flight: confirm B exists, A still has 0 items, all 4 activity rows present.
  const sanity = await db.execute(sql`
    select
      (select count(*)::int from spaces where id = ${B}) as target_exists,
      (select count(*)::int from spaces where id = ${A}) as source_exists,
      (select count(*)::int from items where project_id = ${PROJECT_A}) as items_under_a_project,
      (select count(*)::int from activity_feed where metadata->>'spaceId' = ${A}) as activity_under_a
  `);
  const s = ((sanity as any).rows ?? sanity)[0];
  console.log("Pre-flight:", s);
  if (s.target_exists !== 1) {
    throw new Error(`Target space ${B} not found — abort.`);
  }
  if (s.source_exists === 0) {
    console.log("Source space already gone — nothing to do.");
    return;
  }
  if (s.items_under_a_project !== 0) {
    throw new Error(`Project ${PROJECT_A} now has items — refusing to delete. Investigate manually.`);
  }

  // Step 1: rewrite activity_feed metadata.spaceId
  console.log("\nStep 1: rewriting activity_feed metadata.spaceId A → B");
  const upd = await db.execute(sql`
    update activity_feed
    set metadata = jsonb_set(metadata, '{spaceId}', to_jsonb(${B}::text))
    where metadata->>'spaceId' = ${A}
  `);
  console.log(`  ✓ updated ${(upd as any).rowCount ?? "?"} rows`);

  // Step 2: delete the empty project under A
  console.log("\nStep 2: deleting empty project under A");
  const delProj = await db.execute(sql`
    delete from projects where id = ${PROJECT_A}
  `);
  console.log(`  ✓ deleted ${(delProj as any).rowCount ?? "?"} project rows`);

  // Step 3: delete space A
  console.log("\nStep 3: deleting space A");
  const delSpace = await db.execute(sql`
    delete from spaces where id = ${A}
  `);
  console.log(`  ✓ deleted ${(delSpace as any).rowCount ?? "?"} space rows`);

  // Post-flight: confirm A is gone, B is intact, all dupes resolved.
  console.log("\n=== Post-flight ===");
  const after = await db.execute(sql`
    select
      (select count(*)::int from spaces where id = ${A}) as a_remaining,
      (select count(*)::int from spaces where id = ${B}) as b_remaining,
      (select count(*)::int from projects where space_id = ${B}) as b_projects,
      (select count(*)::int from items i where i.project_id in (select id from projects where space_id = ${B})) as b_items,
      (select count(*)::int from activity_feed where metadata->>'spaceId' = ${B}) as b_activity,
      (select count(*)::int from spaces where id = ${A} or id = ${PROJECT_A}) as ghosts
  `);
  console.log(((after as any).rows ?? after)[0]);

  const stillDupes = await db.execute(sql`
    select org_id, name, count(*) as n from spaces group by org_id, name having count(*) > 1
  `);
  const dupes = (stillDupes as any).rows ?? stillDupes;
  console.log(`\nRemaining duplicates: ${(dupes as any[]).length}`);
  if ((dupes as any[]).length > 0) console.table(dupes);

  console.log("\n✓ Merge complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Merge failed:", err);
  process.exit(1);
});
