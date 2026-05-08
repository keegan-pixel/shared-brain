/**
 * One-off: revoke the unused "Claude Desktop" OAuth client.
 *
 * It was registered today (2026-05-08) when we briefly thought Desktop
 * needed its own client_id. Turns out claude.ai's Custom Connectors
 * sync into Desktop via account state, so the existing "Claude.ai web"
 * client covers both surfaces. Revoke the unused one for hygiene.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { eq } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { oauthClients, oauthAccessTokens } from "../src/lib/db/schema";

const CLIENT_ID = "sb_client_c802d1202c5e5623"; // "Claude Desktop"

async function main() {
  // Sanity check the row.
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, CLIENT_ID));
  if (!row) {
    console.log(`Client ${CLIENT_ID} not found — nothing to do.`);
    return;
  }
  console.log(`Found client: ${row.name} (${row.clientId}, created ${row.createdAt.toISOString()})`);

  // Revoke any tokens issued to this client (probably zero, since we
  // never completed an OAuth flow with it).
  const tokens = await db.select().from(oauthAccessTokens).where(eq(oauthAccessTokens.clientId, CLIENT_ID));
  console.log(`Tokens issued: ${tokens.length}`);
  if (tokens.length > 0) {
    await db
      .update(oauthAccessTokens)
      .set({ revokedAt: new Date() })
      .where(eq(oauthAccessTokens.clientId, CLIENT_ID));
    console.log(`  ✓ revoked ${tokens.length} tokens`);
  }

  // Delete the client row.
  const del = await db.delete(oauthClients).where(eq(oauthClients.clientId, CLIENT_ID));
  console.log(`✓ deleted client (${(del as any).rowCount ?? "?"} rows)`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
