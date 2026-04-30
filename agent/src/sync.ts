import fs from "node:fs/promises";
import path from "node:path";
import { ApiClient } from "./api.ts";
import type { SyncConfig } from "./config.ts";
import { relPath } from "./config.ts";
import { sha1 } from "./hash.ts";
import { fallbackTitleFromPath, mapPath } from "./mapper.ts";
import { parseMarkdown, parseTasks } from "./parser.ts";

type ClientCacheEntry = { spaceId: string; defaultProjectId: string };
const clientCache = new Map<string, ClientCacheEntry>();

export type SyncResult =
  | { ok: true; action: "created" | "updated" | "skipped" | "ignored"; reason?: string }
  | { ok: false; error: string };

/**
 * Sync one file. Idempotent: re-syncing the same file is a no-op unless
 * content changed. Errors are caught and reported via /api/sync/log.
 */
export async function syncOne(
  absPath: string,
  cfg: SyncConfig,
  api: ApiClient,
  opts: { dryRun?: boolean } = {},
): Promise<SyncResult> {
  const relative = relPath(absPath, cfg.vaultRoot);

  // Ignore checks — both ignore prefixes and unmapped paths.
  for (const ig of cfg.ignorePrefixes) {
    if (relative === ig || relative.startsWith(`${ig}/`)) {
      return { ok: true, action: "ignored", reason: `ignore prefix: ${ig}` };
    }
  }
  if (!cfg.includePrefixes.some((p) => relative === p || relative.startsWith(`${p}/`))) {
    return { ok: true, action: "ignored", reason: "outside include prefixes" };
  }
  const mapping = mapPath(relative);
  if (mapping.kind === "ignore") {
    return { ok: true, action: "ignored", reason: mapping.reason };
  }

  let raw: string;
  try {
    raw = await fs.readFile(absPath, "utf8");
  } catch (err) {
    return { ok: false, error: `read failed: ${(err as Error).message}` };
  }
  const hash = sha1(raw);

  if (opts.dryRun) {
    return { ok: true, action: "updated", reason: `[dry-run] ${mapping.kind}` };
  }

  try {
    switch (mapping.kind) {
      case "wiki":
      case "simhouse_doc": {
        const parsed = parseMarkdown(raw, fallbackTitleFromPath(relative));
        const tags = mapping.kind === "wiki" && mapping.tags ? mapping.tags : parsed.tags;
        const res = await api.syncWiki({
          filePath: relative,
          title: parsed.title,
          content: parsed.body,
          contentHash: hash,
          frontmatter: parsed.frontmatter,
          tags,
        });
        return { ok: true, action: res.skipped ? "skipped" : (res.action as "created" | "updated") };
      }

      case "client_overview": {
        const parsed = parseMarkdown(raw, mapping.clientName);
        // 1) Ensure space + default project exist (cache after first hit).
        const cache = await ensureClient(api, mapping.clientName);
        // 2) Sync the file as a wiki page tagged with the client name.
        const res = await api.syncWiki({
          filePath: relative,
          title: parsed.title,
          content: parsed.body,
          contentHash: hash,
          frontmatter: parsed.frontmatter,
          tags: [...parsed.tags, "client-overview", mapping.clientName.toLowerCase()],
        });
        // 3) Update activity feed (handled by syncWiki internally; nothing more to do).
        void cache;
        return { ok: true, action: res.skipped ? "skipped" : (res.action as "created" | "updated") };
      }

      case "client_tasks": {
        const cache = await ensureClient(api, mapping.clientName);
        const parsed = parseMarkdown(raw, `${mapping.clientName} Tasks`);
        const tasks = parseTasks(parsed.body);
        let created = 0;
        let updated = 0;
        for (const task of tasks) {
          const res = await api.syncItem({
            projectId: cache.defaultProjectId,
            filePath: relative,
            lineKey: String(task.line),
            title: task.title,
            type: "task",
            status: task.status,
            content: task.detail,
          });
          if (res.action === "created") created++;
          else updated++;
        }
        return {
          ok: true,
          action: tasks.length === 0 ? "skipped" : "updated",
          reason: `${created} created, ${updated} updated, ${tasks.length} total`,
        };
      }

      case "client_meeting": {
        const parsed = parseMarkdown(raw, fallbackTitleFromPath(relative));
        await api.syncActivity({
          filePath: relative,
          contentHash: hash,
          summary: `${mapping.clientName} meeting: ${parsed.title}`,
          body: parsed.body.slice(0, 4000),
        });
        return { ok: true, action: "updated" };
      }

      case "activity_log": {
        const parsed = parseMarkdown(raw, fallbackTitleFromPath(relative));
        const res = await api.syncActivity({
          filePath: relative,
          contentHash: hash,
          summary: parsed.title,
          body: parsed.body.slice(0, 4000),
        });
        return { ok: true, action: res.skipped ? "skipped" : "updated" };
      }
    }
  } catch (err) {
    const msg = (err as Error).message;
    // Best-effort error reporting; if the error endpoint also fails, swallow.
    api.reportError({ filePath: relative, contentHash: hash, errorMessage: msg }).catch(() => {});
    return { ok: false, error: msg };
  }
}

async function ensureClient(api: ApiClient, clientName: string): Promise<ClientCacheEntry> {
  const cached = clientCache.get(clientName);
  if (cached) return cached;
  const space = await api.syncSpace({ name: clientName, type: "client" });
  const project = await api.syncProject({ spaceId: space.space.id, name: "General" });
  const entry: ClientCacheEntry = { spaceId: space.space.id, defaultProjectId: project.project.id };
  clientCache.set(clientName, entry);
  return entry;
}

export async function walkVault(cfg: SyncConfig): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = relPath(abs, cfg.vaultRoot);
      if (cfg.ignorePrefixes.some((p) => rel === p || rel.startsWith(`${p}/`))) continue;
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(abs);
      }
    }
  }
  for (const inc of cfg.includePrefixes) {
    await walk(path.join(cfg.vaultRoot, inc));
  }
  return out;
}
