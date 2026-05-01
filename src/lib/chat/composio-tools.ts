import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import type { ToolSet } from "ai";

/**
 * Toolkits we expose to the in-platform chat from Composio. Order matters
 * for context: Gmail / Calendar / Drive first since they're the most-used,
 * then richer apps. Add new toolkits here as the user connects them.
 *
 * Mirrors the active list in `Knowledge/Frameworks/Shared Brain/Composio Mapping.md`.
 */
const ENABLED_TOOLKITS = [
  "gmail",
  "googlecalendar",
  "googledrive",
  "notion",
  "linkedin",
  "discord",
  "quickbooks",
];

export function isComposioConfigured(): boolean {
  return !!process.env.COMPOSIO_API_KEY;
}

let _composio: Composio<VercelProvider> | null = null;
function getComposio(): Composio<VercelProvider> {
  if (_composio) return _composio;
  if (!process.env.COMPOSIO_API_KEY) {
    throw new Error("COMPOSIO_API_KEY is not set");
  }
  _composio = new Composio({
    apiKey: process.env.COMPOSIO_API_KEY,
    provider: new VercelProvider(),
  });
  return _composio;
}

/**
 * Fetch the Composio tool set for this chat session. Returns an empty object
 * if Composio isn't configured — the chat still works with platform-only
 * tools in that case.
 *
 * `userId` is whatever Composio identifier we registered the user under.
 * For solo Keegan: COMPOSIO_USER_ID env var (defaults to "default" if unset).
 */
export async function getComposioTools(): Promise<ToolSet> {
  if (!isComposioConfigured()) return {} as ToolSet;
  const userId = process.env.COMPOSIO_USER_ID || "default";
  try {
    const composio = getComposio();
    const tools = (await composio.tools.get(userId, {
      toolkits: ENABLED_TOOLKITS,
    })) as unknown as ToolSet;
    return tools;
  } catch (err) {
    console.warn("[chat] Composio tools fetch failed:", (err as Error).message);
    return {} as ToolSet;
  }
}

/**
 * Short summary line used inside the system prompt when Composio is wired up,
 * so Claude knows the external tools are available and which accounts back them.
 */
export function composioPromptHint(): string | null {
  if (!isComposioConfigured()) return null;
  return [
    "## External tools (Composio)",
    "You also have Composio tools for the following toolkits:",
    `${ENABLED_TOOLKITS.map((t) => `\`${t}\``).join(", ")}.`,
    "",
    "Multi-account routing: each toolkit may have multiple connected",
    "accounts. When the user implies a specific account (e.g. \"send",
    "from my SimHouse address\"), pick the matching connection. The full",
    "routing rules live in the wiki page **Composio Mapping**; call",
    "`search` for it if you need precise account IDs.",
  ].join("\n");
}
