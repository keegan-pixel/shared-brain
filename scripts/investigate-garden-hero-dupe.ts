/**
 * One-off investigation script for the Garden Hero space duplicate.
 *
 * Two rows in `spaces` with identical (orgId, name, type), 1ms apart.
 * This script reports what each row touches across all tables — direct
 * FKs (projects → items via projects) and metadata-JSONB pointers
 * (activity_feed, wiki_pages).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";
import { db } from "../src/lib/db/client";

const A = "eff03afd-9728-4d1a-83aa-291b8889bf4e";
const B = "1465944c-13b0-4b05-bd18-3b04be94cf0f";

async function countsFor(spaceId: string, label: string) {
  const projects = await db.execute(
    sql`select count(*)::int as n from projects where space_id = ${spaceId}`,
  );
  const items = await db.execute(
    sql`select count(*)::int as n from items i where i.project_id in (select id from projects where space_id = ${spaceId})`,
  );
  const activity = await db.execute(
    sql`select count(*)::int as n from activity_feed where metadata->>'spaceId' = ${spaceId}`,
  );
  const wiki = await db.execute(
    sql`select count(*)::int as n from wiki_pages where metadata->>'spaceId' = ${spaceId}`,
  );
  // vault_sync_log has no metadata column. Skip.

  console.log(`\n=== ${label} (${spaceId}) ===`);
  console.log(`  projects:        ${(projects as any).rows?.[0]?.n ?? (projects as any)[0]?.n}`);
  console.log(`  items (via proj): ${(items as any).rows?.[0]?.n ?? (items as any)[0]?.n}`);
  console.log(`  activity_feed:   ${(activity as any).rows?.[0]?.n ?? (activity as any)[0]?.n}`);
  console.log(`  wiki_pages:      ${(wiki as any).rows?.[0]?.n ?? (wiki as any)[0]?.n}`);
}

async function listProjects(spaceId: string, label: string) {
  const rows = await db.execute(
    sql`select id, name, created_at from projects where space_id = ${spaceId} order by created_at`,
  );
  const list = (rows as any).rows ?? rows;
  console.log(`\n--- Projects under ${label} ---`);
  for (const r of list as any[]) {
    console.log(`  ${r.id}  ${r.name}  ${r.created_at}`);
  }
}

async function main() {
  console.log("Investigating Garden Hero space duplicates...\n");

  const both = await db.execute(
    sql`select id, name, type, access_roles, created_at from spaces where id in (${A}, ${B}) order by created_at`,
  );
  console.log("=== Both rows ===");
  console.table((both as any).rows ?? both);

  await countsFor(A, "Space A");
  await countsFor(B, "Space B");
  await listProjects(A, "Space A");
  await listProjects(B, "Space B");

  // Check for an obvious primary across the codebase.
  const allDupes = await db.execute(
    sql`select org_id, name, count(*) as n from spaces group by org_id, name having count(*) > 1`,
  );
  console.log("\n=== All duplicate (org_id, name) pairs ===");
  console.table((allDupes as any).rows ?? allDupes);

  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
