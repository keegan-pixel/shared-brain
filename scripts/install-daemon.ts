/**
 * Shared Brain — Install Vault Sync Daemon (Phase 6 follow-up)
 *
 * Installs a launchd LaunchAgent (macOS) that runs the vault sync
 * watcher continuously in the background. After install, the watcher:
 *   - auto-starts on every login
 *   - watches the vault for changes (chokidar)
 *   - pushes any change (markdown OR file artifacts: PDF, DOCX, XLSX,
 *     PPT, images, code, etc.) to the platform within seconds
 *   - auto-restarts on crash (KeepAlive)
 *
 * Usage:
 *   npm run install-daemon
 *     - or -
 *   npm run install-daemon -- --api-key ck_... --vault-path /path/to/vault
 *
 * To uninstall:
 *   npm run install-daemon -- --uninstall
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

/**
 * Plist label is user-namespaced so multiple installs can coexist on
 * one Mac. New users pass `--user-tag <slug>` to get a per-user label.
 *
 * Special case: when no --user-tag is provided AND no SHARED_BRAIN_USER_TAG
 * env var is set, we use the LEGACY label `com.viaops.shared-brain.sync`
 * (Keegan's original install). This means `npm run install-daemon` with
 * no args keeps doing what it always did. Multi-user systems pass
 * --user-tag for namespacing.
 */
const LEGACY_LABEL = "com.viaops.shared-brain.sync";
function buildLabel(userTag: string, isExplicit: boolean): string {
  if (!isExplicit) return LEGACY_LABEL;
  return `com.shared-brain.sync.${userTag}`;
}
function plistPathFor(label: string): string {
  return join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
}
function logPathFor(userTag: string, isExplicit: boolean): string {
  if (!isExplicit) return `/tmp/shared-brain-sync.log`; // legacy path
  return `/tmp/shared-brain-sync.${userTag}.log`;
}
function errPathFor(userTag: string, isExplicit: boolean): string {
  if (!isExplicit) return `/tmp/shared-brain-sync.err`;
  return `/tmp/shared-brain-sync.${userTag}.err`;
}

function sanitizeUserTag(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "user";
}

const DEFAULT_API_BASE = "https://shared-brain-ecru.vercel.app";

