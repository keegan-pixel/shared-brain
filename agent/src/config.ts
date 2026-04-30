import path from "node:path";

export type SyncConfig = {
  vaultRoot: string;
  apiBase: string;
  apiKey: string;
  /** Glob-ish prefixes within the vault that we sync. Anything outside is ignored. */
  includePrefixes: string[];
  /** Path prefixes to always skip even if inside an included prefix. */
  ignorePrefixes: string[];
  /** Concurrency cap for parallel API calls. */
  concurrency: number;
};

export function loadConfig(): SyncConfig {
  const vaultRoot = process.env.VAULT_PATH || "/Users/keeganlamar/Documents/ViaOps";
  const apiBase = process.env.SHARED_BRAIN_API_BASE || "https://shared-brain-ecru.vercel.app";
  const apiKey = process.env.MCP_API_KEY;
  if (!apiKey) {
    throw new Error(
      "MCP_API_KEY is not set. Export it before running: `export MCP_API_KEY=...` " +
        "(see Projects/shared-brain/.env.local for the value).",
    );
  }

  // Allow override via env for surgical / scoped syncs:
  //   SYNC_INCLUDE="Knowledge/Frameworks" npm run sync:once
  const includeOverride = process.env.SYNC_INCLUDE;
  const includePrefixes = includeOverride
    ? includeOverride.split(",").map((s) => s.trim()).filter(Boolean)
    : [
        "Knowledge",
        "Pipeline",
        "Clients",
        "SimHouse.io",
        "Meetings",
        "Dashboard/Daily Notes",
      ];

  return {
    vaultRoot,
    apiBase,
    apiKey,
    includePrefixes,
    ignorePrefixes: [
      ".obsidian",
      ".git",
      "node_modules",
      "Projects/shared-brain", // never recursively sync this repo into itself
      "Archive",                 // tomb files; out of scope
    ],
    concurrency: 5,
  };
}

export function relPath(absPath: string, vaultRoot: string): string {
  return path.relative(vaultRoot, absPath);
}
