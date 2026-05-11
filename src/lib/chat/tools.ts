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
import { buildActiveState, getProfilePage } from "@/lib/mcp/tools";
import { fileDocument } from "@/lib/filing/file-document";

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
          const vec = await embed(query, orgId);
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

    // ─── Phase 6: Agent Operating Instructions ────────────────────────
    get_active_state: tool({
      description:
        "Snapshot of what's actually live right now: every space/project with at least one open (not `completed`) item, with sample items + entities backlinked to those projects (people in Pipeline/, related notes). Auto-stays-fresh from the database. Call this when you need current world state — not a static doc.",
      inputSchema: z.object({
        max_items_per_project: z.number().int().min(1).max(50).optional(),
        max_related_per_project: z.number().int().min(0).max(50).optional(),
      }),
      execute: async ({ max_items_per_project, max_related_per_project }) => {
        return buildActiveState({
          orgId,
          maxItemsPerProject: max_items_per_project,
          maxRelatedPerProject: max_related_per_project,
        });
      },
    }),

    get_operating_instructions: tool({
      description:
        "Return the user profile + standing instructions every Claude agent should read at session start. Pulls the canonical Profile.md wiki page.",
      inputSchema: z.object({}),
      execute: async () => {
        const page = await getProfilePage(orgId);
        if (!page) {
          return {
            error:
              "Profile not found. Expected Knowledge/Frameworks/Shared Brain/Profile.md to be synced. Run `npm run sync:once`.",
          };
        }
        return { title: page.title, updated_at: page.updatedAt, content: page.content };
      },
    }),

    file_document: tool({
      description:
        "Save an external document (email body, meeting transcript, fetched file, etc.) into the vault at YOUR classified destination. Decide target_path using get_operating_instructions routing rules + get_active_state + content. Confidence <0.7 (or no target_path) routes to Inbox/ — prefer Inbox over a wrong guess; the system learns from where the user refiles. Pair with COMPOSIO tools to fetch external content first.",
      inputSchema: z.object({
        title: z.string().min(1).max(240),
        content: z.string().min(1),
        target_path: z.string().optional(),
        confidence: z.number().min(0).max(1).optional(),
        tags: z.array(z.string()).optional(),
        source: z.string().optional(),
        reasoning: z.string().optional(),
      }),
      execute: async ({ title, content, target_path, confidence, tags, source, reasoning }) => {
        return fileDocument({
          orgId,
          actorAgent,
          title,
          content,
          targetPath: target_path,
          confidence,
          tags,
          source,
          reasoning,
        });
      },
    }),

    record_session_summary: tool({
      description:
        "Log a 2-3 sentence summary of what this session accomplished. Creates an activity entry + a session-note wiki page. Call before ending sessions with significant work. Reference work as `[[Page Title]]` for autolinks.",
      inputSchema: z.object({
        summary: z.string().min(1),
        project: z.string().optional(),
        related_items: z.array(z.string()).optional(),
      }),
      execute: async ({ summary, project, related_items }) => {
        const now = new Date();
        const dateStamp = now.toISOString().slice(0, 10);
        const timeStamp = now.toISOString().slice(11, 19);
        const sessionTitle = `Session ${dateStamp} ${timeStamp} — ${actorAgent}`;
        const body = [
          `# ${sessionTitle}`,
          "",
          `**Agent:** ${actorAgent}`,
          `**Date:** ${dateStamp} ${timeStamp}`,
          project ? `**Project:** ${project}` : null,
          related_items && related_items.length
            ? `**Related:** ${related_items.map((r) => `[[${r}]]`).join(", ")}`
            : null,
          "",
          "## Summary",
          "",
          summary,
        ]
          .filter(Boolean)
          .join("\n");

        const [created] = await db
          .insert(wikiPages)
          .values({ orgId, title: sessionTitle, content: body })
          .returning();
        await logActivity({
          orgId,
          actorAgent,
          action: "session_summary",
          entityType: "wiki_page",
          entityId: created.id,
          summary: `[${actorAgent}] ${project ? `(${project}) ` : ""}${summary.slice(0, 200)}`,
        });
        try {
          await indexEntityLinks({
            orgId,
            source: { type: "wiki_page", id: created.id },
            body,
          });
        } catch {
          /* swallow — non-fatal */
        }
        return { recorded: true, wiki_page: { id: created.id, title: created.title } };
      },
    }),
  } as const;
}
