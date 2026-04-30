import path from "node:path";

export type EntityKind =
  | { kind: "wiki"; tags?: string[] }
  | { kind: "client_overview"; clientName: string }
  | { kind: "client_tasks"; clientName: string }
  | { kind: "client_meeting"; clientName: string }
  | { kind: "simhouse_doc" }
  | { kind: "activity_log" }
  | { kind: "ignore"; reason: string };

/**
 * Map a vault-relative path to its target entity kind. Returns `ignore` for
 * anything we don't recognize — better to ignore than to dump everything.
 */
export function mapPath(vaultRelPath: string): EntityKind {
  // Normalize slashes for matching.
  const p = vaultRelPath.replace(/\\/g, "/");

  if (!p.endsWith(".md")) return { kind: "ignore", reason: "not a markdown file" };

  // Knowledge/**/*.md → wiki
  if (p.startsWith("Knowledge/")) return { kind: "wiki" };

  // Pipeline/*.md → wiki tagged "pipeline"
  if (p.startsWith("Pipeline/")) return { kind: "wiki", tags: ["pipeline"] };

  // Clients/[Name]/...
  if (p.startsWith("Clients/")) {
    const segs = p.split("/");
    if (segs.length < 3) return { kind: "ignore", reason: "Clients/ root file" };
    const clientName = segs[1];
    const rest = segs.slice(2).join("/");
    if (rest === "_Overview.md") return { kind: "client_overview", clientName };
    if (rest === "_Tasks.md") return { kind: "client_tasks", clientName };
    if (rest.startsWith("Meetings/")) return { kind: "client_meeting", clientName };
    return { kind: "ignore", reason: `Clients/${clientName} non-mapped file: ${rest}` };
  }

  // SimHouse.io space
  if (p.startsWith("SimHouse.io/")) return { kind: "simhouse_doc" };

  // Activity logs
  if (p.startsWith("Meetings/")) return { kind: "activity_log" };
  if (p.startsWith("Dashboard/Daily Notes/")) return { kind: "activity_log" };

  return { kind: "ignore", reason: "no mapping rule" };
}

/** Used as fallback title when frontmatter and H1 are both missing. */
export function fallbackTitleFromPath(p: string): string {
  return path.basename(p).replace(/\.md$/, "");
}
