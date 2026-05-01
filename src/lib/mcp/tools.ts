import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db } from "@/lib/db/client";
import {
  activityFeed,
  backlinkEntityValues,
  backlinks,
  itemStatusValues,
  itemTypeValues,
  items,
  organizations,
  projects,
  spaces,
  wikiPages,
} from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { indexEntityLinks } from "@/lib/connections/extract";
import { embed, isEmbeddingsConfigured } from "@/lib/embeddings";
import type { McpContext } from "./context";

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;
const ok = (data: Json) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });

export function registerTools(server: McpServer, ctx: McpContext) {
  // ─── READ ─────────────────────────────────────────────────────────────

  server.tool("get_org", "Get the organization overview and its spaces.", {}, async () => {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
    const orgSpaces = await db.select().from(spaces).where(eq(spaces.orgId, ctx.orgId));
    return ok({ org, spaces: orgSpaces });
  });

  server.tool(
    "get_spaces",
    "List all spaces in the org with project counts.",
    {},
    async () => {
      const rows = await db
        .select({
          id: spaces.id,
          name: spaces.name,
          type: spaces.type,
          projectCount: sql<number>`count(${projects.id})::int`,
        })
        .from(spaces)
        .leftJoin(projects, eq(projects.spaceId, spaces.id))
        .where(eq(spaces.orgId, ctx.orgId))
        .groupBy(spaces.id);
      return ok(rows);
    },
  );

  server.tool(
    "get_projects",
    "List projects in a space.",
    { space_id: z.string().uuid() },
    async ({ space_id }) => {
      await assertSpaceInOrg(ctx.orgId, space_id);
      const rows = await db.select().from(projects).where(eq(projects.spaceId, space_id));
      return ok(rows);
    },
  );

  server.tool(
    "get_items",
    "List items in a project, optionally filtered by status (kanban swimlane).",
    {
      project_id: z.string().uuid(),
      status: z.enum(itemStatusValues).optional(),
    },
    async ({ project_id, status }) => {
      await assertProjectInOrg(ctx.orgId, project_id);
      const conds = [eq(items.projectId, project_id)];
      if (status) conds.push(eq(items.status, status));
      const rows = await db
        .select()
        .from(items)
        .where(conds.length === 1 ? conds[0] : and(...conds));
      return ok(rows);
    },
  );

  server.tool(
    "get_wiki_pages",
    "List or search wiki pages (text match if a query is provided).",
    { query: z.string().optional() },
    async ({ query }) => {
      const conds = [eq(wikiPages.orgId, ctx.orgId)];
      if (query && query.trim()) {
        conds.push(
          or(ilike(wikiPages.title, `%${query}%`), ilike(wikiPages.content, `%${query}%`))!,
        );
      }
      const rows = await db
        .select({
          id: wikiPages.id,
          title: wikiPages.title,
          content: wikiPages.content,
          updatedAt: wikiPages.updatedAt,
        })
        .from(wikiPages)
        .where(conds.length === 1 ? conds[0] : and(...conds))
        .limit(50);
      return ok(rows);
    },
  );

  server.tool(
    "get_activity_feed",
    "Recent activity. Optionally limit count or scope to a single space.",
    {
      limit: z.number().int().min(1).max(200).optional(),
      space_id: z.string().uuid().optional(),
    },
    async ({ limit, space_id }) => {
      const lim = limit ?? 25;
      const rows = await db
        .select()
        .from(activityFeed)
        .where(eq(activityFeed.orgId, ctx.orgId))
        .orderBy(desc(activityFeed.createdAt))
        .limit(lim);
      // space scoping is best-effort: filter by metadata.spaceId if present
      const filtered = space_id
        ? rows.filter((r) => (r.metadata as { spaceId?: string })?.spaceId === space_id)
        : rows;
      return ok(filtered);
    },
  );

  server.tool(
    "get_backlinks",
    "All backlinks pointing to or from an entity.",
    {
      entity_type: z.enum(backlinkEntityValues),
      entity_id: z.string().uuid(),
    },
    async ({ entity_type, entity_id }) => {
      const rows = await db
        .select()
        .from(backlinks)
        .where(
          or(
            and(eq(backlinks.sourceType, entity_type), eq(backlinks.sourceId, entity_id)),
            and(eq(backlinks.targetType, entity_type), eq(backlinks.targetId, entity_id)),
          ),
        );
      return ok(rows);
    },
  );

  server.tool(
    "search",
    "Semantic search across wiki pages (falls back to text search if embeddings aren't configured).",
    { query: z.string().min(1) },
    async ({ query }) => {
      if (isEmbeddingsConfigured()) {
        const vec = await embed(query);
        if (vec) {
          const literal = `[${vec.join(",")}]`;
          const rows = await db.execute(sql`
            select id, title, left(content, 400) as snippet,
                   1 - (embedding <=> ${literal}::vector) as score
            from wiki_pages
            where org_id = ${ctx.orgId} and embedding is not null
            order by embedding <=> ${literal}::vector
            limit 10
          `);
          return ok({ mode: "semantic", results: rows.rows ?? rows });
        }
      }
      const rows = await db
        .select({
          id: wikiPages.id,
          title: wikiPages.title,
          snippet: sql<string>`left(${wikiPages.content}, 400)`,
        })
        .from(wikiPages)
        .where(
          and(
            eq(wikiPages.orgId, ctx.orgId),
            or(ilike(wikiPages.title, `%${query}%`), ilike(wikiPages.content, `%${query}%`))!,
          ),
        )
        .limit(10);
      return ok({ mode: "text", results: rows });
    },
  );

  // ─── WRITE ────────────────────────────────────────────────────────────

  server.tool(
    "create_space",
    "Create a new space (client | dept | team) in the org.",
    {
      name: z.string().min(1).max(120),
      type: z.enum(["client", "dept", "team"]),
    },
    async ({ name, type }) => {
      const [created] = await db
        .insert(spaces)
        .values({ orgId: ctx.orgId, name, type })
        .returning();
      await logActivity({
        orgId: ctx.orgId,
        actorAgent: ctx.actorAgent,
        action: "create_space",
        entityType: "space",
        entityId: created.id,
        summary: `Created ${type} space "${name}"`,
        metadata: { spaceId: created.id },
      });
      return ok({ space: created });
    },
  );

  server.tool(
    "create_project",
    "Create a new project inside a space.",
    {
      space_id: z.string().uuid(),
      name: z.string().min(1).max(160),
      description: z.string().optional(),
    },
    async ({ space_id, name, description }) => {
      await assertSpaceInOrg(ctx.orgId, space_id);
      const [created] = await db
        .insert(projects)
        .values({ spaceId: space_id, name, description })
        .returning();
      await logActivity({
        orgId: ctx.orgId,
        actorAgent: ctx.actorAgent,
        action: "create_project",
        entityType: "project",
        entityId: created.id,
        summary: `Created project "${name}"`,
        metadata: { spaceId: space_id, projectId: created.id },
      });
      return ok({ project: created });
    },
  );

  server.tool(
    "create_item",
    "Create a new item (task | note | file | decision) inside a project.",
    {
      project_id: z.string().uuid(),
      type: z.enum(itemTypeValues),
      title: z.string().min(1).max(240),
      content: z.string().optional(),
      status: z.enum(itemStatusValues).optional(),
    },
    async ({ project_id, type, title, content, status }) => {
      await assertProjectInOrg(ctx.orgId, project_id);
      const [created] = await db
        .insert(items)
        .values({
          projectId: project_id,
          type,
          title,
          content,
          status: status ?? "backlog",
          createdByAgent: ctx.actorAgent,
        })
        .returning();
      await logActivity({
        orgId: ctx.orgId,
        actorAgent: ctx.actorAgent,
        action: "create_item",
        entityType: "item",
        entityId: created.id,
        summary: `Created ${type} "${title}"`,
        metadata: { projectId: project_id, status: created.status },
      });
      await indexEntityLinks({
        orgId: ctx.orgId,
        source: { type: "item", id: created.id },
        body: `${title}\n\n${content ?? ""}`,
      });
      return ok({ item: created });
    },
  );

  server.tool(
    "update_item",
    "Update fields on an existing item.",
    {
      item_id: z.string().uuid(),
      title: z.string().min(1).max(240).optional(),
      content: z.string().nullable().optional(),
      type: z.enum(itemTypeValues).optional(),
      status: z.enum(itemStatusValues).optional(),
    },
    async ({ item_id, ...patch }) => {
      const before = await loadItemInOrg(ctx.orgId, item_id);
      const [updated] = await db
        .update(items)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(items.id, item_id))
        .returning();
      await logActivity({
        orgId: ctx.orgId,
        actorAgent: ctx.actorAgent,
        action: "update_item",
        entityType: "item",
        entityId: item_id,
        summary: `Updated "${updated.title}"`,
        metadata: { changed: Object.keys(patch), previousStatus: before.status },
      });
      if (patch.title !== undefined || patch.content !== undefined) {
        await indexEntityLinks({
          orgId: ctx.orgId,
          source: { type: "item", id: updated.id },
          body: `${updated.title}\n\n${updated.content ?? ""}`,
        });
      }
      return ok({ item: updated });
    },
  );

  server.tool(
    "move_item_status",
    "Move a kanban card to a different swimlane.",
    {
      item_id: z.string().uuid(),
      new_status: z.enum(itemStatusValues),
    },
    async ({ item_id, new_status }) => {
      const before = await loadItemInOrg(ctx.orgId, item_id);
      if (before.status === new_status) return ok({ item: before, unchanged: true });
      const [updated] = await db
        .update(items)
        .set({ status: new_status, updatedAt: new Date() })
        .where(eq(items.id, item_id))
        .returning();
      await logActivity({
        orgId: ctx.orgId,
        actorAgent: ctx.actorAgent,
        action: "move_item_status",
        entityType: "item",
        entityId: item_id,
        summary: `Moved "${updated.title}" → ${new_status}`,
        metadata: { from: before.status, to: new_status },
      });
      return ok({ item: updated });
    },
  );

  server.tool(
    "create_wiki_page",
    "Create a new wiki page. Embedding is generated if OPENAI_API_KEY is set.",
    { title: z.string().min(1).max(240), content: z.string() },
    async ({ title, content }) => {
      const embedding = await embed(`${title}\n\n${content}`);
      const [created] = await db
        .insert(wikiPages)
        .values({ orgId: ctx.orgId, title, content, embedding: embedding ?? undefined })
        .returning({ id: wikiPages.id, title: wikiPages.title });
      await logActivity({
        orgId: ctx.orgId,
        actorAgent: ctx.actorAgent,
        action: "create_wiki_page",
        entityType: "wiki_page",
        entityId: created.id,
        summary: `Created wiki page "${title}"`,
      });
      await indexEntityLinks({
        orgId: ctx.orgId,
        source: { type: "wiki_page", id: created.id },
        body: content,
      });
      return ok({ page: created });
    },
  );

  server.tool(
    "update_wiki_page",
    "Update wiki page content. Embedding is regenerated if OPENAI_API_KEY is set.",
    { page_id: z.string().uuid(), content: z.string(), title: z.string().optional() },
    async ({ page_id, content, title }) => {
      await loadWikiPageInOrg(ctx.orgId, page_id);
      const newTitle = title ?? undefined;
      const embedding = await embed(`${title ?? ""}\n\n${content}`);
      const [updated] = await db
        .update(wikiPages)
        .set({
          content,
          ...(newTitle ? { title: newTitle } : {}),
          ...(embedding ? { embedding } : {}),
          updatedAt: new Date(),
        })
        .where(eq(wikiPages.id, page_id))
        .returning({ id: wikiPages.id, title: wikiPages.title });
      await logActivity({
        orgId: ctx.orgId,
        actorAgent: ctx.actorAgent,
        action: "update_wiki_page",
        entityType: "wiki_page",
        entityId: page_id,
        summary: `Updated wiki page "${updated.title}"`,
      });
      await indexEntityLinks({
        orgId: ctx.orgId,
        source: { type: "wiki_page", id: page_id },
        body: content,
      });
      return ok({ page: updated });
    },
  );

  // ─── PHASE 6: AGENT OPERATING INSTRUCTIONS ─────────────────────────────

  server.tool(
    "get_operating_instructions",
    "Returns the user profile + standing instructions every Claude agent should read at session start. The canonical doc lives in the vault at `Knowledge/Frameworks/Shared Brain/Profile.md` and is mirrored to the platform via vault sync. Call this at the start of every session when connected to Shared Brain.",
    {},
    async () => {
      // Look up the Profile wiki page by title. Vault sync uses the file's
      // basename (without .md) as the title — so "Profile.md" → "Profile".
      const [page] = await db
        .select({ title: wikiPages.title, content: wikiPages.content, updatedAt: wikiPages.updatedAt })
        .from(wikiPages)
        .where(and(eq(wikiPages.orgId, ctx.orgId), eq(wikiPages.title, "Profile")))
        .limit(1);
      if (!page) {
        return ok({
          error:
            "Profile not found. Expected a wiki page titled 'Profile' (synced from `Knowledge/Frameworks/Shared Brain/Profile.md`). Either create the file in vault or seed via `Profile` wiki page in the platform.",
        });
      }
      return ok({
        title: page.title,
        updated_at: page.updatedAt,
        content: page.content,
      });
    },
  );

  server.tool(
    "record_session_summary",
    "Logs a 2-3 sentence summary of what was accomplished in this session to the activity feed AND creates a session-note wiki page. Call before ending any session with significant work. Reference work as `[[Page Title]]` so autolinks resolve.",
    {
      summary: z
        .string()
        .min(1)
        .describe(
          "2-3 sentence summary of what was done. Reference items as [[Page Title]] for autolinks.",
        ),
      project: z
        .string()
        .optional()
        .describe("Optional project name or space to associate with this summary."),
      related_items: z
        .array(z.string())
        .optional()
        .describe(
          "Optional list of related entity titles (wiki pages or items) the work touched.",
        ),
    },
    async ({ summary, project, related_items }) => {
      const now = new Date();
      const dateStamp = now.toISOString().slice(0, 10);
      const timeStamp = now.toISOString().slice(11, 19);
      const sessionTitle = `Session ${dateStamp} ${timeStamp} — ${ctx.actorAgent}`;
      const body = [
        `# ${sessionTitle}`,
        "",
        `**Agent:** ${ctx.actorAgent}`,
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
        .values({
          orgId: ctx.orgId,
          title: sessionTitle,
          content: body,
        })
        .returning();

      await logActivity({
        orgId: ctx.orgId,
        actorAgent: ctx.actorAgent,
        action: "session_summary",
        entityType: "wiki_page",
        entityId: created.id,
        summary: `[${ctx.actorAgent}] ${project ? `(${project}) ` : ""}${summary.slice(0, 200)}`,
      });

      // Best-effort backlink indexing so [[refs]] in the summary resolve
      // into the connection graph.
      try {
        await indexEntityLinks({
          orgId: ctx.orgId,
          source: { type: "wiki_page", id: created.id },
          body,
        });
      } catch {
        /* swallow — non-fatal */
      }

      return ok({
        recorded: true,
        wiki_page: { id: created.id, title: created.title },
      });
    },
  );

  server.tool(
    "add_backlink",
    "Manually create a backlink between two entities (item or wiki_page).",
    {
      source_type: z.enum(backlinkEntityValues),
      source_id: z.string().uuid(),
      target_type: z.enum(backlinkEntityValues),
      target_id: z.string().uuid(),
    },
    async ({ source_type, source_id, target_type, target_id }) => {
      const [created] = await db
        .insert(backlinks)
        .values({ sourceType: source_type, sourceId: source_id, targetType: target_type, targetId: target_id })
        .returning();
      await logActivity({
        orgId: ctx.orgId,
        actorAgent: ctx.actorAgent,
        action: "add_backlink",
        entityType: "backlink",
        entityId: created.id,
        summary: `Linked ${source_type}:${source_id} → ${target_type}:${target_id}`,
      });
      return ok({ backlink: created });
    },
  );
}

