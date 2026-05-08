import { createMcpHandler } from "mcp-handler";
import { resolveOrgContext } from "@/lib/mcp/context";
import { registerTools } from "@/lib/mcp/tools";
import { db } from "@/lib/db/client";
import { mcpRequestLog, type McpRequestStatus } from "@/lib/db/schema";

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

function checkAuth(req: Request): { ok: true } | { ok: false; res: Response } {
  const expected = process.env.MCP_API_KEY;
  if (!expected) {
    return {
      ok: false,
      res: new Response(JSON.stringify({ error: "MCP_API_KEY is not configured on the server" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    };
  }
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!presented || presented !== expected) {
    return {
      ok: false,
      res: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: {
          "content-type": "application/json",
          "www-authenticate": 'Bearer realm="shared-brain-mcp"',
        },
      }),
    };
  }
  return { ok: true };
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
  const auth = checkAuth(req);
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
