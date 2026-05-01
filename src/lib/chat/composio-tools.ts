import { Composio } from "@composio/core";
import { tool } from "@ai-sdk/provider-utils";
import { z } from "zod";
import type { ToolSet } from "ai";

/**
 * Composio integration via the @composio/core SDK.
 *
 * Architecture: instead of pre-baking 200+ Composio tool slugs into the
 * chat tool list, we expose four *meta-tools* that mirror what the
 * Composio CLI install gives Claude Code / Desktop. The chat finds tools
 * on-demand and routes to the right connected account per call.
 *
 * Why not the static MCP URL surface? It defaults to whichever
 * connection Composio has flagged `is_default` for each toolkit and
 * doesn't accept a per-call `connectedAccountId`. With 6 Gmail accounts /
 * 6 calendars / 4 drives, that's a non-starter for routing.
 *
 * Setup: paste your Composio user-API-key (visible in the dashboard or
 * in `~/.composio/config.json` after `composio login`) into
 * `COMPOSIO_API_KEY`. Used for every Composio call. No MCP URL needed.
 *
 * Routing reference: `Knowledge/Frameworks/Shared Brain/Composio Mapping.md`
 * lists every connection ID with the underlying email/workspace, and the
 * preferred default per toolkit. The chat system prompt points Claude at
 * that doc when it needs to pick an `account`.
 */

const COMPOSIO_USER_ID = "default"; // single-user tenancy for solo Keegan
const SHARED_BRAIN_ACCOUNT_DEFAULTS: Record<string, string> = {
  gmail: "gmail_berret-drinn", // keegan@viaops.co
  googlecalendar: "googlecalendar_finn-septa", // keegan@viaops.co
  googledrive: "googledrive_tilaka-actian", // keegan@viaops.co
};
const ALL_TOOLKITS = [
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

let _composio: Composio | null = null;
function getComposio(): Composio {
  if (_composio) return _composio;
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) throw new Error("COMPOSIO_API_KEY is not set");
  // We don't pass a provider — we wrap the raw SDK ourselves into AI SDK
  // tools, so the default provider is fine.
  _composio = new Composio({ apiKey });
  return _composio;
}

/**
 * The four platform tools we expose to the in-platform Claude. Each one
 * wraps a Composio SDK call, with errors surfaced inline.
 */
