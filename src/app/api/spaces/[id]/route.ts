import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { spaces } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";
import { ApiError, handle, parseJson } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

async function loadSpace(id: string) {
  const org = await ensureUserOrg();
  const [row] = await db
    .select()
    .from(spaces)
    .where(and(eq(spaces.id, id), eq(spaces.orgId, org.id)));
  if (!row) throw new ApiError("Space not found", 404);
  return row;
}

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const space = await loadSpace(id);
  return NextResponse.json({ space });
});

const PatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  type: z.enum(["client", "dept", "team"]).optional(),
  accessRoles: z.array(z.string()).optional(),
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await loadSpace(id);
  const patch = await parseJson(req, PatchSchema);
  const [updated] = await db.update(spaces).set(patch).where(eq(spaces.id, id)).returning();
  return NextResponse.json({ space: updated });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await loadSpace(id);
  await db.delete(spaces).where(eq(spaces.id, id));
  return NextResponse.json({ ok: true });
});
