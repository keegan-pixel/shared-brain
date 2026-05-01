import { NextResponse } from "next/server";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activityFeed } from "@/lib/db/schema";
import { handle } from "@/lib/api";
import { ensureUserOrg } from "@/lib/org";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseLimit(raw: string | null): number {
  const n = parseInt(raw ?? `${DEFAULT_LIMIT}`, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
  const since = url.searchParams.get("since"); // ISO timestamp
  const until = url.searchParams.get("until"); // ISO timestamp
  const actor = url.searchParams.get("actor"); // claude-mcp | vault-sync | user | ...
  const action = url.searchParams.get("action"); // sync_wiki_create | move_item_status | ...
  const spaceId = url.searchParams.get("space"); // matches metadata.spaceId or activity.entity_type=space

  const org = await ensureUserOrg();

  const conds: SQL[] = [eq(activityFeed.orgId, org.id)];
  if (since) conds.push(gte(activityFeed.createdAt, new Date(since)));
  if (until) conds.push(lte(activityFeed.createdAt, new Date(until)));
  if (actor) conds.push(eq(activityFeed.actorAgent, actor));
  if (action) conds.push(eq(activityFeed.action, action));

  // Space filter: matches when activity.entity_type=space and entity_id=spaceId,
  // OR when metadata.spaceId equals spaceId.
  if (spaceId) {
    conds.push(
      sql`(${activityFeed.entityType} = 'space' and ${activityFeed.entityId} = ${spaceId})
          or (${activityFeed.metadata}->>'spaceId' = ${spaceId})`,
    );
  }

  const [rows, totalRow] = await Promise.all([
    db
      .select()
      .from(activityFeed)
      .where(and(...conds))
      .orderBy(desc(activityFeed.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(activityFeed)
      .where(and(...conds)),
  ]);

  return NextResponse.json({ entries: rows, total: totalRow[0]?.count ?? 0, limit, offset });
});
