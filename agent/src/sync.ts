import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { ApiClient } from "./api.ts";
import { isBlobConfigured, uploadFileToBlob } from "./blob.ts";
import type { SyncConfig } from "./config.ts";
import { relPath } from "./config.ts";
import { extractText } from "./extract.ts";
import { sha1 } from "./hash.ts";
import { fallbackTitleFromPath, mapPath } from "./mapper.ts";
import { parseMarkdown, parseTasks } from "./parser.ts";

type ClientCacheEntry = { spaceId: string; defaultProjectId: string };
const clientCache = new Map<string, ClientCacheEntry>();

/**
 * Persistent dedup map.
 *
 * Maps absolute file path → last successfully-synced hash. Survives
 * daemon restarts via on-disk JSON cache.
 *
 * Cloud-sync apps (Google Drive, Dropbox, iCloud) periodically TOUCH
 * files (metadata updates, sync-state changes) even when content
 * hasn't changed. chokidar fires a `change` event for each touch.
 * Without this map, we'd POST to /api/sync/wiki for every touch.
 *
 * MF-16 (2026-05-15) introduced this map in-memory only. The flaw:
 * launchd `KeepAlive: true` auto-restarts the daemon on any exit
 * (OOM, crash, sleep/wake, network error). Each restart wiped the
 * map, triggering a fresh full-scan POST-burst against the empty
 * map even though the server already had v5 hashes. With Richard's
 * ~3,800 files × ~3 restarts/day, that's ~11k POSTs/day in pure
 * dedup-skipped restart-bursts.
 *
 * MF-19 (2026-05-16) persists the map to disk after every successful
 * push and loads it on daemon startup. Restart → empty restart burst.
 * Steady state stays steady.
 *
 * Storage: ~/.shared-brain-sync/dedup-cache.json (JSON object of
 * { absPath: hash }). Atomic writes via rename-after-write. Best-
 * effort: I/O failure on persistence doesn't break the sync.
 */
const lastPushedHash = new Map<string, string>();

// Path to the on-disk dedup cache. Co-located with launchd logs in /tmp
// would be wiped on reboot; ~/.shared-brain-sync/ is more durable and
// only the daemon writes there.
const DEDUP_CACHE_DIR = path.join(os.homedir(), ".shared-brain-sync");
const DEDUP_CACHE_FILE = path.join(DEDUP_CACHE_DIR, "dedup-cache.json");

/** Throttled disk-write timer to avoid hammering the filesystem on
 *  bursty syncs (e.g. initial scan of 3,800 files). We write at most
 *  once every 2s after the most-recent change. */
let pendingFlush: NodeJS.Timeout | null = null;
let dedupDirty = false;

