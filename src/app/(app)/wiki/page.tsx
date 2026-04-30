import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { BookOpen, FileText } from "lucide-react";
import { db } from "@/lib/db/client";
import { wikiPages } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";

export default async function WikiIndex() {
  const org = await ensureUserOrg();
  const pages = await db
    .select({
      id: wikiPages.id,
      title: wikiPages.title,
      content: wikiPages.content,
      updatedAt: wikiPages.updatedAt,
      metadata: wikiPages.metadata,
    })
    .from(wikiPages)
    .where(eq(wikiPages.orgId, org.id))
    .orderBy(desc(wikiPages.updatedAt));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            <h1 className="text-2xl font-semibold">Wiki</h1>
          </div>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Pages mirrored from your Obsidian vault. Phase 4 will replace this with directory
            navigation and live backlinks.
          </p>
        </div>
        <span className="text-xs text-[hsl(var(--muted-foreground))]">
          {pages.length} page{pages.length === 1 ? "" : "s"}
        </span>
      </div>

      {pages.length === 0 ? (
        <div className="rounded-lg border border-[hsl(var(--border))] p-6 text-sm text-[hsl(var(--muted-foreground))]">
          No wiki pages yet. Run the vault sync agent or call <code>create_wiki_page</code> from
          Claude.
        </div>
      ) : (
        <ul className="divide-y divide-[hsl(var(--border))] rounded-lg border border-[hsl(var(--border))]">
          {pages.map((p) => {
            const filePath = (p.metadata as { filePath?: string } | null)?.filePath;
            const snippet = p.content
              .replace(/^---[\s\S]*?---\s*/m, "")
              .replace(/^#+\s+.*$/m, "")
              .trim()
              .slice(0, 220);
            return (
              <li key={p.id}>
                <Link
                  href={`/wiki/${p.id}`}
                  className="block px-4 py-3 hover:bg-[hsl(var(--accent))]"
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <div className="flex items-center gap-2 font-medium">
                      <FileText className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                      {p.title}
                    </div>
                    <span className="shrink-0 text-xs text-[hsl(var(--muted-foreground))]">
                      {new Date(p.updatedAt).toLocaleString()}
                    </span>
                  </div>
                  {filePath && (
                    <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                      {filePath}
                    </div>
                  )}
                  {snippet && (
                    <p className="mt-1 line-clamp-2 text-sm text-[hsl(var(--muted-foreground))]">
                      {snippet}…
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
