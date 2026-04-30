import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { BookOpen, ChevronRight, FileText, FolderOpen } from "lucide-react";
import { db } from "@/lib/db/client";
import { wikiPages } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";

type PageRow = {
  id: string;
  title: string;
  filePath: string | null;
  updatedAt: Date;
};

type TreeNode = {
  /** Display label for this folder. Empty string for the (synthetic) root. */
  name: string;
  /** Full path for this folder, e.g. "Knowledge/Frameworks/Shared Brain". */
  path: string;
  children: Map<string, TreeNode>;
  pages: PageRow[];
};

function buildTree(rows: PageRow[]): { tree: TreeNode; orphans: PageRow[] } {
  const root: TreeNode = { name: "", path: "", children: new Map(), pages: [] };
  const orphans: PageRow[] = [];

  for (const row of rows) {
    if (!row.filePath) {
      orphans.push(row);
      continue;
    }
    const segments = row.filePath.split("/");
    const folders = segments.slice(0, -1);
    let cursor = root;
    let acc = "";
    for (const seg of folders) {
      acc = acc ? `${acc}/${seg}` : seg;
      let next = cursor.children.get(seg);
      if (!next) {
        next = { name: seg, path: acc, children: new Map(), pages: [] };
        cursor.children.set(seg, next);
      }
      cursor = next;
    }
    cursor.pages.push(row);
  }

  // Sort pages alphabetically inside every folder.
  function sort(node: TreeNode) {
    node.pages.sort((a, b) => a.title.localeCompare(b.title));
    for (const child of node.children.values()) sort(child);
  }
  sort(root);
  orphans.sort((a, b) => a.title.localeCompare(b.title));

  return { tree: root, orphans };
}

function FolderBlock({ node, depth }: { node: TreeNode; depth: number }) {
  const childFolders = Array.from(node.children.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return (
    <details open={depth < 2} className="group/folder">
      <summary
        className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm font-medium hover:bg-[hsl(var(--accent))]"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <ChevronRight className="tree-chevron h-3.5 w-3.5 shrink-0 transition-transform" />
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
        <span>{node.name}</span>
        <span className="ml-auto text-xs text-[hsl(var(--muted-foreground))]">
          {countPagesDeep(node)}
        </span>
      </summary>
      <ul>
        {node.pages.map((p) => (
          <li key={p.id}>
            <Link
              href={`/wiki/${p.id}`}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-[hsl(var(--accent))]"
              style={{ paddingLeft: `${(depth + 1) * 16 + 16}px` }}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
              <span className="truncate">{p.title}</span>
            </Link>
          </li>
        ))}
        {childFolders.map((child) => (
          <li key={child.path}>
            <FolderBlock node={child} depth={depth + 1} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function countPagesDeep(node: TreeNode): number {
  let n = node.pages.length;
  for (const child of node.children.values()) n += countPagesDeep(child);
  return n;
}

export default async function WikiIndex() {
  const org = await ensureUserOrg();
  const rows = await db
    .select({
      id: wikiPages.id,
      title: wikiPages.title,
      updatedAt: wikiPages.updatedAt,
      metadata: wikiPages.metadata,
    })
    .from(wikiPages)
    .where(eq(wikiPages.orgId, org.id))
    .orderBy(desc(wikiPages.updatedAt));

  const pageRows: PageRow[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    updatedAt: r.updatedAt,
    filePath: (r.metadata as { filePath?: string } | null)?.filePath ?? null,
  }));

  const { tree, orphans } = buildTree(pageRows);
  const topLevelFolders = Array.from(tree.children.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            <h1 className="text-2xl font-semibold">Wiki</h1>
          </div>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Pages mirrored from your Obsidian vault, grouped by source folder. Phase 4 will add
            backlinks, AI suggestions, and a richer hierarchy strategy.
          </p>
        </div>
        <span className="text-xs text-[hsl(var(--muted-foreground))]">
          {pageRows.length} page{pageRows.length === 1 ? "" : "s"}
        </span>
      </div>

      {pageRows.length === 0 ? (
        <div className="rounded-lg border border-[hsl(var(--border))] p-6 text-sm text-[hsl(var(--muted-foreground))]">
          No wiki pages yet. Run the vault sync agent or call <code>create_wiki_page</code> from
          Claude.
        </div>
      ) : (
        <div className="rounded-lg border border-[hsl(var(--border))] py-2">
          {topLevelFolders.map((node) => (
            <FolderBlock key={node.path} node={node} depth={0} />
          ))}

          {orphans.length > 0 && (
            <details open className="group/folder">
              <summary className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm font-medium hover:bg-[hsl(var(--accent))]">
                <ChevronRight className="tree-chevron h-3.5 w-3.5 shrink-0 transition-transform" />
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                <span>Created in platform</span>
                <span className="ml-auto text-xs text-[hsl(var(--muted-foreground))]">
                  {orphans.length}
                </span>
              </summary>
              <ul>
                {orphans.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/wiki/${p.id}`}
                      className="flex items-center gap-1.5 rounded px-6 py-1 text-sm hover:bg-[hsl(var(--accent))]"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                      <span className="truncate">{p.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
