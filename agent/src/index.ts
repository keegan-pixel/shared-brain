import chokidar from "chokidar";
import path from "node:path";
import pLimit from "p-limit";
import { fileURLToPath } from "node:url";
import { ApiClient } from "./api.ts";
import { loadAllConfigs, relPath, type SyncConfig } from "./config.ts";
import { syncOne, walkVault, type SyncResult } from "./sync.ts";
import { pullDown } from "./pull.ts";

// Agent dir = where this file lives + ".." (we're in agent/src/, agent dir is one up).
const AGENT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

type Args = { mode: "once" | "watch"; dryRun: boolean };

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const mode = args.find((a) => a.startsWith("--mode="))?.split("=")[1] ?? "once";
  if (mode !== "once" && mode !== "watch") {
    throw new Error(`--mode must be "once" or "watch", got "${mode}"`);
  }
  const dryRun = args.includes("--dry-run");
  return { mode, dryRun };
}

function fmt(absPath: string, vaultRoot: string, res: SyncResult): string {
  const rel = relPath(absPath, vaultRoot);
  if (!res.ok) return `✗ ${rel} — ${res.error}`;
  if (res.action === "ignored") return `· ${rel} (${res.reason})`;
  if (res.action === "skipped") return `= ${rel} (unchanged)`;
  return `✓ ${rel} (${res.action}${res.reason ? `: ${res.reason}` : ""})`;
}

async function scanOneConfig(cfg: SyncConfig, api: ApiClient, args: Args) {
  console.log(
    `[sync] full scan${args.dryRun ? " (dry-run)" : ""}: ${cfg.vaultRoot}\n` +
      `[sync] include: ${cfg.includePrefixes.join(", ")}`,
  );

  const files = await walkVault(cfg);
  console.log(`[sync] found ${files.length} markdown files under ${cfg.vaultRoot}`);

  const limit = pLimit(cfg.concurrency);
  let done = 0;
  const stats = { ok: 0, ignored: 0, skipped: 0, error: 0 };

  await Promise.all(
    files.map((file) =>
      limit(async () => {
        const res = await syncOne(file, cfg, api, { dryRun: args.dryRun });
        done++;
        if (!res.ok) stats.error++;
        else if (res.action === "ignored") stats.ignored++;
        else if (res.action === "skipped") stats.skipped++;
        else stats.ok++;
        const interesting = !res.ok || (res.ok && res.action !== "ignored");
        if (interesting) {
          console.log(`[${done}/${files.length}] ${fmt(file, cfg.vaultRoot, res)}`);
        }
      }),
    ),
  );

  console.log(
    `[sync] ${cfg.vaultRoot} → done: ${stats.ok} synced, ${stats.skipped} unchanged, ${stats.ignored} ignored, ${stats.error} errors`,
  );
  return stats;
}

async function fullScan(args: Args) {
  const configs = loadAllConfigs();
  const primary = configs[0];
  // API client is shared across configs — same apiKey + apiBase (extras
  // inherit from primary). One client = one HTTP keepalive pool.
  const api = new ApiClient(primary);

  console.log(`[sync] api: ${primary.apiBase}`);
  if (configs.length > 1) {
    console.log(`[sync] multi-vault mode: ${configs.length} folders configured`);
  }

  // Phase F4d — pull-down BEFORE push. Materialize any platform-side
  // entries into the LOCAL primary vault. Platform doesn't distinguish
  // vault roots (filePath is a single string), so pull-down only
  // materializes into the primary vault. Extra vaults are push-only
  // for now (v2.1 will add per-vault routing).
  try {
    await pullDown({ cfg: primary, api, agentDir: AGENT_DIR, dryRun: args.dryRun });
  } catch (err) {
    console.warn(`[sync] pull-down failed (continuing with push): ${(err as Error).message}`);
  }

  const totals = { ok: 0, ignored: 0, skipped: 0, error: 0 };
  for (const cfg of configs) {
    const stats = await scanOneConfig(cfg, api, args);
    totals.ok += stats.ok;
    totals.ignored += stats.ignored;
    totals.skipped += stats.skipped;
    totals.error += stats.error;
  }

  if (configs.length > 1) {
    console.log(
      `[sync] total across ${configs.length} folders: ${totals.ok} synced, ${totals.skipped} unchanged, ${totals.ignored} ignored, ${totals.error} errors`,
    );
  }

  return { configs, primary, api, stats: totals };
}

async function watch(args: Args) {
  const { configs, primary, api } = await fullScan(args);
  if (args.dryRun) {
    console.log("[sync] dry-run mode → not entering watch loop");
    return;
  }

  // Spin up one chokidar watcher per configured vault. Each watcher
  // computes paths relative to ITS vaultRoot so syncOne always gets
  // the right cfg + relative path. Multi-vault watching shipped
  // 2026-05-14 for Richard's install (he had 5 folders to watch).
  const watchers: ReturnType<typeof chokidar.watch>[] = [];
  for (const cfg of configs) {
    console.log(`[sync] watching ${cfg.vaultRoot} for changes…`);
    const watchRoots = cfg.includePrefixes.map((p) => path.join(cfg.vaultRoot, p));
    const watcher = chokidar.watch(watchRoots, {
      ignoreInitial: true,
      ignored: (p) => {
        const rel = relPath(p, cfg.vaultRoot);
        return cfg.ignorePrefixes.some((ig) => rel === ig || rel.startsWith(`${ig}/`));
      },
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });

    const handle = (event: string) => async (file: string) => {
      // Don't filter by extension here — mapper.ts is the single source of
      // truth for what's syncable (markdown, file_artifact, or ignored).
      // Filtering on .md here silently drops binaries (PDFs, images, etc.)
      // added during watch, leaving them unsynced until the next full scan.
      if (path.basename(file).startsWith(".")) return;
      const res = await syncOne(file, cfg, api);
      if (res.ok && res.action === "ignored") return;
      console.log(`[watch:${event}] ${fmt(file, cfg.vaultRoot, res)}`);
    };

    watcher
      .on("add", handle("add"))
      .on("change", handle("change"))
      .on("unlink", async (file) => {
        // For now we don't delete — vault is source-of-truth + we don't want to
        // accidentally lose data on transient unmounts. Future: soft-delete.
        console.log(`[watch:unlink] ${relPath(file, cfg.vaultRoot)} (deletion not yet propagated)`);
      });

    watchers.push(watcher);
  }

  // Phase F4d — periodic pull-down so long-running watch sessions
  // pick up platform-created entries (chat sessions, mobile, other
  // users) without requiring a restart. Pull into primary vault only
  // (platform doesn't distinguish vault roots — see fullScan comment).
  const PULL_INTERVAL_MS = 5 * 60 * 1000;
  const pullTimer = setInterval(async () => {
    try {
      await pullDown({ cfg: primary, api, agentDir: AGENT_DIR });
    } catch (err) {
      console.warn(`[sync] periodic pull-down failed: ${(err as Error).message}`);
    }
  }, PULL_INTERVAL_MS);

  const closeAll = () => Promise.all(watchers.map((w) => w.close()));

  process.on("SIGINT", () => {
    console.log("[sync] SIGINT received, stopping watchers…");
    clearInterval(pullTimer);
    closeAll().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    clearInterval(pullTimer);
    closeAll().then(() => process.exit(0));
  });
}

(async () => {
  const args = parseArgs();
  try {
    if (args.mode === "once") await fullScan(args);
    else await watch(args);
  } catch (err) {
    console.error("[sync] fatal:", (err as Error).message);
    process.exit(1);
  }
})();
