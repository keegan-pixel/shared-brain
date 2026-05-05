/**
 * Shared Brain — Rotate MCP_API_KEY (Phase 6 follow-up)
 *
 * Productizes the MCP_API_KEY rotation flow that's otherwise 5 manual
 * steps with high forget-rate (we just lived through one). Generates a
 * new key, updates every place we know it lives on disk, copies the new
 * value to the clipboard for the one place we can't auto-update
 * (Vercel), and prints a checklist of any remaining manual steps.
 *
 * Updates in place:
 *   - `.env.local` (MCP_API_KEY=)
 *   - `~/Library/Application Support/Claude/claude_desktop_config.json`
 *     (shared-brain MCP server's AUTH_HEADER env)
 *   - `~/Library/LaunchAgents/com.viaops.shared-brain.sync.plist`
 *     (MCP_API_KEY EnvironmentVariable + reload via launchctl)
 *
 * Manual steps surfaced (not auto-applied):
 *   - Vercel env var (clipboard ready, redeploy needed)
 *   - Claude Code: `claude mcp remove shared-brain && claude mcp add ...`
 *   - Claude Cowork: Settings → MCP servers → Shared Brain → update auth
 *
 * Security:
 *   - The new key is never echoed to stdout. Copied to the clipboard
 *     via `pbcopy` and written directly to the target files.
 *   - Backups created at `<file>.bak.<timestamp>` before any edit.
 *   - On any error mid-rotation, original files remain at the .bak path.
 *
 * Usage:
 *   npm run rotate-key
 *   npm run rotate-key -- --dry-run
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const ENV_LOCAL_PATH = resolve(__dirname, "..", ".env.local");
const CLAUDE_DESKTOP_CONFIG = join(
  homedir(),
  "Library",
  "Application Support",
  "Claude",
  "claude_desktop_config.json",
);
const DAEMON_PLIST = join(
  homedir(),
  "Library",
  "LaunchAgents",
  "com.viaops.shared-brain.sync.plist",
);
const DAEMON_LABEL = "com.viaops.shared-brain.sync";

type RotateResult = {
  envLocal: { updated: boolean; reason?: string };
  claudeDesktop: { updated: boolean; reason?: string };
  daemon: { updated: boolean; reloaded: boolean; reason?: string };
};

function generateKey(): string {
  return randomBytes(32).toString("base64url");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function backupFile(path: string, dryRun: boolean): Promise<string> {
  const backupPath = `${path}.bak.${timestamp()}`;
  if (dryRun) {
    console.log(`  [dry-run] would back up ${path} → ${backupPath}`);
    return backupPath;
  }
  const content = await fs.readFile(path);
  await fs.writeFile(backupPath, content, { mode: 0o600 });
  console.log(`  ✓ backed up ${path} → ${backupPath}`);
  return backupPath;
}

async function updateEnvLocal(
  newKey: string,
  dryRun: boolean,
): Promise<RotateResult["envLocal"]> {
  if (!existsSync(ENV_LOCAL_PATH)) {
    return { updated: false, reason: "no .env.local found" };
  }
  await backupFile(ENV_LOCAL_PATH, dryRun);
  const original = await fs.readFile(ENV_LOCAL_PATH, "utf8");
  if (!/^MCP_API_KEY=.*/m.test(original)) {
    // Append a new line if the variable doesn't exist yet.
    const updated = original.endsWith("\n") ? original : original + "\n";
    if (dryRun) {
      console.log(`  [dry-run] would append MCP_API_KEY=… to ${ENV_LOCAL_PATH}`);
      return { updated: true };
    }
    await fs.writeFile(ENV_LOCAL_PATH, `${updated}MCP_API_KEY=${newKey}\n`, {
      mode: 0o600,
    });
    console.log(`  ✓ appended MCP_API_KEY to ${ENV_LOCAL_PATH}`);
    return { updated: true };
  }
  const replaced = original.replace(/^MCP_API_KEY=.*$/m, `MCP_API_KEY=${newKey}`);
  if (dryRun) {
    console.log(`  [dry-run] would replace MCP_API_KEY in ${ENV_LOCAL_PATH}`);
    return { updated: true };
  }
  await fs.writeFile(ENV_LOCAL_PATH, replaced, { mode: 0o600 });
  console.log(`  ✓ updated MCP_API_KEY in ${ENV_LOCAL_PATH}`);
  return { updated: true };
}

