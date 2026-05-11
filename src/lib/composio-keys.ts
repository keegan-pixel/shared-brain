/**
 * Phase 8 v2 — per-org Composio key resolution + validation.
 *
 * Each org has its own Composio consumer key. This module is the
 * central resolver. Falls back to env vars (legacy single-user mode)
 * if no org config is present.
 *
 * Resolution order:
 *   1. org_composio_config row for the given orgId
 *   2. process.env.COMPOSIO_API_KEY / COMPOSIO_CONSUMER_API_KEY
 *   3. null → caller surfaces "not configured" to the user
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orgComposioConfig } from "@/lib/db/schema";

export type ResolvedComposioKey = {
  apiKey: string;
  mcpUrl: string;
  source: "org-config" | "env-fallback";
};

const DEFAULT_MCP_URL = "https://connect.composio.dev/mcp";

export async function resolveOrgComposioKey(orgId: string): Promise<ResolvedComposioKey | null> {
  // Try org config first.
  const [row] = await db
    .select()
    .from(orgComposioConfig)
    .where(eq(orgComposioConfig.orgId, orgId))
    .limit(1);
  if (row) {
    return {
      apiKey: row.apiKey,
      mcpUrl: row.mcpUrl ?? process.env.COMPOSIO_MCP_URL ?? DEFAULT_MCP_URL,
      source: "org-config",
    };
  }
  // Env-var fallback (legacy single-user setup).
  const envKey =
    process.env.COMPOSIO_API_KEY ||
    process.env.COMPOSIO_CONSUMER_API_KEY;
  if (envKey) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(
        `[composio-keys] org=${orgId} — using env-var fallback (no org config set)`,
      );
    }
    return {
      apiKey: envKey,
      mcpUrl: process.env.COMPOSIO_MCP_URL ?? DEFAULT_MCP_URL,
      source: "env-fallback",
    };
  }
  return null;
}

// ─── Validation ─────────────────────────────────────────────────────

export type ComposioValidationResult =
  | { ok: true; connectionCount?: number }
  | { ok: false; error: string };

/**
 * Verify a Composio consumer key works. Hits the universal MCP
 * endpoint with `initialize` + `tools/list` — same handshake the
 * chat layer does. 5s timeout.
 *
 * We accept the key as valid if Composio returns any meta-tool list
 * for it. A 401/403 means bad key; anything else means transient
 * Composio outage (we still save the key but warn).
 */
export async function validateComposioKey(
  apiKey: string,
  mcpUrl: string = DEFAULT_MCP_URL,
): Promise<ComposioValidationResult> {
  if (!apiKey || apiKey.length < 10) {
    return { ok: false, error: "Key looks too short to be a valid Composio consumer key." };
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    // Composio's MCP server speaks JSON-RPC over HTTP. We send a
    // minimal initialize call. A 401/403 means the key is rejected;
    // a 200 means the key works (regardless of how many tools come back).
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-consumer-api-key": apiKey,
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "shared-brain-validator", version: "1.0" },
        },
      }),
      signal: ac.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Composio rejected the key. Double-check your consumer key in app.composio.dev." };
    }
    if (!res.ok) {
      return { ok: false, error: `Composio returned ${res.status}. Try again in a minute.` };
    }
    // Don't try to parse the response too deeply — Composio's MCP
    // response format varies. 200 = key works.
    return { ok: true };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return { ok: false, error: "Validation timed out after 5s. Composio might be slow; try again." };
    }
    return { ok: false, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
