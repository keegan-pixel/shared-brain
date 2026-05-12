/**
 * Phase 8 v2 — per-request MCP context via AsyncLocalStorage.
 *
 * The MCP handler's setup callback runs per-request (verified against
 * mcp-handler's source). To scope tool calls to the authenticated
 * user's org, we stash userId in an AsyncLocalStorage at the start of
 * the request and read it from resolveOrgContext().
 *
 * Legacy path (static MCP_API_KEY): no userId is set; resolveOrgContext
 * falls back to env var / first org for backwards-compat with Keegan's
 * existing daemon.
 */

import { AsyncLocalStorage } from "node:async_hooks";

type RequestContext = {
  /** Clerk user id from the OAuth access token, or null for legacy auth. */
  userId: string | null;
};

const store = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
  ctx: RequestContext,
  fn: () => Promise<T>,
): Promise<T> {
  return store.run(ctx, fn);
}

export function getRequestUserId(): string | null {
  return store.getStore()?.userId ?? null;
}
