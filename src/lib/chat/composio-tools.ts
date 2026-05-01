import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { dynamicTool, jsonSchema } from "@ai-sdk/provider-utils";
import type { ToolSet } from "ai";

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

export function isComposioConfigured(): boolean {
  return !!process.env.COMPOSIO_CONSUMER_API_KEY;
}

let _client: Client | null = null;
let _transport: StreamableHTTPClientTransport | null = null;
let _toolsCache: ToolSet | null = null;
let _toolsCacheAt = 0;
const TOOLS_CACHE_TTL_MS = 5 * 60 * 1000;

async function getClient(): Promise<Client> {
  if (_client) return _client;
  const apiKey = process.env.COMPOSIO_CONSUMER_API_KEY;
  if (!apiKey) throw new Error("COMPOSIO_CONSUMER_API_KEY is not set");
  const url = process.env.COMPOSIO_MCP_URL || DEFAULT_COMPOSIO_MCP_URL;

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: {
        "x-consumer-api-key": apiKey,
      },
    },
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

    // Composio's universal MCP endpoint returns its ENTIRE tool catalog
    // (200+ slugs across every connected app) plus the 7 COMPOSIO_*
    // meta-tools. The static slugs don't support per-call account
    // routing — useless for multi-account — and the schemas total ~30K
    // tokens per chat turn (rate-limit + cost disaster). Filter to just
    // the meta-tools, which is what Claude Desktop / Code use.
    const META_TOOL_PREFIX = "COMPOSIO_";
    const filtered = rawTools.filter((t) => t.name.startsWith(META_TOOL_PREFIX));
    if (filtered.length === 0 && rawTools.length > 0) {
      console.warn(
        `[composio] returned ${rawTools.length} tools but none match the COMPOSIO_* meta-prefix — schema may have changed.`,
      );
    } else {
      console.info(
        `[composio] loaded ${filtered.length} meta-tools (filtered from ${rawTools.length} raw):`,
        filtered.map((t) => t.name).join(", "),
      );
    }
    const tools = adaptMcpTools(client, filtered);
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
 * Routing primer for the chat system prompt — tells Claude how to use
 * Composio's meta-tool surface and which connected account to prefer
 * per brand.
 */
export function composioPromptHint(): string | null {
  if (!isComposioConfigured()) return null;
  return [
    "## External app tools (Composio)",
    "You have Composio's meta-tool surface: `COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_GET_TOOL_SCHEMAS`,",
    "`COMPOSIO_MULTI_EXECUTE_TOOL`, `COMPOSIO_MANAGE_CONNECTIONS`, plus the workbench / wait /",
    "bash variants. Use them to act on the user's Gmail, Google Calendar, Google Drive, Notion,",
    "LinkedIn, Discord, and QuickBooks accounts.",
    "",
    "**Workflow for an external-app task:**",
    "1. `COMPOSIO_SEARCH_TOOLS` with the use case (e.g. `'list calendar events for today'`).",
    "2. Optionally `COMPOSIO_GET_TOOL_SCHEMAS` if the search result didn't include the schema.",
    "3. `COMPOSIO_MULTI_EXECUTE_TOOL` with `tool_slug`, `arguments`, and **always pass `account`**",
    "   for multi-account toolkits (gmail, googlecalendar, googledrive).",
    "",
    "**Account routing** (full table: `Composio Mapping.md`):",
    "- **Default for Gmail / Calendar / Drive when unspecified:** ViaOps (`keegan@viaops.co`).",
    "  - Gmail: `gmail_berret-drinn`",
    "  - Calendar: `googlecalendar_finn-septa`",
    "  - Drive: `googledrive_tilaka-actian`",
    "- \"From SimHouse\" → Gmail `gmail_rubine-smell` / Calendar `googlecalendar_whole-scrim` / Drive `googledrive_thilly-backet`",
    "- \"Chief of Chaos\" / \"XPFlow company\" → Gmail `gmail_sorage-wavira` / Calendar `googlecalendar_bowls-gandum` (also reads Matt's + Patti's calendars) / Drive `googledrive_ahmed-charry`",
    "- \"Coaching\" / \"Lamar Coaching\" → Gmail `gmail_casper-nerium` / Calendar `googlecalendar_suave-saco` / Drive `googledrive_tigger-robe` / QuickBooks `quickbooks_frail-album`",
    "- \"SwingBays\" → Gmail `gmail_shady-beday` / Calendar `googlecalendar_servet-yaya`",
    "- \"Personal\" → Gmail `gmail_theek-rush` / Calendar `googlecalendar_prof-enlife`",
    "- Notion → `notion_erick-immix` (XPFlow workspace)",
    "- LinkedIn → `linkedin_shiny-arigue`",
    "- Discord → `discord_ethine-acarus`",
    "",
    "When the user's request is ambiguous (\"send an email\"), default to ViaOps. When they name a brand (\"check the SimHouse calendar\"), use that brand's account.",
  ].join("\n");
}
