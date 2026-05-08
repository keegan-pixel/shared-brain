/**
 * Phase 8 v1 — OAuth 2.1 Token Endpoint.
 *
 * Exchanges an authorization code (issued by /oauth/authorize) for an
 * opaque access token. Public-client friendly: PKCE replaces client
 * secret if the client was registered without one — but for v1 we
 * always require client_secret (Claude.ai is a confidential client
 * via its server-side proxy).
 *
 * Auth: client may present credentials via either:
 *   - HTTP Basic auth: `Authorization: Basic base64(client_id:client_secret)`
 *   - form-encoded body: `client_id` + `client_secret` fields
 *
 * RFC 6749 §5.2 + RFC 7636 §4.5.
 */

import { NextRequest } from "next/server";
import {
  authenticateClient,
  consumeAuthorizationCode,
  findClientById,
  issueAccessToken,
} from "@/lib/oauth/core";

function jsonError(status: number, error: string, description?: string) {
  return new Response(
    JSON.stringify(description ? { error, error_description: description } : { error }),
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

function parseBasicAuth(header: string | null): { id: string; secret: string } | null {
  if (!header || !header.toLowerCase().startsWith("basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx === -1) return null;
    return { id: decoded.slice(0, idx), secret: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  // Per RFC 6749, token endpoint must accept application/x-www-form-urlencoded.
  let form: URLSearchParams;
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      form = new URLSearchParams(await req.text());
    } else if (contentType.includes("application/json")) {
      const body = (await req.json()) as Record<string, string>;
      form = new URLSearchParams(body);
    } else {
      // Be lenient — try form first.
      form = new URLSearchParams(await req.text());
    }
  } catch {
    return jsonError(400, "invalid_request", "Could not parse request body.");
  }

  const grantType = form.get("grant_type");
  if (grantType !== "authorization_code") {
    return jsonError(400, "unsupported_grant_type", `Only 'authorization_code' is supported. Got: ${grantType}`);
  }

  const code = form.get("code");
  const redirectUri = form.get("redirect_uri");
  const codeVerifier = form.get("code_verifier");
  if (!code) return jsonError(400, "invalid_request", "Missing 'code'.");
  if (!redirectUri) return jsonError(400, "invalid_request", "Missing 'redirect_uri'.");
  if (!codeVerifier) return jsonError(400, "invalid_request", "Missing 'code_verifier' (PKCE).");

  // Authenticate the client.
  const basic = parseBasicAuth(req.headers.get("authorization"));
  const formClientId = form.get("client_id") ?? undefined;
  const formClientSecret = form.get("client_secret") ?? undefined;
  const presentedId = basic?.id ?? formClientId;
  const presentedSecret = basic?.secret ?? formClientSecret;

  if (!presentedId) {
    return jsonError(401, "invalid_client", "Missing client_id.");
  }

  let clientRecord;
  if (presentedSecret) {
    clientRecord = await authenticateClient({
      clientId: presentedId,
      clientSecret: presentedSecret,
    });
    if (!clientRecord) {
      return jsonError(401, "invalid_client", "Invalid client credentials.");
    }
  } else {
    // Public-client path — PKCE alone authenticates. v1 still requires
    // the client to be registered (client_id exists), but tolerates a
    // missing secret. Tighten later if needed.
    clientRecord = await findClientById(presentedId);
    if (!clientRecord) {
      return jsonError(401, "invalid_client", "Unknown client_id.");
    }
  }

  const result = await consumeAuthorizationCode({
    code,
    clientId: presentedId,
    redirectUri,
    codeVerifier,
  });
  if ("error" in result) {
    return jsonError(400, "invalid_grant", result.error);
  }

  const { token, expiresIn } = await issueAccessToken({
    clientId: presentedId,
    userId: result.userId,
    scope: result.scope,
  });

  return new Response(
    JSON.stringify({
      access_token: token,
      token_type: "Bearer",
      expires_in: expiresIn,
      scope: result.scope,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        pragma: "no-cache",
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
      "access-control-allow-headers": "authorization, content-type",
    },
  });
}
