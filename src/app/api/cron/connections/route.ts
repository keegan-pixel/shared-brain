/**
 * Phase 4b — Background AI edges cron route.
 *
 * Vercel Cron hits this endpoint on a schedule (see vercel.json) to
 * compute keyword_overlap + co_mention edges across every org. The
 * computations are idempotent — running more often or less often only
 * affects freshness, not correctness.
 *
 * Auth: Vercel Cron sets the `Authorization: Bearer <CRON_SECRET>`
 * header automatically. We accept that OR a normal MCP_API_KEY bearer
 * for manual invocation. Also accepts `?manual=1` with MCP key for
 * ad-hoc runs while testing.
 *
 * Returns: per-org summary of edges computed and total duration.
 */

import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema";
import { runBackgroundEdges } from "@/lib/connections/background";

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  if (!presented) return false;
  // Vercel Cron uses CRON_SECRET; manual invocations use MCP_API_KEY.
  // Accept either.
  if (process.env.CRON_SECRET && presented === process.env.CRON_SECRET) return true;
  if (process.env.MCP_API_KEY && presented === process.env.MCP_API_KEY) return true;
  return false;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="shared-brain-cron"',
      },
    });
  }

  const orgs = await db.select().from(organizations);
  const start = Date.now();
  const results: Array<{
    orgId: string;
    orgName: string;
    keyword_overlap: { entities: number; edges: number };
    co_mention: { people: number; documents: number; edges: number };
    duration_ms: number;
  }> = [];

  for (const org of orgs) {
    try {
      const r = await runBackgroundEdges(org.id);
      results.push({ orgId: org.id, orgName: org.name, ...r });
      console.info(
        `[cron/connections] ${org.name}: keyword_overlap=${r.keyword_overlap.edges} co_mention=${r.co_mention.edges} (${r.duration_ms}ms)`,
      );
    } catch (err) {
      console.error(
        `[cron/connections] ${org.name} failed:`,
        (err as Error).message,
      );
      results.push({
        orgId: org.id,
        orgName: org.name,
        keyword_overlap: { entities: 0, edges: 0 },
        co_mention: { people: 0, documents: 0, edges: 0 },
        duration_ms: 0,
      });
    }
  }

  return Response.json({
    ran_at: new Date().toISOString(),
    total_duration_ms: Date.now() - start,
    org_count: orgs.length,
    results,
  });
}

// POST with the same handler so Vercel Cron / manual curl both work.
// Vercel Cron uses GET by default; POST is allowed for ad-hoc.
export const POST = GET;
