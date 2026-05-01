import path from "node:path";

export type EntityKind =
  | { kind: "wiki"; tags?: string[] }
  | { kind: "client_overview"; clientName: string }
  | { kind: "client_tasks"; clientName: string }
  | { kind: "client_meeting"; clientName: string }
  | { kind: "simhouse_doc" }
  | { kind: "activity_log" }
  | { kind: "file_artifact"; tags?: string[] }
  | { kind: "ignore"; reason: string };

/** Filenames / patterns we never want to sync regardless of folder. */
const JUNK_PATTERNS = [
  /\/\.DS_Store$/,
  /\/\.~lock\./,           // LibreOffice / Word lock files
  /\/~\$/,                  // Office temp files
  /\.tmp$/i,
  /\/\._/,                  // macOS extended attribute resource forks
];

/** Extensions we surface as file artifacts (catalog only — content not embedded). */
const FILE_ARTIFACT_EXTENSIONS = new Set([
  "pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "csv",
  "png", "jpg", "jpeg", "gif", "svg", "webp", "heic",
  "html", "htm",
  "key", "numbers", "pages",
  "zip",
  "py", "js", "ts", "json", "yaml", "yml", "sh",
  "txt",
  "mp3", "wav", "m4a",
  "mp4", "mov", "webm",
]);

function isJunk(p: string): boolean {
  return JUNK_PATTERNS.some((re) => re.test("/" + p));
}

function fileExtension(p: string): string {
  const lastDot = p.lastIndexOf(".");
  if (lastDot < 0) return "";
  return p.slice(lastDot + 1).toLowerCase();
}

/**
 * Map a vault-relative path to its target entity kind. Returns `ignore` for
 * anything we don't recognize.
 *
 * Path conventions documented in `Knowledge/Frameworks/Shared Brain/Vault
 * Reorganization Plan.md` (mirrored to repo `docs/`).
 */
export function mapPath(vaultRelPath: string): EntityKind {
  const p = vaultRelPath.replace(/\\/g, "/");
  if (isJunk(p)) return { kind: "ignore", reason: "junk pattern (lock / DS_Store / temp)" };

  // Markdown files take the rich path. Non-markdown files use the same
  // path-derived tags but route to file_artifact so the sync writes a
  // synthetic wiki entry that says "this is a PDF / xlsx / etc."
  const isMarkdown = p.endsWith(".md");
  const ext = fileExtension(p);
  if (!isMarkdown && !FILE_ARTIFACT_EXTENSIONS.has(ext)) {
    return { kind: "ignore", reason: `unsupported file type: .${ext || "(no ext)"}` };
  }

  // Helper — pick the right kind given the markdown-ness of the path.
  const wikiOrFile = (tags: string[] | undefined): EntityKind =>
    isMarkdown ? { kind: "wiki", tags } : { kind: "file_artifact", tags };

  // ─── Knowledge ─────────────────────────────────────────────────────────
  if (p.startsWith("Knowledge/")) return wikiOrFile(undefined);

  // ─── Pipeline ──────────────────────────────────────────────────────────
  if (p.startsWith("Pipeline/")) return wikiOrFile(["pipeline", "contact"]);

  // ─── Partners ──────────────────────────────────────────────────────────
  if (p.startsWith("Partners/")) return wikiOrFile(["partner"]);

  // ─── LinkedIn (content & thought leadership) ───────────────────────────
  if (p.startsWith("LinkedIn/")) {
    const segs = p.split("/");
    const category = segs.length >= 3 ? segs[1].toLowerCase().replace(/[^a-z0-9]+/g, "-") : null;
    const tags = ["linkedin", "thought-leadership"];
    if (category) tags.push(category);
    return wikiOrFile(tags);
  }

  // ─── Website summary docs ──────────────────────────────────────────────
  if (p.startsWith("Website/")) return wikiOrFile(["website", "viaops-internal"]);

  // ─── Coaching ──────────────────────────────────────────────────────────
  if (p.startsWith("Coaching/")) {
    const segs = p.split("/");
    if (segs[1] === "Clients" && segs.length >= 4) {
      const clientSlug = segs[2].toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return wikiOrFile(["coaching", "coaching-client", clientSlug]);
    }
    if (segs[1] === "Concepts") return wikiOrFile(["coaching", "concept"]);
    if (segs[1] === "Resources") return wikiOrFile(["coaching", "resource"]);
    return wikiOrFile(["coaching"]);
  }

  // ─── Clients ───────────────────────────────────────────────────────────
  // Clients/[Name]/_Overview.md    → ensure space + wiki page
  // Clients/[Name]/_Tasks.md       → tasks (parsed from [ ] / [x])
  // Clients/[Name]/Meetings/<x>    → wiki page or file_artifact tagged "meeting" + client
  // Clients/[Name]/<other>         → wiki page or file_artifact tagged with client name
  if (p.startsWith("Clients/")) {
    const segs = p.split("/");
    if (segs.length < 3) return { kind: "ignore", reason: "Clients/ root file" };
    const clientName = segs[1];
    const rest = segs.slice(2).join("/");
    const clientSlug = clientName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (isMarkdown) {
      if (rest === "_Overview.md") return { kind: "client_overview", clientName };
      if (rest === "_Tasks.md") return { kind: "client_tasks", clientName };
    }
    if (rest.startsWith("Meetings/")) {
      return wikiOrFile(["meeting", "client-meeting", clientSlug]);
    }
    return wikiOrFile(["client-context", clientSlug]);
  }

  // ─── SimHouse ──────────────────────────────────────────────────────────
  if (p.startsWith("SimHouse.io/")) {
    return isMarkdown ? { kind: "simhouse_doc" } : { kind: "file_artifact", tags: ["simhouse"] };
  }

  // ─── Meetings (top-level) ──────────────────────────────────────────────
  if (p.startsWith("Meetings/")) return wikiOrFile(["meeting"]);

  return { kind: "ignore", reason: "no mapping rule" };
}

/** Used as fallback title when frontmatter and H1 are both missing. */
export function fallbackTitleFromPath(p: string): string {
  return path.basename(p).replace(/\.md$/, "");
}
