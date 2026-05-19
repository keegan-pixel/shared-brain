import chokidar from "chokidar";
import path from "node:path";
import pLimit from "p-limit";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { ApiClient } from "./api.ts";
import { loadAllConfigs, relPath, type SyncConfig } from "./config.ts";
import {
  syncOne,
  walkVault,
  loadDedupCache,
  flushDedupCacheNow,
  type SyncResult,
} from "./sync.ts";
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

  // MF-17 — self-report config to the platform so /settings/daemon
  // shows what the daemon is actually watching, regardless of whether
  // the user clicked "Save folders" during install. Best-effort: failure
  // here doesn't block sync.
  if (!args.dryRun) {
    try {
      const allPaths = configs.map((c) => c.vaultRoot);
      const vaultName = process.env.OBSIDIAN_VAULT_NAME?.trim() || null;
      await api.reportConfig({ vaultPaths: allPaths, vaultName });
      console.log(`[sync] reported config (${allPaths.length} vault paths) to platform`);
    } catch (err) {
      console.warn(`[sync] config self-report failed (non-fatal): ${(err as Error).message}`);
    }
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

  // Graceful shutdown: flush pending dedup-cache writes before exit so
  // the next launchd restart loads a complete map.
  const shutdown = async (signal: string) => {
    console.log(`[sync] ${signal} received, flushing dedup cache + stopping watchers…`);
    clearInterval(pullTimer);
    try {
      await flushDedupCacheNow();
    } catch {
      /* swallow — best-effort */
    }
    await closeAll();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

/**
 * MF-21 — On startup, read the previous-instance err log (if any) and
 * POST it to the platform. Catches crashes we'd otherwise never see
 * (SIGKILL from OOM, launchd timeouts, hard exits before our try/catch
 * runs). After successful report, truncate the file to mark as reported.
 *
 * Log paths follow install-daemon's convention:
 *   /tmp/shared-brain-sync.<userTag>.{log,err} (modern)
 *   /tmp/shared-brain-sync.{log,err} (legacy — no user-tag set)
 */
function logPaths(): { logPath: string; errPath: string } {
  const tag = process.env.SHARED_BRAIN_USER_TAG?.trim();
  if (tag) {
    return {
      logPath: `/tmp/shared-brain-sync.${tag}.log`,
      errPath: `/tmp/shared-brain-sync.${tag}.err`,
    };
  }
  return {
    logPath: "/tmp/shared-brain-sync.log",
    errPath: "/tmp/shared-brain-sync.err",
  };
}

function tailLines(s: string, n: number): string {
  const lines = s.split("\n");
  return lines.slice(Math.max(0, lines.length - n)).join("\n");
}

async function reportCrashIfAny(api: ApiClient): Promise<void> {
  const { logPath, errPath } = logPaths();
  try {
    const errStat = await stat(errPath).catch(() => null);
    if (!errStat || errStat.size === 0) return; // no err yet, clean startup

    const errContent = await readFile(errPath, "utf8");
    if (!errContent.trim()) return;

    // Best-effort: also include recent stdout for context.
    let stdoutContent: string | undefined;
    try {
      const stdoutFull = await readFile(logPath, "utf8");
      stdoutContent = tailLines(stdoutFull, 100);
    } catch {
      /* stdout log missing — that's fine */
    }

    await api.reportCrash({
      errLog: tailLines(errContent, 200),
      stdoutLog: stdoutContent,
      detectedAt: new Date().toISOString(),
      errMtime: errStat.mtime.toISOString(),
    });

    // Truncate the err file so we don't re-report the same crash on
    // the next restart. Best-effort — if truncate fails we just
    // re-report next time, no harm done.
    try {
      await writeFile(errPath, "", "utf8");
    } catch {
      /* swallow */
    }
    console.log(`[sync] reported previous-instance crash log to platform`);
  } catch (err) {
    // Crash-report failure must not block the daemon startup.
    console.warn(`[sync] crash-report failed (non-fatal): ${(err as Error).message}`);
  }
}

/**
 * Restart backoff (MF-20): track when the daemon last started. If we
 * just started < BACKOFF_THRESHOLD_MS ago, sleep before doing any work.
 * Combined with launchd's KeepAlive, this prevents tight crash-loops
 * from generating runaway API traffic.
 *
 * Discovered 2026-05-19: Richard's daemon was crash-looping every ~10s,
 * generating 12 req/min of POST /api/daemon/config + GET /api/sync/pull
 * (= ~17,280 DB queries/day from one daemon). Each was cheap individually
 * but burned through his Neon Pro compute quota in days.
 *
 * State file at ~/.shared-brain-sync/last-start.txt (epoch ms).
 */
const BACKOFF_FILE = path.join(homedir(), ".shared-brain-sync", "last-start.txt");
const BACKOFF_THRESHOLD_MS = 30_000; // < 30s since last start = recent crash
const BACKOFF_SLEEP_MS = 60_000; // sleep 60s on crash-loop detection

async function maybeBackoff(): Promise<void> {
  try {
    const raw = await readFile(BACKOFF_FILE, "utf8");
    const lastStart = Number(raw.trim());
    const elapsed = Date.now() - lastStart;
    if (Number.isFinite(lastStart) && elapsed < BACKOFF_THRESHOLD_MS) {
      console.warn(
        `[sync] crash-loop detected (last start ${Math.round(elapsed / 1000)}s ago). ` +
          `Sleeping ${BACKOFF_SLEEP_MS / 1000}s before starting work to let launchd backoff catch up.`,
      );
      await new Promise((r) => setTimeout(r, BACKOFF_SLEEP_MS));
    }
  } catch {
    /* first run or unreadable — no backoff needed */
  }
  // Record this start time for the NEXT process to consult.
  try {
    await mkdir(path.dirname(BACKOFF_FILE), { recursive: true });
    await writeFile(BACKOFF_FILE, String(Date.now()), "utf8");
  } catch {
    /* swallow — best-effort */
  }
}

// Global safety net (MF-20): catch any unhandled error so a single
// transient issue doesn't kill the daemon and trigger launchd restart.
// Log it loud and keep going. If we DO want to exit, that path should
// be explicit, not implicit-via-unhandled-error.
process.on("unhandledRejection", (reason) => {
  console.error("[sync] unhandledRejection (suppressed, daemon stays alive):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[sync] uncaughtException (suppressed, daemon stays alive):", err);
});

(async () => {
  const args = parseArgs();
  try {
    // Backoff if we just crashed-and-restarted. Prevents tight crash-loops
    // from hammering the platform with daemon/config + sync/pull calls.
    if (args.mode === "watch") await maybeBackoff();

    // MF-21 — report any previous-instance crash log to the platform
    // BEFORE doing other work. Needs an ApiClient; build one from the
    // primary config (apiBase + apiKey live in env vars + the plist).
    const primaryCfg = loadAllConfigs()[0];
    const earlyApi = new ApiClient(primaryCfg);
    await reportCrashIfAny(earlyApi);

    // Load the persistent dedup cache BEFORE any sync work so the
    // startup full-scan immediately matches what's already been pushed
    // and skips the dedup-skipped POST burst.
    await loadDedupCache();

    if (args.mode === "once") await fullScan(args);
    else await watch(args);
  } catch (err) {
    console.error("[sync] fatal:", (err as Error).message);
    // Try to flush the dedup cache even on a fatal error path so we
    // don't lose state if the process exits.
    try { await flushDedupCacheNow(); } catch { /* swallow */ }
    process.exit(1);
  }
})();
