import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { mcpRequestLog } from "@/lib/db/schema";

export const revalidate = 30; // refresh every 30s on next visit

const STATUS_STYLES: Record<string, { color: string; label: string }> = {
  healthy: { color: "bg-green-500/20 text-green-700 dark:text-green-300 border-green-500/40", label: "Healthy" },
  degraded: { color: "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40", label: "Degraded" },
  unhealthy: { color: "bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/40", label: "Unhealthy" },
  unknown: { color: "bg-muted text-muted-foreground border-border", label: "No traffic" },
};

function fmtPct(n: number | null): string {
  if (n === null) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

function fmtAgo(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const ms = Date.now() - date.getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export default async function StatusPage() {
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

  const recentErrorsRes = await db
    .select()
    .from(mcpRequestLog)
    .where(sql`status = 'error' AND created_at > ${since}`)
    .orderBy(sql`created_at DESC`)
    .limit(10);

  const successRate = totals.total > 0 ? totals.ok / totals.total : null;
  const healthy =
    totals.total === 0
      ? "unknown"
      : successRate !== null && successRate >= 0.99
        ? "healthy"
        : successRate !== null && successRate >= 0.95
          ? "degraded"
          : "unhealthy";
  const style = STATUS_STYLES[healthy];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Status</h1>
        <p className="text-sm text-muted-foreground mt-1">
          MCP endpoint health over the last 24 hours. Public surface — no auth required.
          See <a href="/api/status" className="underline">/api/status</a> for the JSON form.
        </p>
      </div>

      <div className={`mb-6 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium ${style.color}`}>
        <span className="h-2 w-2 rounded-full bg-current" />
        {style.label}
        {successRate !== null && (
          <span className="ml-2 text-xs opacity-80">{fmtPct(successRate)} success rate</span>
        )}
      </div>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Total requests</div>
          <div className="text-2xl font-medium">{totals.total.toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Auth failures</div>
          <div className="text-2xl font-medium">{totals.auth_fail.toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Errors</div>
          <div className="text-2xl font-medium">{totals.error.toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Avg / p95 latency</div>
          <div className="text-2xl font-medium">
            {totals.avg_duration} <span className="text-sm text-muted-foreground">/ {totals.p95_duration} ms</span>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card">
        <header className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">Recent errors (last 24h)</h2>
        </header>
        {recentErrorsRes.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center">
            No errors in the last 24 hours.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {recentErrorsRes.map((e) => (
              <li key={e.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <code className="text-xs rounded bg-muted px-1.5 py-0.5">HTTP {e.httpStatus}</code>
                  <span className="text-xs text-muted-foreground">{fmtAgo(e.createdAt)}</span>
                </div>
                {e.errorMessage && (
                  <div className="mt-1 text-xs text-muted-foreground break-all">{e.errorMessage}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-xs text-muted-foreground">
        Privacy: this page records request metadata only — never tool arguments, request bodies,
        or response data. See <a href="/api/status" className="underline">/api/status</a> JSON.
      </p>
    </div>
  );
}
