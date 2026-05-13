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
  vaultSyncLog,
  wikiPages,
} from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { indexEntityLinks } from "@/lib/connections/extract";
import { embed, isEmbeddingsConfigured } from "@/lib/embeddings";
import { fileDocument } from "@/lib/filing/file-document";
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
    "List/search the user's vault pages by exact title/content substring. Like `search` but text-match instead of semantic — better when you have an exact title phrase. Returns content stub plus tappable `view_url` and `download_url`. NOT for searching Composio services — this is vault/brain content only.",
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
          blobUrl: wikiPages.blobUrl,
          extractedWordCount: wikiPages.extractedWordCount,
        })
        .from(wikiPages)
        .where(conds.length === 1 ? conds[0] : and(...conds))
        .limit(50);
      const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://shared-brain-ecru.vercel.app";
      return ok(
        rows.map((r) => {
          const isBinary = !!r.blobUrl;
          return {
            id: r.id,
            title: r.title,
            content: r.content,
            updated_at: r.updatedAt,
            kind: isBinary ? "binary" : "prose",
            word_count: r.extractedWordCount ?? null,
            view_url: isBinary ? `${base}/api/files/${r.id}` : `${base}/wiki/${r.id}`,
            download_url: isBinary ? `${base}/api/files/${r.id}?download=1` : null,
            // HTML-rendered preview (DOCX/XLSX → readable HTML; PDFs in
            // iframe; images inline). Better mobile UX than the raw blob.
            preview_url: isBinary ? `${base}/api/files/${r.id}/preview` : null,
          };
        }),
      );
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
    "PRIMARY tool for finding ANY content in the user's Shared Brain / Obsidian vault / notes — contracts, meeting notes, contact cards, project docs, invoices, transcripts, logos, images, anything indexed in their vault. Semantic + text search across wiki pages. Returns id/title/snippet plus `view_url` and (for binary files) `download_url`. Use this for ANY request like 'find', 'pull up', 'show me', 'where is', 'what's in', 'pull back', 'see the' targeting vault content. URLs are CLERK-AUTH'D — they're TAPPABLE LINKS for the user (they're signed in on their browser), NOT fetchable by you. Do NOT attempt to fetch view_url / download_url server-side; you'll get the login page. Surface the URLs in your reply text and let the user tap. Do NOT use Composio search for vault content — Composio is for external services (Gmail/Drive/etc); this searches the user's filed knowledge.",
    { query: z.string().min(1) },
    async ({ query }) => {
      const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://shared-brain-ecru.vercel.app";
      const enrich = (r: {
        id: string;
        title: string;
        snippet: string;
        score?: number;
        blob_url?: string | null;
      }) => {
        const isBinary = !!r.blob_url;
        return {
          id: r.id,
          title: r.title,
          snippet: r.snippet,
          score: r.score,
          kind: isBinary ? "binary" : "prose",
          view_url: isBinary ? `${base}/api/files/${r.id}` : `${base}/wiki/${r.id}`,
          download_url: isBinary ? `${base}/api/files/${r.id}?download=1` : null,
          // HTML-rendered preview — best for DOCX/XLSX on mobile (no
          // native renderer); browser viewer for PDFs and images.
          preview_url: isBinary ? `${base}/api/files/${r.id}/preview` : null,
        };
      };

      if (isEmbeddingsConfigured()) {
        const vec = await embed(query, ctx.orgId);
        if (vec) {
          const literal = `[${vec.join(",")}]`;
          const rows = await db.execute(sql`
            select id, title, left(content, 400) as snippet, blob_url,
                   1 - (embedding <=> ${literal}::vector) as score
            from wiki_pages
            where org_id = ${ctx.orgId} and embedding is not null
            order by embedding <=> ${literal}::vector
            limit 10
          `);
          const list = ((rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[])) as Array<{
            id: string;
            title: string;
            snippet: string;
            blob_url: string | null;
            score: number;
          }>;
          return ok({ mode: "semantic", results: list.map(enrich) });
        }
      }
      const rows = await db
        .select({
          id: wikiPages.id,
          title: wikiPages.title,
          snippet: sql<string>`left(${wikiPages.content}, 400)`,
          blob_url: wikiPages.blobUrl,
        })
        .from(wikiPages)
        .where(
          and(
            eq(wikiPages.orgId, ctx.orgId),
            or(ilike(wikiPages.title, `%${query}%`), ilike(wikiPages.content, `%${query}%`))!,
          ),
        )
        .limit(10);
      return ok({ mode: "text", results: rows.map(enrich) });
    },
  );

  server.tool(
    "get_document",
    "Read the FULL extracted text of a doc in the user's vault. Use AFTER `search` finds a candidate — pass the id (or title_match) and get back the complete body. Returns prose markdown for .md pages and full extracted text for binary files (.docx / .pdf / .xlsx). Includes view_url and download_url. Use this when the caller wants you to summarize, analyze, or quote from a specific vault doc — NOT for Gmail/Drive/Composio content.",
    {
      wiki_page_id: z.string().uuid().optional(),
      title_match: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe(
          "Substring match on title — use only if you don't have an id. Picks the most-recently-updated match.",
        ),
      max_chars: z
        .number()
        .int()
        .min(1000)
        .max(200_000)
        .optional()
        .describe("Cap for the returned content. Defaults to 100,000 chars."),
    },
    async ({ wiki_page_id, title_match, max_chars }) => {
      if (!wiki_page_id && !title_match) {
        return ok({ error: "Provide either wiki_page_id or title_match." });
      }
      const cap = max_chars ?? 100_000;
      let row: typeof wikiPages.$inferSelect | undefined;
      if (wiki_page_id) {
        [row] = await db
          .select()
          .from(wikiPages)
          .where(and(eq(wikiPages.orgId, ctx.orgId), eq(wikiPages.id, wiki_page_id)))
          .limit(1);
      } else {
        [row] = await db
          .select()
          .from(wikiPages)
          .where(
            and(
              eq(wikiPages.orgId, ctx.orgId),
              ilike(wikiPages.title, `%${title_match}%`),
            ),
          )
          .orderBy(desc(wikiPages.updatedAt))
          .limit(1);
      }
      if (!row) return ok({ found: false });
      const isBinary = !!row.blobUrl;
      const fullText = isBinary ? row.extractedText ?? "" : row.content;
      const truncated = fullText.length > cap;

      // Tappable URLs for the mobile use case (find → view / save / forward).
      // All routes are Clerk-auth'd, so signed-in users can tap directly.
      // The blob URL itself is private and never returned to the caller.
      const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://shared-brain-ecru.vercel.app";
      const view_url = isBinary
        ? `${base}/api/files/${row.id}`
        : `${base}/wiki/${row.id}`;
      const download_url = isBinary ? `${base}/api/files/${row.id}?download=1` : null;
      const preview_url = isBinary ? `${base}/api/files/${row.id}/preview` : null;

      return ok({
        found: true,
        id: row.id,
        title: row.title,
        kind: isBinary ? "binary" : "prose",
        word_count: row.extractedWordCount ?? null,
        updated_at: row.updatedAt,
        content: truncated ? fullText.slice(0, cap) : fullText,
        truncated,
        total_chars: fullText.length,
        // Surface these to the user when they want to view, save, or forward
        // the doc. On mobile, tapping view_url opens it in their browser
        // (signed in via Clerk session); download_url forces an attachment.
        view_url,
        download_url,
        preview_url,
        hint:
          isBinary && !row.extractedText
            ? "Binary file with no extracted text yet — open via view_url or wait for the F2 extraction backfill to catch it."
            : undefined,
      });
    },
  );

  server.tool(
    "get_document_url",
    "Cheap variant of `get_document` that returns ONLY the URL set (no content). Use when the caller wants to view, save, or forward a doc without you reading it (e.g. \"send me the brand doc\" — no need to spend tokens on the body).",
    {
      wiki_page_id: z.string().uuid().optional(),
      title_match: z.string().min(1).max(200).optional(),
    },
    async ({ wiki_page_id, title_match }) => {
      if (!wiki_page_id && !title_match) {
        return ok({ error: "Provide either wiki_page_id or title_match." });
      }
      let row: typeof wikiPages.$inferSelect | undefined;
      if (wiki_page_id) {
        [row] = await db
          .select()
          .from(wikiPages)
          .where(and(eq(wikiPages.orgId, ctx.orgId), eq(wikiPages.id, wiki_page_id)))
          .limit(1);
      } else {
        [row] = await db
          .select()
          .from(wikiPages)
          .where(
            and(
              eq(wikiPages.orgId, ctx.orgId),
              ilike(wikiPages.title, `%${title_match}%`),
            ),
          )
          .orderBy(desc(wikiPages.updatedAt))
          .limit(1);
      }
      if (!row) return ok({ found: false });
      const isBinary = !!row.blobUrl;
      const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://shared-brain-ecru.vercel.app";
      return ok({
        found: true,
        id: row.id,
        title: row.title,
        kind: isBinary ? "binary" : "prose",
        view_url: isBinary ? `${base}/api/files/${row.id}` : `${base}/wiki/${row.id}`,
        download_url: isBinary ? `${base}/api/files/${row.id}?download=1` : null,
        preview_url: isBinary ? `${base}/api/files/${row.id}/preview` : null,
      });
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
      // Idempotent: if a space with this name already exists in the org,
      // return it instead of creating a duplicate. Backed by the
      // (org_id, name) unique index.
      const [created] = await db
        .insert(spaces)
        .values({ orgId: ctx.orgId, name, type })
        .onConflictDoNothing({ target: [spaces.orgId, spaces.name] })
        .returning();
      if (!created) {
        const [existing] = await db
          .select()
          .from(spaces)
          .where(and(eq(spaces.orgId, ctx.orgId), eq(spaces.name, name)));
        return ok({ space: existing, alreadyExisted: true });
      }
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
      const embedding = await embed(`${title}\n\n${content}`, ctx.orgId);
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
      const embedding = await embed(`${title ?? ""}\n\n${content}`, ctx.orgId);
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
    "get_active_state",
    "Returns the current 'active state of the world' — every space/project that has at least one item not in `completed` status, with the open items + entities backlinked to those projects (people in Pipeline/, related notes, etc.). Replaces a static state-of-world doc; auto-stays-fresh as work progresses. Call to get a snapshot of what's actually live right now.",
    {
      max_items_per_project: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .default(8),
      max_related_per_project: z
        .number()
        .int()
        .min(0)
        .max(50)
        .optional()
        .default(8),
    },
    async ({ max_items_per_project = 8, max_related_per_project = 8 }) => {
      const result = await buildActiveState({
        orgId: ctx.orgId,
        maxItemsPerProject: max_items_per_project,
        maxRelatedPerProject: max_related_per_project,
      });
      return ok(result);
    },
  );

  server.tool(
    "get_operating_instructions",
    "Returns the user profile + standing instructions every Claude agent should read at session start. The canonical doc lives in the vault at `Knowledge/Frameworks/Shared Brain/Profile.md` and is mirrored to the platform via vault sync. Call this at the start of every session when connected to Shared Brain.",
    {},
    async () => {
      const page = await getProfilePage(ctx.orgId);
      if (!page) {
        return ok({
          error:
            "Profile not found. Expected `Knowledge/Frameworks/Shared Brain/Profile.md` to be synced into the platform. Run `npm run sync:once` from the agent dir.",
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
    "file_document",
    [
      "Save an external document (email body, meeting transcript, fetched file content, web page, etc.) into the user's vault at an AI-classified location. YOU decide the targetPath using:",
      "1. Routing rules from get_operating_instructions (Profile.md sections 5 + 7 — where things go).",
      "2. Active state from get_active_state (which active project/space matches the content?).",
      "3. The document's content (subject, parties, topic, dates).",
      "Provide a confidence score 0.0-1.0; below 0.7 routes to Inbox/ for the user to review and refile (which the system will learn from). For uncertain cases, prefer Inbox over a wrong guess.",
      "Pair with COMPOSIO_MULTI_EXECUTE_TOOL to fetch external content (Gmail messages, Drive files, etc.) first, then call this tool with the fetched content. Always include `source` describing the origin so the activity log + future reconciliation know where the doc came from.",
    ].join("\n"),
    {
      title: z.string().min(1).max(240),
      content: z.string().min(1),
      target_path: z
        .string()
        .optional()
        .describe(
          "Vault-relative path including .md extension (e.g. 'Clients/Trade Oracle/Meetings/2026-05-07 - Subject.md'). Omit if uncertain — the system will route to Inbox/.",
        ),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe(
          "0.0-1.0 self-assessment of target_path correctness. <0.7 routes to Inbox.",
        ),
      tags: z.array(z.string()).optional(),
      source: z
        .string()
        .optional()
        .describe(
          "Origin descriptor — e.g. 'gmail:user@example.com/INBOX/<msgId>', 'gdrive:<file_id>', 'granola:<meetingId>'.",
        ),
      reasoning: z
        .string()
        .optional()
        .describe(
          "One-sentence rationale for the chosen target_path. Surfaced in the activity log so user can audit AI filing decisions.",
        ),
    },
    async ({ title, content, target_path, confidence, tags, source, reasoning }) => {
      const result = await fileDocument({
        orgId: ctx.orgId,
        actorAgent: ctx.actorAgent,
        title,
        content,
        targetPath: target_path,
        confidence,
        tags,
        source,
        reasoning,
      });
      return ok(result);
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

/**
 * Canonical vault path for the Profile / Operating Instructions doc.
 * The wiki page's title is whatever the user puts in frontmatter, so
 * we look up by file path via vault_sync_log instead — that's stable
 * regardless of how the user renames the doc internally.
 */
const PROFILE_VAULT_PATH = "Knowledge/Frameworks/Shared Brain/Profile.md";

export async function getProfilePage(orgId: string) {
  // vault_sync_log maps file_path → wiki_pages.id deterministically.
  const [row] = await db
    .select({
      id: wikiPages.id,
      title: wikiPages.title,
      content: wikiPages.content,
      updatedAt: wikiPages.updatedAt,
    })
    .from(vaultSyncLog)
    .innerJoin(wikiPages, eq(vaultSyncLog.entityId, wikiPages.id))
    .where(
      and(
        eq(vaultSyncLog.filePath, PROFILE_VAULT_PATH),
        eq(wikiPages.orgId, orgId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Snapshot of the user's active state of the world. Defined as: every
 * project with at least one item where status != 'completed', grouped
 * under its space, plus the entities backlinked to those projects so
 * the model has a sense of who/what is connected to active work.
 *
 * Pure function on the DB — auto-stays-fresh as items get marked
 * complete or new ones are added. Replaces the static "Active State of
 * the World" + "Key People" sections from earlier Phase 6 drafts.
 */
export async function buildActiveState(args: {
  orgId: string;
  maxItemsPerProject?: number;
  maxRelatedPerProject?: number;
}) {
  const { orgId, maxItemsPerProject = 8, maxRelatedPerProject = 8 } = args;

  // Pull all open items in this org, joined to project + space.
  const openItems = await db
    .select({
      itemId: items.id,
      itemTitle: items.title,
      itemStatus: items.status,
      itemType: items.type,
      itemUpdatedAt: items.updatedAt,
      projectId: projects.id,
      projectName: projects.name,
      spaceId: spaces.id,
      spaceName: spaces.name,
      spaceType: spaces.type,
    })
    .from(items)
    .innerJoin(projects, eq(items.projectId, projects.id))
    .innerJoin(spaces, eq(projects.spaceId, spaces.id))
    .where(and(eq(spaces.orgId, orgId), sql`${items.status} != 'completed'`))
    .orderBy(desc(items.updatedAt));

  // Group items by project; track which projects we've seen.
  type ProjectBucket = {
    projectId: string;
    projectName: string;
    spaceId: string;
    spaceName: string;
    spaceType: string;
    openCount: number;
    sampleItems: Array<{
      id: string;
      title: string;
      status: string;
      type: string;
      updated_at: Date;
    }>;
  };
  const projectMap = new Map<string, ProjectBucket>();
  for (const r of openItems) {
    const existing = projectMap.get(r.projectId);
    if (existing) {
      existing.openCount += 1;
      if (existing.sampleItems.length < maxItemsPerProject) {
        existing.sampleItems.push({
          id: r.itemId,
          title: r.itemTitle,
          status: r.itemStatus,
          type: r.itemType,
          updated_at: r.itemUpdatedAt,
        });
      }
    } else {
      projectMap.set(r.projectId, {
        projectId: r.projectId,
        projectName: r.projectName,
        spaceId: r.spaceId,
        spaceName: r.spaceName,
        spaceType: r.spaceType,
        openCount: 1,
        sampleItems: [
          {
            id: r.itemId,
            title: r.itemTitle,
            status: r.itemStatus,
            type: r.itemType,
            updated_at: r.itemUpdatedAt,
          },
        ],
      });
    }
  }

  const projectIds = [...projectMap.keys()];

  // For each active project, find related entities via backlinks. We
  // include both directions (project linked from / linked to). We then
  // resolve the related entity titles from items + wiki_pages in batch.
  const allBacklinks =
    projectIds.length > 0
      ? await db
          .select()
          .from(backlinks)
          .where(
            or(
              and(
                eq(backlinks.sourceType, "project"),
                sql`${backlinks.sourceId} = ANY(${projectIds})`,
              ),
              and(
                eq(backlinks.targetType, "project"),
                sql`${backlinks.targetId} = ANY(${projectIds})`,
              ),
            ),
          )
      : [];

  // Collect distinct (type, id) pairs for related entities so we can
  // resolve titles in two batched queries (one for items, one for wiki).
  const relatedItemIds = new Set<string>();
  const relatedWikiIds = new Set<string>();
  for (const b of allBacklinks) {
    const otherSideType =
      b.sourceType === "project" && projectIds.includes(b.sourceId)
        ? b.targetType
        : b.sourceType;
    const otherSideId =
      b.sourceType === "project" && projectIds.includes(b.sourceId)
        ? b.targetId
        : b.sourceId;
    if (otherSideType === "item") relatedItemIds.add(otherSideId);
    else if (otherSideType === "wiki_page") relatedWikiIds.add(otherSideId);
  }

  const itemRows = relatedItemIds.size
    ? await db
        .select({ id: items.id, title: items.title })
        .from(items)
        .where(sql`${items.id} = ANY(${[...relatedItemIds]})`)
    : [];
  const wikiRows = relatedWikiIds.size
    ? await db
        .select({ id: wikiPages.id, title: wikiPages.title })
        .from(wikiPages)
        .where(sql`${wikiPages.id} = ANY(${[...relatedWikiIds]})`)
    : [];
  const itemTitle = new Map(itemRows.map((r) => [r.id, r.title]));
  const wikiTitle = new Map(wikiRows.map((r) => [r.id, r.title]));

  // Attach the resolved related entities to each project.
  type Related = { kind: "item" | "wiki_page"; id: string; title: string };
  const relatedByProject = new Map<string, Related[]>();
  for (const b of allBacklinks) {
    const projectId =
      b.sourceType === "project" && projectIds.includes(b.sourceId)
        ? b.sourceId
        : b.targetId;
    const otherType =
      b.sourceType === "project" && projectIds.includes(b.sourceId)
        ? b.targetType
        : b.sourceType;
    const otherId =
      b.sourceType === "project" && projectIds.includes(b.sourceId)
        ? b.targetId
        : b.sourceId;
    let title: string | undefined;
    if (otherType === "item") title = itemTitle.get(otherId);
    else if (otherType === "wiki_page") title = wikiTitle.get(otherId);
    if (!title) continue;
    const list = relatedByProject.get(projectId) ?? [];
    if (!list.find((r) => r.kind === otherType && r.id === otherId)) {
      list.push({
        kind: otherType as "item" | "wiki_page",
        id: otherId,
        title,
      });
    }
    relatedByProject.set(projectId, list);
  }

  // Group projects by space.
  type SpaceOut = {
    space: { id: string; name: string; type: string };
    projects: Array<{
      id: string;
      name: string;
      open_items_count: number;
      sample_items: ProjectBucket["sampleItems"];
      related: Related[];
    }>;
  };
  const spaceMap = new Map<string, SpaceOut>();
  for (const p of projectMap.values()) {
    const out = spaceMap.get(p.spaceId) ?? {
      space: { id: p.spaceId, name: p.spaceName, type: p.spaceType },
      projects: [],
    };
    const related = (relatedByProject.get(p.projectId) ?? []).slice(
      0,
      maxRelatedPerProject,
    );
    out.projects.push({
      id: p.projectId,
      name: p.projectName,
      open_items_count: p.openCount,
      sample_items: p.sampleItems,
      related,
    });
    spaceMap.set(p.spaceId, out);
  }

  return {
    snapshot_at: new Date().toISOString(),
    active_spaces: [...spaceMap.values()].sort((a, b) =>
      a.space.name.localeCompare(b.space.name),
    ),
    totals: {
      active_spaces: spaceMap.size,
      active_projects: projectMap.size,
      open_items: openItems.length,
    },
  };
}

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
