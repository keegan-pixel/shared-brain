import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { dynamicTool, jsonSchema } from "@ai-sdk/provider-utils";
import type { ToolSet } from "ai";

/**
 * Composio MCP integration.
 *
 * Composio exposes a single MCP URL per user that bundles all connected
 * toolkits + accounts. We connect to that URL via streamable HTTP, list
 * the tools, and adapt them into AI SDK `dynamicTool`s so `streamText`
 * can call them.
 *
 * Setup: paste the MCP URL Composio gives you into `COMPOSIO_MCP_URL`,
 * and the API key shown next to it into `COMPOSIO_API_KEY`. Both go in
 * `.env.local` for dev and Vercel env vars for prod. No user IDs needed —
 * the URL is scoped to your Composio user and the API key authenticates
 * the MCP handshake.
 *
 * The companion routing doc is `Knowledge/Frameworks/Shared Brain/Composio Mapping.md`,
 * which lists the active toolkits and tells Claude which connected
 * account to prefer for each request.
 */

export function isComposioConfigured(): boolean {
  return !!process.env.COMPOSIO_MCP_URL;
}

/**
 * Per-process cache: connecting to MCP and listing tools costs a network
 * round trip. The chat route calls `getComposioTools` on every request,
 * so we keep the connection warm for the lifetime of the serverless
 * worker. If the connection drops we lazily reconnect on next call.
 */
let _client: Client | null = null;
let _transport: StreamableHTTPClientTransport | null = null;
let _toolsCache: ToolSet | null = null;
let _toolsCacheAt = 0;
const TOOLS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getClient(): Promise<Client> {
  if (_client) return _client;
  const url = process.env.COMPOSIO_MCP_URL;
  if (!url) throw new Error("COMPOSIO_MCP_URL is not set");
  const apiKey = process.env.COMPOSIO_API_KEY;

  // Composio's MCP endpoint expects the API key as a bearer token. We
  // also set `x-api-key` for compatibility with whichever header
  // convention Composio's gateway is currently using.
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
    headers["x-api-key"] = apiKey;
  }

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers },
  });
  const client = new Client(
    { name: "shared-brain-chat", version: "1.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  _client = client;
  _transport = transport;
  return client;
}

async function resetClient() {
  try {
    await _client?.close();
  } catch {
    /* swallow */
  }
  try {
    await _transport?.close();
  } catch {
    /* swallow */
  }
  _client = null;
  _transport = null;
  _toolsCache = null;
}

type McpListedTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

function adaptMcpTools(client: Client, tools: McpListedTool[]): ToolSet {
  const out: ToolSet = {};
  for (const t of tools) {
    const schema = (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>;
    out[t.name] = dynamicTool({
      description: t.description,
      inputSchema: jsonSchema(schema as never),
      execute: async (args) => {
        try {
          const result = await client.callTool({
            name: t.name,
            arguments: (args ?? {}) as Record<string, unknown>,
          });
          return result;
        } catch (err) {
          // Surface to model + logs so we can debug auth / schema / routing
          // issues without the chat going opaque.
          const message = (err as Error).message;
          const stack = (err as Error).stack;
          console.error(
            `[composio] tool '${t.name}' call failed:`,
            message,
            "\nargs:",
            JSON.stringify(args ?? {}),
            "\nstack:",
            stack,
          );
          return { error: message, tool: t.name };
        }
      },
    });
  }
  return out;
}

/**
 * Fetch the Composio tool set for this chat session. Returns an empty object
 * if Composio isn't configured — the chat still works with platform-only
 * tools in that case.
 */
export async function getComposioTools(): Promise<ToolSet> {
  if (!isComposioConfigured()) return {} as ToolSet;
  const now = Date.now();
  if (_toolsCache && now - _toolsCacheAt < TOOLS_CACHE_TTL_MS) {
    return _toolsCache;
  }
  try {
    const client = await getClient();
    const listed = await client.listTools();
    const rawTools = (listed.tools ?? []) as McpListedTool[];
    const tools = adaptMcpTools(client, rawTools);
    console.info(
      `[composio] loaded ${rawTools.length} MCP tools:`,
      rawTools
        .slice(0, 10)
        .map((t) => t.name)
        .join(", "),
      rawTools.length > 10 ? `… +${rawTools.length - 10} more` : "",
    );
    _toolsCache = tools;
    _toolsCacheAt = now;
    return tools;
  } catch (err) {
    console.warn(
      "[composio] MCP tools fetch failed:",
      (err as Error).message,
      "\nstack:",
      (err as Error).stack,
    );
    await resetClient();
    return {} as ToolSet;
  }
}

/**
 * Short summary line used inside the system prompt when Composio is wired up,
 * so Claude knows the external tools are available and how to route between
 * the multiple connected accounts behind each toolkit.
 */
export function composioPromptHint(): string | null {
  if (!isComposioConfigured()) return null;
  return [
    "## External tools (Composio MCP)",
    "You have access to the user's connected Composio toolkits via MCP:",
    "Gmail, Google Calendar, Google Drive, Notion, LinkedIn, Discord, QuickBooks.",
    "",
    "Multi-account routing: each toolkit may have multiple connected",
    "accounts (e.g. 6 Gmail addresses). When the user implies a specific",
    "account (\"send from my SimHouse address\", \"check the ChiefofChaos calendar\"),",
    "pick the matching connection. When unspecified, default to the",
    "ViaOps account (`keegan@viaops.co`) for any Google service.",
    "",
    "The full routing rules live in the wiki page **Composio Mapping** —",
    "call `search` for it if you need precise account IDs or context for",
    "a specific brand.",
  ].join("\n");
}
