/**
 * Public status endpoint — no auth required. Returns aggregate MCP
 * health metrics from the last 24 hours so the platform can
 * self-report uptime / failure rates without exposing per-request
 * details.
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { mcpRequestLog } from "@/lib/db/schema";

export async function GET() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const totalsRes = await db.execute<{
    total: number;
    ok: number;
    auth_fail: number;
    error: number;
    avg_duration: number;
    p95_duration: number;
  }>(sql`
    SELECT
      count(*)::int                                                       AS total,
      count(*) FILTER (WHERE status = 'ok')::int                          AS ok,
      count(*) FILTER (WHERE status = 'auth_fail')::int                   AS auth_fail,
      count(*) FILTER (WHERE status = 'error')::int                       AS error,
      coalesce(avg(duration_ms)::int, 0)                                  AS avg_duration,
      coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::int, 0) AS p95_duration
    FROM mcp_request_log
    WHERE created_at > ${since}
  `);
  const totals = totalsRes.rows[0] ?? {
    total: 0,
    ok: 0,
    auth_fail: 0,
    error: 0,
    avg_duration: 0,
    p95_duration: 0,
  };

  const recentErrorsRes = await db.execute<{
    created_at: string;
    http_status: number;
    error_message: string | null;
  }>(sql`
    SELECT created_at, http_status, error_message
    FROM mcp_request_log
    WHERE status = 'error' AND created_at > ${since}
    ORDER BY created_at DESC
    LIMIT 10
  `);

  const successRate =
    totals.total > 0 ? totals.ok / totals.total : null;

  // Health bucket: green ≥0.99, yellow ≥0.95, red <0.95 OR no traffic
  const healthy =
    totals.total === 0
      ? "unknown"
      : successRate !== null && successRate >= 0.99
        ? "healthy"
        : successRate !== null && successRate >= 0.95
          ? "degraded"
          : "unhealthy";

  return Response.json(
    {
      status: healthy,
      window_hours: 24,
      generated_at: new Date().toISOString(),
      mcp: {
        total_requests: totals.total,
        ok: totals.ok,
        auth_fail: totals.auth_fail,
        error: totals.error,
        success_rate: successRate,
        avg_duration_ms: totals.avg_duration,
        p95_duration_ms: totals.p95_duration,
      },
      recent_errors: recentErrorsRes.rows.map((r) => ({
        at: r.created_at,
        http_status: r.http_status,
        message: r.error_message,
      })),
    },
    {
      headers: {
        // Edge-cache for 60s so monitoring tools polling don't hammer
        // the DB. Status doesn't need to be sub-second fresh.
        "cache-control": "public, max-age=60, s-maxage=60",
      },
    },
  );
}
