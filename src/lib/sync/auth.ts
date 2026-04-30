import { ApiError } from "@/lib/api";

/**
 * Sync endpoints share the same Bearer token used by the MCP server. They
 * are server-to-server (the local sync agent calling the deployed platform),
 * not user-facing, so they don't go through Clerk.
 */
export function requireSyncAuth(req: Request) {
  const expected = process.env.MCP_API_KEY;
  if (!expected) throw new ApiError("MCP_API_KEY is not configured on the server", 500);
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!presented || presented !== expected) throw new ApiError("Unauthorized", 401);
}
