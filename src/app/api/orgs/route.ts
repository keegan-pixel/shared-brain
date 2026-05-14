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

const PatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  /** Obsidian vault name for deep-links — pass empty string / null to clear. */
  vaultName: z.string().max(120).nullable().optional(),
  /** Vault paths the daemon should watch. Pass full list (replace, not merge). */
  vaultPaths: z.array(z.string().min(1).max(500)).max(20).optional(),
});

/**
 * PATCH /api/orgs — update the calling user's org.
 *
 * Owner-only by virtue of the `ownerUserId` WHERE clause (Phase 8 v2
 * will replace this with a role check via org_memberships, but for
 * solo orgs the owner IS the only member).
 *
 * Slug intentionally stays stable on rename so URLs don't break.
 */
export const PATCH = handle(async (req: Request) => {
  const userId = await requireUserId();
  const body = await parseJson(req, PatchSchema);

  if (
    body.name === undefined &&
    body.vaultName === undefined &&
    body.vaultPaths === undefined
  ) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const patch: {
    name?: string;
    vaultName?: string | null;
    vaultPaths?: string[];
  } = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.vaultName !== undefined) patch.vaultName = body.vaultName || null;
  if (body.vaultPaths !== undefined) patch.vaultPaths = body.vaultPaths;

  const [updated] = await db
    .update(organizations)
    .set(patch)
    .where(eq(organizations.ownerUserId, userId))
    .returning();
  return NextResponse.json({ org: updated });
});