async function flushDedupCache(): Promise<void> {
  if (!dedupDirty) return;
  dedupDirty = false;
  try {
    await fs.mkdir(DEDUP_CACHE_DIR, { recursive: true });
    // Atomic write: write to .tmp then rename. Avoids torn-write on crash.
    const obj = Object.fromEntries(lastPushedHash);
    const tmp = `${DEDUP_CACHE_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(obj), "utf8");
    await fs.rename(tmp, DEDUP_CACHE_FILE);
  } catch (err) {
    // Persistence is best-effort. If it fails, we'd just rebuild the
    // map on next restart — annoying but not breaking.
    console.warn(`[sync] dedup cache flush failed (non-fatal): ${(err as Error).message}`);
  }
}

function scheduleDedupFlush(): void {
  dedupDirty = true;
  if (pendingFlush) return;
  pendingFlush = setTimeout(() => {
    pendingFlush = null;
    void flushDedupCache();
  }, 2000);
}

/** Load the dedup cache from disk. Called once on daemon startup before
 *  any sync work. Silent no-op if the file doesn't exist (first-ever run). */
export async function loadDedupCache(): Promise<void> {
  try {
    const raw = await fs.readFile(DEDUP_CACHE_FILE, "utf8");
    const obj = JSON.parse(raw) as Record<string, string>;
    let count = 0;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof k === "string" && typeof v === "string") {
        lastPushedHash.set(k, v);
        count++;
      }
    }
    console.log(`[sync] loaded dedup cache: ${count} entries`);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("ENOENT")) {
      console.log("[sync] no dedup cache yet (first run)");
    } else {
      console.warn(`[sync] dedup cache load failed (continuing with empty map): ${msg}`);
    }
  }
}

/** Flush any pending dedup writes — call this from SIGINT/SIGTERM
 *  handlers to make sure we don't lose recent state on graceful shutdown. */
export async function flushDedupCacheNow(): Promise<void> {
  if (pendingFlush) {
    clearTimeout(pendingFlush);
    pendingFlush = null;
  }
  await flushDedupCache();
}

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
  // Special prefixes "." and "" mean "the entire vault root" — used by
  // SYNC_INCLUDE="." in user installs that want everything synced.
  const matchesInclude = cfg.includePrefixes.some(
    (p) => p === "." || p === "" || relative === p || relative.startsWith(`${p}/`),
  );
  if (!matchesInclude) {
    return { ok: true, action: "ignored", reason: "outside include prefixes" };
  }
  const mapping = mapPath(relative);
  if (mapping.kind === "ignore") {
    return { ok: true, action: "ignored", reason: mapping.reason };
  }

  // For file_artifact (non-markdown), we never read content into memory.
  // Hash is path + size + blob-availability ONLY — mtime is intentionally
  // excluded because cloud-sync apps (Google Drive, Dropbox, iCloud)
  // touch mtime constantly without content actually changing, which
  // generated a 600k Vercel edge-request spike on 2026-05-15.
  // Including blob:0/1 in the hash means toggling BLOB_READ_WRITE_TOKEN
  // invalidates cached entries, so prior "metadata-only" syncs get
  // re-processed with their bytes uploaded.
  //
  // Collision risk: same-path / same-size / different-content. For real-
  // world documents (PDF, DOCX, images, etc.) this is vanishingly rare;
  // any meaningful edit changes byte count. Acceptable tradeoff.
  const isFileArtifact = mapping.kind === "file_artifact";

  let raw = "";
  let hash = "";
  if (isFileArtifact) {
    try {
      const stat = await fs.stat(absPath);
      const blobMarker = isBlobConfigured() ? "1" : "0";
      // v5: dropped mtime, see comment above. Hash bump forces one-time
      // re-sync after this ships so the new (mtime-free) hashes land in
      // vault_sync_log.
      hash = sha1(`v5|${relative}|${stat.size}|blob:${blobMarker}`);
    } catch (err) {
      return { ok: false, error: `stat failed: ${(err as Error).message}` };
    }
  } else {
    try {
      raw = await fs.readFile(absPath, "utf8");
    } catch (err) {
      return { ok: false, error: `read failed: ${(err as Error).message}` };
    }
    hash = sha1(raw);
  }

  // Client-side dedup: if we've already pushed this exact hash for this
  // path during the current daemon session, skip the POST entirely.
  // Catches the cloud-touch feedback loop where chokidar fires `change`
  // events for files whose content hasn't changed. Server-side dedup
  // still happens too (vault_sync_log row match) but skipping client-
  // side saves the Vercel edge request entirely.
  const lastHash = lastPushedHash.get(absPath);
  if (lastHash === hash) {
    return { ok: true, action: "skipped", reason: "client-side dedup (no content change)" };
  }
  const recordPush = () => {
    lastPushedHash.set(absPath, hash);
    scheduleDedupFlush();
  };

  if (opts.dryRun) {
    return { ok: true, action: "updated", reason: `[dry-run] ${mapping.kind}` };
  }

  try {
    switch (mapping.kind) {
      case "file_artifact": {
        const ext = path.extname(absPath).slice(1).toLowerCase() || "file";
        const filename = path.basename(absPath);
        const titleNoExt = filename.replace(/\.[^.]+$/, "");
        const stat = await fs.stat(absPath).catch(() => null);
        const sizeKb = stat ? Math.round(stat.size / 1024) : null;

        // 1. Upload bytes to Vercel Blob (if configured). Pass the URL to the
        //    server so it stores blob_url alongside the wiki entry.
        let blobUrl: string | null = null;
        if (isBlobConfigured()) {
          try {
            blobUrl = await uploadFileToBlob({ absPath, vaultRelPath: relative });
          } catch (err) {
            // Don't fail the whole sync on a blob upload error — log and continue
            // with a wiki entry that just has the metadata.
            console.warn(
              `[sync] blob upload failed for ${relative}: ${(err as Error).message}`,
            );
          }
        }

        // 2. Extract plain text from the file (PDFs, DOCX, XLSX, code, etc.).
        const extracted = await extractText(absPath);

        // 3. Build the synthetic wiki body. Includes file metadata plus a
        //    short snippet of the extracted text so the page itself is
        //    glanceable in the wiki tree.
        // Obsidian deep-link is optional. We only emit it when
        // OBSIDIAN_VAULT_NAME is set (install-daemon.ts plumbs it in
        // from the user's /settings/org config). Otherwise the link
        // would point to a non-existent vault for any user whose
        // Obsidian vault name doesn't happen to be "ViaOps" — see
        // ADR-038 / Jake's post-mortem MF-5.
        const obsidianVault = process.env.OBSIDIAN_VAULT_NAME?.trim();
        const obsidianHref = obsidianVault
          ? `obsidian://open?vault=${encodeURIComponent(obsidianVault)}&file=${encodeURIComponent(
              relative.replace(/\.[^.]+$/, ""),
            )}`
          : null;
        const indexedNote = extracted.text
          ? `_Indexed for semantic search — ${extracted.wordCount.toLocaleString()} words extracted._`
          : extracted.skipReason
            ? `_File stored. ${extracted.skipReason}._`
            : `_File stored. Content not indexed (binary)._`;

        const snippet = extracted.text
          ? "\n\n---\n\n## Preview\n\n" +
            extracted.text.slice(0, 1500).trim() +
            (extracted.text.length > 1500 ? "\n\n…" : "")
          : "";

        const synthBody = [
          `**${ext.toUpperCase()} file** — \`${filename}\``,
          "",
          `- **Path:** \`${relative}\``,
          sizeKb !== null ? `- **Size:** ${sizeKb} KB` : null,
          stat ? `- **Modified:** ${stat.mtime.toISOString()}` : null,
          blobUrl ? `- **Stored in Shared Brain:** ✅` : null,
          "",
          // Build the action-link line: Download (if blob), Open in
          // Obsidian (if vault name configured). Skip the whole line if
          // neither is available.
          blobUrl && obsidianHref
            ? `[Download](${blobUrl}) · [Open in Obsidian](${obsidianHref})`
            : blobUrl
              ? `[Download](${blobUrl})`
              : obsidianHref
                ? `[Open in Obsidian](${obsidianHref})`
                : null,
          "",
          indexedNote,
          snippet,
        ]
          .filter((l) => l !== null)
          .join("\n");

        const tags = [...(mapping.tags ?? []), "file", `file-${ext}`];

        const res = await api.syncWiki({
          filePath: relative,
          title: titleNoExt,
          content: synthBody,
          contentHash: hash,
          frontmatter: {},
          tags,
          blobUrl: blobUrl ?? undefined,
          extractedText: extracted.text ?? undefined,
          extractedWordCount: extracted.wordCount,
        });
        recordPush();
        return { ok: true, action: res.skipped ? "skipped" : (res.action as "created" | "updated") };
      }

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
        recordPush();
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
        recordPush();
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
        recordPush();
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
        recordPush();
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
        recordPush();
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
      } else if (entry.isFile()) {
        // Collect everything; mapper.ts decides what to actually sync vs ignore.
        // Hidden / dot files are skipped at the walker level.
        if (entry.name.startsWith(".")) continue;
        out.push(abs);
      }
    }
  }
  for (const inc of cfg.includePrefixes) {
    await walk(path.join(cfg.vaultRoot, inc));
  }
  return out;
}
