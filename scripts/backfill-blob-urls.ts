/**
 * One-time (and idempotent) backfill: re-upload binary vault files
 * whose wiki_pages.blob_url is NULL.
 *
 * Why this exists: a window in 2026-04 / 2026-05 had two combined bugs:
 *   1. agent/src/index.ts watch handler filtered to *.md only, so new
 *      binaries added during watch were silently dropped.
 *   2. The launchd plist installed by scripts/install-daemon.ts didn't
 *      forward BLOB_READ_WRITE_TOKEN, so binaries that DID get synced
 *      (via fullScan on daemon restart) created wiki_pages rows with
 *      blob_url = NULL — the sync.ts upload path returns null when
 *      isBlobConfigured() is false.
 *
 * Both bugs are fixed in code, but existing rows need recovery. After
 * the daemon is reinstalled with the token, a `npm run sync:once` would
 * also re-upload because the agent's hash includes `blob:0|1` and flips
 * on token change — but that re-runs the whole sync pass. This script
 * is targeted: it walks affected rows directly, looks each file up via
 * vault_sync_log.file_path, uploads to Vercel Blob, and patches the
 * row. Safe to re-run; it only touches rows where blob_url IS NULL.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/backfill-blob-urls.ts --dry-run
 *   npx tsx scripts/backfill-blob-urls.ts                 # do it
 *   npx tsx scripts/backfill-blob-urls.ts --limit 25      # cap batch size
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { put } from "@vercel/blob";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { vaultSyncLog, wikiPages } from "../src/lib/db/schema";

const DRY_RUN = process.argv.includes("--dry-run");
// VAULT_PATH should be set explicitly for multi-tenant correctness.
// Fall back to ~/Documents/ViaOps so Keegan's local dev still works.
const VAULT_ROOT = process.env.VAULT_PATH || path.join(os.homedir(), "Documents", "ViaOps");

function parseLimit(): number | null {
  const i = process.argv.indexOf("--limit");
  if (i < 0) return null;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  heic: "image/heic",
  html: "text/html",
  htm: "text/html",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  zip: "application/zip",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

function contentTypeFor(absPath: string): string {
  const ext = path.extname(absPath).slice(1).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

type Candidate = {
  pageId: string;
  filePath: string;
  title: string;
};

async function findCandidates(limit: number | null): Promise<Candidate[]> {
  // Source of truth for "this is a binary": metadata.tags includes "file".
  // Cross-checked against vault_sync_log for the actual filesystem path
  // (metadata.filePath is also there, but the join keeps the mapping
  // explicit and lets us scope to rows that actually have a sync log
  // row — anything else is an orphan we don't want to touch).
  const rows = await db
    .select({
      pageId: wikiPages.id,
      title: wikiPages.title,
      filePath: vaultSyncLog.filePath,
    })
    .from(wikiPages)
    .innerJoin(
      vaultSyncLog,
      and(
        eq(vaultSyncLog.entityType, "wiki_page"),
        eq(vaultSyncLog.entityId, wikiPages.id),
      ),
    )
    .where(
      and(
        isNull(wikiPages.blobUrl),
        // metadata.tags is a json array; check via @>
        sql`${wikiPages.metadata}->'tags' @> '["file"]'::jsonb`,
      ),
    )
    .limit(limit ?? 10000);
  return rows;
}

async function uploadOne(
  c: Candidate,
): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  const absPath = path.join(VAULT_ROOT, c.filePath);
  let buf: Buffer;
  try {
    buf = await fs.readFile(absPath);
  } catch (err) {
    return { ok: false, reason: `read failed: ${(err as Error).message}` };
  }
  if (DRY_RUN) {
    return { ok: true, url: `<dry-run blob upload: ${buf.length} bytes>` };
  }
  try {
    const result = await put(c.filePath.replace(/^\/+/, ""), buf, {
      access: "private",
      contentType: contentTypeFor(absPath),
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return { ok: true, url: result.url };
  } catch (err) {
    return { ok: false, reason: `blob put failed: ${(err as Error).message}` };
  }
}

async function main() {
  if (!DRY_RUN && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN not set. Source .env.local first: " +
        "`set -a && source .env.local && set +a`",
    );
  }
  const limit = parseLimit();

  const candidates = await findCandidates(limit);
  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}` +
      `${candidates.length} wiki_pages with blob_url IS NULL and tags contains "file"` +
      (limit ? ` (limit=${limit})` : ""),
  );

  // Group by extension for a quick at-a-glance read.
  const byExt = new Map<string, number>();
  for (const c of candidates) {
    const ext = path.extname(c.filePath).slice(1).toLowerCase() || "(none)";
    byExt.set(ext, (byExt.get(ext) ?? 0) + 1);
  }
  for (const [ext, n] of [...byExt.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  .${ext}: ${n}`);
  }

  if (candidates.length === 0) {
    console.log("nothing to do.");
    return;
  }

  const stats = { uploaded: 0, missing: 0, errors: 0 };
  for (const c of candidates) {
    const res = await uploadOne(c);
    if (!res.ok) {
      if (res.reason.startsWith("read failed")) {
        stats.missing++;
        console.warn(`✗ ${c.filePath} — ${res.reason}`);
      } else {
        stats.errors++;
        console.warn(`✗ ${c.filePath} — ${res.reason}`);
      }
      continue;
    }

    if (!DRY_RUN) {
      await db
        .update(wikiPages)
        .set({ blobUrl: res.url, updatedAt: new Date() })
        .where(eq(wikiPages.id, c.pageId));
    }
    stats.uploaded++;
    console.log(`✓ ${c.filePath} → ${DRY_RUN ? res.url : "stored"}`);
  }

  console.log(
    `\n${DRY_RUN ? "[dry-run] " : ""}done: ${stats.uploaded} uploaded, ` +
      `${stats.missing} missing locally, ${stats.errors} errors`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
