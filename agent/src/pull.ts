/**
 * Phase F4d — Vault pull-down (platform → local Obsidian).
 *
 * Complements the existing push direction (sync.ts). Calls
 * /api/sync/pull?since=<cursor>, gets back wiki pages that were
 * created or updated on the platform, and writes any that don't yet
 * exist locally as markdown files in the vault.
 *
 * Loop prevention is handled implicitly by the existing push
 * pipeline: when the new file triggers a chokidar `add` event, the
 * agent computes its hash and POSTs to /api/sync/wiki; the server
 * sees the existing vault_sync_log entry with the matching hash and
 * returns `skipped: true`. So we never bounce a pulled file back up.
 *
 * Conflict handling (v1): if the target path already exists locally
 * AND the local content differs from what's on the platform, we
 * leave the local file alone and log a warning. The user is the
 * tiebreaker. v2 can add merge.
 *
 * Cursor: persisted in `<agent-dir>/.last-pull` so cross-run state
 * survives. First-ever run pulls the last 30 days.
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { ApiClient } from "./api.ts";
import { type SyncConfig } from "./config.ts";

const CURSOR_FILE = ".last-pull";

type PullResult = {
  pulled: number;
  written: number;
  skipped_existing: number;
  conflicts: number;
  errors: number;
  cursor: string;
};

async function readCursor(agentDir: string): Promise<string | undefined> {
  const p = path.join(agentDir, CURSOR_FILE);
  if (!existsSync(p)) return undefined;
  try {
    const content = (await fs.readFile(p, "utf8")).trim();
    if (content && !Number.isNaN(new Date(content).getTime())) return content;
  } catch {
    /* swallow — fall back to default */
  }
  return undefined;
}

async function writeCursor(agentDir: string, cursor: string): Promise<void> {
  const p = path.join(agentDir, CURSOR_FILE);
  await fs.writeFile(p, cursor + "\n", "utf8");
}

async function tryReadFile(absPath: string): Promise<string | null> {
  if (!existsSync(absPath)) return null;
  try {
    return await fs.readFile(absPath, "utf8");
  } catch {
    return null;
  }
}

export async function pullDown(args: {
  cfg: SyncConfig;
  api: ApiClient;
  agentDir: string;
  /** When true, only print what would change. */
  dryRun?: boolean;
}): Promise<PullResult> {
  const { cfg, api, agentDir, dryRun = false } = args;

  const cursor = await readCursor(agentDir);
  const sinceLabel = cursor ?? "(server default — last 30 days)";
  console.log(`[pull] since=${sinceLabel}`);

  const res = await api.pull({ since: cursor });
  console.log(`[pull] platform returned ${res.page_count} pages`);

  let written = 0;
  let skipped_existing = 0;
  let conflicts = 0;
  let errors = 0;

  for (const page of res.pages) {
    const targetAbs = path.join(cfg.vaultRoot, page.filePath);
    const existing = await tryReadFile(targetAbs);

    if (existing === null) {
      // New file — write it.
      if (dryRun) {
        console.log(`[pull] [dry] would create ${page.filePath}`);
        written++;
        continue;
      }
      try {
        await fs.mkdir(path.dirname(targetAbs), { recursive: true });
        await fs.writeFile(targetAbs, page.body, "utf8");
        console.log(`[pull] ✓ created ${page.filePath}`);
        written++;
      } catch (err) {
        console.warn(
          `[pull] ✗ failed to write ${page.filePath}: ${(err as Error).message}`,
        );
        errors++;
      }
      continue;
    }

    // File exists locally. If the content matches what the platform
    // sent, nothing to do — skip silently.
    if (existing === page.body) {
      skipped_existing++;
      continue;
    }

    // Content differs. v1 conservative behavior: leave local alone
    // and warn. The next push pass will sync the local version up.
    console.warn(
      `[pull] ⚠ ${page.filePath} differs locally — keeping local copy. ` +
        `(platform updated ${page.updatedAt}; will push local back up on next sync)`,
    );
    conflicts++;
  }

  // Advance cursor to whatever the server returned (max(updatedAt) of
  // the response, or `since` if empty). Saves work on next pull.
  if (!dryRun) await writeCursor(agentDir, res.cursor);

  console.log(
    `[pull] done: ${written} created, ${skipped_existing} unchanged, ${conflicts} conflicts, ${errors} errors. ` +
      `cursor → ${res.cursor}`,
  );

  return {
    pulled: res.page_count,
    written,
    skipped_existing,
    conflicts,
    errors,
    cursor: res.cursor,
  };
}
