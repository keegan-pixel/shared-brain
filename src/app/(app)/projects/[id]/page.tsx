import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { items, projects, spaces } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";
import { KanbanBoard } from "@/components/kanban/board";
import type { Item } from "@/components/kanban/types";

type Props = { params: Promise<{ id: string }> };

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
  const initialItems: Item[] = itemRows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    type: r.type,
    title: r.title,
    content: r.content,
    status: r.status,
    createdByAgent: r.createdByAgent,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
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

      <KanbanBoard projectId={row.project.id} initialItems={initialItems} />
    </div>
  );
}
