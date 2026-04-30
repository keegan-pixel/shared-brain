import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { items, projects, spaces, wikiPages } from "@/lib/db/schema";
import { ApiError, handle } from "@/lib/api";
import { ensureUserOrg } from "@/lib/org";
import { getConnections } from "@/lib/connections/query";

const Schema = z.object({
  type: z.enum(["wiki_page", "item"]),
  id: z.string().uuid(),
});

/** Verify the entity belongs to the caller's org so we don't leak across tenants. */
async function assertInOrg(orgId: string, type: "wiki_page" | "item", id: string) {
  if (type === "wiki_page") {
    const [row] = await db
      .select({ id: wikiPages.id })
      .from(wikiPages)
      .where(and(eq(wikiPages.id, id), eq(wikiPages.orgId, orgId)));
    if (!row) throw new ApiError("Not found", 404);
    return;
  }
  const [row] = await db
    .select({ id: items.id })
    .from(items)
    .innerJoin(projects, eq(items.projectId, projects.id))
    .innerJoin(spaces, eq(projects.spaceId, spaces.id))
    .where(and(eq(items.id, id), eq(spaces.orgId, orgId)));
  if (!row) throw new ApiError("Not found", 404);
}

export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const parsed = Schema.safeParse({
    type: url.searchParams.get("type"),
    id: url.searchParams.get("id"),
  });
  if (!parsed.success) throw new ApiError("Invalid query params", 400, { issues: parsed.error.issues });
  const { type, id } = parsed.data;

  const org = await ensureUserOrg();
  await assertInOrg(org.id, type, id);
  const connections = await getConnections({ type, id });
  return NextResponse.json({ connections });
});
