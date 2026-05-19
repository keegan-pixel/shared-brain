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
    /** Vercel Blob URL when the source is a non-markdown file. */
    blobUrl?: string;
    /** Plain text pulled out of binary files (PDF, DOCX, XLSX, etc.). */
    extractedText?: string;
    /** Word count of extractedText — surfaced in the wiki page metadata. */
    extractedWordCount?: number;
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

  /**
   * MF-17 — daemon reports its current config to the platform so
   * `/settings/daemon` UI reflects what the daemon is actually watching.
   * Idempotent: replaces existing org.vault_paths each call.
   */
  reportConfig(input: { vaultPaths: string[]; vaultName?: string | null }) {
    return this.req<{ ok: boolean; vault_paths: string[]; vault_name: string | null }>(
      "/api/daemon/config",
      { body: input },
    );
  }

  /**
   * MF-21 — daemon reports its previous-instance crash log on startup
   * so we never have to ask the user for /tmp/shared-brain-sync.*.err.
   * Server stores in activity_feed with action='daemon_crash_report'.
   */
  reportCrash(input: {
    errLog: string;
    stdoutLog?: string;
    detectedAt?: string;
    errMtime?: string;
    daemonVersion?: string;
  }) {
    return this.req<{ ok: boolean; recorded: boolean; reason?: string }>(
      "/api/daemon/crash-report",
      { body: input },
    );
  }

  /**
   * Phase F4d — pull wiki pages updated on the platform since `since`,
   * for the local agent to materialize as markdown files in the vault.
   * `since` may be omitted for the agent's first-ever pull (defaults to
   * 30 days ago server-side).
   */
  pull(input: { since?: string }) {
    const qs = input.since ? `?since=${encodeURIComponent(input.since)}` : "";
    return this.req<{
      pulled_at: string;
      since: string;
      cursor: string;
      page_count: number;
      pages: Array<{
        id: string;
        filePath: string;
        title: string;
        body: string;
        contentHash: string;
        updatedAt: string;
        hasExistingLog: boolean;
      }>;
    }>(`/api/sync/pull${qs}`, { method: "GET" });
  }
}
