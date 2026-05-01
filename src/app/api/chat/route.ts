import { anthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { z } from "zod";
import { ApiError, jsonError } from "@/lib/api";
import { ensureUserOrg } from "@/lib/org";
import { buildChatTools } from "@/lib/chat/tools";

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
    `## Capabilities`,
    `You can call platform tools to read and write the user's workspace:`,
    `- **Reads:** \`get_org\`, \`get_spaces\`, \`get_projects\`, \`get_items\`, \`search\` (semantic across wiki pages, including extracted text from PDFs/DOCX/XLSX), \`get_recent_activity\`.`,
    `- **Writes:** \`create_item\` (creates tasks/notes/files/decisions), \`move_item_status\` (moves kanban cards).`,
    ``,
    `Prefer calling tools to get fresh data over assuming. When the user asks "what's in X" or "show me Y", call the appropriate get tool. When they ask you to do something concrete (move a card, add a task), call the write tool — don't just describe what you'd do.`,
    ``,
    `## Style`,
    `- Direct, friendly, technically precise. Match Keegan's tone: no fluff, decisions stated plainly.`,
    `- Use markdown for lists, tables, code. Avoid heavy headings unless the answer is long.`,
    `- When citing wiki content, use the page title; the platform renders it as a real link automatically when wrapped in \`[[...]]\`.`,
    `- For destructive operations (item deletion, mass writes), confirm before executing.`,
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
  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonError(
      "ANTHROPIC_API_KEY is not configured on the server. Add it to Vercel env vars.",
      500,
    );
  }

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

  const tools = buildChatTools({ orgId, actorAgent: "claude-builtin" });
  const system = buildSystemPrompt({ orgName, context: body.context });

  const result = streamText({
    model: anthropic(MODEL_ID),
    system,
    messages: await convertToModelMessages(body.messages),
    tools,
    // Allow the model to call tools, see results, then respond — multi-step.
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse();
}
