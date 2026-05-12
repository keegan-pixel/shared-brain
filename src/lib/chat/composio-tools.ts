import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { dynamicTool, jsonSchema } from "@ai-sdk/provider-utils";
import type { ToolSet } from "ai";
import { resolveOrgComposioKey } from "@/lib/composio-keys";

/**
 * Composio integration via the universal MCP endpoint.
 *
 * **Architecture (final, after two earlier missteps):**
 * Composio has two scopes — a "For You" account where each user's
 * personal connections (Gmail × 6, Calendar × 6, etc.) live, and a
 * developer "Platform" project for orchestrating multi-user OAuth on
 * behalf of others. Our chat needs the "For You" scope. The
 * `@composio/core` SDK is built for the Platform side, which is why
 * the previous SDK pivot couldn't see any connections.
 *
 * The "For You" surface is exposed exclusively over MCP at
 * `https://connect.composio.dev/mcp`, authenticated with a
 * **consumer API key** (`ck_...` from Composio → Settings → Sessions).
 * The MCP client gets the seven meta-tools — `COMPOSIO_SEARCH_TOOLS`,
 * `COMPOSIO_GET_TOOL_SCHEMAS`, `COMPOSIO_MULTI_EXECUTE_TOOL`,
 * `COMPOSIO_MANAGE_CONNECTIONS`, `COMPOSIO_WAIT_FOR_CONNECTIONS`,
 * `COMPOSIO_REMOTE_BASH_TOOL`, `COMPOSIO_REMOTE_WORKBENCH` — same set
 * Claude Desktop / Code see when installed via the Composio CLI. The
 * meta-tools support per-call routing via an `account` parameter, so
 * all 19 connected accounts are reachable.
 *
 * Setup: paste the `ck_...` key from Composio's Sessions page into
 * `COMPOSIO_CONSUMER_API_KEY`. The MCP URL defaults to the universal
 * one and almost never needs to change; override via `COMPOSIO_MCP_URL`
 * only if Composio publishes a new endpoint.
 *
 * Routing reference: `Knowledge/Frameworks/Shared Brain/Composio Mapping.md`
 * has the full account-ID-to-email table; the chat system prompt has a
 * compressed version with the ViaOps defaults.
 */

const DEFAULT_COMPOSIO_MCP_URL = "https://connect.composio.dev/mcp";

/**
 * Per-org check: does this org have a Composio key configured? Env-var
 * fallback returns true if either env name is set (legacy single-user).
 */
export async function isComposioConfigured(orgId?: string): Promise<boolean> {
  if (orgId) {
    const resolved = await resolveOrgComposioKey(orgId);
    return !!resolved;
  }
  return !!(process.env.COMPOSIO_API_KEY || process.env.COMPOSIO_CONSUMER_API_KEY);
}

/**
 * Per-org Composio client cache. Each org gets its own connection
 * because they have different keys + (eventually) different scopes.
 * Cache TTL keeps the MCP handshake cost amortized across chat turns.
 */
type ClientEntry = {
  client: Client;
  transport: StreamableHTTPClientTransport;
  toolsCache: ToolSet | null;
  toolsCacheAt: number;
};
const _clientCache = new Map<string, ClientEntry>();
const TOOLS_CACHE_TTL_MS = 5 * 60 * 1000;

async function getClient(orgId: string): Promise<ClientEntry> {
  const cached = _clientCache.get(orgId);
  if (cached) return cached;
  const resolved = await resolveOrgComposioKey(orgId);
  if (!resolved) throw new Error("Composio not configured for this org");
  const url = resolved.mcpUrl;

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: {
        "x-consumer-api-key": resolved.apiKey,
      },
    },
  });
  // EMPIRICAL: Composio's universal MCP endpoint dumps the entire
  // 200+ tool catalog when called by an arbitrary client. Claude
  // Desktop / Code see only the 7 COMPOSIO_* meta-tools. Strong
  // hypothesis: the gating key is the clientInfo.name during the
  // MCP initialize handshake. We send "Claude" to match.
  const client = new Client(
    { name: "Claude", version: "1.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  const entry: ClientEntry = {
    client,
    transport,
    toolsCache: null,
    toolsCacheAt: 0,
  };
  _clientCache.set(orgId, entry);
  return entry;
}

async function resetClient(orgId: string) {
  const entry = _clientCache.get(orgId);
  if (!entry) return;
  try {
    await entry.client.close();
  } catch {
    /* swallow */
  }
  try {
    await entry.transport.close();
  } catch {
    /* swallow */
  }
  _clientCache.delete(orgId);
}

type McpListedTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

