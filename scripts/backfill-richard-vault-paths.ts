/**
 * One-off backfill: populate organizations.vault_paths for Richard
 * Lackey's org. Richard's daemon was installed 2026-05-14, BEFORE
 * MF-14 added vault_paths persistence (shipped that night). His
 * plist on disk has the paths, but his DB row's vault_paths is [].
 *
 * Running this before the 2026-05-15 follow-up meeting so /settings/daemon
 * shows his three folders pre-filled instead of forcing Keegan to
 * re-type them.
 *
 * Run: `DATABASE_URL=... npx tsx scripts/backfill-richard-vault-paths.ts`
 *
 * Once `feat(daemon): auto-report-config endpoint` ships (MF-17),
 * this script becomes redundant — daemons will self-report their
 * config on startup.
 */

import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { organizations } from "../src/lib/db/schema";

// Richard's three vault paths from his 2026-05-14 install command.
// Hardcoded because this is a targeted one-off backfill, not a general tool.
const RICHARD_SLUG = "richard-lackey-brain";
const RICHARD_PATHS = [
  "/Users/GFEGROUP1/Library/CloudStorage/GoogleDrive-worldfoodbankgroup@gmail.com",
  "/Users/GFEGROUP1/Dropbox",
  "/Users/GFEGROUP1/Library/Mobile Documents/com~apple~CloudDocs",
];

async function main() {
  console.log(`Backfilling vault_paths for slug='${RICHARD_SLUG}'...`);
  console.log(`  Paths to set:`);
  for (const p of RICHARD_PATHS) console.log(`    - ${p}`);

  const [before] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, RICHARD_SLUG))
    .limit(1);

  if (!before) {
    console.error(`✗ No org found with slug='${RICHARD_SLUG}'. Aborting.`);
    process.exit(1);
  }

  console.log(`\nBefore:`);
  console.log(`  org.id:           ${before.id}`);
  console.log(`  org.name:         ${before.name}`);
  console.log(`  org.vault_paths:  ${JSON.stringify(before.vaultPaths)}`);

  if (before.vaultPaths.length > 0) {
    console.log(`\n⚠ vault_paths is already set. Aborting to avoid clobbering.`);
    console.log(`  If you actually want to overwrite, delete that row's vault_paths first or run a different script.`);
    process.exit(0);
  }

  const [after] = await db
    .update(organizations)
    .set({ vaultPaths: RICHARD_PATHS })
    .where(eq(organizations.slug, RICHARD_SLUG))
    .returning();

  console.log(`\nAfter:`);
  console.log(`  org.vault_paths:  ${JSON.stringify(after.vaultPaths)}`);
  console.log(`\n✓ Backfill complete.`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
