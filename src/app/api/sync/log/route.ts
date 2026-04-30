import { NextResponse } from "next/server";
import { z } from "zod";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { vaultSyncLog } from "@/lib/db/schema";
import { handle, parseJson } from "@/lib/api";
import { requireSyncAuth } from "@/lib/sync/auth";

const ErrorSchema = z.object({
  filePath: z.string().min(1),
  contentHash: z.string().min(1),
  errorMessage: z.string(),
});

export const GET = handle(async (req: Request) => {
  requireSyncAuth(req);
  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 500);
  const rows = await db
    .select()
    .from(vaultSyncLog)
    .orderBy(desc(vaultSyncLog.lastSyncedAt))
    .limit(limit);
  return NextResponse.json({ entries: rows });
});

/** Record a sync error for a specific file. */
export const POST = handle(async (req: Request) => {
  requireSyncAuth(req);
  const body = await parseJson(req, ErrorSchema);
  await db
    .insert(vaultSyncLog)
    .values({
      filePath: body.filePath,
      contentHash: body.contentHash,
      status: "error",
      errorMessage: body.errorMessage,
      lastSyncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: vaultSyncLog.filePath,
      set: {
        contentHash: body.contentHash,
        status: "error",
        errorMessage: body.errorMessage,
        lastSyncedAt: new Date(),
      },
    });
  return NextResponse.json({ ok: true });
});