async function updateClaudeDesktop(
  newKey: string,
  dryRun: boolean,
): Promise<RotateResult["claudeDesktop"]> {
  if (!existsSync(CLAUDE_DESKTOP_CONFIG)) {
    return {
      updated: false,
      reason: `no Claude Desktop config at ${CLAUDE_DESKTOP_CONFIG}`,
    };
  }
  await backupFile(CLAUDE_DESKTOP_CONFIG, dryRun);
  const raw = await fs.readFile(CLAUDE_DESKTOP_CONFIG, "utf8");
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    return {
      updated: false,
      reason: `Claude Desktop config is not valid JSON: ${(err as Error).message}`,
    };
  }
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  const sharedBrain = servers["shared-brain"] as
    | { env?: Record<string, string> }
    | undefined;
  if (!sharedBrain || !sharedBrain.env) {
    return {
      updated: false,
      reason:
        "no `shared-brain` MCP server entry with env block found in Claude Desktop config",
    };
  }
  // The header field is conventionally AUTH_HEADER ("Bearer <key>") per
  // the Runbook setup. Be tolerant of slight naming variations.
  const candidates = ["AUTH_HEADER", "BEARER_TOKEN", "MCP_API_KEY"];
  const fieldName = candidates.find((k) =>
    Object.prototype.hasOwnProperty.call(sharedBrain.env, k),
  );
  if (!fieldName) {
    return {
      updated: false,
      reason: `no recognized auth field in env block (looked for ${candidates.join(", ")})`,
    };
  }
  const newValue = fieldName === "AUTH_HEADER" ? `Bearer ${newKey}` : newKey;
  if (dryRun) {
    console.log(`  [dry-run] would replace ${fieldName} in shared-brain MCP server`);
    return { updated: true };
  }
  sharedBrain.env[fieldName] = newValue;
  await fs.writeFile(
    CLAUDE_DESKTOP_CONFIG,
    JSON.stringify(config, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(
    `  ✓ updated ${fieldName} in ${CLAUDE_DESKTOP_CONFIG} (Claude Desktop will use new key after a restart)`,
  );
  return { updated: true };
}

function isDaemonLoaded(): boolean {
  try {
    const out = execSync(`launchctl list | grep ${DAEMON_LABEL} || true`).toString();
    return out.includes(DAEMON_LABEL);
  } catch {
    return false;
  }
}

function getUid(): string {
  return execSync("id -u").toString().trim();
}

async function updateDaemonPlist(
  newKey: string,
  dryRun: boolean,
): Promise<RotateResult["daemon"]> {
  if (!existsSync(DAEMON_PLIST)) {
    return {
      updated: false,
      reloaded: false,
      reason: `no daemon plist at ${DAEMON_PLIST}`,
    };
  }
  await backupFile(DAEMON_PLIST, dryRun);
  const original = await fs.readFile(DAEMON_PLIST, "utf8");
  // Match the MCP_API_KEY entry: <key>MCP_API_KEY</key> followed by
  // <string>...</string> on the next non-empty line. Replace the value.
  const re = /(<key>MCP_API_KEY<\/key>\s*<string>)[^<]*(<\/string>)/;
  if (!re.test(original)) {
    return {
      updated: false,
      reloaded: false,
      reason: "no MCP_API_KEY entry found in daemon plist",
    };
  }
  const replaced = original.replace(re, `$1${newKey}$2`);
  if (dryRun) {
    console.log(
      `  [dry-run] would replace MCP_API_KEY value in ${DAEMON_PLIST}`,
    );
    if (isDaemonLoaded()) {
      console.log(`  [dry-run] would launchctl bootout + bootstrap to reload daemon`);
    }
    return { updated: true, reloaded: false };
  }
  await fs.writeFile(DAEMON_PLIST, replaced, { mode: 0o600 });
  console.log(`  ✓ updated MCP_API_KEY in ${DAEMON_PLIST}`);

  if (!isDaemonLoaded()) {
    console.log("  (daemon not currently loaded; new key takes effect when you next install/start it)");
    return { updated: true, reloaded: false };
  }
  // Reload so the running watcher picks up the new env var. launchd
  // reads EnvironmentVariables only at load time — without a reload, the
  // watcher would keep using the old key in memory.
  try {
    execSync(`launchctl bootout gui/${getUid()} ${DAEMON_PLIST}`, {
      stdio: "inherit",
    });
  } catch {
    /* swallow */
  }
  execSync(`launchctl bootstrap gui/${getUid()} ${DAEMON_PLIST}`, {
    stdio: "inherit",
  });
  console.log(`  ✓ reloaded daemon (launchctl bootout + bootstrap)`);
  return { updated: true, reloaded: true };
}

function copyToClipboard(value: string): boolean {
  try {
    execSync("pbcopy", { input: value });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(
    dryRun
      ? "Rotating MCP_API_KEY (DRY RUN — no files will be modified)\n"
      : "Rotating MCP_API_KEY...\n",
  );

  const newKey = generateKey();

  console.log("Step 1: update .env.local");
  const envLocal = await updateEnvLocal(newKey, dryRun);
  if (envLocal.reason) console.log(`  ⚠ ${envLocal.reason}`);
  console.log("");

  console.log("Step 2: update Claude Desktop config");
  const claudeDesktop = await updateClaudeDesktop(newKey, dryRun);
  if (claudeDesktop.reason) console.log(`  ⚠ ${claudeDesktop.reason}`);
  console.log("");

  console.log("Step 3: update daemon plist + reload");
  const daemon = await updateDaemonPlist(newKey, dryRun);
  if (daemon.reason) console.log(`  ⚠ ${daemon.reason}`);
  console.log("");

  console.log("Step 4: copy new key to clipboard for Vercel");
  if (dryRun) {
    console.log("  [dry-run] would copy new key to clipboard");
  } else {
    const ok = copyToClipboard(newKey);
    if (ok) console.log("  ✓ new key copied to clipboard (paste into Vercel)");
    else console.log("  ⚠ pbcopy failed; key NOT in clipboard. Read .env.local to get it.");
  }
  console.log("");

  console.log("─────────────────────────────────────────────");
  console.log("Auto-applied:");
  console.log(`  ${envLocal.updated ? "✓" : "—"} .env.local`);
  console.log(`  ${claudeDesktop.updated ? "✓" : "—"} Claude Desktop config`);
  console.log(`  ${daemon.updated ? "✓" : "—"} Daemon plist${daemon.reloaded ? " (reloaded)" : ""}`);
  console.log("");
  console.log("Still manual:");
  console.log("  ☐ Vercel env var: Settings → Environment Variables →");
  console.log("    MCP_API_KEY → Edit → Cmd-V → Save → Redeploy");
  console.log("  ☐ Claude Code (if installed):");
  console.log("    claude mcp remove shared-brain && claude mcp add ...");
  console.log("  ☐ Claude Cowork (if installed):");
  console.log("    Cowork app → Settings → MCP servers → Shared Brain → update");
  console.log("  ☐ Restart Claude Desktop (Cmd-Q then reopen) for new key to take effect");
  console.log("─────────────────────────────────────────────");
}

main().catch((err) => {
  console.error("Rotation failed:", (err as Error).message);
  console.error("Backup files (if any) are at <path>.bak.<timestamp>.");
  process.exit(1);
});
