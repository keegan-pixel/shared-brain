import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { spaces } from "@/lib/db/schema";
import { handle, parseJson } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { SYNC_ACTOR, resolveSyncOrg } from "@/lib/sync/context";
import { requireSyncAuth } from "@/lib/sync/auth";

const Schema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(["client", "dept", "team"]),
});

export const POST = handle(async (req: Request) => {
  const { orgId } = await requireSyncAuth(req);
  const body = await parseJson(req, Schema);


  // Pre-check is a best-effort fast path; the unique index on
  // (org_id, name) is what actually prevents the race (TOCTOU bug
  // hit on 2026-05-06 — Garden Hero double-create). The insert below
  // uses ON CONFLICT DO NOTHING + re-fetch to handle concurrent calls.
  const [existing] = await db
    .select()
    .from(spaces)
    .where(and(eq(spaces.orgId, orgId), eq(spaces.name, body.name)));
  if (existing) return NextResponse.json({ space: existing, created: false });

  const [created] = await db
    .insert(spaces)
    .values({ orgId, name: body.name, type: body.type })
    .onConflictDoNothing({ target: [spaces.orgId, spaces.name] })
    .returning();

  // Race lost: someone else inserted the same (org, name) between our
  // SELECT and our INSERT. Re-fetch and treat as no-op.
  if (!created) {
    const [winner] = await db
      .select()
      .from(spaces)
      .where(and(eq(spaces.orgId, orgId), eq(spaces.name, body.name)));
    return NextResponse.json({ space: winner, created: false });
  }

  await logActivity({
    orgId,
    actorAgent: SYNC_ACTOR,
    action: "sync_space_create",
    entityType: "space",
    entityId: created.id,
    summary: `Created ${body.type} space "${body.name}" from vault`,
    metadata: { spaceId: created.id },
  });

  return NextResponse.json({ space: created, created: true });
});
