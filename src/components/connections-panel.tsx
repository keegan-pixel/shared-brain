"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ArrowRightLeft, FileText, Hash, Folder, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BacklinkKind } from "@/lib/db/schema";

type Connection = {
  kind: BacklinkKind;
  direction: "outgoing" | "incoming" | "mutual";
  target: { type: string; id: string; title: string; context?: string };
  score?: number;
  evidence?: Record<string, unknown>;
};

const SECTION_META: Partial<
  Record<BacklinkKind, { label: string; icon: React.ComponentType<{ className?: string }>; help: string }>
> = {
  explicit_link: {
    label: "Linked",
    icon: ArrowRightLeft,
    help: "Connected by a [[wikilink]] in body content (in or out)",
  },
  frontmatter_related: {
    label: "Related",
    icon: ArrowRightLeft,
    help: "Connected via the related: field in YAML frontmatter",
  },
  tag_overlap: {
    label: "Shared tags",
    icon: Hash,
    help: "Both pages share at least one tag",
  },
  folder_sibling: {
    label: "Same folder",
    icon: Folder,
    help: "In the same source folder in your vault",
  },
  semantic_similar: {
    label: "Semantically similar",
    icon: Sparkles,
    help: "Embedding similarity (cosine ≥ 0.5) — meaning, not exact words",
  },
};

function DirectionIcon({ d }: { d: Connection["direction"] }) {
  if (d === "outgoing") return <ArrowUpRight className="h-3 w-3 text-[hsl(var(--muted-foreground))]" aria-label="Outgoing" />;
  if (d === "incoming") return <ArrowDownLeft className="h-3 w-3 text-[hsl(var(--muted-foreground))]" aria-label="Incoming" />;
  return null;
}

function targetHref(target: Connection["target"]): string | null {
  if (target.type === "wiki_page") return `/wiki/${target.id}`;
  if (target.type === "project") return `/projects/${target.id}`;
  if (target.type === "space") return `/spaces/${target.id}`;
  return null;
}

function evidenceBadge(c: Connection): string | null {
  if (c.kind === "tag_overlap") {
    const tags = (c.evidence?.sharedTags as string[] | undefined) ?? [];
    if (tags.length === 0) return null;
    return `#${tags.slice(0, 2).join(" #")}${tags.length > 2 ? "…" : ""}`;
  }
  if (c.kind === "semantic_similar" && typeof c.score === "number") {
    return `${Math.round(c.score * 100)}%`;
  }
  return null;
}

export function ConnectionsPanel({
  type,
  id,
}: {
  type: "wiki_page" | "item";
  id: string;
}) {
  const [connections, setConnections] = React.useState<Connection[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/connections?type=${type}&id=${id}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { connections: Connection[] };
        if (!cancelled) setConnections(json.connections);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [type, id]);

  if (error) {
    return (
      <div className="rounded-lg border border-[hsl(var(--border))] p-3 text-xs text-[hsl(var(--muted-foreground))]">
        Failed to load connections: {error}
      </div>
    );
  }
  if (connections === null) {
    return (
      <div className="rounded-lg border border-[hsl(var(--border))] p-3 text-xs text-[hsl(var(--muted-foreground))]">
        Loading connections…
      </div>
    );
  }

  // Group by kind, preserving section order: explicit > frontmatter > tag > folder > semantic
  const order: BacklinkKind[] = [
    "explicit_link",
    "frontmatter_related",
    "tag_overlap",
    "folder_sibling",
    "semantic_similar",
  ];

  const grouped: Partial<Record<BacklinkKind, Connection[]>> = {};
  for (const c of connections) {
    (grouped[c.kind] ??= []).push(c);
  }

  const totalShown = order.reduce((acc, k) => acc + (grouped[k]?.length ?? 0), 0);
  if (totalShown === 0) {
    return (
      <div className="rounded-lg border border-[hsl(var(--border))] p-3 text-xs text-[hsl(var(--muted-foreground))]">
        No connections found yet. Add a <code>[[wikilink]]</code> in another page to connect them, or
        share tags / folders.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {order.map((kind) => {
        const list = grouped[kind];
        if (!list || list.length === 0) return null;
        const meta = SECTION_META[kind];
        if (!meta) return null;
        const Icon = meta.icon;
        return (
          <section
            key={kind}
            className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]/40"
          >
            <header
              className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-3 py-2"
              title={meta.help}
            >
              <Icon className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
              <h3 className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                {meta.label}
              </h3>
              <span className="ml-auto text-[10px] text-[hsl(var(--muted-foreground))]">
                {list.length}
              </span>
            </header>
            <ul className="divide-y divide-[hsl(var(--border))]">
              {list.map((c, idx) => {
                const href = targetHref(c.target);
                const badge = evidenceBadge(c);
                const inner = (
                  <div className="flex items-start gap-2 px-3 py-2">
                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm">
                        <span className="truncate">{c.target.title}</span>
                        <DirectionIcon d={c.direction} />
                      </div>
                      {c.target.context && (
                        <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
                          {c.target.context}
                        </div>
                      )}
                    </div>
                    {badge && (
                      <span className="shrink-0 rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                        {badge}
                      </span>
                    )}
                  </div>
                );
                return (
                  <li key={`${kind}-${idx}`}>
                    {href ? (
                      <Link href={href} className={cn("block hover:bg-[hsl(var(--accent))]")}>
                        {inner}
                      </Link>
                    ) : (
                      <div>{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
