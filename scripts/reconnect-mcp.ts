/**
 * Shared Brain — MCP reconnect diagnostic CLI.
 *
 * Runs through the "MCP disconnected" decision tree from the Runbook
 * automatically and reports which step failed. With `--fix`, applies
 * the cheapest safe remediation (sync Claude Desktop config key to
 * .env.local, kill stale mcp-remote subprocesses).
 *
 * MCP reliability is product-critical per ADR-026 — a paying user
 * should be able to resolve a disconnect in under 60 seconds with
 * one command. This script is the customer-support shield.
 *
 * Usage:
 *   npm run reconnect-mcp           # diagnose only, report findings
 *   npm run reconnect-mcp -- --fix  # auto-apply fixes for fixable issues
 *
 * Steps (mirrors Runbook → "MCP disconnected" decision tree):
 *   1. Platform endpoint reachable + auth valid (curl
 *      /api/operating-instructions)
 *   2. MCP handshake works (POST /api/mcp initialize)
 *   3. Claude Desktop config has matching key + mcp-remote subprocess
 *      isn't wedged
 *   4. Force-clean reconnect (kill mcp-remote, prompt for Cmd-Q restart)
 *
 * Exit codes:
 *   0 = all checks passed (or --fix made everything pass)
 *   1 = at least one issue requires manual intervention
 *   2 = unexpected error during diagnosis
 */

import { promises as fs } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

const REPO_ROOT = resolve(__dirname, "..");
const ENV_LOCAL = join(REPO_ROOT, ".env.local");
const CLAUDE_DESKTOP_CONFIG = join(
  homedir(),
  "Library",
  "Application Support",
  "Claude",
  "claude_desktop_config.json",
);
const CLAUDE_MCP_LOG = join(
  homedir(),
  "Library",
  "Logs",
  "Claude",
  "mcp-server-shared-brain.log",
);
const PLATFORM_BASE =
  process.env.SHARED_BRAIN_BASE_URL || "https://shared-brain-ecru.vercel.app";

type StepResult = {
  step: number;
  name: string;
  status: "pass" | "fail" | "fixed" | "warn";
  detail?: string;
  fix_hint?: string;
};

const args = process.argv.slice(2);
const APPLY_FIXES = args.includes("--fix");

