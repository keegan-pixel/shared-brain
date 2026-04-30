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
 *
 * Path conventions documented in `Knowledge/Frameworks/Shared Brain/Vault
 * Reorganization Plan.md` (mirrored to repo `docs/`).
 */
export function mapPath(vaultRelPath: string): EntityKind {
  const p = vaultRelPath.replace(/\\/g, "/");
  if (!p.endsWith(".md")) return { kind: "ignore", reason: "not a markdown file" };

  // ─── Knowledge ─────────────────────────────────────────────────────────
  if (p.startsWith("Knowledge/")) return { kind: "wiki" };

  // ─── Pipeline ──────────────────────────────────────────────────────────
  if (p.startsWith("Pipeline/")) {
    // Pipeline can have files at root (Beth Lazar.md) or folders for richer
    // contacts (Pipeline/Kyle LaMar/Kyle LaMar — ...md). Both are wiki pages.
    return { kind: "wiki", tags: ["pipeline", "contact"] };
  }

  // ─── Partners ──────────────────────────────────────────────────────────
  if (p.startsWith("Partners/")) {
    return { kind: "wiki", tags: ["partner"] };
  }

  // ─── LinkedIn (content & thought leadership) ───────────────────────────
  if (p.startsWith("LinkedIn/")) {
    const segs = p.split("/");
    // Tag with the category folder if present (e.g. "AI Strategy & Implementation").
    const category = segs.length >= 3 ? segs[1].toLowerCase().replace(/[^a-z0-9]+/g, "-") : null;
    const tags = ["linkedin", "thought-leadership"];
    if (category) tags.push(category);
    return { kind: "wiki", tags };
  }

  // ─── Website summary docs ──────────────────────────────────────────────
  if (p.startsWith("Website/")) {
    return { kind: "wiki", tags: ["website", "viaops-internal"] };
  }

  // ─── Coaching ──────────────────────────────────────────────────────────
  // Coaching/Clients/<Name>/...    → wiki tagged "coaching" + client name
  // Coaching/Concepts/*.md         → wiki tagged "coaching", "concept"
  // Coaching/Resources/*.md        → wiki tagged "coaching", "resource"
  // Coaching/_README.md or other   → wiki tagged "coaching"
  if (p.startsWith("Coaching/")) {
    const segs = p.split("/");
    if (segs[1] === "Clients" && segs.length >= 4) {
      const clientSlug = segs[2].toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return { kind: "wiki", tags: ["coaching", "coaching-client", clientSlug] };
    }
    if (segs[1] === "Concepts") return { kind: "wiki", tags: ["coaching", "concept"] };
    if (segs[1] === "Resources") return { kind: "wiki", tags: ["coaching", "resource"] };
    return { kind: "wiki", tags: ["coaching"] };
  }

  // ─── Clients ───────────────────────────────────────────────────────────
  // Clients/[Name]/_Overview.md    → ensure space + wiki page
  // Clients/[Name]/_Tasks.md       → tasks (parsed from [ ] / [x])
  // Clients/[Name]/Meetings/*.md   → wiki page tagged "meeting" + client
  //                                  (was activity-only; switched to wiki so
  //                                  [[wikilinks]] from other pages resolve)
  // Clients/[Name]/<other>.md      → wiki tagged with client name
  if (p.startsWith("Clients/")) {
    const segs = p.split("/");
    if (segs.length < 3) return { kind: "ignore", reason: "Clients/ root file" };
    const clientName = segs[1];
    const rest = segs.slice(2).join("/");
    if (rest === "_Overview.md") return { kind: "client_overview", clientName };
    if (rest === "_Tasks.md") return { kind: "client_tasks", clientName };
    const clientSlug = clientName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (rest.startsWith("Meetings/")) {
      return { kind: "wiki", tags: ["meeting", "client-meeting", clientSlug] };
    }
    return { kind: "wiki", tags: ["client-context", clientSlug] };
  }

  // ─── SimHouse ──────────────────────────────────────────────────────────
  if (p.startsWith("SimHouse.io/")) return { kind: "simhouse_doc" };

  // ─── Meetings (top-level) ──────────────────────────────────────────────
  // Wiki pages tagged "meeting" so [[wikilinks]] resolve from anywhere.
  if (p.startsWith("Meetings/")) return { kind: "wiki", tags: ["meeting"] };

  return { kind: "ignore", reason: "no mapping rule" };
}

/** Used as fallback title when frontmatter and H1 are both missing. */
export function fallbackTitleFromPath(p: string): string {
  return path.basename(p).replace(/\.md$/, "");
}
