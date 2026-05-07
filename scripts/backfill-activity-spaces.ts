/**
 * One-time backfill: add metadata.spaceId to existing activity_feed rows
 * that should have had it but didn't (because pre-fix sync routes never
 * populated it).
 *
 * Strategy:
 *   - For action LIKE 'sync_item_%' or 'move_item_status' and entity_type='item':
 *     join through items → projects to get spaceId.
 *   - For action LIKE 'sync_wiki_%' and entity_type='wiki_page':
 *     derive spaceId from metadata.filePath using the same Clients/<NAME>,
 *     SimHouse.io/, Coaching/ rules the sync route uses.
 *   - Skip rows where metadata.spaceId is already set (idempotent).
 *
 * Usage:
 *   export DATABASE_URL=...
 *   npx tsx scripts/backfill-activity-spaces.ts
 *   npx tsx scripts/backfill-activity-spaces.ts --dry-run
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { activityFeed, items, projects, spaces } from "../src/lib/db/schema";

type ActivityFeedRow = typeof activityFeed.$inferSelect;

const DRY_RUN = process.argv.includes("--dry-run");

function deriveSpaceNameFromPath(filePath: string): string | null {
  const segs = filePath.split("/");
  if (segs.length < 2) return null;
  if (segs[0] === "Clients") return segs[1];
  if (segs[0] === "SimHouse.io") return "SimHouse.io";
  if (segs[0] === "Coaching") return "Coaching";
  return null;
}

async function main() {
  console.log(DRY_RUN ? "[dry-run] " : "" + "starting backfill...\n");

  // Build a name → id map of all spaces (we have ~10, so a single query is fine)
  const allSpaces = await db.select({ id: spaces.id, name: spaces.name }).from(spaces);
  const spaceIdByName = new Map(allSpaces.map((s) => [s.name, s.id]));
  console.log(`loaded ${allSpaces.length} spaces:`, [...spaceIdByName.keys()].join(", "));

  // Pull all activity rows that don't have spaceId in metadata yet.
  const rows: ActivityFeedRow[] = await db
    .select()
    .from(activityFeed)
    .where(sql`${activityFeed.metadata}->>'spaceId' IS NULL`);
  console.log(`scanning ${rows.length} rows without metadata.spaceId\n`);

  let itemFixed = 0;
  let wikiFixed = 0;
  let skipped = 0;

  for (const row of rows) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    let spaceId: string | null = null;

    // Items: look up via projectId in metadata if available, else through the item itself
    if (row.entityType === "item" && row.entityId) {
      if (typeof meta.projectId === "string") {
        const [proj] = await db
          .select({ spaceId: projects.spaceId })
          .from(projects)
          .where(eq(projects.id, meta.projectId as string))
          .limit(1);
        spaceId = proj?.spaceId ?? null;
      } else {
        const [joined] = await db
          .select({ spaceId: projects.spaceId })
          .from(items)
          .innerJoin(projects, eq(items.projectId, projects.id))
          .where(eq(items.id, row.entityId))
          .limit(1);
        spaceId = joined?.spaceId ?? null;
      }
      if (spaceId) itemFixed++;
    }

    // Wiki pages: derive from filePath in metadata
    if (row.entityType === "wiki_page" && typeof meta.filePath === "string") {
      const spaceName = deriveSpaceNameFromPath(meta.filePath as string);
      if (spaceName) {
        spaceId = spaceIdByName.get(spaceName) ?? null;
        if (spaceId) wikiFixed++;
      }
    }

    if (!spaceId) {
      skipped++;
      continue;
    }

    if (!DRY_RUN) {
      await db
        .update(activityFeed)
        .set({
          metadata: sql`${activityFeed.metadata} || jsonb_build_object('spaceId', ${spaceId}::text)`,
        })
        .where(eq(activityFeed.id, row.id));
    }
  }

  console.log("\n─── results ───");
  console.log(`  items fixed:    ${itemFixed}`);
  console.log(`  wiki fixed:     ${wikiFixed}`);
  console.log(`  skipped (no resolvable space): ${skipped}`);
  console.log(DRY_RUN ? "(dry-run — no rows actually updated)" : "✓ done");
}

main().catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});
