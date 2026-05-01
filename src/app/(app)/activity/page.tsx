import { Activity, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activityFeed, spaces } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";
import { ActivityRow } from "@/components/activity-row";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 50;

type Search = {
  actor?: string;
  action?: string;
  space?: string;
  since?: string;
  until?: string;
  page?: string;
};

type HrefOverride = {
  actor?: string;
  action?: string;
  space?: string;
  since?: string;
  until?: string;
  page?: string | number;
};

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const org = await ensureUserOrg();

  const conds: SQL[] = [eq(activityFeed.orgId, org.id)];
  if (params.actor) conds.push(eq(activityFeed.actorAgent, params.actor));
  if (params.action) conds.push(eq(activityFeed.action, params.action));
  if (params.since) conds.push(gte(activityFeed.createdAt, new Date(params.since)));
  if (params.until) conds.push(lte(activityFeed.createdAt, new Date(params.until)));
  if (params.space) {
    conds.push(
      sql`(${activityFeed.entityType} = 'space' and ${activityFeed.entityId} = ${params.space})
          or (${activityFeed.metadata}->>'spaceId' = ${params.space})`,
    );
  }

  // Fetch in parallel: page rows, total, distinct actors / actions, spaces list.
  const [rows, totalRow, distinctActors, distinctActions, orgSpaces] = await Promise.all([
    db
      .select()
      .from(activityFeed)
      .where(and(...conds))
      .orderBy(desc(activityFeed.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(activityFeed)
      .where(and(...conds)),
    db
      .selectDistinct({ actor: activityFeed.actorAgent })
      .from(activityFeed)
      .where(eq(activityFeed.orgId, org.id))
      .orderBy(activityFeed.actorAgent),
    db
      .selectDistinct({ action: activityFeed.action })
      .from(activityFeed)
      .where(eq(activityFeed.orgId, org.id))
      .orderBy(activityFeed.action),
    db
      .select({ id: spaces.id, name: spaces.name })
      .from(spaces)
      .where(eq(spaces.orgId, org.id))
      .orderBy(spaces.name),
  ]);

  const total = totalRow[0]?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Build filter form action. Resets page to 1 when filters change.
  const buildHref = (override: HrefOverride): string => {
    const merged: Record<string, string> = {};
    if (params.actor) merged.actor = params.actor;
    if (params.action) merged.action = params.action;
    if (params.space) merged.space = params.space;
    if (params.since) merged.since = params.since;
    if (params.until) merged.until = params.until;
    Object.entries(override).forEach(([k, v]) => {
      if (v == null || v === "") delete merged[k];
      else merged[k] = String(v);
    });
    const qs = new URLSearchParams(merged).toString();
    return qs ? `/activity?${qs}` : "/activity";
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          <h1 className="text-2xl font-semibold">Activity</h1>
        </div>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Every read and write across your spaces — by Claude clients, the vault sync agent, and you.
        </p>
      </div>

      {/* Filters */}
      <form
        method="GET"
        action="/activity"
        className="grid grid-cols-1 gap-3 rounded-lg border border-[hsl(var(--border))] p-3 md:grid-cols-5"
      >
        <FilterSelect
          name="actor"
          label="Actor"
          value={params.actor ?? ""}
          options={distinctActors.map((r) => ({ value: r.actor, label: r.actor }))}
        />
        <FilterSelect
          name="action"
          label="Action"
          value={params.action ?? ""}
          options={distinctActions.map((r) => ({ value: r.action, label: r.action }))}
        />
        <FilterSelect
          name="space"
          label="Space"
          value={params.space ?? ""}
          options={orgSpaces.map((s) => ({ value: s.id, label: s.name }))}
        />
        <FilterDate name="since" label="Since" value={params.since ?? ""} />
        <FilterDate name="until" label="Until" value={params.until ?? ""} />

        <div className="md:col-span-5 flex items-center gap-2">
          <Button type="submit" size="sm">
            Apply
          </Button>
          <Link
            href="/activity"
            className="text-xs text-[hsl(var(--muted-foreground))] hover:underline"
          >
            Clear
          </Link>
          <span className="ml-auto text-xs text-[hsl(var(--muted-foreground))]">
            {total} entries
          </span>
        </div>
      </form>

      {/* Feed */}
      <div className="rounded-lg border border-[hsl(var(--border))]">
        {rows.length === 0 ? (
          <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">
            No activity matches these filters.
          </div>
        ) : (
          <ul className="divide-y divide-[hsl(var(--border))]">
            {rows.map((entry) => (
              <li key={entry.id}>
                <ActivityRow
                  entry={{
                    ...entry,
                    metadata: (entry.metadata ?? {}) as Record<string, unknown>,
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Link
            href={buildHref({ page: page > 1 ? page - 1 : undefined })}
            aria-disabled={page <= 1}
            className={
              page <= 1
                ? "pointer-events-none flex items-center gap-1 text-[hsl(var(--muted-foreground))]/40"
                : "flex items-center gap-1 hover:underline"
            }
          >
            <ChevronLeft className="h-4 w-4" /> Previous
          </Link>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            Page {page} of {totalPages}
          </span>
          <Link
            href={buildHref({ page: page < totalPages ? page + 1 : undefined })}
            aria-disabled={page >= totalPages}
            className={
              page >= totalPages
                ? "pointer-events-none flex items-center gap-1 text-[hsl(var(--muted-foreground))]/40"
                : "flex items-center gap-1 hover:underline"
            }
          >
            Next <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">{label}</div>
      <select
        name={name}
        defaultValue={value}
        className="h-9 w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 text-sm"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterDate({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">{label}</div>
      <input
        type="date"
        name={name}
        defaultValue={value ? value.slice(0, 10) : ""}
        className="h-9 w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 text-sm"
      />
    </label>
  );
}
