/**
 * Phase F4 v2 — Sync configs list endpoint.
 * Clerk-authenticated. Returns the org's sync config rows for the
 * Settings → Sync UI to render.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { syncConfigs } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";
import { handle } from "@/lib/api";

export const GET = handle(async () => {
  const org = await ensureUserOrg();
  const rows = await db
    .select()
    .from(syncConfigs)
    .where(eq(syncConfigs.orgId, org.id))
    .orderBy(syncConfigs.toolkit, syncConfigs.label);
  return NextResponse.json({ configs: rows });
});
