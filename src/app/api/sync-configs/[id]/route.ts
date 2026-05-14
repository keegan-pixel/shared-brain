/**
 * Phase F4 v2 — Single sync config patch endpoint.
 * Updates mode and/or source filter for an org's sync config.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { syncConfigs, syncConfigModeValues } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";
import { ApiError, handle, parseJson } from "@/lib/api";

const PatchSchema = z.object({
  mode: z.enum(syncConfigModeValues).optional(),
  sourceFilter: z.record(z.string(), z.unknown()).optional(),
  /** Human-readable label for the connection. User-editable via inline UI. */
  label: z.string().min(1).max(160).optional(),
});

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const org = await ensureUserOrg();
  const body = await parseJson(req, PatchSchema);

  const [existing] = await db
    .select()
    .from(syncConfigs)
    .where(and(eq(syncConfigs.id, id), eq(syncConfigs.orgId, org.id)));
  if (!existing) throw new ApiError("Sync config not found", 404);

  const update: Partial<typeof syncConfigs.$inferInsert> = { updatedAt: new Date() };
  if (body.mode !== undefined) update.mode = body.mode;
  if (body.sourceFilter !== undefined) update.sourceFilter = body.sourceFilter;
  if (body.label !== undefined) update.label = body.label.trim();

  const [updated] = await db
    .update(syncConfigs)
    .set(update)
    .where(and(eq(syncConfigs.id, id), eq(syncConfigs.orgId, org.id)))
    .returning();

  return NextResponse.json({ config: updated });
});
