import { createAnthropic } from "@ai-sdk/anthropic";
import { resolveOrgLlmKey } from "@/lib/llm-keys";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { z } from "zod";
import { ApiError, jsonError } from "@/lib/api";
import { ensureUserOrg } from "@/lib/org";
import { buildChatTools } from "@/lib/chat/tools";
import { composioPromptHint, getComposioTools } from "@/lib/chat/composio-tools";

const MODEL_ID = process.env.ANTHROPIC_MODEL_ID || "claude-sonnet-4-5";

const ContextSchema = z
  .object({
    /** What page is the user on right now? Helps Claude answer "what am I looking at?" */
    page: z
      .object({
        path: z.string().optional(),
        kind: z.enum(["home", "wiki", "wiki-detail", "space", "project", "activity", "other"]).optional(),
        id: z.string().optional(),
        title: z.string().optional(),
      })
      .optional(),
  })
  .optional();

type IncomingBody = {
  messages: UIMessage[];
  context?: z.infer<typeof ContextSchema>;
};

function buildSystemPrompt(args: {
  orgName: string;
  context?: z.infer<typeof ContextSchema>;
}): string {
  const { orgName, context } = args;
  const lines = [
    `You are Claude, an AI assistant inside the **Shared Brain** platform — Keegan's AI-native PM system mirroring his Obsidian vault.`,
    ``,
    `**Org:** ${orgName}`,
    `**Today:** ${new Date().toISOString().slice(0, 10)}`,
    ``,
    `## Operating Instructions`,
    `Before any non-trivial task (anything beyond a one-line factual answer), call \`get_operating_instructions\` to load Keegan's profile, standing rules, vault conventions, and Composio account routing. The result tells you who Keegan is, the three businesses, where things live, and how to behave. Treat what it returns as authoritative context.`,
    ``,
    `Before ending a session with significant work, call \`record_session_summary\` with a 2-3 sentence summary, the project/space, and related items as \`[[Page Title]]\` references. This is non-optional — it's how the brain stays synced as multi-user scales.`,
    ``,
    `## Capabilities`,
    `You can call platform tools to read and write the user's workspace:`,
    `- **Reads:** \`get_org\`, \`get_spaces\`, \`get_projects\`, \`get_items\`, \`search\` (semantic across wiki pages, including extracted text from PDFs/DOCX/XLSX), \`get_recent_activity\`, \`get_operating_instructions\`, \`get_active_state\` (every project with open items + their backlinked entities — current world state, auto-fresh).`,
    `- **Writes:** \`create_item\` (creates tasks/notes/files/decisions), \`move_item_status\` (moves kanban cards), \`record_session_summary\` (logs what this session accomplished).`,
    ``,
    `Prefer calling tools to get fresh data over assuming. When the user asks "what's in X" or "show me Y", call the appropriate get tool. When they ask you to do something concrete (move a card, add a task), call the write tool — don't just describe what you'd do.`,
    ``,
    `## Style`,
    `- Direct, friendly, terse. No preamble, no apologies, no "I'd be happy to". Just the answer.`,
    `- Default to short responses. Skip recapping the question. Bullets > paragraphs. Markdown for lists/tables/code.`,
    `- Cite wiki pages as \`[[Page Title]]\` — platform renders as real links.`,
    `- For destructive operations (item deletion, mass writes), confirm before executing.`,
    ``,
    `## Token discipline`,
    `- When fetching external data (Gmail / Calendar / Drive via Composio), request only what you need: small max_results, narrow time windows, no full-body fetches when a list is enough.`,
    `- Don't dump tool results back to the user verbatim — summarize or pull just the relevant fields.`,
  ];

  if (context?.page) {
    lines.push("", "## Current page context");
    if (context.page.title) lines.push(`- **Title:** ${context.page.title}`);
    if (context.page.kind) lines.push(`- **Kind:** ${context.page.kind}`);
    if (context.page.path) lines.push(`- **URL:** ${context.page.path}`);
    if (context.page.id) lines.push(`- **Entity id:** ${context.page.id}`);
    lines.push("", "When the user says \"this page\" or \"this thing\", they mean the entity above.");
  }

  return lines.join("\n");
}

export async function POST(req: Request) {
  let body: IncomingBody;
  try {
    body = (await req.json()) as IncomingBody;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  if (!body || !Array.isArray(body.messages)) {
    return jsonError("Body must include `messages` array", 400);
  }

  let orgId: string;
  let orgName: string;
  try {
    const org = await ensureUserOrg();
    orgId = org.id;
    orgName = org.name;
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHENTICATED") {
      return jsonError("Unauthenticated", 401);
    }
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    throw err;
  }

  // Platform tools (always available) + Composio tools (if configured).
  // Composio fetch is gated on COMPOSIO_API_KEY; resolves to {} otherwise so
  // the chat still works in a platform-only mode for setups without Composio.
  const platformTools = buildChatTools({ orgId, actorAgent: "claude-builtin" });
  const composioTools = await getComposioTools();
  const tools = { ...platformTools, ...composioTools };

  const composioHint = composioPromptHint();
  const system =
    buildSystemPrompt({ orgName, context: body.context }) +
    (composioHint ? `\n\n${composioHint}` : "");

  // Resolve org's Anthropic key (falls back to env for legacy).
  const resolved = await resolveOrgLlmKey({
    orgId,
    useCase: "chat",
    provider: "anthropic",
  });
  if (!resolved) {
    return jsonError(
      "No Anthropic API key configured. Add one in Settings → LLM API keys, " +
        "or set ANTHROPIC_API_KEY as a fallback env var.",
      400,
    );
  }
  const anthropicClient = createAnthropic({ apiKey: resolved.apiKey });

  const result = streamText({
    model: anthropicClient(MODEL_ID),
    system,
    messages: await convertToModelMessages(body.messages),
    tools,
    // Allow the model to call tools, see results, then respond — multi-step.
    stopWhen: stepCountIs(12),
    // Cost optimization: mark system prompt + tool definitions as cacheable.
    // Anthropic caches them for ~5 min; cache reads are 0.1× normal input
    // cost. For repeat chat turns (most chat use), this is a ~10× saving on
    // the static portion of every request.
    providerOptions: {
      anthropic: {
        cacheControl: { type: "ephemeral", ttl: "5m" },
      },
    },
  });

  return result.toUIMessageStreamResponse();
}
