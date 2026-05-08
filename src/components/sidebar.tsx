"use client";

import Link from "next/link";
import { Activity, BookOpen, FolderKanban, Home, RefreshCw, HeartPulse } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SidebarOrg, SidebarSpace } from "@/components/sidebar-data";

type SidebarProps = {
  org: SidebarOrg;
  spaces: SidebarSpace[];
  className?: string;
  onNavigate?: () => void;
};

export function Sidebar({ org, spaces: orgSpaces, className, onNavigate }: SidebarProps) {
  const linkClass =
    "flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[hsl(var(--accent))]";
  return (
    <aside
      className={cn(
        "flex h-full w-60 shrink-0 flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--background))]",
        className,
      )}
    >
      <div className="flex h-14 items-center border-b border-[hsl(var(--border))] px-4">
        <Link href="/" onClick={onNavigate} className="flex items-center gap-2">
          <div className="h-6 w-6 rounded bg-[hsl(var(--primary))]" />
          <span className="font-semibold">{org.name}</span>
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 text-sm">
        <Link href="/" onClick={onNavigate} className={linkClass}>
          <Home className="h-4 w-4" /> Home
        </Link>
        <Link href="/activity" onClick={onNavigate} className={linkClass}>
          <Activity className="h-4 w-4" /> Activity
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
                <Link href={`/spaces/${s.id}`} onClick={onNavigate} className={linkClass}>
                  <FolderKanban className="h-4 w-4" /> {s.name}
                </Link>
              </li>
            ))
          )}
        </ul>
        <div className="mt-4 px-2 text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          Knowledge
        </div>
        <Link href="/wiki" onClick={onNavigate} className={cn("mt-1", linkClass)}>
          <BookOpen className="h-4 w-4" /> Wiki
        </Link>
        <div className="mt-4 px-2 text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          Settings
        </div>
        <Link href="/settings/sync" onClick={onNavigate} className={cn("mt-1", linkClass)}>
          <RefreshCw className="h-4 w-4" /> Sync
        </Link>
        <Link href="/status" onClick={onNavigate} className={cn("mt-1", linkClass)}>
          <HeartPulse className="h-4 w-4" /> Status
        </Link>
      </nav>
    </aside>
  );
}
