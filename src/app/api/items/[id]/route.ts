import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { items, itemStatusValues, itemTypeValues, projects, spaces } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";
import { ApiError, handle, parseJson } from "@/lib/api";
import { indexEntityLinks } from "@/lib/connections/extract";

type Ctx = { params: Promise<{ id: string }> };

async function loadItem(id: string) {
  const org = await ensureUserOrg();
  const [row] = await db
    .select({ item: items })
    .from(items)
    .innerJoin(projects, eq(items.projectId, projects.id))
    .innerJoin(spaces, eq(projects.spaceId, spaces.id))
    .where(and(eq(items.id, id), eq(spaces.orgId, org.id)));
  if (!row) throw new ApiError("Item not found", 404);
  return row.item;
}

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const item = await loadItem(id);
  return NextResponse.json({ item });
});

const PatchSchema = z.object({
  title: z.string().min(1).max(240).optional(),
  content: z.string().nullable().optional(),
  type: z.enum(itemTypeValues).optional(),
  status: z.enum(itemStatusValues).optional(),
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await loadItem(id);
  const patch = await parseJson(req, PatchSchema);
  const [updated] = await db
    .update(items)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(items.id, id))
    .returning();

  // Re-index links if title or content changed (cheap to always re-run).
  if (patch.title !== undefined || patch.content !== undefined) {
    const org = await ensureUserOrg();
    await indexEntityLinks({
      orgId: org.id,
      source: { type: "item", id: updated.id },
      body: `${updated.title}\n\n${updated.content ?? ""}`,
    });
  }
  return NextResponse.json({ item: updated });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await loadItem(id);
  await db.delete(items).where(eq(items.id, id));
  return NextResponse.json({ ok: true });
});
