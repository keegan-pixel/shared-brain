/**
 * Phase 8 v2 — Composio consumer key per org.
 *
 *   GET    /api/orgs/composio        get current config (masked)
 *   POST   /api/orgs/composio        set/update (validates first)
 *   DELETE /api/orgs/composio        remove
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orgComposioConfig } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";
import { handle, parseJson } from "@/lib/api";
import { validateComposioKey } from "@/lib/composio-keys";

export const GET = handle(async () => {
  const org = await ensureUserOrg();
  const [row] = await db
    .select()
    .from(orgComposioConfig)
    .where(eq(orgComposioConfig.orgId, org.id))
    .limit(1);
  if (!row) return NextResponse.json({ connected: false });
  return NextResponse.json({
    connected: true,
    keyHint: `${row.apiKey.slice(0, 6)}...${row.apiKey.slice(-4)}`,
    mcpUrl: row.mcpUrl,
    updatedAt: row.updatedAt,
  });
});

const PostSchema = z.object({
  apiKey: z.string().min(10),
  mcpUrl: z.string().url().optional(),
});

export const POST = handle(async (req: Request) => {
  const org = await ensureUserOrg();
  const body = await parseJson(req, PostSchema);

  const validation = await validateComposioKey(body.apiKey, body.mcpUrl);
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error, hint: "Make sure you copied the consumer key from app.composio.dev." },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select()
    .from(orgComposioConfig)
    .where(eq(orgComposioConfig.orgId, org.id))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(orgComposioConfig)
      .set({
        apiKey: body.apiKey,
        mcpUrl: body.mcpUrl ?? existing.mcpUrl,
        updatedAt: new Date(),
      })
      .where(eq(orgComposioConfig.id, existing.id))
      .returning();
    return NextResponse.json({ ok: true, action: "updated", updatedAt: updated.updatedAt });
  }

  const [created] = await db
    .insert(orgComposioConfig)
    .values({
      orgId: org.id,
      apiKey: body.apiKey,
      mcpUrl: body.mcpUrl,
    })
    .returning();
  return NextResponse.json({ ok: true, action: "created", updatedAt: created.updatedAt });
});

export const DELETE = handle(async () => {
  const org = await ensureUserOrg();
  await db
    .delete(orgComposioConfig)
    .where(eq(orgComposioConfig.orgId, org.id));
  return NextResponse.json({ ok: true });
});
