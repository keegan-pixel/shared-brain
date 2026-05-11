/**
 * Phase F4 v2 — server-side helper for invoking a Composio app tool
 * via the universal MCP endpoint with a specific connected account.
 *
 * The chat-side Composio integration in `src/lib/chat/composio-tools.ts`
 * exposes an MCP-tool surface for the AI SDK. Cron has no chat loop,
 * so we open a new MCP client per call and invoke MULTI_EXECUTE_TOOL
 * directly with `{tool_slug, arguments, account}`.
 *
 * Each call opens + closes its own client. Cron runs daily so per-call
 * connection overhead is negligible (and avoids long-lived connection
 * weirdness on serverless).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const DEFAULT_COMPOSIO_MCP_URL = "https://connect.composio.dev/mcp";

export type ComposioToolResult = {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
};

export async function executeComposioTool(args: {
  toolSlug: string;
  arguments: Record<string, unknown>;
  /** Composio connection ID (e.g. "gmail_berret-drinn") to route to. */
  account?: string;
  /** Org whose Composio key should authenticate this call. Optional;
   * falls back to env var if omitted (legacy single-user path). */
  orgId?: string;
}): Promise<ComposioToolResult> {
  let apiKey: string | undefined;
  let url: string;
  if (args.orgId) {
    const { resolveOrgComposioKey } = await import("@/lib/composio-keys");
    const resolved = await resolveOrgComposioKey(args.orgId);
    if (!resolved) {
      return { success: false, error: "Composio not configured for this org" };
    }
    apiKey = resolved.apiKey;
    url = resolved.mcpUrl;
  } else {
    apiKey = process.env.COMPOSIO_API_KEY || process.env.COMPOSIO_CONSUMER_API_KEY;
    if (!apiKey) {
      return { success: false, error: "COMPOSIO_API_KEY (consumer key) is not set" };
    }
    url = process.env.COMPOSIO_MCP_URL || DEFAULT_COMPOSIO_MCP_URL;
  }

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { "x-consumer-api-key": apiKey } },
  });
  const client = new Client(
    // Use "Claude" as clientInfo.name to gate to the meta-tool surface
    // (same trick as composio-tools.ts; otherwise Composio dumps 200+
    // static slugs and we'd need a different invocation path).
    { name: "Claude", version: "1.0.0" },
    { capabilities: {} },
  );
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: {
        tools: [
          {
            tool_slug: args.toolSlug,
            arguments: args.arguments,
            ...(args.account ? { account: args.account } : {}),
          },
        ],
        sync_response_to_workbench: false,
      },
    });
    // MULTI_EXECUTE returns a structured result wrapping each tool's
    // outcome. Pull out the first (we only sent one).
    const content = (result.content ?? []) as Array<{
      type: string;
      text?: string;
    }>;
    const textPart = content.find((c) => c.type === "text");
    if (!textPart?.text) {
      return { success: false, error: "Composio returned no text content" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(textPart.text);
    } catch {
      return { success: false, error: `Composio returned non-JSON: ${textPart.text.slice(0, 200)}` };
    }
    return { success: true, data: parsed as Record<string, unknown> };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  } finally {
    try {
      await client.close();
    } catch {
      /* swallow */
    }
    try {
      await transport.close();
    } catch {
      /* swallow */
    }
  }
}