// Whitelist of meta-tools the chat actually uses. Dropping
// REMOTE_BASH_TOOL, REMOTE_WORKBENCH (Python sandbox — not chat use case),
// and WAIT_FOR_CONNECTIONS (OAuth setup flow only) saves ~10K tokens of
// schema overhead per chat turn.
const ENABLED_META_TOOLS = new Set([
  "COMPOSIO_SEARCH_TOOLS",
  "COMPOSIO_GET_TOOL_SCHEMAS",
  "COMPOSIO_MULTI_EXECUTE_TOOL",
  "COMPOSIO_MANAGE_CONNECTIONS",
]);

// Composio's own descriptions for these tools are extremely verbose
// (multi-page usage guides, examples, error patterns) which inflate the
// per-turn token cost. We override with terse versions — the model
// learns the workflow from the system prompt routing primer instead.
const TERSE_DESCRIPTIONS: Record<string, string> = {
  COMPOSIO_SEARCH_TOOLS:
    "Find Composio tool slugs for an external-app task (Gmail, Calendar, Drive, Notion, LinkedIn, Discord, QuickBooks). Call before MULTI_EXECUTE when you don't know the slug. Returns relevant slugs + brief descriptions. Pass `queries` as an array of `{ use_case, known_fields? }`.",
  COMPOSIO_GET_TOOL_SCHEMAS:
    "Fetch the input schema for one or more tool slugs. Use after SEARCH if you need the exact argument shape before MULTI_EXECUTE.",
  COMPOSIO_MULTI_EXECUTE_TOOL:
    "Execute one or more Composio tools (e.g. send email, list calendar events). Each tool item: `{ tool_slug, arguments, account? }`. **Always pass `account`** for multi-account toolkits (gmail, googlecalendar, googledrive) — see the routing rules in the system prompt.",
  COMPOSIO_MANAGE_CONNECTIONS:
    "List, add, rename, or remove connected accounts. Use action='list' with toolkit slug to see all accounts for a service.",
};

// Hard cap on bytes a tool result can re-inject into conversation context.
// Composio's MULTI_EXECUTE results can run 30K+ tokens (full email bodies,
// base64 attachments, etc.); since results replay every turn, that's a
// runaway cost. Anything bigger gets truncated with a marker telling the
// model how to fetch more.
const TOOL_RESULT_CHAR_CAP = 12_000; // ~3K tokens

function truncateToolResult(toolName: string, result: unknown): unknown {
  let serialized: string;
  try {
    serialized = JSON.stringify(result);
  } catch {
    return result;
  }
  if (serialized.length <= TOOL_RESULT_CHAR_CAP) return result;
  // Try to preserve structure: if result is an object with a `data` array,
  // truncate the array rather than chopping mid-string.
  if (
    result &&
    typeof result === "object" &&
    "data" in (result as Record<string, unknown>)
  ) {
    const data = (result as { data: unknown }).data;
    if (Array.isArray(data)) {
      // Estimate how many items fit under the cap.
      const overhead = serialized.length - JSON.stringify(data).length;
      const perItem = data.length > 0 ? JSON.stringify(data[0]).length : 0;
      const fit = perItem > 0 ? Math.max(1, Math.floor((TOOL_RESULT_CHAR_CAP - overhead) / perItem)) : 5;
      const truncated = data.slice(0, fit);
      return {
        ...(result as Record<string, unknown>),
        data: truncated,
        _truncated: {
          tool: toolName,
          original_count: data.length,
          returned_count: truncated.length,
          hint: "Result truncated to fit context budget. Re-call with stricter filters or pagination for more.",
        },
      };
    }
  }
  // Fallback: chop the JSON string and tell the model.
  return {
    _truncated: {
      tool: toolName,
      original_chars: serialized.length,
      returned_chars: TOOL_RESULT_CHAR_CAP,
      hint: "Result truncated. Re-call with stricter filters for more.",
    },
    preview: serialized.slice(0, TOOL_RESULT_CHAR_CAP),
  };
}

