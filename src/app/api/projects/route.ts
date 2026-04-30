import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects, spaces } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";
import { ApiError, handle, parseJson } from "@/lib/api";

async function assertSpaceInOrg(spaceId: string) {
  const org = await ensureUserOrg();
  const [space] = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(and(eq(spaces.id, spaceId), eq(spaces.orgId, org.id)));
  if (!space) throw new ApiError("Space not found", 404);
}

export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const spaceId = url.searchParams.get("spaceId");
  if (!spaceId) throw new ApiError("spaceId query param is required", 400);
  await assertSpaceInOrg(spaceId);
  const rows = await db.select().from(projects).where(eq(projects.spaceId, spaceId));
  return NextResponse.json({ projects: rows });
});

const CreateSchema = z.object({
  spaceId: z.string().uuid(),
  name: z.string().min(1).max(160),
  description: z.string().optional(),
});

export const POST = handle(async (req: Request) => {
  const body = await parseJson(req, CreateSchema);
  await assertSpaceInOrg(body.spaceId);
  const [created] = await db
    .insert(projects)
    .values({ spaceId: body.spaceId, name: body.name, description: body.description })
    .returning();
  return NextResponse.json({ project: created }, { status: 201 });
});
