import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { items, itemStatusValues, projects, spaces, type ItemStatus } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";

type Props = { params: Promise<{ id: string }> };

const STATUS_LABELS: Record<ItemStatus, string> = {
  backlog: "Backlog",
  not_started: "Not Started",
  research_planning: "Research / Planning",
  in_progress: "In Progress",
  review: "Review",
  completed: "Completed",
};

export default async function ProjectPage({ params }: Props) {
  const { id } = await params;
  const org = await ensureUserOrg();

  const [row] = await db
    .select({ project: projects, space: spaces })
    .from(projects)
    .innerJoin(spaces, eq(projects.spaceId, spaces.id))
    .where(and(eq(projects.id, id), eq(spaces.orgId, org.id)));
  if (!row) notFound();

  const itemRows = await db.select().from(items).where(eq(items.projectId, id));
  const grouped = itemStatusValues.reduce<Record<ItemStatus, typeof itemRows>>(
    (acc, status) => {
      acc[status] = itemRows.filter((i) => i.status === status);
      return acc;
    },
    {} as Record<ItemStatus, typeof itemRows>,
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          href={`/spaces/${row.space.id}`}
          className="text-xs text-[hsl(var(--muted-foreground))] hover:underline"
        >
          ← {row.space.name}
        </Link>
        <h1 className="text-2xl font-semibold">{row.project.name}</h1>
        {row.project.description && (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{row.project.description}</p>
        )}
      </div>

      <div className="text-xs text-[hsl(var(--muted-foreground))]">
        Phase 3 will replace this list with a kanban. For now, items grouped by status:
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {itemStatusValues.map((status) => (
          <div
            key={status}
            className="rounded-lg border border-[hsl(var(--border))]"
          >
            <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-3 py-2">
              <h2 className="text-sm font-medium">{STATUS_LABELS[status]}</h2>
              <span className="text-xs text-[hsl(var(--muted-foreground))]">
                {grouped[status].length}
              </span>
            </div>
            {grouped[status].length === 0 ? (
              <div className="p-3 text-xs text-[hsl(var(--muted-foreground))]">—</div>
            ) : (
              <ul className="divide-y divide-[hsl(var(--border))]">
                {grouped[status].map((item) => (
                  <li key={item.id} className="px-3 py-2 text-sm">
                    <div className="font-medium">{item.title}</div>
                    <div className="text-xs text-[hsl(var(--muted-foreground))]">
                      {item.type}
                      {item.createdByAgent ? ` · ${item.createdByAgent}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
