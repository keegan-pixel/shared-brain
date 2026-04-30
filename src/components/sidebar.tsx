import Link from "next/link";
import { BookOpen, FolderKanban, Home } from "lucide-react";
import { db } from "@/lib/db/client";
import { spaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ensureUserOrg } from "@/lib/org";

export async function Sidebar() {
  const org = await ensureUserOrg();
  const orgSpaces = await db
    .select({ id: spaces.id, name: spaces.name })
    .from(spaces)
    .where(eq(spaces.orgId, org.id))
    .orderBy(spaces.name);

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--background))]">
      <div className="flex h-14 items-center border-b border-[hsl(var(--border))] px-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="h-6 w-6 rounded bg-[hsl(var(--primary))]" />
          <span className="font-semibold">{org.name}</span>
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 text-sm">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[hsl(var(--accent))]"
        >
          <Home className="h-4 w-4" /> Home
        </Link>
        <div className="mt-4 px-2 text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          Spaces
        </div>
        <ul className="mt-1 space-y-px">
          {orgSpaces.length === 0 ? (
            <li className="px-2 py-1 text-xs text-[hsl(var(--muted-foreground))]">No spaces yet</li>
          ) : (
            orgSpaces.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/spaces/${s.id}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[hsl(var(--accent))]"
                >
                  <FolderKanban className="h-4 w-4" /> {s.name}
                </Link>
              </li>
            ))
          )}
        </ul>
        <div className="mt-4 px-2 text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          Knowledge
        </div>
        <Link
          href="/wiki"
          className="mt-1 flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[hsl(var(--accent))]"
        >
          <BookOpen className="h-4 w-4" /> Wiki
        </Link>
      </nav>
    </aside>
  );
}