// ─── helpers ───────────────────────────────────────────────────────────

async function assertSpaceInOrg(orgId: string, spaceId: string) {
  const [row] = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(and(eq(spaces.id, spaceId), eq(spaces.orgId, orgId)));
  if (!row) throw new Error(`Space ${spaceId} not found in this org.`);
}

async function assertProjectInOrg(orgId: string, projectId: string) {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(spaces, eq(projects.spaceId, spaces.id))
    .where(and(eq(projects.id, projectId), eq(spaces.orgId, orgId)));
  if (!row) throw new Error(`Project ${projectId} not found in this org.`);
}

async function loadItemInOrg(orgId: string, itemId: string) {
  const [row] = await db
    .select({ item: items })
    .from(items)
    .innerJoin(projects, eq(items.projectId, projects.id))
    .innerJoin(spaces, eq(projects.spaceId, spaces.id))
    .where(and(eq(items.id, itemId), eq(spaces.orgId, orgId)));
  if (!row) throw new Error(`Item ${itemId} not found in this org.`);
  return row.item;
}

async function loadWikiPageInOrg(orgId: string, pageId: string) {
  const [row] = await db
    .select()
    .from(wikiPages)
    .where(and(eq(wikiPages.id, pageId), eq(wikiPages.orgId, orgId)));
  if (!row) throw new Error(`Wiki page ${pageId} not found in this org.`);
  return row;
}
