import { resolveOrgContext } from "@/lib/mcp/context";
import { getProfilePage } from "@/lib/mcp/tools";

/**
 * GET /api/operating-instructions
 *
 * Public-facing endpoint for the `shared-brain --install-skill` flow:
 * the installed skill file in Claude's config points at this URL so
 * every session pulls the live operating instructions without
 * needing to re-install when the doc changes.
 *
 * Auth: same Bearer-token convention as the MCP server. Without a
 * valid `MCP_API_KEY`, returns 401 — keeps the user's profile from
 * being world-readable.
 *
 * Response: plain markdown by default (so Claude reads it as
 * instructions). `?format=json` returns JSON with metadata.
 */
export async function GET(req: Request) {
  const expected = process.env.MCP_API_KEY;
  if (!expected) {
    return new Response(
      JSON.stringify({ error: "MCP_API_KEY is not configured on the server" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!presented || presented !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="shared-brain-operating-instructions"',
      },
    });
  }

  const ctx = await resolveOrgContext("operating-instructions-endpoint");
  const page = await getProfilePage(ctx.orgId);

  if (!page) {
    return new Response(
      JSON.stringify({
        error:
          "Profile page not found. Create `Knowledge/Frameworks/Shared Brain/Profile.md` in your vault and let the sync agent push it up.",
      }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }

  const url = new URL(req.url);
  if (url.searchParams.get("format") === "json") {
    return new Response(
      JSON.stringify({ title: page.title, updated_at: page.updatedAt, content: page.content }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          // Brief edge cache so repeated pulls within a few minutes don't
          // hit the DB. Not so long that updates take ages to propagate.
          "cache-control": "public, max-age=60, s-maxage=60",
        },
      },
    );
  }

  return new Response(page.content, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=60",
    },
  });
}
