import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activityFeed, items, projects, spaces } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";
import { ActivityRow } from "@/components/activity-row";

type Props = { params: Promise<{ id: string }> };

export default async function SpacePage({ params }: Props) {
  const { id } = await params;
  const org = await ensureUserOrg();

  const [space] = await db
    .select()
    .from(spaces)
    .where(and(eq(spaces.id, id), eq(spaces.orgId, org.id)));
  if (!space) notFound();

  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      itemCount: sql<number>`count(${items.id})::int`,
    })
    .from(projects)
    .leftJoin(items, eq(items.projectId, projects.id))
    .where(eq(projects.spaceId, id))
    .groupBy(projects.id);

  // Recent activity scoped to this space — entries that either reference the
  // space directly or were tagged with this spaceId in metadata.
  const recentActivity = await db
    .select()
    .from(activityFeed)
    .where(
      and(
        eq(activityFeed.orgId, org.id),
        or(
          and(eq(activityFeed.entityType, "space"), eq(activityFeed.entityId, id)),
          sql`(${activityFeed.metadata}->>'spaceId' = ${id})`,
        )!,
      ),
    )
    .orderBy(desc(activityFeed.createdAt))
    .limit(15);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <div className="text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          {space.type} space
        </div>
        <h1 className="text-2xl font-semibold">{space.name}</h1>
      </div>

      <div className="rounded-lg border border-[hsl(var(--border))]">
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-4 py-3">
          <h2 className="font-medium">Projects</h2>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            {projectRows.length} project{projectRows.length === 1 ? "" : "s"}
          </span>
        </div>
        {projectRows.length === 0 ? (
          <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">
            No projects yet. Create one via Claude Desktop with{" "}
            <code className="rounded bg-[hsl(var(--muted))] px-1 py-0.5 text-xs">create_project</code>{" "}
            (space_id: <code className="text-xs">{space.id}</code>) or POST{" "}
            <code className="rounded bg-[hsl(var(--muted))] px-1 py-0.5 text-xs">/api/projects</code>.
          </div>
        ) : (
          <ul className="divide-y divide-[hsl(var(--border))]">
            {projectRows.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-[hsl(var(--accent))]"
                >
                  <div>
                    <div className="font-medium">{p.name}</div>
                    {p.description && (
                      <div className="text-xs text-[hsl(var(--muted-foreground))]">
                        {p.description}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">
                    {p.itemCount} item{p.itemCount === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {recentActivity.length > 0 && (
        <div className="rounded-lg border border-[hsl(var(--border))]">
          <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-4 py-3">
            <h2 className="font-medium">Recent activity</h2>
            <Link
              href={`/activity?space=${space.id}`}
              className="text-xs text-[hsl(var(--muted-foreground))] hover:underline"
            >
              View all →
            </Link>
          </div>
          <ul className="divide-y divide-[hsl(var(--border))]">
            {recentActivity.map((entry) => (
              <li key={entry.id}>
                <ActivityRow
                  entry={{
                    ...entry,
                    metadata: (entry.metadata ?? {}) as Record<string, unknown>,
                  }}
                  compact
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
