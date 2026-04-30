import matter from "gray-matter";

export type ParsedFile = {
  frontmatter: Record<string, unknown>;
  body: string;
  /** Title — frontmatter.title if set, otherwise first H1, otherwise filename. */
  title: string;
  tags: string[];
};

export function parseMarkdown(raw: string, fallbackTitle: string): ParsedFile {
  // gray-matter throws on malformed YAML — fall back to body-only parse so a
  // bad frontmatter block doesn't take out the whole sync run.
  let fm: Record<string, unknown> = {};
  let body: string;
  try {
    const parsed = matter(raw);
    fm = (parsed.data as Record<string, unknown>) ?? {};
    body = parsed.content;
  } catch {
    // Strip the YAML block (best-effort) and continue with the remaining body.
    body = raw.replace(/^---[\s\S]*?---\s*/m, "");
  }

  // fm.title can technically be anything (string, number, object, null) if
  // someone wrote weird YAML. Only treat strings as usable titles.
  const fmTitle = typeof fm.title === "string" ? fm.title.trim() : "";
  let title = fmTitle;
  if (!title) {
    const h1 = body.match(/^#\s+(.+)$/m);
    if (h1) title = h1[1].trim();
  }
  if (!title) title = fallbackTitle;
  // Hard cap — DB column is 240 chars.
  if (title.length > 240) title = title.slice(0, 237) + "...";

  let tags: string[] = [];
  if (Array.isArray(fm.tags)) tags = fm.tags.map(String);
  else if (typeof fm.tags === "string") tags = [fm.tags];

  return { frontmatter: fm, body, title, tags };
}

export type ParsedTask = {
  /** Original line in the source file (1-indexed). Used as the upsert key. */
  line: number;
  status: "completed" | "not_started";
  title: string;
  /** Indented detail lines that follow this task. */
  detail?: string;
};

const TASK_RE = /^\s*-\s+\[( |x|X)\]\s+(.+?)\s*$/;

/**
 * Pull `- [ ]` and `- [x]` checkboxes out of a markdown body. Sub-bullets
 * indented under a task become its `detail`.
 */
export function parseTasks(body: string): ParsedTask[] {
  const lines = body.split("\n");
  const tasks: ParsedTask[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TASK_RE);
    if (!m) continue;
    const [, mark, title] = m;
    const status = mark.toLowerCase() === "x" ? "completed" : "not_started";

    // Capture indented detail lines until the next un-indented or task line.
    const detailLines: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (/^\s*-\s+\[[ xX]\]/.test(next)) break;
      if (next.trim() === "") {
        detailLines.push(next);
        continue;
      }
      if (/^\s+/.test(next)) detailLines.push(next);
      else break;
    }
    const detail = detailLines.join("\n").trim() || undefined;

    // The DB column for item title is varchar(240). Long task lines (e.g.
    // a one-liner that includes the whole description) get truncated; the
    // full text is preserved in `detail`.
    const trimmedTitle =
      title.length > 240 ? title.slice(0, 237) + "..." : title;
    const fullDetail =
      title.length > 240
        ? `${detail ? `${detail}\n\n` : ""}_Original task line:_\n\n${title}`
        : detail;

    tasks.push({ line: i + 1, status, title: trimmedTitle, detail: fullDetail });
  }

  return tasks;
}
