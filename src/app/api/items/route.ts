import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { items, itemStatusValues, itemTypeValues, projects, spaces } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";
import { ApiError, handle, parseJson } from "@/lib/api";
import { indexEntityLinks } from "@/lib/connections/extract";

async function assertProjectInOrg(projectId: string) {
  const org = await ensureUserOrg();
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(spaces, eq(projects.spaceId, spaces.id))
    .where(and(eq(projects.id, projectId), eq(spaces.orgId, org.id)));
  if (!row) throw new ApiError("Project not found", 404);
}

export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const status = url.searchParams.get("status");
  if (!projectId) throw new ApiError("projectId query param is required", 400);
  await assertProjectInOrg(projectId);

  const conditions = [eq(items.projectId, projectId)];
  if (status) {
    if (!(itemStatusValues as readonly string[]).includes(status)) {
      throw new ApiError(`Invalid status: ${status}`, 400);
    }
    conditions.push(eq(items.status, status as (typeof itemStatusValues)[number]));
  }
  const rows = await db
    .select()
    .from(items)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions));
  return NextResponse.json({ items: rows });
});

const CreateSchema = z.object({
  projectId: z.string().uuid(),
  type: z.enum(itemTypeValues),
  title: z.string().min(1).max(240),
  content: z.string().optional(),
  status: z.enum(itemStatusValues).optional(),
  createdByAgent: z.string().optional(),
});

export const POST = handle(async (req: Request) => {
  const body = await parseJson(req, CreateSchema);
  await assertProjectInOrg(body.projectId);
  const [created] = await db
    .insert(items)
    .values({
      projectId: body.projectId,
      type: body.type,
      title: body.title,
      content: body.content,
      status: body.status ?? "backlog",
      createdByAgent: body.createdByAgent ?? "user",
    })
    .returning();

  const org = await ensureUserOrg();
  await indexEntityLinks({
    orgId: org.id,
    source: { type: "item", id: created.id },
    body: `${created.title}\n\n${created.content ?? ""}`,
  });

  return NextResponse.json({ item: created }, { status: 201 });
});
