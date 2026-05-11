import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema";

/** Generate a per-org sync key. Format: `sb_sync_<43 base64url chars>`. */
function generateSyncKey(): string {
  return "sb_sync_" + randomBytes(32).toString("base64url");
}

/**
 * Phase 8 v2 prep — per-user org isolation.
 *
 * Each Clerk user gets their OWN org on first sign-in. We no longer
 * default everyone to "ViaOps" — that was the single-user assumption
 * of Phase 0. Now new users get an org named after them
 * (`{first} {last}'s Brain`), with a slug derived from the same.
 *
 * Existing data: Keegan's "ViaOps" org keeps its name/slug. No
 * migration needed since the lookup is by `ownerUserId`.
 *
 * Org rename: see `PATCH /api/orgs/<id>` and `/settings/org` UI.
 */

export async function requireUserId() {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHENTICATED");
  return userId;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "brain";
}

async function uniqueSlug(base: string): Promise<string> {
  // Resolve slug collisions by suffixing `-2`, `-3`, ... Cheap loop
  // since collisions are rare (most slugs are unique on first try).
  let slug = base;
  let n = 1;
  while (true) {
    const [hit] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);
    if (!hit) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

/**
 * Build a default org name from Clerk user info. Falls back through
 * `firstName lastName`, then `firstName`, then email local-part, then
 * a generic "My Brain" if Clerk has nothing useful for us.
 */
function defaultOrgName(
  user: { firstName?: string | null; lastName?: string | null; emailAddresses?: Array<{ emailAddress: string }> } | null,
): string {
  if (!user) return "My Brain";
  const first = (user.firstName ?? "").trim();
  const last = (user.lastName ?? "").trim();
  if (first && last) return `${first} ${last}'s Brain`;
  if (first) return `${first}'s Brain`;
  const email = user.emailAddresses?.[0]?.emailAddress ?? "";
  const local = email.split("@")[0]?.trim();
  if (local) return `${local}'s Brain`;
  return "My Brain";
}

export async function ensureUserOrg() {
  const userId = await requireUserId();

  const existing = await db
    .select()
    .from(organizations)
    .where(eq(organizations.ownerUserId, userId))
    .limit(1);

  if (existing.length > 0) return existing[0];

  // First time this user signs in — create their own org.
  const user = await currentUser();
  const name = defaultOrgName(user);
  const slug = await uniqueSlug(slugify(name));

  const [created] = await db
    .insert(organizations)
    .values({
      name,
      slug,
      ownerUserId: userId,
      mcpApiKey: generateSyncKey(),
    })
    .returning();

  return created;
}

/**
 * Generate (or rotate) the sync key for an org. Caller must verify
 * the user is allowed to rotate (currently: only the owner).
 */
export async function rotateSyncKey(orgId: string): Promise<string> {
  const newKey = generateSyncKey();
  await db
    .update(organizations)
    .set({ mcpApiKey: newKey })
    .where(eq(organizations.id, orgId));
  return newKey;
}
