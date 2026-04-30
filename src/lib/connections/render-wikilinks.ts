import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { wikiPages } from "@/lib/db/schema";

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;

/**
 * Replace [[Page Title]] / [[Page Title|alias]] tokens with real markdown
 * links if a wiki page with that title exists in the org. Unresolved links
 * become a styled span ("(unresolved)") so the reader knows they don't
 * navigate anywhere yet.
 */
export async function renderWikilinks(orgId: string, body: string): Promise<string> {
  if (!body.includes("[[")) return body;

  const titles = new Set<string>();
  for (const m of body.matchAll(WIKILINK_RE)) titles.add(m[1].trim());
  if (titles.size === 0) return body;

  // Fetch every wiki page in the org once and build candidate keys per page:
  // title, filename basename (no .md), and full path (no .md). Obsidian-style
  // [[Page]] usually refers to the basename, not the H1 title.
  const rows = await db
    .select({ id: wikiPages.id, title: wikiPages.title, metadata: wikiPages.metadata })
    .from(wikiPages)
    .where(eq(wikiPages.orgId, orgId));
  const lookup = new Map<string, string>();
  for (const r of rows) {
    const meta = (r.metadata as { filePath?: string } | null) ?? null;
    const keys = new Set<string>([r.title.toLowerCase()]);
    if (meta?.filePath) {
      const noExt = meta.filePath.replace(/\.md$/i, "");
      const base = noExt.split("/").pop() ?? noExt;
      keys.add(noExt.toLowerCase());
      keys.add(base.toLowerCase());
    }
    for (const k of keys) {
      if (!lookup.has(k)) lookup.set(k, r.id);
    }
  }

  return body.replace(WIKILINK_RE, (full, title: string, alias?: string) => {
    const t = title.trim();
    const display = (alias ?? t).trim();
    const id = lookup.get(t.toLowerCase());
    if (id) return `[${display}](/wiki/${id})`;
    // Unresolved: render as a styled span so reader notices but the link
    // doesn't go to a 404. Using HTML directly because react-markdown will
    // escape inline HTML by default — wrap in code/strong instead.
    return `*${display}* ⟂`;
  });
}
