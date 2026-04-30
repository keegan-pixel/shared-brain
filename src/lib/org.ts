import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema";

const DEFAULT_ORG_NAME = "ViaOps";
const DEFAULT_ORG_SLUG = "viaops";

export async function requireUserId() {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHENTICATED");
  return userId;
}

export async function ensureUserOrg() {
  const userId = await requireUserId();

  const existing = await db
    .select()
    .from(organizations)
    .where(eq(organizations.ownerUserId, userId))
    .limit(1);

  if (existing.length > 0) return existing[0];

  const [created] = await db
    .insert(organizations)
    .values({
      name: DEFAULT_ORG_NAME,
      slug: DEFAULT_ORG_SLUG,
      ownerUserId: userId,
    })
    .returning();

  return created;
}