export async function getComposioTools(): Promise<ToolSet> {
  if (!isComposioConfigured()) return {} as ToolSet;

  const tools: ToolSet = {
    composio_search_tools: tool({
      description: [
        "Find Composio tool slugs for an external-app task (Gmail, Google Calendar,",
        "Google Drive, Notion, LinkedIn, Discord, QuickBooks). Use BEFORE",
        "composio_execute when you don't know the exact slug. Returns up to N",
        "tools matching the use case. Filter by toolkit if you already know which",
        "app you need.",
      ].join(" "),
      inputSchema: z.object({
        use_case: z
          .string()
          .describe(
            "Plain-English description of what you want to do. Example: 'send an email', 'list calendar events for today'.",
          ),
        toolkit: z
          .string()
          .optional()
          .describe(
            "Optional toolkit slug to filter results. One of: gmail, googlecalendar, googledrive, notion, linkedin, discord, quickbooks.",
          ),
        limit: z.number().int().min(1).max(20).optional().default(8),
      }),
      execute: async ({ use_case, toolkit, limit }) => {
        try {
          const composio = getComposio();
          const list = await composio.tools.getRawComposioTools({
            toolkits: toolkit ? [toolkit] : ALL_TOOLKITS,
            search: use_case,
            limit: limit ?? 8,
          });
          return {
            tools: list.map((t) => ({
              slug: t.slug,
              toolkit: t.toolkit?.slug,
              name: t.name,
              description: t.description,
            })),
          };
        } catch (err) {
          console.error("[composio] search_tools failed:", err);
          return { error: (err as Error).message };
        }
      },
    }),

    composio_get_tool_schema: tool({
      description:
        "Fetch the input schema for one or more Composio tool slugs. Call AFTER composio_search_tools and BEFORE composio_execute when you need to know exactly what arguments a tool accepts.",
      inputSchema: z.object({
        tool_slugs: z
          .array(z.string())
          .min(1)
          .max(10)
          .describe("Composio tool slugs, e.g. ['GMAIL_SEND_EMAIL', 'GOOGLECALENDAR_EVENTS_LIST']."),
      }),
      execute: async ({ tool_slugs }) => {
        try {
          const composio = getComposio();
          const results = await Promise.all(
            tool_slugs.map(async (slug) => {
              try {
                const t = await composio.tools.getRawComposioToolBySlug(slug);
                return {
                  slug: t.slug,
                  toolkit: t.toolkit?.slug,
                  description: t.description,
                  inputParameters: t.inputParameters,
                };
              } catch (err) {
                return { slug, error: (err as Error).message };
              }
            }),
          );
          return { schemas: results };
        } catch (err) {
          console.error("[composio] get_tool_schema failed:", err);
          return { error: (err as Error).message };
        }
      },
    }),

    composio_execute: tool({
      description: [
        "Execute a Composio tool — sends emails, creates calendar events, etc.",
        "ALWAYS pass `account` to specify which connected account to use; the",
        "default may not be what you want (see Composio Mapping wiki page for",
        "the routing table). For multi-account toolkits (gmail, googlecalendar,",
        "googledrive), the default if unspecified is the ViaOps account.",
      ].join(" "),
      inputSchema: z.object({
        tool_slug: z
          .string()
          .describe("Composio tool slug, e.g. 'GMAIL_SEND_EMAIL'. Get from composio_search_tools."),
        arguments: z
          .record(z.string(), z.unknown())
          .describe("Arguments for the tool, matching its input schema."),
        account: z
          .string()
          .optional()
          .describe(
            "Connection account ID (e.g. 'gmail_rubine-smell' for SimHouse) or alias. If omitted, falls back to ViaOps for Gmail/Calendar/Drive, or the toolkit's `is_default` for others.",
          ),
      }),
      execute: async ({ tool_slug, arguments: args, account }) => {
        try {
          const composio = getComposio();
          // Infer the toolkit prefix from the slug (e.g. 'GMAIL_SEND_EMAIL' -> 'gmail')
          // to apply the ViaOps-default routing if the model didn't pass one.
          const toolkit = tool_slug.split("_")[0]?.toLowerCase();
          const connectedAccountId =
            account ??
            (toolkit ? SHARED_BRAIN_ACCOUNT_DEFAULTS[toolkit] : undefined);
          const result = await composio.tools.execute(tool_slug, {
            userId: COMPOSIO_USER_ID,
            arguments: args ?? {},
            ...(connectedAccountId ? { connectedAccountId } : {}),
          });
          return result;
        } catch (err) {
          console.error("[composio] execute failed:", tool_slug, err);
          return { error: (err as Error).message, tool_slug };
        }
      },
    }),

    composio_list_connections: tool({
      description:
        "List your connected accounts for one or all toolkits. Returns account IDs + the underlying email/workspace so you can pick the right `account` for composio_execute.",
      inputSchema: z.object({
        toolkit: z
          .string()
          .optional()
          .describe(
            "Optional toolkit slug to filter (gmail, googlecalendar, etc.). Omit to list across all toolkits.",
          ),
      }),
      execute: async ({ toolkit }) => {
        try {
          const composio = getComposio();
          const list = await composio.connectedAccounts.list({
            ...(toolkit ? { toolkitSlugs: [toolkit] } : {}),
          });
          return {
            connections: list.items.map((c) => ({
              id: c.id,
              toolkit: c.toolkit?.slug,
              status: c.status,
            })),
          };
        } catch (err) {
          console.error("[composio] list_connections failed:", err);
          return { error: (err as Error).message };
        }
      },
    }),
  };

  return tools;
}

/**
 * System-prompt addendum: tells the chat how to use the meta-tools and
 * which connection to prefer per brand. The Composio Mapping doc has the
 * full routing table; this is the in-context primer.
 */
export function composioPromptHint(): string | null {
  if (!isComposioConfigured()) return null;
  return [
    "## External app tools (Composio)",
    "You can act on the user's Gmail, Google Calendar, Google Drive, Notion, LinkedIn, Discord, and QuickBooks via four meta-tools:",
    "- `composio_search_tools` — find a tool slug for a use case",
    "- `composio_get_tool_schema` — inspect a tool's required arguments",
    "- `composio_execute` — run the tool (always specify `account` for multi-account toolkits)",
    "- `composio_list_connections` — see all connected accounts and their emails",
    "",
    "**Workflow:** for an external-app task, call `composio_search_tools` first (unless you already know the slug), then `composio_execute` with the right slug + arguments + `account`.",
    "",
    "**Account routing** (full table in wiki: search 'Composio Mapping'):",
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
