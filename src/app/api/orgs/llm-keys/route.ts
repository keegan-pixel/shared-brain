/**
 * Phase 8 v2 — LLM keys API.
 *
 *   GET    /api/orgs/llm-keys                 list keys for caller's org
 *   POST   /api/orgs/llm-keys                 add/update a key (validates first)
 *   DELETE /api/orgs/llm-keys?provider=foo    remove a provider's key
 *
 * Validation is mandatory on POST: a quick call to the provider's
 * models endpoint confirms the key works before we persist. Better to
 * fail fast than save a bad key and have semantic search silently fall
 * back for weeks.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orgLlmConfig, orgLlmProviderValues, type OrgLlmProvider } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";
import { handle, parseJson } from "@/lib/api";
import { validateLlmKey } from "@/lib/llm-keys";

export const GET = handle(async () => {
  const org = await ensureUserOrg();
  const rows = await db
    .select({
      id: orgLlmConfig.id,
      provider: orgLlmConfig.provider,
      defaultModel: orgLlmConfig.defaultModel,
      useFor: orgLlmConfig.useFor,
      monthlyTokenCap: orgLlmConfig.monthlyTokenCap,
      hasKey: orgLlmConfig.apiKey, // we don't echo back the actual key
      createdAt: orgLlmConfig.createdAt,
      updatedAt: orgLlmConfig.updatedAt,
    })
    .from(orgLlmConfig)
    .where(eq(orgLlmConfig.orgId, org.id));

  // Mask the api_key — never return it. Just confirm presence.
  const masked = rows.map((r) => ({
    ...r,
    hasKey: r.hasKey ? `${r.hasKey.slice(0, 6)}...${r.hasKey.slice(-4)}` : null,
  }));
  return NextResponse.json({ keys: masked });
});

const PostSchema = z.object({
  provider: z.enum(orgLlmProviderValues),
  apiKey: z.string().min(10),
  defaultModel: z.string().max(120).optional(),
  useFor: z.array(z.string()).default(["all"]),
  monthlyTokenCap: z.number().int().positive().nullable().optional(),
});

export const POST = handle(async (req: Request) => {
  const org = await ensureUserOrg();
  const body = await parseJson(req, PostSchema);

  // Validate the key with the provider BEFORE saving.
  const validation = await validateLlmKey(body.provider as OrgLlmProvider, body.apiKey);
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error, hint: "Double-check the key in your provider's console and try again." },
      { status: 400 },
    );
  }

  // Upsert: one row per (orgId, provider).
  const [existing] = await db
    .select()
    .from(orgLlmConfig)
    .where(
      and(eq(orgLlmConfig.orgId, org.id), eq(orgLlmConfig.provider, body.provider)),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(orgLlmConfig)
      .set({
        apiKey: body.apiKey,
        defaultModel: body.defaultModel ?? existing.defaultModel,
        useFor: body.useFor,
        monthlyTokenCap: body.monthlyTokenCap ?? existing.monthlyTokenCap,
        updatedAt: new Date(),
      })
      .where(eq(orgLlmConfig.id, existing.id))
      .returning();
    return NextResponse.json({
      ok: true,
      keyId: updated.id,
      validation,
      action: "updated",
    });
  }

  const [created] = await db
    .insert(orgLlmConfig)
    .values({
      orgId: org.id,
      provider: body.provider,
      apiKey: body.apiKey,
      defaultModel: body.defaultModel,
      useFor: body.useFor,
      monthlyTokenCap: body.monthlyTokenCap,
    })
    .returning();
  return NextResponse.json({
    ok: true,
    keyId: created.id,
    validation,
    action: "created",
  });
});

const DeleteSchema = z.object({
  provider: z.enum(orgLlmProviderValues),
});

export const DELETE = handle(async (req: Request) => {
  const org = await ensureUserOrg();
  const url = new URL(req.url);
  const parse = DeleteSchema.safeParse({ provider: url.searchParams.get("provider") });
  if (!parse.success) {
    return NextResponse.json({ error: "Missing or invalid `provider` param" }, { status: 400 });
  }
  await db
    .delete(orgLlmConfig)
    .where(
      and(eq(orgLlmConfig.orgId, org.id), eq(orgLlmConfig.provider, parse.data.provider)),
    );
  return NextResponse.json({ ok: true });
});
