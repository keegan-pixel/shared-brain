/**
 * One-off: generate `mcp_api_key` for any org that doesn't have one
 * (idempotent — only fills in nulls). Phase 8 v2 prep — per-org
 * sync keys replace the single shared MCP_API_KEY env var.
 *
 * Backwards-compat: the env var still works as a fallback in
 * requireSyncAuth. This script gives every org its own key so they
 * can switch their daemon over when ready.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { randomBytes } from "node:crypto";
import { eq, isNull } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { organizations } from "../src/lib/db/schema";

function gen(): string {
  return "sb_sync_" + randomBytes(32).toString("base64url");
}

async function main() {
  const rows = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(isNull(organizations.mcpApiKey));
  console.log(`${rows.length} org(s) need a sync key.`);
  for (const r of rows) {
    const key = gen();
    await db
      .update(organizations)
      .set({ mcpApiKey: key })
      .where(eq(organizations.id, r.id));
    console.log(`  ✓ ${r.name} (${r.id}) — key starts ${key.slice(0, 14)}...`);
  }
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
