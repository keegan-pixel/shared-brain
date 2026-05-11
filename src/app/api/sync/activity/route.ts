import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { vaultSyncLog } from "@/lib/db/schema";
import { handle, parseJson } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { SYNC_ACTOR, resolveSyncOrg } from "@/lib/sync/context";
import { requireSyncAuth } from "@/lib/sync/auth";

const Schema = z.object({
  filePath: z.string().min(1),
  contentHash: z.string().min(1),
  summary: z.string().min(1).max(240),
  body: z.string().optional(),
});

export const POST = handle(async (req: Request) => {
  const { orgId } = await requireSyncAuth(req);
  const body = await parseJson(req, Schema);


  // Idempotency: skip if hash unchanged
  const [logRow] = await db.select().from(vaultSyncLog).where(eq(vaultSyncLog.filePath, body.filePath));
  if (logRow && logRow.contentHash === body.contentHash) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  await logActivity({
    orgId,
    actorAgent: SYNC_ACTOR,
    action: "sync_activity",
    entityType: "vault_file",
    entityId: null,
    summary: body.summary,
    metadata: { filePath: body.filePath, body: body.body ?? "" },
  });

  await db
    .insert(vaultSyncLog)
    .values({
      filePath: body.filePath,
      entityType: "activity",
      entityId: null,
      contentHash: body.contentHash,
      status: "synced",
      lastSyncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: vaultSyncLog.filePath,
      set: {
        entityType: "activity",
        contentHash: body.contentHash,
        status: "synced",
        lastSyncedAt: new Date(),
        errorMessage: null,
      },
    });

  return NextResponse.json({ ok: true });
});
