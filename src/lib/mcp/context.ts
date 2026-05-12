import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema";
import { getRequestUserId } from "./request-context";

export type McpContext = {
  orgId: string;
  ownerUserId: string;
  actorAgent: string;
};

/**
 * Resolves the org context for an MCP request.
 *
 * Phase 8 v2 (live fix during Jake's install): the resolver now scopes
 * per-user via AsyncLocalStorage. When called from the MCP handler:
 *   1. Read userId from request-scoped storage (set by route.ts after
 *      OAuth token validation).
 *   2. If userId is present, find THAT user's org.
 *   3. Else (legacy MCP_API_KEY auth, no userId), fall back to
 *      MCP_USER_ID env var → first org.
 *
 * The old in-memory `_cached` was REMOVED — it was the root cause of
 * Jake seeing Keegan's data through MCP. Per-request resolution costs
 * one extra DB query per call; negligible at our scale.
 */
export async function resolveOrgContext(actorAgent: string): Promise<McpContext> {
  // Path 1: per-user (OAuth-authed request).
  const requestUserId = getRequestUserId();
  if (requestUserId) {
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.ownerUserId, requestUserId))
      .limit(1);
    if (org) {
      return { orgId: org.id, ownerUserId: org.ownerUserId, actorAgent };
    }
    // User has an OAuth token but no org? That's a "user existed before
    // Build A's auto-org-create" scenario. ensureUserOrg would have
    // created one on web-login. For MCP-only users without web-login,
    // we'd need to create one here. For now, fall through to env fallback.
    console.warn(`[mcp] OAuth user ${requestUserId} has no org; falling back`);
  }

  // Path 2: legacy fallback (env var or first org).
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
    return { orgId: org.id, ownerUserId: org.ownerUserId, actorAgent };
  }

  const [org] = await db.select().from(organizations).limit(1);
  if (!org) {
    throw new Error("No organizations exist. Sign in once at the web app to bootstrap your org.");
  }
  return { orgId: org.id, ownerUserId: org.ownerUserId, actorAgent };
}
