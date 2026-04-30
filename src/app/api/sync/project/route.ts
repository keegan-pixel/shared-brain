import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects, spaces } from "@/lib/db/schema";
import { ApiError, handle, parseJson } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { SYNC_ACTOR, resolveSyncOrg } from "@/lib/sync/context";
import { requireSyncAuth } from "@/lib/sync/auth";

const Schema = z.object({
  spaceId: z.string().uuid(),
  name: z.string().min(1).max(160),
  description: z.string().optional(),
});

export const POST = handle(async (req: Request) => {
  requireSyncAuth(req);
  const body = await parseJson(req, Schema);
  const { orgId } = await resolveSyncOrg();

  const [space] = await db
    .select()
    .from(spaces)
    .where(and(eq(spaces.id, body.spaceId), eq(spaces.orgId, orgId)));
  if (!space) throw new ApiError("Space not found", 404);

  const [existing] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.spaceId, body.spaceId), eq(projects.name, body.name)));
  if (existing) return NextResponse.json({ project: existing, created: false });

  const [created] = await db
    .insert(projects)
    .values({ spaceId: body.spaceId, name: body.name, description: body.description })
    .returning();

  await logActivity({
    orgId,
    actorAgent: SYNC_ACTOR,
    action: "sync_project_create",
    entityType: "project",
    entityId: created.id,
    summary: `Created project "${body.name}" from vault`,
    metadata: { spaceId: body.spaceId, projectId: created.id },
  });

  return NextResponse.json({ project: created, created: true });
});
