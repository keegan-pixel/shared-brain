import { z } from "zod";
import { tool } from "ai";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  activityFeed,
  itemStatusValues,
  itemTypeValues,
  items,
  organizations,
  projects,
  spaces,
  wikiPages,
} from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { embed, isEmbeddingsConfigured } from "@/lib/embeddings";
import { indexEntityLinks } from "@/lib/connections/extract";

/**
 * Build the tool set the in-platform Claude chat panel can use. Same surface
 * area as the MCP server — defined here as AI-SDK `tool()` so streamText can
 * call them inline (rather than HTTP-roundtripping through our own MCP server).
 *
 * Every tool is org-scoped via the supplied `orgId`. The chat session is
 * Clerk-authenticated, so the orgId comes from `ensureUserOrg()` in the route.
 */
export function buildChatTools(args: { orgId: string; actorAgent: string }) {
  const { orgId, actorAgent } = args;

  return {
    get_org: tool({
      description: "Get the current organization and its spaces.",
      inputSchema: z.object({}),
      execute: async () => {
        const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
        const orgSpaces = await db.select().from(spaces).where(eq(spaces.orgId, orgId));
        return { org, spaces: orgSpaces };
      },
    }),

    get_spaces: tool({
      description: "List all spaces in the org with project counts.",
      inputSchema: z.object({}),
      execute: async () => {
        const rows = await db
          .select({
            id: spaces.id,
            name: spaces.name,
            type: spaces.type,
            projectCount: sql<number>`count(${projects.id})::int`,
          })
          .from(spaces)
          .leftJoin(projects, eq(projects.spaceId, spaces.id))
          .where(eq(spaces.orgId, orgId))
          .groupBy(spaces.id);
        return rows;
      },
    }),

    get_projects: tool({
      description: "List projects in a space.",
      inputSchema: z.object({ space_id: z.string().uuid() }),
      execute: async ({ space_id }) => {
        const [space] = await db
          .select({ id: spaces.id })
          .from(spaces)
          .where(and(eq(spaces.id, space_id), eq(spaces.orgId, orgId)));
        if (!space) return { error: `Space ${space_id} not found in this org.` };
        const rows = await db.select().from(projects).where(eq(projects.spaceId, space_id));
        return rows;
      },
    }),

    get_items: tool({
      description: "List items (tasks / notes / files / decisions) in a project, optionally filtered by status.",
      inputSchema: z.object({
        project_id: z.string().uuid(),
        status: z.enum(itemStatusValues).optional(),
      }),
      execute: async ({ project_id, status }) => {
        const [proj] = await db
          .select({ id: projects.id })
          .from(projects)
          .innerJoin(spaces, eq(projects.spaceId, spaces.id))
          .where(and(eq(projects.id, project_id), eq(spaces.orgId, orgId)));
        if (!proj) return { error: `Project ${project_id} not found.` };
        const conds = [eq(items.projectId, project_id)];
        if (status) conds.push(eq(items.status, status));
        const rows = await db
          .select()
          .from(items)
          .where(conds.length === 1 ? conds[0] : and(...conds));
        return rows;
      },
    }),

    search: tool({
      description: "Semantic search across wiki pages (falls back to text match if embeddings unavailable). Returns titles + snippets.",
      inputSchema: z.object({ query: z.string().min(1) }),
      execute: async ({ query }) => {
        if (isEmbeddingsConfigured()) {
          const vec = await embed(query);
          if (vec) {
            const literal = `[${vec.join(",")}]`;
            const rows = await db.execute(sql`
              select id, title, left(coalesce(extracted_text, content), 400) as snippet,
                     1 - (embedding <=> ${literal}::vector) as score
              from wiki_pages
              where org_id = ${orgId} and embedding is not null
              order by embedding <=> ${literal}::vector
              limit 10
            `);
            return { mode: "semantic", results: rows.rows ?? rows };
          }
        }
        const rows = await db
          .select({
            id: wikiPages.id,
            title: wikiPages.title,
            snippet: sql<string>`left(coalesce(${wikiPages.extractedText}, ${wikiPages.content}), 400)`,
          })
          .from(wikiPages)
          .where(
            and(
              eq(wikiPages.orgId, orgId),
              or(ilike(wikiPages.title, `%${query}%`), ilike(wikiPages.content, `%${query}%`))!,
            ),
          )
          .limit(10);
        return { mode: "text", results: rows };
      },
    }),

    get_recent_activity: tool({
      description: "Recent activity entries across the org. Useful when the user asks 'what happened recently'.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
      execute: async ({ limit }) => {
        const rows = await db
          .select()
          .from(activityFeed)
          .where(eq(activityFeed.orgId, orgId))
          .orderBy(desc(activityFeed.createdAt))
          .limit(limit ?? 15);
        return rows;
      },
    }),

    create_item: tool({
      description: "Create a new item (task / note / file / decision) inside a project. Returns the created item.",
      inputSchema: z.object({
        project_id: z.string().uuid(),
        type: z.enum(itemTypeValues),
        title: z.string().min(1).max(240),
        content: z.string().optional(),
        status: z.enum(itemStatusValues).optional(),
      }),
      execute: async ({ project_id, type, title, content, status }) => {
        const [proj] = await db
          .select({ id: projects.id })
          .from(projects)
          .innerJoin(spaces, eq(projects.spaceId, spaces.id))
          .where(and(eq(projects.id, project_id), eq(spaces.orgId, orgId)));
        if (!proj) return { error: `Project ${project_id} not found.` };
        const [created] = await db
          .insert(items)
          .values({
            projectId: project_id,
            type,
            title,
            content,
            status: status ?? "backlog",
            createdByAgent: actorAgent,
          })
          .returning();
        await logActivity({
          orgId,
          actorAgent,
          action: "create_item",
          entityType: "item",
          entityId: created.id,
          summary: `Created ${type} "${title}"`,
          metadata: { projectId: project_id, status: created.status },
        });
        await indexEntityLinks({
          orgId,
          source: { type: "item", id: created.id },
          body: `${title}\n\n${content ?? ""}`,
        });
        return { item: created };
      },
    }),

    move_item_status: tool({
      description: "Move a kanban card to a different swimlane. Use this when the user asks to mark something done, in progress, etc.",
      inputSchema: z.object({
        item_id: z.string().uuid(),
        new_status: z.enum(itemStatusValues),
      }),
      execute: async ({ item_id, new_status }) => {
        const [row] = await db
          .select({ item: items })
          .from(items)
          .innerJoin(projects, eq(items.projectId, projects.id))
          .innerJoin(spaces, eq(projects.spaceId, spaces.id))
          .where(and(eq(items.id, item_id), eq(spaces.orgId, orgId)));
        if (!row) return { error: `Item ${item_id} not found.` };
        if (row.item.status === new_status) return { item: row.item, unchanged: true };
        const [updated] = await db
          .update(items)
          .set({ status: new_status, updatedAt: new Date() })
          .where(eq(items.id, item_id))
          .returning();
        await logActivity({
          orgId,
          actorAgent,
          action: "move_item_status",
          entityType: "item",
          entityId: item_id,
          summary: `Moved "${updated.title}" → ${new_status}`,
          metadata: { from: row.item.status, to: new_status },
        });
        return { item: updated };
      },
    }),
  } as const;
}
