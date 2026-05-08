import { createMcpHandler } from "mcp-handler";
import { resolveOrgContext } from "@/lib/mcp/context";
import { registerTools } from "@/lib/mcp/tools";
import { db } from "@/lib/db/client";
import { mcpRequestLog, type McpRequestStatus } from "@/lib/db/schema";
import { validateAccessToken } from "@/lib/oauth/core";

/**
 * Fire-and-forget log of every MCP request. Privacy: we record only
 * metadata (status, duration, IP, UA, error message) — never request
 * bodies, tool arguments, or response data. Read by /api/status for
 * the public health surface.
 */
async function logMcpRequest(args: {
  req: Request;
  status: McpRequestStatus;
  httpStatus: number;
  durationMs: number;
  errorMessage?: string;
}): Promise<void> {
  try {
    await db.insert(mcpRequestLog).values({
      httpMethod: args.req.method,
      status: args.status,
      httpStatus: args.httpStatus,
      durationMs: args.durationMs,
      clientIp:
        args.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: args.req.headers.get("user-agent") ?? null,
      errorMessage: args.errorMessage ?? null,
    });
  } catch (err) {
    // Never let logging failures break MCP requests.
    console.warn("[mcp] request log insert failed:", (err as Error).message);
  }
}

/**
 * MCP authentication. Accepts either:
 *   1. The static `MCP_API_KEY` (legacy / mcp-remote stdio bridge)
 *   2. An OAuth-issued access token (Phase 8 v1, claude.ai Custom Connectors)
 *
 * The OAuth path looks up the token in `oauth_access_tokens` and
 * confirms it's not expired or revoked. Future phases will use the
 * resolved userId to scope data per-user; v1 still operates on the
 * single-org context.
 */
async function checkAuth(req: Request): Promise<{ ok: true } | { ok: false; res: Response }> {
  const expected = process.env.MCP_API_KEY;
  const authHeader = req.headers.get("authorization") ?? "";
  const presented = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";

  // Build the WWW-Authenticate header that points OAuth-aware clients
  // at our discovery document. Per the MCP auth spec, an unauthenticated
  // request should return enough info for the client to start a flow.
  const origin = (() => {
    const fwdHost = req.headers.get("x-forwarded-host");
    const fwdProto = req.headers.get("x-forwarded-proto");
    if (fwdHost && fwdProto) return `${fwdProto}://${fwdHost}`;
    const u = new URL(req.url);
    return `${u.protocol}//${u.host}`;
  })();
  const wwwAuth = `Bearer realm="shared-brain-mcp", authorization_uri="${origin}/.well-known/oauth-authorization-server"`;

  if (!presented) {
    return {
      ok: false,
      res: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: {
          "content-type": "application/json",
          "www-authenticate": wwwAuth,
        },
      }),
    };
  }

  // Path 1: static API key match.
  if (expected && presented === expected) {
    return { ok: true };
  }

  // Path 2: OAuth-issued access token.
  if (presented.startsWith("sb_at_")) {
    const validated = await validateAccessToken(presented);
    if (validated) return { ok: true };
  }

  return {
    ok: false,
    res: new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": wwwAuth,
      },
    }),
  };
}

// All MCP writes are attributed to this actor in the activity feed for Phase 1.
// Per-client attribution (e.g. Claude Desktop vs. Cowork) comes later.
const DEFAULT_ACTOR = "claude-mcp";

const mcp = createMcpHandler(
  async (server) => {
    const ctx = await resolveOrgContext(DEFAULT_ACTOR);
    registerTools(server, ctx);
  },
  {},
  { basePath: "/api", disableSse: true, verboseLogs: false },
);

async function handler(req: Request) {
  const start = Date.now();
  const auth = await checkAuth(req);
  if (!auth.ok) {
    const duration = Date.now() - start;
    void logMcpRequest({
      req,
      status: auth.res.status === 401 ? "auth_fail" : "error",
      httpStatus: auth.res.status,
      durationMs: duration,
      errorMessage: `auth check failed (${auth.res.status})`,
    });
    return auth.res;
  }
  try {
    const res = await mcp(req);
    void logMcpRequest({
      req,
      status: res.ok ? "ok" : "error",
      httpStatus: res.status,
      durationMs: Date.now() - start,
      errorMessage: res.ok ? undefined : `MCP handler returned ${res.status}`,
    });
    return res;
  } catch (err) {
    const errorMessage = (err as Error).message;
    void logMcpRequest({
      req,
      status: "error",
      httpStatus: 500,
      durationMs: Date.now() - start,
      errorMessage,
    });
    throw err;
  }
}

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