function adaptMcpTools(client: Client, tools: McpListedTool[]): ToolSet {
  const out: ToolSet = {};
  for (const t of tools) {
    const schema = (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>;
    const description = TERSE_DESCRIPTIONS[t.name] ?? t.description;
    out[t.name] = dynamicTool({
      description,
      inputSchema: jsonSchema(schema as never),
      execute: async (args) => {
        try {
          const result = await client.callTool({
            name: t.name,
            arguments: (args ?? {}) as Record<string, unknown>,
          });
          return truncateToolResult(t.name, result);
        } catch (err) {
          const message = (err as Error).message;
          console.error(
            `[composio] tool '${t.name}' call failed:`,
            message,
            "\nargs:",
            JSON.stringify(args ?? {}),
          );
          return { error: message, tool: t.name };
        }
      },
    });
  }
  return out;
}

/**
 * Fetch the Composio meta-tools for this chat session. Returns an empty
 * object if Composio isn't configured — the chat still works with
 * platform-only tools in that case.
 */
export async function getComposioTools(orgId: string): Promise<ToolSet> {
  if (!(await isComposioConfigured(orgId))) return {} as ToolSet;
  const now = Date.now();
  const cached = _clientCache.get(orgId);
  if (cached?.toolsCache && now - cached.toolsCacheAt < TOOLS_CACHE_TTL_MS) {
    return cached.toolsCache;
  }
  try {
    const entry = await getClient(orgId);
    const listed = await entry.client.listTools();
    const rawTools = (listed.tools ?? []) as McpListedTool[];

    const metaTools = rawTools.filter((t) => t.name.startsWith("COMPOSIO_"));
    const isMetaSurface = metaTools.length > 0 && metaTools.length === rawTools.length;
    const isCatalogSurface = !isMetaSurface && rawTools.length > 20;
    const enabledTools = metaTools.filter((t) => ENABLED_META_TOOLS.has(t.name));

    console.info(
      `[composio] org=${orgId} tools/list returned ${rawTools.length} tools. ` +
        `meta-tools: ${metaTools.length}. ` +
        `enabled (after whitelist): ${enabledTools.length}. ` +
        `surface: ${isMetaSurface ? "META (good)" : isCatalogSurface ? "CATALOG (bad)" : "MIXED/UNKNOWN"}`,
    );

    const tools = adaptMcpTools(entry.client, enabledTools);
    entry.toolsCache = tools;
    entry.toolsCacheAt = now;
    return tools;
  } catch (err) {
    console.warn(
      `[composio] org=${orgId} MCP tools fetch failed:`,
      (err as Error).message,
    );
    await resetClient(orgId);
    return {} as ToolSet;
  }
}

/**
 * Routing primer for the chat system prompt — tells Claude how to use
 * Composio's meta-tool surface and which connected account to prefer
 * per brand.
 */
/**
 * Generic Composio hint for the chat system prompt. Per-org routing
 * lives in the user's Profile.md (loaded via `get_operating_instructions`);
 * this hint just tells Claude how to discover available connections
 * at runtime via Composio's meta-tools.
 *
 * Phase 8 v2 prep: the hardcoded ViaOps routing table that lived here
 * was Keegan-specific. Now it's runtime-discovered + Profile.md-driven
 * so Jake / Richard / any future user gets correct routing for their
 * own Composio connections.
 *
 * Returns null when Composio is not configured (chat works in
 * platform-only mode in that case).
 */
export async function composioPromptHint(orgId?: string): Promise<string | null> {
  if (!(await isComposioConfigured(orgId))) return null;
  return [
    "## External app tools (Composio)",
    "You have Composio's meta-tool surface: `COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_GET_TOOL_SCHEMAS`,",
    "`COMPOSIO_MULTI_EXECUTE_TOOL`, `COMPOSIO_MANAGE_CONNECTIONS`, plus the workbench / wait /",
    "bash variants. Use them to act on the user's external services (Gmail, Calendar, Drive,",
    "Notion, LinkedIn, Discord, etc.) — whichever they've connected.",
    "",
    "**Workflow for an external-app task:**",
    "1. `COMPOSIO_SEARCH_TOOLS` with the use case (e.g. `'list calendar events for today'`).",
    "2. Optionally `COMPOSIO_GET_TOOL_SCHEMAS` if the search result didn't include the schema.",
    "3. `COMPOSIO_MULTI_EXECUTE_TOOL` with `tool_slug`, `arguments`, and **always pass `account`**",
    "   for multi-account toolkits (gmail, googlecalendar, googledrive).",
    "",
    "**Account routing — runtime discovery:**",
    "Different users have different connected accounts with different IDs. Don't assume specific",
    "connection IDs. Two options to figure out which account to pass:",
    "1. **Check the user's Profile.md** (via `get_operating_instructions`) — if they've recorded",
    "   per-context routing rules (e.g. 'use Gmail X for work'), follow those.",
    "2. **Discover at runtime** — call `COMPOSIO_MANAGE_CONNECTIONS` to list the user's actual",
    "   connections, then pick the right one based on the context. Confirm with the user if",
    "   ambiguous (\"You have 3 Gmail accounts connected — which one for this?\").",
    "",
    "Never invent a connection ID. Always use one you've seen in MANAGE_CONNECTIONS output or",
    "in the user's Profile.md routing rules.",
  ].join("\n");
}
