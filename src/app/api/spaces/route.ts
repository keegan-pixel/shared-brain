import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { spaces } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";
import { handle, parseJson } from "@/lib/api";

export const GET = handle(async () => {
  const org = await ensureUserOrg();
  const rows = await db.select().from(spaces).where(eq(spaces.orgId, org.id));
  return NextResponse.json({ spaces: rows });
});

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(["client", "dept", "team"]),
  accessRoles: z.array(z.string()).optional(),
});

export const POST = handle(async (req: Request) => {
  const org = await ensureUserOrg();
  const body = await parseJson(req, CreateSchema);
  const [created] = await db
    .insert(spaces)
    .values({
      orgId: org.id,
      name: body.name,
      type: body.type,
      accessRoles: body.accessRoles ?? [],
    })
    .returning();
  return NextResponse.json({ space: created }, { status: 201 });
});
