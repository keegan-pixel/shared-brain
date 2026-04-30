import { and, eq, sql, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { backlinks, items, projects, spaces, wikiPages } from "@/lib/db/schema";
import type { BacklinkEntity, BacklinkKind } from "@/lib/db/schema";

export type ConnectionTarget = {
  type: BacklinkEntity;
  id: string;
  title: string;
  /** Optional sub-context like project/space name. */
  context?: string;
};

export type Connection = {
  kind: BacklinkKind;
  /** Direction: who connects to whom. "outgoing" = source is the current entity. */
  direction: "outgoing" | "incoming" | "mutual";
  target: ConnectionTarget;
  score?: number;
  evidence?: Record<string, unknown>;
};

type EntityLookup = {
  type: "wiki_page" | "item";
  id: string;
  orgId: string;
  title: string;
  metadata: Record<string, unknown>;
  embedding: number[] | null;
};

async function loadEntity(args: {
  type: "wiki_page" | "item";
  id: string;
}): Promise<EntityLookup | null> {
  if (args.type === "wiki_page") {
    const [row] = await db
      .select({
        id: wikiPages.id,
        orgId: wikiPages.orgId,
        title: wikiPages.title,
        metadata: wikiPages.metadata,
        embedding: wikiPages.embedding,
      })
      .from(wikiPages)
      .where(eq(wikiPages.id, args.id));
    if (!row) return null;
    return {
      type: "wiki_page",
      id: row.id,
      orgId: row.orgId,
      title: row.title,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      embedding: row.embedding ?? null,
    };
  }
  const [row] = await db
    .select({
      id: items.id,
      title: items.title,
      orgId: spaces.orgId,
    })
    .from(items)
    .innerJoin(projects, eq(items.projectId, projects.id))
    .innerJoin(spaces, eq(projects.spaceId, spaces.id))
    .where(eq(items.id, args.id));
  if (!row) return null;
  return {
    type: "item",
    id: row.id,
    orgId: row.orgId,
    title: row.title,
    metadata: {},
    embedding: null,
  };
}

async function fetchTargetTitles(
  refs: { type: BacklinkEntity; id: string }[],
): Promise<Map<string, ConnectionTarget>> {
  const out = new Map<string, ConnectionTarget>();
  if (refs.length === 0) return out;

  const wikiIds = refs.filter((r) => r.type === "wiki_page").map((r) => r.id);
  const itemIds = refs.filter((r) => r.type === "item").map((r) => r.id);
  const spaceIds = refs.filter((r) => r.type === "space").map((r) => r.id);
  const projectIds = refs.filter((r) => r.type === "project").map((r) => r.id);

  if (wikiIds.length) {
    const rows = await db
      .select({ id: wikiPages.id, title: wikiPages.title })
      .from(wikiPages)
      .where(inArray(wikiPages.id, wikiIds));
    for (const r of rows) out.set(`wiki_page:${r.id}`, { type: "wiki_page", id: r.id, title: r.title });
  }
  if (itemIds.length) {
    const rows = await db
      .select({
        id: items.id,
        title: items.title,
        projectName: projects.name,
        spaceName: spaces.name,
      })
      .from(items)
      .innerJoin(projects, eq(items.projectId, projects.id))
      .innerJoin(spaces, eq(projects.spaceId, spaces.id))
      .where(inArray(items.id, itemIds));
    for (const r of rows) {
      out.set(`item:${r.id}`, {
        type: "item",
        id: r.id,
        title: r.title,
        context: `${r.spaceName} · ${r.projectName}`,
      });
    }
  }
  if (spaceIds.length) {
    const rows = await db.select().from(spaces).where(inArray(spaces.id, spaceIds));
    for (const r of rows) out.set(`space:${r.id}`, { type: "space", id: r.id, title: r.name });
  }
  if (projectIds.length) {
    const rows = await db
      .select({ id: projects.id, name: projects.name, spaceName: spaces.name })
      .from(projects)
      .innerJoin(spaces, eq(projects.spaceId, spaces.id))
      .where(inArray(projects.id, projectIds));
    for (const r of rows)
      out.set(`project:${r.id}`, { type: "project", id: r.id, title: r.name, context: r.spaceName });
  }

  return out;
}

/** Persisted edges (explicit_link + frontmatter_related) for the entity. */
async function getPersistedEdges(entity: EntityLookup): Promise<Connection[]> {
  const outgoingRows = await db
    .select()
    .from(backlinks)
    .where(and(eq(backlinks.sourceType, entity.type), eq(backlinks.sourceId, entity.id)));

  const incomingRows = await db
    .select()
    .from(backlinks)
    .where(and(eq(backlinks.targetType, entity.type), eq(backlinks.targetId, entity.id)));

  const refs = [
    ...outgoingRows.map((r) => ({ type: r.targetType, id: r.targetId })),
    ...incomingRows.map((r) => ({ type: r.sourceType, id: r.sourceId })),
  ];
  const titleMap = await fetchTargetTitles(refs);

  const out: Connection[] = [];
  for (const r of outgoingRows) {
    const target = titleMap.get(`${r.targetType}:${r.targetId}`);
    if (!target) continue;
    out.push({
      kind: r.kind,
      direction: "outgoing",
      target,
      score: r.score ?? undefined,
      evidence: r.evidence,
    });
  }
  for (const r of incomingRows) {
    const target = titleMap.get(`${r.sourceType}:${r.sourceId}`);
    if (!target) continue;
    out.push({
      kind: r.kind,
      direction: "incoming",
      target,
      score: r.score ?? undefined,
      evidence: r.evidence,
    });
  }
  return out;
}

/** Tag overlap — wiki pages that share at least one tag. */
async function getTagOverlap(entity: EntityLookup, limit = 10): Promise<Connection[]> {
  if (entity.type !== "wiki_page") return [];
  const tags = (entity.metadata as { tags?: string[] }).tags ?? [];
  if (tags.length === 0) return [];

  // Use jsonb path query: metadata.tags ?| array['a','b']
  const rows = await db.execute(sql`
    select id, title, metadata
    from wiki_pages
    where org_id = ${entity.orgId}
      and id <> ${entity.id}
      and (metadata->'tags') ?| array[${sql.join(tags.map((t) => sql`${t}`), sql`, `)}]::text[]
    limit ${limit}
  `);
  const list = (rows.rows ?? rows) as Array<{
    id: string;
    title: string;
    metadata: { tags?: string[] };
  }>;
  return list.map((r) => {
    const overlap = tags.filter((t) => (r.metadata.tags ?? []).includes(t));
    return {
      kind: "tag_overlap" as const,
      direction: "mutual" as const,
      target: { type: "wiki_page" as const, id: r.id, title: r.title },
      evidence: { sharedTags: overlap },
    };
  });
}

/** Folder siblings — wiki pages in the same parent directory. */
async function getFolderSiblings(entity: EntityLookup, limit = 10): Promise<Connection[]> {
  if (entity.type !== "wiki_page") return [];
  const filePath = (entity.metadata as { filePath?: string }).filePath;
  if (!filePath) return [];
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash < 0) return [];
  const parent = filePath.slice(0, lastSlash + 1);

  const rows = await db.execute(sql`
    select id, title, metadata
    from wiki_pages
    where org_id = ${entity.orgId}
      and id <> ${entity.id}
      and (metadata->>'filePath') like ${parent + "%"}
      and position('/' in substr(metadata->>'filePath', ${parent.length + 1})) = 0
    limit ${limit}
  `);
  const list = (rows.rows ?? rows) as Array<{ id: string; title: string }>;
  return list.map((r) => ({
    kind: "folder_sibling" as const,
    direction: "mutual" as const,
    target: { type: "wiki_page" as const, id: r.id, title: r.title },
    evidence: { folder: parent },
  }));
}