function readEnvKey(): string | null {
  if (!existsSync(ENV_LOCAL)) return null;
  const content = readFileSync(ENV_LOCAL, "utf8");
  const m = content.match(/^MCP_API_KEY=(.*)$/m);
  if (!m) return null;
  return m[1].replace(/^["']|["']$/g, "").trim() || null;
}

function readClaudeDesktopAuthHeader(): {
  exists: boolean;
  raw?: string;
  bearerKey?: string;
  parseError?: string;
} {
  if (!existsSync(CLAUDE_DESKTOP_CONFIG)) return { exists: false };
  try {
    const cfg = JSON.parse(readFileSync(CLAUDE_DESKTOP_CONFIG, "utf8"));
    const sb = cfg?.mcpServers?.["shared-brain"];
    if (!sb?.env?.AUTH_HEADER) return { exists: true, parseError: "no shared-brain MCP server entry with env.AUTH_HEADER" };
    const header: string = sb.env.AUTH_HEADER;
    const m = header.match(/^Bearer\s+(.+)$/);
    return {
      exists: true,
      raw: header,
      bearerKey: m ? m[1].trim() : undefined,
    };
  } catch (err) {
    return { exists: true, parseError: (err as Error).message };
  }
}

async function step1(envKey: string): Promise<StepResult> {
  // Endpoint health + auth validation
  try {
    const res = await fetch(`${PLATFORM_BASE}/api/operating-instructions?format=json`, {
      headers: { Authorization: `Bearer ${envKey}` },
    });
    if (res.status === 200) {
      return { step: 1, name: "Platform endpoint reachable + auth valid", status: "pass" };
    }
    if (res.status === 401) {
      return {
        step: 1,
        name: "Platform endpoint reachable + auth valid",
        status: "fail",
        detail: "401 Unauthorized — your local MCP_API_KEY doesn't match Vercel's",
        fix_hint: "Run `npm run rotate-key` to generate a new key + sync everywhere, OR manually update Vercel env vars to match .env.local and redeploy",
      };
    }
    return {
      step: 1,
      name: "Platform endpoint reachable + auth valid",
      status: "fail",
      detail: `${res.status} ${res.statusText}`,
      fix_hint: "Check vercel.com/dashboard → shared-brain → Deployments. If a recent deploy is stuck/failed, redeploy from the previous good commit",
    };
  } catch (err) {
    return {
      step: 1,
      name: "Platform endpoint reachable + auth valid",
      status: "fail",
      detail: `Network error: ${(err as Error).message}`,
      fix_hint: "Check internet connection",
    };
  }
}

async function step2(envKey: string): Promise<StepResult> {
  // MCP handshake
  try {
    const res = await fetch(`${PLATFORM_BASE}/api/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${envKey}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "reconnect-mcp", version: "1.0" },
        },
      }),
    });
    if (res.status !== 200) {
      return {
        step: 2,
        name: "MCP initialize handshake",
        status: "fail",
        detail: `HTTP ${res.status}`,
        fix_hint: "Server-side MCP route problem. Check Vercel runtime logs for /api/mcp",
      };
    }
    const text = await res.text();
    if (text.includes("\"result\":") && text.includes("protocolVersion")) {
      return { step: 2, name: "MCP initialize handshake", status: "pass" };
    }
    return {
      step: 2,
      name: "MCP initialize handshake",
      status: "fail",
      detail: `Unexpected response shape: ${text.slice(0, 200)}`,
      fix_hint: "Server may have changed protocol version; check /api/mcp route handler",
    };
  } catch (err) {
    return {
      step: 2,
      name: "MCP initialize handshake",
      status: "fail",
      detail: (err as Error).message,
    };
  }
}

async function step3(envKey: string, fix: boolean): Promise<StepResult> {
  // Claude Desktop config alignment + mcp-remote subprocess
  const cfg = readClaudeDesktopAuthHeader();
  if (!cfg.exists) {
    return {
      step: 3,
      name: "Claude Desktop config + mcp-remote",
      status: "warn",
      detail: "Claude Desktop config file not found — Claude Desktop may not be installed (or is using a non-default config path)",
    };
  }
  if (cfg.parseError) {
    return {
      step: 3,
      name: "Claude Desktop config + mcp-remote",
      status: "fail",
      detail: cfg.parseError,
      fix_hint: "Run `npm run install-skill claude` to regenerate Claude Desktop's shared-brain MCP config",
    };
  }
  if (!cfg.bearerKey) {
    return {
      step: 3,
      name: "Claude Desktop config + mcp-remote",
      status: "fail",
      detail: `AUTH_HEADER doesn't look like a Bearer token: ${cfg.raw?.slice(0, 30)}...`,
      fix_hint: "Run `npm run install-skill claude` or `npm run rotate-key`",
    };
  }
  if (cfg.bearerKey !== envKey) {
    if (fix) {
      // Sync Claude Desktop config to match .env.local without forcing
      // a full rotation. Most disconnects are config drift, not compromise.
      const cfgRaw = JSON.parse(readFileSync(CLAUDE_DESKTOP_CONFIG, "utf8"));
      cfgRaw.mcpServers["shared-brain"].env.AUTH_HEADER = `Bearer ${envKey}`;
      // Backup before write
      const backupPath = `${CLAUDE_DESKTOP_CONFIG}.bak.${Date.now()}`;
      await fs.copyFile(CLAUDE_DESKTOP_CONFIG, backupPath);
      await fs.writeFile(CLAUDE_DESKTOP_CONFIG, JSON.stringify(cfgRaw, null, 2) + "\n", { mode: 0o600 });
      return {
        step: 3,
        name: "Claude Desktop config + mcp-remote",
        status: "fixed",
        detail: `Synced AUTH_HEADER to match .env.local (backup at ${backupPath}). Quit Claude Desktop fully (Cmd-Q) and reopen.`,
      };
    }
    return {
      step: 3,
      name: "Claude Desktop config + mcp-remote",
      status: "fail",
      detail: "Claude Desktop's AUTH_HEADER doesn't match .env.local's MCP_API_KEY",
      fix_hint: "Re-run with --fix to sync, or manually edit ~/Library/Application Support/Claude/claude_desktop_config.json",
    };
  }

  // Config matches. Check for stuck mcp-remote subprocesses + log clues.
  let staleProcs = 0;
  try {
    const out = execSync('ps aux | grep "mcp-remote" | grep -v grep || true').toString();
    staleProcs = out.split("\n").filter((l) => l.trim()).length;
  } catch {
    /* swallow */
  }

  let recentLogPattern: string | null = null;
  if (existsSync(CLAUDE_MCP_LOG)) {
    try {
      const log = readFileSync(CLAUDE_MCP_LOG, "utf8").slice(-8000);
      if (log.includes("MaxListenersExceeded")) recentLogPattern = "MaxListenersExceeded — process leak";
      else if (log.includes("ECONNREFUSED")) recentLogPattern = "ECONNREFUSED — network blip";
      else if (log.match(/Authorization: \$\{AUTH_HEADER\}/)) recentLogPattern = "Literal ${AUTH_HEADER} (env expansion broken)";
      else if (log.includes("disconnected") || log.includes("closed")) recentLogPattern = "Connection closed/disconnected";
    } catch {
      /* swallow */
    }
  }

  if (staleProcs > 1 || recentLogPattern) {
    if (fix && staleProcs > 0) {
      try {
        execSync('pkill -f "mcp-remote" 2>/dev/null || true');
      } catch {
        /* swallow */
      }
      return {
        step: 3,
        name: "Claude Desktop config + mcp-remote",
        status: "fixed",
        detail: `Killed ${staleProcs} stale mcp-remote process(es). ${recentLogPattern ? `Recent log pattern: ${recentLogPattern}.` : ""} Quit Claude Desktop fully (Cmd-Q) and reopen.`,
      };
    }
    return {
      step: 3,
      name: "Claude Desktop config + mcp-remote",
      status: "warn",
      detail: `${staleProcs} mcp-remote process(es) running${recentLogPattern ? `; recent log: ${recentLogPattern}` : ""}`,
      fix_hint: "Re-run with --fix to kill stale processes, or run `pkill -f mcp-remote` manually then Cmd-Q + reopen Claude Desktop",
    };
  }

  return {
    step: 3,
    name: "Claude Desktop config + mcp-remote",
    status: "pass",
    detail: cfg.bearerKey === envKey ? "config aligned with .env.local" : undefined,
  };
}

function fmtStatus(r: StepResult): string {
  const icon = { pass: "✓", fail: "✗", fixed: "🔧", warn: "⚠" }[r.status];
  return `${icon} step ${r.step}: ${r.name}${r.detail ? ` — ${r.detail}` : ""}`;
}

async function main() {
  console.log(`Shared Brain — reconnect-mcp ${APPLY_FIXES ? "(fix mode)" : "(diagnose only)"}\n`);

  const envKey = readEnvKey();
  if (!envKey) {
    console.error("✗ Cannot read MCP_API_KEY from .env.local. Aborting.");
    console.error(`  Looked at: ${ENV_LOCAL}`);
    process.exit(2);
  }

  const results: StepResult[] = [];
  results.push(await step1(envKey));
  if (results[0].status === "pass") {
    results.push(await step2(envKey));
    results.push(await step3(envKey, APPLY_FIXES));
  }

  for (const r of results) console.log(fmtStatus(r));
  console.log("");

  const failures = results.filter((r) => r.status === "fail");
  const fixed = results.filter((r) => r.status === "fixed");
  const warnings = results.filter((r) => r.status === "warn");

  if (failures.length === 0 && fixed.length === 0 && warnings.length === 0) {
    console.log("All checks passed. MCP server side is healthy and Claude Desktop config is aligned.");
    console.log("If you're still seeing 'Server disconnected' in Claude Desktop, do a full Cmd-Q + reopen.");
    process.exit(0);
  }

  if (fixed.length > 0) {
    console.log("─── Fixes applied ───");
    for (const r of fixed) {
      if (r.detail) console.log(`  • ${r.detail}`);
    }
    console.log("");
  }

  if (warnings.length > 0) {
    console.log("─── Warnings (manual action recommended) ───");
    for (const r of warnings) {
      console.log(`  • ${r.detail}`);
      if (r.fix_hint) console.log(`    → ${r.fix_hint}`);
    }
    console.log("");
  }

  if (failures.length > 0) {
    console.log("─── Failures ───");
    for (const r of failures) {
      console.log(`  • step ${r.step}: ${r.detail}`);
      if (r.fix_hint) console.log(`    → ${r.fix_hint}`);
    }
    console.log("");
    process.exit(1);
  }

  // Fixed-or-warned only — exit 0 but encourage the restart
  console.log("Next: Cmd-Q Claude Desktop completely (not just close window) and reopen.");
  process.exit(0);
}

main().catch((err) => {
  console.error("reconnect-mcp failed:", (err as Error).message);
  process.exit(2);
});
