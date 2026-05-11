/**
 * GET /api/orgs/claude-project-instructions
 *
 * Renders the Claude Project Instructions markdown for the caller's
 * org, pre-filled with their org name + MCP URL + Profile.md content.
 *
 * Response: text/markdown for direct download / paste.
 *
 * Auth: Clerk session (via global proxy.ts — this endpoint is NOT
 * public; it returns org-specific content).
 */

import { ensureUserOrg } from "@/lib/org";
import { renderClaudeProjectInstructions } from "@/lib/claude-project-template";

const MCP_URL = "https://shared-brain-ecru.vercel.app/api/mcp";

export async function GET() {
  const org = await ensureUserOrg();
  const body = await renderClaudeProjectInstructions({
    orgId: org.id,
    orgName: org.name,
    mcpUrl: MCP_URL,
  });
  const filename = `claude-project-instructions-${org.slug}.md`;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
