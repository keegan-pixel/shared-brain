import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { db } from "@/lib/db/client";
import { wikiPages } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";
import { ConnectionsPanel } from "@/components/connections-panel";
import { renderWikilinks } from "@/lib/connections/render-wikilinks";

type Props = { params: Promise<{ id: string }> };

export default async function WikiPage({ params }: Props) {
  const { id } = await params;
  const org = await ensureUserOrg();

  const [page] = await db
    .select()
    .from(wikiPages)
    .where(and(eq(wikiPages.id, id), eq(wikiPages.orgId, org.id)));
  if (!page) notFound();

  const meta = (page.metadata as {
    filePath?: string;
    tags?: string[];
    frontmatter?: Record<string, unknown>;
  } | null) ?? null;

  // Build an Obsidian deep link if we know the source path. Format:
  //   obsidian://open?vault=<vault-name>&file=<vault-relative-path-without-extension>
  const VAULT_NAME = "ViaOps";
  const obsidianHref = meta?.filePath
    ? `obsidian://open?vault=${encodeURIComponent(VAULT_NAME)}&file=${encodeURIComponent(
        meta.filePath.replace(/\.md$/, ""),
      )}`
    : null;

  // Strip Obsidian-style frontmatter if it sneaked into the body — gray-matter
  // already removed it on the way in, but be defensive on legacy rows.
  const stripped = page.content.replace(/^---[\s\S]*?---\s*/m, "");
  // Resolve [[wikilinks]] to real /wiki/[id] links so navigation works inline.
  const body = await renderWikilinks(org.id, stripped);

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-6">
        <div>
          <Link href="/wiki" className="text-xs text-[hsl(var(--muted-foreground))] hover:underline">
            ← Wiki
          </Link>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{page.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
            <span>Updated {new Date(page.updatedAt).toLocaleString()}</span>
            {meta?.filePath && (
              <>
                <span>·</span>
                {obsidianHref ? (
                  <a
                    href={obsidianHref}
                    className="underline-offset-2 hover:text-[hsl(var(--foreground))] hover:underline"
                    title="Open in Obsidian"
                  >
                    {meta.filePath}
                  </a>
                ) : (
                  <span>{meta.filePath}</span>
                )}
              </>
            )}
            {meta?.tags?.map((t) => (
              <span
                key={t}
                className="rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 text-[hsl(var(--muted-foreground))]"
              >
                #{t}
              </span>
            ))}
          </div>
        </div>

        <article className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </article>
      </div>

      <aside className="lg:sticky lg:top-4 lg:self-start">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          Connections
        </h2>
        <ConnectionsPanel type="wiki_page" id={page.id} />
      </aside>
    </div>
  );
}
