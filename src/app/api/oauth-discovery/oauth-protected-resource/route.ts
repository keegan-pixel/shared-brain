/**
 * Phase 8 v1 — OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * Some MCP clients (and the MCP authorization spec) fetch
 * `/.well-known/oauth-protected-resource` first to learn which
 * Authorization Server protects the resource — then they fetch
 * THAT server's metadata. We only have one AS (ourselves), so this
 * just points back at our authorization-server discovery doc.
 *
 * Public — no auth required.
 */

function originFromRequest(req: Request): string {
  const fwdHost = req.headers.get("x-forwarded-host");
  const fwdProto = req.headers.get("x-forwarded-proto");
  if (fwdHost && fwdProto) return `${fwdProto}://${fwdHost}`;
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

export async function GET(req: Request) {
  const origin = originFromRequest(req);

  const metadata = {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: ["mcp"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/status`,
  };

  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300, s-maxage=300",
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