/** Semantic similar — pgvector cosine distance, top K. */
async function getSemanticSimilar(entity: EntityLookup, limit = 6): Promise<Connection[]> {
  if (entity.type !== "wiki_page" || !entity.embedding) return [];
  const literal = `[${entity.embedding.join(",")}]`;

  const rows = await db.execute(sql`
    select id, title, 1 - (embedding <=> ${literal}::vector) as score
    from wiki_pages
    where org_id = ${entity.orgId}
      and id <> ${entity.id}
      and embedding is not null
    order by embedding <=> ${literal}::vector
    limit ${limit}
  `);
  const list = (rows.rows ?? rows) as Array<{ id: string; title: string; score: number }>;
  // Filter very-low-relevance (< 0.5 cosine) — they tend to be noise.
  return list
    .filter((r) => Number(r.score) >= 0.5)
    .map((r) => ({
      kind: "semantic_similar" as const,
      direction: "mutual" as const,
      target: { type: "wiki_page" as const, id: r.id, title: r.title },
      score: Number(r.score),
    }));
}

/**
 * Get all connections for an entity, grouped by kind, with redundancy
 * removed (e.g. if A explicitly links B, don't also surface A↔B as a
 * semantic_similar).
 */
export async function getConnections(args: {
  type: "wiki_page" | "item";
  id: string;
}): Promise<Connection[]> {
  const entity = await loadEntity(args);
  if (!entity) return [];

  const [persisted, tagOverlap, siblings, semantic] = await Promise.all([
    getPersistedEdges(entity),
    getTagOverlap(entity),
    getFolderSiblings(entity),
    getSemanticSimilar(entity),
  ]);

  // Build a set of (type:id) keys already covered by stronger / explicit edges.
  const coveredByExplicit = new Set<string>();
  for (const c of persisted) {
    if (c.kind === "explicit_link" || c.kind === "frontmatter_related") {
      coveredByExplicit.add(`${c.target.type}:${c.target.id}`);
    }
  }
  // Tag overlap deduped against explicit; folder siblings deduped against
  // explicit + tag overlap; semantic deduped against everything else.
  const coveredByTagOrFolder = new Set<string>(coveredByExplicit);
  const tagOverlapFiltered = tagOverlap.filter((c) => {
    const k = `${c.target.type}:${c.target.id}`;
    if (coveredByTagOrFolder.has(k)) return false;
    coveredByTagOrFolder.add(k);
    return true;
  });
  const siblingsFiltered = siblings.filter((c) => {
    const k = `${c.target.type}:${c.target.id}`;
    if (coveredByTagOrFolder.has(k)) return false;
    coveredByTagOrFolder.add(k);
    return true;
  });
  const semanticFiltered = semantic.filter((c) => {
    const k = `${c.target.type}:${c.target.id}`;
    return !coveredByTagOrFolder.has(k);
  });

  return [
    ...persisted,
    ...tagOverlapFiltered,
    ...siblingsFiltered,
    ...semanticFiltered,
  ];
}
