import { createMcpHandler } from "mcp-handler";
import { resolveOrgContext } from "@/lib/mcp/context";
import { registerTools } from "@/lib/mcp/tools";

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
  const auth = checkAuth(req);
  if (!auth.ok) return auth.res;
  return mcp(req);
}

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
