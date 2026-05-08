/**
 * Shared Brain — Register an OAuth client (Phase 8 v1)
 *
 * Manually-registered clients only in v1 (no Dynamic Client Registration).
 * Run this once per AI platform that should connect to the brain via
 * native OAuth (claude.ai Custom Connectors, future GPT/Gemini, etc.).
 *
 * Generates a client_id + client_secret, hashes the secret with scrypt,
 * stores the row in `oauth_clients`, and prints the credentials ONCE.
 * The secret is NOT recoverable — re-run this script to issue a new
 * client if you lose it.
 *
 * Usage:
 *   npm run create-oauth-client -- \
 *     --name "Claude.ai web" \
 *     --redirect "https://claude.ai/api/mcp/auth_callback"
 *
 * Multiple --redirect flags are supported.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db/client";
import { oauthClients } from "../src/lib/db/schema";
import { hashClientSecret } from "../src/lib/oauth/core";

function parseArgs(argv: string[]): { name: string; redirects: string[] } {
  const out = { name: "", redirects: [] as string[] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name") {
      out.name = argv[++i] ?? "";
    } else if (a === "--redirect" || a === "--redirect-uri") {
      const v = argv[++i];
      if (v) out.redirects.push(v);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.name) {
    console.error("Usage: create-oauth-client --name \"<display name>\" --redirect <uri> [--redirect <uri>...]");
    process.exit(1);
  }
  if (args.redirects.length === 0) {
    console.error("At least one --redirect is required.");
    process.exit(1);
  }

  // Validate redirect URIs.
  for (const r of args.redirects) {
    try {
      const u = new URL(r);
      if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") {
        console.error(`Refusing non-https redirect_uri (except localhost): ${r}`);
        process.exit(1);
      }
    } catch {
      console.error(`Invalid redirect_uri: ${r}`);
      process.exit(1);
    }
  }

  // Generate credentials. The id is short + recognizable; the secret is
  // 48 random bytes. We hash the secret with scrypt before persisting.
  const clientId = "sb_client_" + randomBytes(8).toString("hex");
  const clientSecret = "sb_secret_" + randomBytes(32).toString("base64url");
  const clientSecretHash = hashClientSecret(clientSecret);

  const [row] = await db
    .insert(oauthClients)
    .values({
      clientId,
      clientSecretHash,
      name: args.name,
      redirectUris: args.redirects,
    })
    .returning();

  console.log("");
  console.log("OAuth client registered. SAVE THESE NOW — the secret is not recoverable.");
  console.log("─────────────────────────────────────────────");
  console.log(`  name           ${row.name}`);
  console.log(`  client_id      ${row.clientId}`);
  console.log(`  client_secret  ${clientSecret}`);
  console.log(`  redirect_uris  ${args.redirects.join(", ")}`);
  console.log("─────────────────────────────────────────────");
  console.log("");
  console.log("Discovery URL (paste into the AI platform's connector setup):");
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://shared-brain-ecru.vercel.app";
  console.log(`  ${baseUrl}/.well-known/oauth-authorization-server`);
  console.log("");

  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", (err as Error).message);
  process.exit(1);
});
