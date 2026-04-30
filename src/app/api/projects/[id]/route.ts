import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects, spaces } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";
import { ApiError, handle, parseJson } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

async function loadProject(id: string) {
  const org = await ensureUserOrg();
  const [row] = await db
    .select({ project: projects })
    .from(projects)
    .innerJoin(spaces, eq(projects.spaceId, spaces.id))
    .where(and(eq(projects.id, id), eq(spaces.orgId, org.id)));
  if (!row) throw new ApiError("Project not found", 404);
  return row.project;
}

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const project = await loadProject(id);
  return NextResponse.json({ project });
});

const PatchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().optional(),
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await loadProject(id);
  const patch = await parseJson(req, PatchSchema);
  const [updated] = await db.update(projects).set(patch).where(eq(projects.id, id)).returning();
  return NextResponse.json({ project: updated });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await loadProject(id);
  await db.delete(projects).where(eq(projects.id, id));
  return NextResponse.json({ ok: true });
});
