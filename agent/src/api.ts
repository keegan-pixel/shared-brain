import type { SyncConfig } from "./config.ts";

type ApiOpts = {
  method?: "GET" | "POST";
  body?: unknown;
};

export class ApiClient {
  constructor(private cfg: SyncConfig) {}

  private async req<T>(path: string, opts: ApiOpts = {}): Promise<T> {
    const url = `${this.cfg.apiBase}${path}`;
    const res = await fetch(url, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        "content-type": "application/json",
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} on ${path}: ${text.slice(0, 500)}`);
    }
    return text ? (JSON.parse(text) as T) : ({} as T);
  }

  syncWiki(input: {
    filePath: string;
    title: string;
    content: string;
    contentHash: string;
    frontmatter?: Record<string, unknown>;
    tags?: string[];
  }) {
    return this.req<{ ok: boolean; pageId?: string; skipped?: boolean; action?: string }>(
      "/api/sync/wiki",
      { body: input },
    );
  }

  syncSpace(input: { name: string; type: "client" | "dept" | "team" }) {
    return this.req<{ space: { id: string; name: string }; created: boolean }>(
      "/api/sync/space",
      { body: input },
    );
  }

  syncProject(input: { spaceId: string; name: string; description?: string }) {
    return this.req<{ project: { id: string; name: string }; created: boolean }>(
      "/api/sync/project",
      { body: input },
    );
  }

  syncItem(input: {
    projectId: string;
    filePath: string;
    lineKey: string;
    title: string;
    type?: "task" | "note" | "file" | "decision";
    status: "backlog" | "not_started" | "research_planning" | "in_progress" | "review" | "completed";
    content?: string;
  }) {
    return this.req<{ ok: boolean; itemId: string; action: "created" | "updated" }>(
      "/api/sync/item",
      { body: input },
    );
  }

  syncActivity(input: { filePath: string; contentHash: string; summary: string; body?: string }) {
    return this.req<{ ok: boolean; skipped?: boolean }>("/api/sync/activity", { body: input });
  }

  reportError(input: { filePath: string; contentHash: string; errorMessage: string }) {
    return this.req<{ ok: boolean }>("/api/sync/log", { body: input });
  }
}
