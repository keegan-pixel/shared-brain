/** Per-spec UI guidance: color-code activity rows by the actor agent. */
export function actorBadgeClass(actor: string): string {
  switch (actor) {
    case "claude-mcp":
      return "bg-purple-500/15 text-purple-700 dark:text-purple-300";
    case "vault-sync":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-300";
    case "user":
      return "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300";
    case "claude-desktop":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    case "claude-code":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    case "cowork":
      return "bg-pink-500/15 text-pink-700 dark:text-pink-300";
    default:
      return "bg-slate-500/15 text-slate-700 dark:text-slate-300";
  }
}

/** Map raw action codes to a human label. Keeps the action column scannable. */
export function actionLabel(action: string): string {
  const map: Record<string, string> = {
    sync_wiki_create: "synced wiki page",
    sync_wiki_update: "updated wiki page",
    sync_item_created: "synced item",
    sync_item_updated: "updated item",
    sync_activity: "logged activity",
    sync_space_create: "synced space",
    sync_project_create: "synced project",
    create_space: "created space",
    create_project: "created project",
    create_item: "created item",
    update_item: "updated item",
    move_item_status: "moved item",
    create_wiki_page: "created wiki page",
    update_wiki_page: "updated wiki page",
    add_backlink: "linked entities",
  };
  return map[action] ?? action;
}

export function entityLink(entry: {
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
}): string | null {
  const id = entry.entityId;
  if (!id) return null;
  switch (entry.entityType) {
    case "wiki_page":
      return `/wiki/${id}`;
    case "item": {
      const projectId = (entry.metadata?.projectId as string | undefined) ?? null;
      return projectId ? `/projects/${projectId}` : null;
    }
    case "project":
      return `/projects/${id}`;
    case "space":
      return `/spaces/${id}`;
    default:
      return null;
  }
}

/** Pretty relative time like "3m ago" / "2h ago" / "yesterday" / "2026-04-15". */
export function relativeTime(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return date.toLocaleDateString();
}
