/**
 * One-off: backfill Keegan's existing ANTHROPIC_API_KEY + OPENAI_API_KEY
 * from env into the org_llm_config table.
 *
 * Phase 8 v2 prep: LLM keys are moving from env vars to per-org config.
 * Existing env-var fallback still works (see lib/llm-keys.ts), but
 * promoting to per-org storage is the new product-correct path. This
 * script does it for Keegan's existing "ViaOps" org so his current
 * setup uses the same code path Richard will use Thursday.
 *
 * Idempotent: skips providers that already have a row.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/backfill-org-llm-keys.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { and, eq } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { organizations, orgLlmConfig, type OrgLlmProvider } from "../src/lib/db/schema";

async function main() {
  const [keeganOrg] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, "viaops"))
    .limit(1);
  if (!keeganOrg) {
    console.error("No org found with slug='viaops'; nothing to backfill.");
    process.exit(1);
  }
  console.log(`Backfilling LLM keys for org "${keeganOrg.name}" (${keeganOrg.id})`);

  const candidates: Array<{
    provider: OrgLlmProvider;
    envName: string;
    useFor: string[];
  }> = [
    { provider: "anthropic", envName: "ANTHROPIC_API_KEY", useFor: ["all"] },
    { provider: "openai", envName: "OPENAI_API_KEY", useFor: ["embeddings"] },
  ];

  let inserted = 0;
  let skipped = 0;
  for (const c of candidates) {
    const value = process.env[c.envName];
    if (!value) {
      console.log(`  – ${c.provider}: no ${c.envName} in env; skipping`);
      continue;
    }
    const [existing] = await db
      .select({ id: orgLlmConfig.id })
      .from(orgLlmConfig)
      .where(
        and(eq(orgLlmConfig.orgId, keeganOrg.id), eq(orgLlmConfig.provider, c.provider)),
      )
      .limit(1);
    if (existing) {
      console.log(`  ↻ ${c.provider}: already has a row; skipping`);
      skipped++;
      continue;
    }
    await db.insert(orgLlmConfig).values({
      orgId: keeganOrg.id,
      provider: c.provider,
      apiKey: value,
      useFor: c.useFor,
    });
    console.log(`  ✓ ${c.provider}: backfilled (${value.slice(0, 6)}...${value.slice(-4)})`);
    inserted++;
  }
  console.log(`\nDone: ${inserted} inserted, ${skipped} skipped.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
