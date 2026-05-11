import { eq } from "drizzle-orm";
import { ApiError } from "@/lib/api";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema";

/**
 * Phase 8 v2 prep — sync auth now resolves an ORG from the Bearer key.
 *
 * Each org has its own `organizations.mcp_api_key`. The daemon presents
 * this key on every /api/sync/* request. We look it up and attach the
 * resolved org to subsequent context resolution.
 *
 * Legacy fallback: if the presented key matches `process.env.MCP_API_KEY`,
 * we resolve to the FIRST org (Keegan's existing setup). Lets his current
 * daemon keep working until he switches it to his org's per-key.
 *
 * Returns the resolved orgId on success; throws ApiError on failure.
 */
export async function requireSyncAuth(req: Request): Promise<{ orgId: string }> {
  const authHeader = req.headers.get("authorization") ?? "";
  const presented = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!presented) throw new ApiError("Unauthorized", 401);

  // Path 1: per-org key match (the new product-correct path).
  const [byOrgKey] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.mcpApiKey, presented))
    .limit(1);
  if (byOrgKey) {
    return { orgId: byOrgKey.id };
  }

  // Path 2: legacy env-var key match (Keegan's pre-v2 setup).
  const legacy = process.env.MCP_API_KEY;
  if (legacy && presented === legacy) {
    const [first] = await db.select({ id: organizations.id }).from(organizations).limit(1);
    if (!first) throw new ApiError("No org found for legacy MCP_API_KEY", 500);
    return { orgId: first.id };
  }

  throw new ApiError("Unauthorized", 401);
}
