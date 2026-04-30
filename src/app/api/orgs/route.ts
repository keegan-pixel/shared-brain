import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema";
import { ensureUserOrg, requireUserId } from "@/lib/org";
import { handle, parseJson } from "@/lib/api";

export const GET = handle(async () => {
  const org = await ensureUserOrg();
  return NextResponse.json({ org });
});

const PatchSchema = z.object({ name: z.string().min(1).max(120) });

export const PATCH = handle(async (req: Request) => {
  const userId = await requireUserId();
  const { name } = await parseJson(req, PatchSchema);
  const [updated] = await db
    .update(organizations)
    .set({ name })
    .where(eq(organizations.ownerUserId, userId))
    .returning();
  return NextResponse.json({ org: updated });
});
