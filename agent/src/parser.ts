import matter from "gray-matter";

export type ParsedFile = {
  frontmatter: Record<string, unknown>;
  body: string;
  /** Title — frontmatter.title if set, otherwise first H1, otherwise filename. */
  title: string;
  tags: string[];
};

export function parseMarkdown(raw: string, fallbackTitle: string): ParsedFile {
  const parsed = matter(raw);
  const fm = parsed.data as Record<string, unknown>;
  const body = parsed.content;

  let title = (fm.title as string | undefined)?.trim() || "";
  if (!title) {
    const h1 = body.match(/^#\s+(.+)$/m);
    if (h1) title = h1[1].trim();
  }
  if (!title) title = fallbackTitle;

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

    tasks.push({ line: i + 1, status, title, detail });
  }

  return tasks;
}
