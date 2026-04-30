import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema";

export type McpContext = {
  orgId: string;
  ownerUserId: string;
  actorAgent: string;
};

let _cached: { orgId: string; ownerUserId: string } | null = null;

/**
 * Resolves the org context for an MCP request. For Phase 1 (single user), we
 * look up the org owned by MCP_USER_ID. If not set, we fall back to the first
 * org in the table — fine for personal-use MVP, replace with per-key auth when
 * we go multi-tenant.
 */
export async function resolveOrgContext(actorAgent: string): Promise<McpContext> {
  if (_cached) return { ...{ ..._cached }, actorAgent };

  const targetUserId = process.env.MCP_USER_ID;
  if (targetUserId) {
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.ownerUserId, targetUserId))
      .limit(1);
    if (!org) {
      throw new Error(
        `No org found for MCP_USER_ID=${targetUserId}. Sign in once at the web app to bootstrap your org.`,
      );
    }
    _cached = { orgId: org.id, ownerUserId: org.ownerUserId };
    return { ...{ ..._cached }, actorAgent };
  }

  const [org] = await db.select().from(organizations).limit(1);
  if (!org) {
    throw new Error("No organizations exist. Sign in once at the web app to bootstrap your org.");
  }
  _cached = { orgId: org.id, ownerUserId: org.ownerUserId };
  return { ...{ ..._cached }, actorAgent };
}
