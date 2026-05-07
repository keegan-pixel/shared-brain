import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/lib/db/client";
import { items, itemStatusValues, itemTypeValues, projects, spaces, vaultSyncLog } from "@/lib/db/schema";
import { ApiError, handle, parseJson } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { indexEntityLinks } from "@/lib/connections/extract";
import { SYNC_ACTOR, resolveSyncOrg } from "@/lib/sync/context";
import { requireSyncAuth } from "@/lib/sync/auth";

const Schema = z.object({
  projectId: z.string().uuid(),
  filePath: z.string().min(1),
  /** Position within the source file (line number) — disambiguates multiple items in the same file */
  lineKey: z.string(),
  title: z.string().min(1).max(240),
  type: z.enum(itemTypeValues).optional(),
  status: z.enum(itemStatusValues),
  content: z.string().optional(),
});

export const POST = handle(async (req: Request) => {
  requireSyncAuth(req);
  const body = await parseJson(req, Schema);
  const { orgId } = await resolveSyncOrg();

  const [project] = await db
    .select({ id: projects.id, spaceId: projects.spaceId })
    .from(projects)
    .innerJoin(spaces, eq(projects.spaceId, spaces.id))
    .where(and(eq(projects.id, body.projectId), eq(spaces.orgId, orgId)));
  if (!project) throw new ApiError("Project not found", 404);

  const lookupKey = `${body.filePath}#${body.lineKey}`;

  const [logRow] = await db
    .select()
    .from(vaultSyncLog)
    .where(eq(vaultSyncLog.filePath, lookupKey));

  // Compute the same hash the wiki route uses for its skip-if-unchanged
  // check, but for items: title + content + status. This MUST match the
  // SQL `md5(title || content || status)` written below so the
  // round-trip comparison is consistent.
  const incomingHash = createHash("md5")
    .update(`${body.title}${body.content ?? ""}${body.status}`)
    .digest("hex");

  // Skip-if-unchanged: if we already have an item-typed log row with the
  // same hash, no real change happened — return early. Without this,
  // every full-vault sync pass re-stamps every task as "updated" and
  // writes a fresh activity entry, flooding the feed with phantom
  // updates. (Bug found 2026-05-06: 262+ spurious updates per daemon
  // restart because client_tasks loops every line and POSTs each one.)
  if (
    logRow &&
    logRow.entityType === "item" &&
    logRow.entityId &&
    logRow.contentHash === incomingHash
  ) {
    return NextResponse.json({ ok: true, skipped: true, itemId: logRow.entityId });
  }

  let itemId: string;
  let action: "created" | "updated";
  if (logRow?.entityType === "item" && logRow.entityId) {
    const [updated] = await db
      .update(items)
      .set({
        title: body.title,
        type: body.type ?? "task",
        status: body.status,
        content: body.content,
        updatedAt: new Date(),
      })
      .where(eq(items.id, logRow.entityId))
      .returning({ id: items.id });
    itemId = updated.id;
    action = "updated";
  } else {
    const [created] = await db
      .insert(items)
      .values({
        projectId: body.projectId,
        type: body.type ?? "task",
        title: body.title,
        status: body.status,
        content: body.content,
        createdByAgent: SYNC_ACTOR,
      })
      .returning({ id: items.id });
    itemId = created.id;
    action = "created";
  }

  await db
    .insert(vaultSyncLog)
    .values({
      filePath: lookupKey,
      entityType: "item",
      entityId: itemId,
      contentHash: sql`md5(${body.title} || coalesce(${body.content ?? ""}, '') || ${body.status})`,
      status: "synced",
      lastSyncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: vaultSyncLog.filePath,
      set: {
        entityType: "item",
        entityId: itemId,
        contentHash: sql`md5(${body.title} || coalesce(${body.content ?? ""}, '') || ${body.status})`,
        status: "synced",
        lastSyncedAt: new Date(),
        errorMessage: null,
      },
    });

  await logActivity({
    orgId,
    actorAgent: SYNC_ACTOR,
    action: `sync_item_${action}`,
    entityType: "item",
    entityId: itemId,
    summary: `${action === "created" ? "Created" : "Updated"} task "${body.title}" from ${body.filePath}`,
    // Include spaceId in metadata so the activity feed's space filter
    // (which checks metadata.spaceId) catches synced items.
    metadata: {
      filePath: body.filePath,
      status: body.status,
      spaceId: project.spaceId,
      projectId: body.projectId,
    },
  });

  // Index any [[wikilinks]] that appear in the item title or content.
  await indexEntityLinks({
    orgId,
    source: { type: "item", id: itemId },
    body: `${body.title}\n\n${body.content ?? ""}`,
  });

  return NextResponse.json({ ok: true, itemId, action });
});
