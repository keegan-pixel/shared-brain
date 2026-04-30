import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { backlinks, wikiPages } from "@/lib/db/schema";
import type { BacklinkEntity } from "@/lib/db/schema";

/**
 * Pull [[Page Title]] references out of a markdown body. Returns a deduped
 * array of titles in the order they first appear.
 */
export function extractWikilinks(body: string): string[] {
  const matches = body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const title = m[1].trim();
    if (!title) continue;
    if (seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    out.push(title);
  }
  return out;
}

/**
 * Pull related entries out of frontmatter. Accepts either a string or array.
 * Strips wrapping [[ ]] if the user wrote them that way.
 */
export function extractFrontmatterRelated(fm: Record<string, unknown>): string[] {
  const raw = fm.related;
  const list: string[] = [];
  const push = (v: unknown) => {
    if (typeof v !== "string") return;
    const t = v.trim().replace(/^\[\[|\]\]$/g, "").trim();
    if (t) list.push(t);
  };
  if (Array.isArray(raw)) raw.forEach(push);
  else push(raw);
  return list;
}

/**
 * Resolve a list of titles to wiki_page ids. Obsidian-compatible: matches
 * against (a) page title, (b) filename basename (without .md), and (c) the
 * basename's last path segment if the title contains slashes (Obsidian
 * supports `[[Subfolder/Page]]` notation). All case-insensitive.
 *
 * Returns a map keyed by the lowercased reference title.
 */
export async function resolveWikiTitles(orgId: string, titles: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (titles.length === 0) return result;

  const lowers = new Set(titles.map((t) => t.toLowerCase()));

  const rows = await db
    .select({ id: wikiPages.id, title: wikiPages.title, metadata: wikiPages.metadata })
    .from(wikiPages)
    .where(eq(wikiPages.orgId, orgId));

  // Build candidate keys for each row: title, filename basename, full file
  // path without extension. First match per requested title wins.
  for (const r of rows) {
    const meta = (r.metadata as { filePath?: string } | null) ?? null;
    const filePath = meta?.filePath ?? null;
    const candidates = new Set<string>();
    candidates.add(r.title.toLowerCase());
    if (filePath) {
      const noExt = filePath.replace(/\.md$/i, "");
      const base = noExt.split("/").pop() ?? noExt;
      candidates.add(noExt.toLowerCase()); // "shared brain/build log"
      candidates.add(base.toLowerCase()); // "build log"
    }
    for (const c of candidates) {
      if (lowers.has(c) && !result.has(c)) {
        result.set(c, r.id);
      }
    }
  }
  return result;
}

type EdgeInput = {
  sourceType: BacklinkEntity;
  sourceId: string;
  targetType: BacklinkEntity;
  targetId: string;
  kind: "explicit_link" | "frontmatter_related";
  evidence?: Record<string, unknown>;
};

/**
 * Replace all explicit/frontmatter edges originating from a given entity with
 * the supplied set. We delete + insert because content changes can both add
 * and remove links — easier than diffing.
 */
export async function replaceWriteTimeEdges(
  source: { type: BacklinkEntity; id: string },
  edges: EdgeInput[],
) {
  await db
    .delete(backlinks)
    .where(
      and(
        eq(backlinks.sourceType, source.type),
        eq(backlinks.sourceId, source.id),
        // Only blow away the kinds we control on this write path.
        inArray(backlinks.kind, ["explicit_link", "frontmatter_related"]),
      ),
    );

  if (edges.length === 0) return;

  await db.insert(backlinks).values(
    edges.map((e) => ({
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      targetType: e.targetType,
      targetId: e.targetId,
      kind: e.kind,
      evidence: e.evidence ?? {},
    })),
  );
}

/**
 * Compute and write explicit + frontmatter edges for a single source entity.
 * Caller provides the body and (optional) frontmatter; we extract, resolve,
 * and persist. Unresolved targets are skipped (we don't store dead-end edges
 * — could relax later if we want to surface "unresolved" link suggestions).
 */
export async function indexEntityLinks(args: {
  orgId: string;
  source: { type: BacklinkEntity; id: string };
  body: string;
  frontmatter?: Record<string, unknown>;
}) {
  const { orgId, source, body, frontmatter } = args;

  const explicit = extractWikilinks(body);
  const frontmatterRelated = frontmatter ? extractFrontmatterRelated(frontmatter) : [];
  const allTitles = Array.from(new Set([...explicit, ...frontmatterRelated]));

  if (allTitles.length === 0) {
    await replaceWriteTimeEdges(source, []);
    return { resolved: 0, unresolved: 0 };
  }

  const resolved = await resolveWikiTitles(orgId, allTitles);
  const edges: EdgeInput[] = [];
  let unresolved = 0;

  for (const title of explicit) {
    const id = resolved.get(title.toLowerCase());
    if (!id) {
      unresolved++;
      continue;
    }
    if (id === source.id && source.type === "wiki_page") continue; // self-link
    edges.push({
      sourceType: source.type,
      sourceId: source.id,
      targetType: "wiki_page",
      targetId: id,
      kind: "explicit_link",
      evidence: { matchedTitle: title },
    });
  }

  for (const title of frontmatterRelated) {
    const id = resolved.get(title.toLowerCase());
    if (!id) {
      unresolved++;
      continue;
    }
    if (id === source.id && source.type === "wiki_page") continue;
    edges.push({
      sourceType: source.type,
      sourceId: source.id,
      targetType: "wiki_page",
      targetId: id,
      kind: "frontmatter_related",
      evidence: { matchedTitle: title },
    });
  }

  // Dedupe — if the same title appears in body AND frontmatter, frontmatter wins.
  const dedupe = new Map<string, EdgeInput>();
  for (const e of edges) {
    const key = `${e.targetType}:${e.targetId}`;
    if (e.kind === "frontmatter_related" || !dedupe.has(key)) {
      dedupe.set(key, e);
    }
  }

  await replaceWriteTimeEdges(source, [...dedupe.values()]);
  return { resolved: dedupe.size, unresolved };
}

/**
 * Reverse-resolve: given an entity, find every wiki_page / item / etc. that
 * has an unresolved title reference matching this entity's title. This is
 * useful when a new wiki page is created — pages that previously had a
 * `[[Future Page]]` reference can now resolve to it. (Phase 4b — for now we
 * skip and just rely on re-indexing on next save.)
 */
export async function findIncomingByTitle(_orgId: string, _title: string) {
  return [];
}
