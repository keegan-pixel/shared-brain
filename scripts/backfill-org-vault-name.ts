/**
 * One-off: backfill `vault_name = 'ViaOps'` for Keegan's existing org.
 *
 * Phase 8 v2 prep: the `vault_name` column was added to support
 * per-user Obsidian vault names. Keegan's vault is named "ViaOps"
 * (matches the folder name). New users will set theirs via the
 * onboarding wizard.
 *
 * Idempotent: only updates rows where vault_name IS NULL.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { eq, isNull, and } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { organizations } from "../src/lib/db/schema";

async function main() {
  const updated = await db
    .update(organizations)
    .set({ vaultName: "ViaOps" })
    .where(and(eq(organizations.slug, "viaops"), isNull(organizations.vaultName)))
    .returning({ id: organizations.id, name: organizations.name });
  console.log(`Backfilled ${updated.length} org(s):`);
  for (const o of updated) console.log(`  ${o.id} — ${o.name} → vault_name = "ViaOps"`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
