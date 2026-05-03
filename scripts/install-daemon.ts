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

const LABEL = "com.viaops.shared-brain.sync";
const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const LOG_PATH = "/tmp/shared-brain-sync.log";
const ERR_PATH = "/tmp/shared-brain-sync.err";

const DEFAULT_API_BASE = "https://shared-brain-ecru.vercel.app";

function parseArgs(argv: string[]): {
  apiKey?: string;
  vaultPath: string;
  apiBase: string;
  agentDir: string;
  uninstall: boolean;
  dryRun: boolean;
} {
  const args = argv.slice(2);
  let apiKey: string | undefined =
    process.env.MCP_API_KEY || process.env.SHARED_BRAIN_API_KEY;
  let vaultPath = process.env.VAULT_PATH || join(homedir(), "Documents", "ViaOps");
  let apiBase = process.env.SHARED_BRAIN_API_BASE || DEFAULT_API_BASE;
  // The agent dir is wherever this repo's `agent/` lives. Default: ../agent
  // relative to the script (scripts/install-daemon.ts → agent/).
  let agentDir = resolve(__dirname, "..", "agent");
  let uninstall = false;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--api-key" && args[i + 1]) apiKey = args[++i];
    else if (a === "--vault-path" && args[i + 1]) vaultPath = args[++i];
    else if (a === "--api-base" && args[i + 1]) apiBase = args[++i];
    else if (a === "--agent-dir" && args[i + 1]) agentDir = args[++i];
    else if (a === "--uninstall") uninstall = true;
    else if (a === "--dry-run") dryRun = true;
  }
  return { apiKey, vaultPath, apiBase, agentDir, uninstall, dryRun };
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
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
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
    <string>${escapeXml(opts.vaultPath)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${ERR_PATH}</string>
</dict>
</plist>
`;
}

function getUid(): string {
  return execSync("id -u").toString().trim();
}

function isLoaded(): boolean {
  try {
    const out = execSync(`launchctl list | grep ${LABEL} || true`).toString();
    return out.includes(LABEL);
  } catch {
    return false;
  }
}

async function main() {
  const opts = parseArgs(process.argv);

  // ── Uninstall path ──────────────────────────────────────────────────
  if (opts.uninstall) {
    if (!existsSync(PLIST_PATH)) {
      console.log(`Nothing to uninstall — no plist at ${PLIST_PATH}`);
      return;
    }
    if (isLoaded()) {
      console.log(`Stopping daemon...`);
      try {
        execSync(`launchctl bootout gui/${getUid()} ${PLIST_PATH}`, {
          stdio: "inherit",
        });
      } catch {
        // Older macOS uses unload; try as fallback
        try {
          execSync(`launchctl unload ${PLIST_PATH}`, { stdio: "inherit" });
        } catch {
          /* swallow */
        }
      }
    }
    await fs.unlink(PLIST_PATH);
    console.log(`✓ removed ${PLIST_PATH}`);
    console.log(`Logs at ${LOG_PATH} were not deleted; remove manually if you like.`);
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

  const plist = buildPlist({
    agentDir: opts.agentDir,
    apiBase: opts.apiBase,
    apiKey: opts.apiKey,
    vaultPath: opts.vaultPath,
  });

  if (opts.dryRun) {
    // Redact the API key in dry-run output so it doesn't leak into
    // shells or transcripts. Real install writes the unredacted plist
    // to disk with mode 0600.
    const redactedPlist = plist.replace(
      new RegExp(opts.apiKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      "<REDACTED:" + opts.apiKey.length + "-chars>",
    );
    console.log(`[dry-run] would write plist to ${PLIST_PATH}:\n`);
    console.log(redactedPlist);
    console.log(`[dry-run] would launchctl bootstrap gui/${getUid()} ${PLIST_PATH}`);
    return;
  }

  // If already loaded, bootout first so the new config takes effect.
  if (isLoaded()) {
    console.log(`Daemon already loaded — replacing config...`);
    try {
      execSync(`launchctl bootout gui/${getUid()} ${PLIST_PATH}`, {
        stdio: "inherit",
      });
    } catch {
      /* swallow */
    }
  }

  await fs.mkdir(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  await fs.writeFile(PLIST_PATH, plist, { encoding: "utf8", mode: 0o600 });
  console.log(`✓ wrote ${PLIST_PATH} (mode 600 — contains your MCP_API_KEY)`);

  execSync(`launchctl bootstrap gui/${getUid()} ${PLIST_PATH}`, {
    stdio: "inherit",
  });

  // Give it a couple seconds to start, then verify.
  await new Promise((r) => setTimeout(r, 2500));
  if (!isLoaded()) {
    throw new Error(
      `Daemon failed to load. Check ${ERR_PATH} for details.`,
    );
  }
  console.log(`✓ daemon loaded`);
  console.log("");
  console.log("Daemon is now running. It will:");
  console.log(`  - watch ${opts.vaultPath} for any markdown / PDF / DOCX / etc. changes`);
  console.log(`  - push them to ${opts.apiBase} within seconds`);
  console.log(`  - auto-restart if it crashes`);
  console.log(`  - auto-start on every login`);
  console.log("");
  console.log(`Logs:    tail -f ${LOG_PATH}`);
  console.log(`Errors:  tail -f ${ERR_PATH}`);
  console.log(`Status:  launchctl list | grep ${LABEL}`);
  console.log(`Stop:    npm run install-daemon -- --uninstall`);
}

main().catch((err) => {
  console.error("Install failed:", (err as Error).message);
  process.exit(1);
});
