/**
 * GET /api/orgs/claude-project-instructions
 *
 * Renders the Claude Project Instructions markdown for the caller's
 * org, pre-filled with their org name + MCP URL + Profile.md content.
 *
 *   ?format=full  (default) — full template with first-run discovery
 *                  interview, for users setting up a fresh Claude Project.
 *   ?format=short — lead-agent patch for users who already have a
 *                   working Claude Project / agent architecture
 *                   (e.g. Jake's AXIS) — just the "you now have
 *                   shared-brain MCP" addition to drop into existing
 *                   system prompts.
 *
 * Response: text/markdown for direct download / paste.
 */

import { NextRequest } from "next/server";
import { ensureUserOrg } from "@/lib/org";
import {
  renderClaudeProjectInstructions,
  renderLeadAgentPatch,
} from "@/lib/claude-project-template";

const MCP_URL = "https://shared-brain-ecru.vercel.app/api/mcp";

export async function GET(req: NextRequest) {
  const org = await ensureUserOrg();
  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "short" ? "short" : "full";

  const body =
    format === "short"
      ? renderLeadAgentPatch({ orgName: org.name, mcpUrl: MCP_URL })
      : await renderClaudeProjectInstructions({
          orgId: org.id,
          orgName: org.name,
          mcpUrl: MCP_URL,
        });
  const filename =
    format === "short"
      ? `shared-brain-lead-agent-patch-${org.slug}.md`
      : `claude-project-instructions-${org.slug}.md`;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
