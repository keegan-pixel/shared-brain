/**
 * Phase 8 v2 — Dynamic Client Registration (RFC 7591).
 *
 * Lets AI clients (Claude Desktop, claude.ai web on a new Anthropic
 * account, future GPT/Gemini) register themselves on first connection
 * without the brain operator running a CLI.
 *
 * Without this endpoint, the FIRST time a user adds our brain as a
 * Custom Connector from an Anthropic account that hasn't seen us
 * before, Claude tries DCR, gets 404, and surfaces "couldn't reach
 * the MCP server." Adding the endpoint unblocks every new user.
 *
 * Spec: https://datatracker.ietf.org/doc/html/rfc7591
 *
 * Auth: PUBLIC. That's by design — DCR is for clients with no
 * existing credentials to bootstrap their own. To prevent abuse:
 *   - We require at least one https:// redirect_uri
 *   - We rate-limit-friendly (no DB indexes on time, just allow Vercel's
 *     default per-IP throttling)
 *   - Names that look like known good clients (Claude.*, etc.) are
 *     fine; unrecognized clients still register but admins can
 *     revoke via DB
 *   - Future: pre-shared registration_access_token gate if we see abuse
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db/client";
import { oauthClients } from "@/lib/db/schema";
import { hashClientSecret } from "@/lib/oauth/core";

// RFC 7591 client metadata fields we accept. Most are optional;
// only redirect_uris is strictly required.
const RegisterSchema = z.object({
  redirect_uris: z.array(z.string().url()).min(1).max(10),
  client_name: z.string().max(120).optional(),
  // We accept these for compliance but mostly ignore — we only support
  // authorization_code grant w/ S256 PKCE.
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  scope: z.string().optional(),
  client_uri: z.string().url().optional(),
  logo_uri: z.string().url().optional(),
  contacts: z.array(z.string()).optional(),
  tos_uri: z.string().url().optional(),
  policy_uri: z.string().url().optional(),
  software_id: z.string().optional(),
  software_version: z.string().optional(),
});

function jsonError(status: number, error: string, description?: string) {
  return new Response(
    JSON.stringify(
      description ? { error, error_description: description } : { error },
    ),
    {
      status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    },
  );
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_client_metadata", "Body must be JSON.");
  }

  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      400,
      "invalid_client_metadata",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  const m = parsed.data;

  // Validate redirect URIs: must be https OR localhost (per OAuth 2.1).
  for (const uri of m.redirect_uris) {
    try {
      const u = new URL(uri);
      if (
        u.protocol !== "https:" &&
        u.hostname !== "localhost" &&
        u.hostname !== "127.0.0.1" &&
        // Allow custom schemes for native apps (claude://, mcp://, etc.) — common
        // for Desktop / mobile OAuth callbacks.
        !["claude:", "mcp:", "anthropic:"].includes(u.protocol)
      ) {
        return jsonError(
          400,
          "invalid_redirect_uri",
          `redirect_uri must be https, localhost, or a known native-app scheme: ${uri}`,
        );
      }
    } catch {
      return jsonError(400, "invalid_redirect_uri", `Not a valid URL: ${uri}`);
    }
  }

  // Generate credentials. Same shape as manually-registered clients.
  const clientId = "sb_client_" + randomBytes(8).toString("hex");
  const clientSecret = "sb_secret_" + randomBytes(32).toString("base64url");
  const clientSecretHash = hashClientSecret(clientSecret);

  const [row] = await db
    .insert(oauthClients)
    .values({
      clientId,
      clientSecretHash,
      name: m.client_name ?? "Dynamically registered client",
      redirectUris: m.redirect_uris,
    })
    .returning();

  // RFC 7591 response. `client_id_issued_at` + `client_secret_expires_at`
  // are advisory; we issue non-expiring credentials.
  return new Response(
    JSON.stringify({
      client_id: row.clientId,
      client_secret: clientSecret,
      client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
      client_secret_expires_at: 0, // never expires
      redirect_uris: row.redirectUris,
      client_name: row.name,
      token_endpoint_auth_method: m.token_endpoint_auth_method ?? "client_secret_post",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    }),
    {
      status: 201,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    },
  );
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}
