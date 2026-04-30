import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema";

let _cached: { orgId: string; ownerUserId: string } | null = null;

/** Resolve the org context for a sync request. Same logic as MCP context. */
export async function resolveSyncOrg() {
  if (_cached) return _cached;

  const targetUserId = process.env.MCP_USER_ID;
  if (targetUserId) {
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.ownerUserId, targetUserId))
      .limit(1);
    if (!org) throw new Error(`No org found for MCP_USER_ID=${targetUserId}`);
    _cached = { orgId: org.id, ownerUserId: org.ownerUserId };
    return _cached;
  }

  const [org] = await db.select().from(organizations).limit(1);
  if (!org) throw new Error("No organizations exist. Sign in once at the web app to bootstrap your org.");
  _cached = { orgId: org.id, ownerUserId: org.ownerUserId };
  return _cached;
}

export const SYNC_ACTOR = "vault-sync";
