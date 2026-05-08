/**
 * Phase 8 v1 — OAuth 2.1 Authorization Server Metadata (RFC 8414).
 *
 * Claude.ai's Custom Connectors UI (and any standards-compliant
 * OAuth client) fetches this document to discover the authorize/
 * token endpoints, supported PKCE methods, and supported grant types.
 *
 * Public — no auth required (this is the entry point that tells
 * clients HOW to authenticate).
 */

function originFromRequest(req: Request): string {
  const url = new URL(req.url);
  // Trust forwarded headers when behind Vercel — direct host has the
  // canonical scheme/host, but x-forwarded-host wins on Vercel edge.
  const fwdHost = req.headers.get("x-forwarded-host");
  const fwdProto = req.headers.get("x-forwarded-proto");
  if (fwdHost && fwdProto) return `${fwdProto}://${fwdHost}`;
  return `${url.protocol}//${url.host}`;
}

export async function GET(req: Request) {
  const origin = originFromRequest(req);

  const metadata = {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
    scopes_supported: ["mcp"],
    // We don't support refresh tokens in v1 — re-authorize when the
    // 30-day access token expires.
    // Dynamic Client Registration (RFC 7591) deferred.
  };

  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300, s-maxage=300",
      // CORS: claude.ai fetches this cross-origin during connector setup.
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "*",
    },
  });
}