function parseArgs(argv: string[]): {
  apiKey?: string;
  vaultPath: string;
  extraVaultPaths: string[];
  apiBase: string;
  agentDir: string;
  blobToken?: string;
  userTag: string;
  userTagExplicit: boolean;
  uninstall: boolean;
  dryRun: boolean;
} {
  const args = argv.slice(2);
  let apiKey: string | undefined =
    process.env.MCP_API_KEY || process.env.SHARED_BRAIN_API_KEY;
  let vaultPath = process.env.VAULT_PATH || join(homedir(), "Documents", "ViaOps");
  const extraVaultPaths: string[] = [];
  let apiBase = process.env.SHARED_BRAIN_API_BASE || DEFAULT_API_BASE;
  // The agent dir is wherever this repo's `agent/` lives. Default: ../agent
  // relative to the script (scripts/install-daemon.ts → agent/).
  let agentDir = resolve(__dirname, "..", "agent");
  let blobToken: string | undefined = process.env.BLOB_READ_WRITE_TOKEN;
  // User tag namespaces the plist label so multiple users can install
  // on the same Mac. When omitted, we use the LEGACY label
  // (com.viaops.shared-brain.sync) to keep Keegan's original install
  // working without changes.
  let userTag = process.env.SHARED_BRAIN_USER_TAG || "viaops";
  let userTagExplicit = !!process.env.SHARED_BRAIN_USER_TAG;
  let uninstall = false;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--api-key" && args[i + 1]) apiKey = args[++i];
    else if (a === "--vault-path" && args[i + 1]) vaultPath = args[++i];
    else if (a === "--extra-vault-path" && args[i + 1]) extraVaultPaths.push(args[++i]);
    else if (a === "--api-base" && args[i + 1]) apiBase = args[++i];
    else if (a === "--agent-dir" && args[i + 1]) agentDir = args[++i];
    else if (a === "--blob-token" && args[i + 1]) blobToken = args[++i];
    else if (a === "--user-tag" && args[i + 1]) {
      userTag = args[++i];
      userTagExplicit = true;
    }
    else if (a === "--uninstall") uninstall = true;
    else if (a === "--dry-run") dryRun = true;
  }
  return {
    apiKey,
    vaultPath,
    extraVaultPaths,
    apiBase,
    agentDir,
    blobToken,
    userTag: sanitizeUserTag(userTag),
    userTagExplicit,
    uninstall,
    dryRun,
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildPlist(opts: {
  agentDir: string;
  apiBase: string;
  apiKey: string;
  vaultPath: string;
  extraVaultPaths: string[];
  blobToken?: string;
  label: string;
  logPath: string;
  errPath: string;
}): string {
  // Optional Vercel Blob token. Without it, file_artifact syncs (PDFs,
  // images, etc.) will skip the upload and leave wiki_pages.blob_url
  // NULL — search results for those files lose their tappable
  // download_url. Recovered via `npm run backfill:blob-urls` after
  // (re)installing the daemon with the token plumbed through.
  const blobBlock = opts.blobToken
    ? `
    <key>BLOB_READ_WRITE_TOKEN</key>
    <string>${escapeXml(opts.blobToken)}</string>`
    : "";
  // Multi-folder support: agent reads `EXTRA_VAULT_PATHS` as a colon-
  // separated list. Daemon spins up an additional chokidar watcher per
  // extra path.
  const extraVaultBlock = opts.extraVaultPaths.length > 0
    ? `
    <key>EXTRA_VAULT_PATHS</key>
    <string>${escapeXml(opts.extraVaultPaths.join(":"))}</string>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${opts.label}</string>
  <key>WorkingDirectory</key>
  <string>${escapeXml(opts.agentDir)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-l</string>
    <string>-c</string>
    <string>cd ${escapeXml(opts.agentDir)} &amp;&amp; npm run sync:watch</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>SHARED_BRAIN_API_BASE</key>
    <string>${escapeXml(opts.apiBase)}</string>
    <key>MCP_API_KEY</key>
    <string>${escapeXml(opts.apiKey)}</string>
    <key>VAULT_PATH</key>
    <string>${escapeXml(opts.vaultPath)}</string>${extraVaultBlock}${blobBlock}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${opts.logPath}</string>
  <key>StandardErrorPath</key>
  <string>${opts.errPath}</string>
</dict>
</plist>
`;
}

function getUid(): string {
  return execSync("id -u").toString().trim();
}

function isLoaded(label: string): boolean {
  try {
    const out = execSync(`launchctl list | grep ${label} || true`).toString();
    return out.includes(label);
  } catch {
    return false;
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  const label = buildLabel(opts.userTag, opts.userTagExplicit);
  const plistPath = plistPathFor(label);
  const logPath = logPathFor(opts.userTag, opts.userTagExplicit);
  const errPath = errPathFor(opts.userTag, opts.userTagExplicit);

  console.log(
    opts.userTagExplicit
      ? `User tag: ${opts.userTag}  →  label: ${label}`
      : `Using legacy label (no --user-tag provided): ${label}`,
  );

  // ── Uninstall path ──────────────────────────────────────────────────
  if (opts.uninstall) {
    if (!existsSync(plistPath)) {
      console.log(`Nothing to uninstall — no plist at ${plistPath}`);
      return;
    }
    if (isLoaded(label)) {
      console.log(`Stopping daemon...`);
      try {
        execSync(`launchctl bootout gui/${getUid()} ${plistPath}`, {
          stdio: "inherit",
        });
      } catch {
        try {
          execSync(`launchctl unload ${plistPath}`, { stdio: "inherit" });
        } catch {
          /* swallow */
        }
      }
    }
    await fs.unlink(plistPath);
    console.log(`✓ removed ${plistPath}`);
    console.log(`Logs at ${logPath} were not deleted; remove manually if you like.`);
    return;
  }

  // ── Install path ────────────────────────────────────────────────────
  if (!opts.apiKey) {
    throw new Error(
      "API key required. Set MCP_API_KEY in env, or pass --api-key. " +
        "Easy way: `export MCP_API_KEY=$(grep '^MCP_API_KEY=' .env.local | cut -d= -f2 | tr -d '\"')`",
    );
  }
  if (!existsSync(opts.agentDir)) {
    throw new Error(`Agent directory not found: ${opts.agentDir}`);
  }
  if (!existsSync(opts.vaultPath)) {
    throw new Error(`Vault path not found: ${opts.vaultPath}`);
  }

  if (!opts.blobToken) {
    console.warn(
      "⚠ BLOB_READ_WRITE_TOKEN not set — daemon will skip blob uploads for binary files (PDFs, images, etc.). " +
        "Set it in env or pass --blob-token. Easy way: " +
        "`export BLOB_READ_WRITE_TOKEN=$(grep '^BLOB_READ_WRITE_TOKEN=' .env.local | cut -d= -f2-)`",
    );
  }

  const plist = buildPlist({
    agentDir: opts.agentDir,
    apiBase: opts.apiBase,
    apiKey: opts.apiKey,
    vaultPath: opts.vaultPath,
    extraVaultPaths: opts.extraVaultPaths,
    blobToken: opts.blobToken,
    label,
    logPath,
    errPath,
  });

  if (opts.dryRun) {
    // Redact secrets in dry-run output so they don't leak into shells
    // or transcripts. Real install writes the unredacted plist to disk
    // with mode 0600.
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let redactedPlist = plist.replace(
      new RegExp(escapeRe(opts.apiKey), "g"),
      "<REDACTED:" + opts.apiKey.length + "-chars>",
    );
    if (opts.blobToken) {
      redactedPlist = redactedPlist.replace(
        new RegExp(escapeRe(opts.blobToken), "g"),
        "<REDACTED:" + opts.blobToken.length + "-chars>",
      );
    }
    console.log(`[dry-run] would write plist to ${plistPath}:\n`);
    console.log(redactedPlist);
    console.log(`[dry-run] would launchctl bootstrap gui/${getUid()} ${plistPath}`);
    return;
  }

  // If already loaded, bootout first so the new config takes effect.
  if (isLoaded(label)) {
    console.log(`Daemon already loaded — replacing config...`);
    try {
      execSync(`launchctl bootout gui/${getUid()} ${plistPath}`, {
        stdio: "inherit",
      });
    } catch {
      /* swallow */
    }
  }

  await fs.mkdir(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  await fs.writeFile(plistPath, plist, { encoding: "utf8", mode: 0o600 });
  console.log(`✓ wrote ${plistPath} (mode 600 — contains your MCP_API_KEY)`);

  execSync(`launchctl bootstrap gui/${getUid()} ${plistPath}`, {
    stdio: "inherit",
  });

  // Give it a couple seconds to start, then verify.
  await new Promise((r) => setTimeout(r, 2500));
  if (!isLoaded(label)) {
    throw new Error(
      `Daemon failed to load. Check ${errPath} for details.`,
    );
  }
  console.log(`✓ daemon loaded as ${label}`);
  console.log("");
  console.log("Daemon is now running. It will:");
  console.log(`  - watch ${opts.vaultPath} for any markdown / PDF / DOCX / etc. changes`);
  console.log(`  - push them to ${opts.apiBase} within seconds`);
  console.log(`  - auto-restart if it crashes`);
  console.log(`  - auto-start on every login`);
  console.log("");
  console.log(`Logs:    tail -f ${logPath}`);
  console.log(`Errors:  tail -f ${errPath}`);
  console.log(`Status:  launchctl list | grep ${label}`);
  console.log(`Stop:    npm run install-daemon -- --user-tag ${opts.userTag} --uninstall`);
}

main().catch((err) => {
  console.error("Install failed:", (err as Error).message);
  process.exit(1);
});
