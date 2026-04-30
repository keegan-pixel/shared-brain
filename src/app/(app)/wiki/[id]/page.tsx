import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { db } from "@/lib/db/client";
import { wikiPages } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";

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

  // Strip Obsidian-style frontmatter if it sneaked into the body — gray-matter
  // already removed it on the way in, but be defensive on legacy rows.
  const body = page.content.replace(/^---[\s\S]*?---\s*/m, "");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/wiki" className="text-xs text-[hsl(var(--muted-foreground))] hover:underline">
          ← Wiki
        </Link>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{page.title}</h1>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted-foreground))]">
          <span>Updated {new Date(page.updatedAt).toLocaleString()}</span>
          {meta?.filePath && <span>· {meta.filePath}</span>}
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
  );
}
