/**
 * Phase F4d — Vault pull-down endpoint.
 *
 * Returns wiki pages updated since `since` (ISO timestamp), with the
 * minimum information the local agent needs to materialize them as
 * markdown files in the vault: filePath, frontmatter, body, and the
 * server-side contentHash used by the existing skip-if-unchanged
 * push pipeline.
 *
 * Pages WITHOUT a `metadata.filePath` are also returned, with a
 * derived default path under `Knowledge/Sessions/` — these are
 * platform-only entries (chat-created session summaries, etc.) that
 * we want to materialize so the local Obsidian vault stays a complete
 * mirror.
 *
 * Items are NOT included for v1: they live inside parent `_Tasks.md`
 * files, not as standalone files. Pull-down for items would require
 * a richer round-trip (re-render the parent file from current task
 * state). Deferred to v2 if needed.
 *
 * Auth: same Bearer pattern as other /api/sync/* routes.
 */

import { eq, gt, and, isNull } from "drizzle-orm";
import { wikiPages, vaultSyncLog } from "@/lib/db/schema";
import { db } from "@/lib/db/client";
import { resolveSyncOrg } from "@/lib/sync/context";
import { requireSyncAuth } from "@/lib/sync/auth";
import { handle } from "@/lib/api";
import { createHash } from "node:crypto";

// Reasonable default if the agent's first-ever pull has no `since`:
// pull everything from the last 30 days.
const DEFAULT_SINCE_DAYS = 30;

function safeFilenameSegment(s: string): string {
  return s
    .replace(/[\/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * Fallback path for pages without a metadata.filePath. Goes under
 * Knowledge/Sessions/ — the canonical vault location for chat /
 * platform-originated entries per Profile.md routing rules.
 */
function fallbackFilePath(title: string): string {
  return `Knowledge/Sessions/${safeFilenameSegment(title)}.md`;
}

function buildBody(args: {
  title: string;
  content: string;
  frontmatter: Record<string, unknown> | undefined;
}): string {
  // If frontmatter is present and non-empty, prepend it as YAML.
  const fm = args.frontmatter ?? {};
  const fmKeys = Object.keys(fm);
  if (fmKeys.length === 0) return args.content;
  const yamlLines: string[] = ["---"];
  for (const k of fmKeys) {
    const v = fm[k];
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      yamlLines.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]`);
    } else if (typeof v === "object") {
      yamlLines.push(`${k}: ${JSON.stringify(v)}`);
    } else if (typeof v === "string") {
      // Quote strings that contain special YAML characters.
      const needsQuotes = /[:#\[\]{}&*!|>'"%@`]/.test(v) || /^\s|\s$/.test(v);
      yamlLines.push(`${k}: ${needsQuotes ? JSON.stringify(v) : v}`);
    } else {
      yamlLines.push(`${k}: ${String(v)}`);
    }
  }
  yamlLines.push("---", "");
  return `${yamlLines.join("\n")}${args.content}`;
}

export const GET = handle(async (req: Request) => {
  requireSyncAuth(req);
  const { orgId } = await resolveSyncOrg();

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam
    ? new Date(sinceParam)
    : new Date(Date.now() - DEFAULT_SINCE_DAYS * 24 * 60 * 60 * 1000);
  if (Number.isNaN(since.getTime())) {
    return Response.json(
      { error: "Invalid `since` parameter (expected ISO timestamp)" },
      { status: 400 },
    );
  }

  // Pull only PLATFORM-CREATED wiki pages — those with no
  // vault_sync_log entry. Pages pushed up from the local vault
  // already have a local markdown file (with possibly-divergent
  // frontmatter formatting), so re-materializing them would create
  // false conflicts. Pure platform entries (chat session summaries,
  // mobile-created pages, future multi-user contributions) are the
  // ones we actually need to bring down.
  //
  // Also exclude file_artifact pages (those with blob_url set) —
  // those represent binary files that live in Vercel Blob, not
  // markdown that should land in the vault.
  const rows = await db
    .select({
      id: wikiPages.id,
      title: wikiPages.title,
      content: wikiPages.content,
      blobUrl: wikiPages.blobUrl,
      metadata: wikiPages.metadata,
      updatedAt: wikiPages.updatedAt,
      logFilePath: vaultSyncLog.filePath,
    })
    .from(wikiPages)
    .leftJoin(
      vaultSyncLog,
      and(
        eq(vaultSyncLog.entityType, "wiki_page"),
        eq(vaultSyncLog.entityId, wikiPages.id),
      ),
    )
    .where(
      and(
        eq(wikiPages.orgId, orgId),
        gt(wikiPages.updatedAt, since),
        isNull(vaultSyncLog.filePath),
        isNull(wikiPages.blobUrl),
      ),
    );

  // Build the agent-friendly response. We pre-render the body the
  // agent should write (frontmatter + content) and pre-compute the
  // expected contentHash so the agent can write vault_sync_log
  // identically and avoid push-back loops.
  const pages = rows.map((r) => {
    const metadata = (r.metadata ?? {}) as {
      filePath?: string;
      frontmatter?: Record<string, unknown>;
    };
    const filePath = metadata.filePath ?? r.logFilePath ?? fallbackFilePath(r.title);
    const body = buildBody({
      title: r.title,
      content: r.content,
      frontmatter: metadata.frontmatter,
    });
    // Hash matches what the agent would compute when round-tripping.
    // The agent uses md5(body) — no version prefix, no trailing newline
    // normalization here, since the agent's own hash function adds the
    // version prefix.
    const contentHash = createHash("md5").update(body).digest("hex");

    return {
      id: r.id,
      filePath,
      title: r.title,
      body,
      contentHash,
      updatedAt: r.updatedAt,
      // Tell the agent whether the platform already has a vault_sync_log
      // row for this entity. If yes, the agent should rely on the existing
      // log; if no, the agent should treat as a brand-new local file.
      hasExistingLog: r.logFilePath != null,
    };
  });

  // Cursor: use the max updatedAt of returned pages, OR `since` if no
  // pages came back, so the agent can advance to "now".
  const cursor = pages.reduce<Date>(
    (acc, p) => (p.updatedAt > acc ? p.updatedAt : acc),
    since,
  );

  return Response.json({
    pulled_at: new Date().toISOString(),
    since: since.toISOString(),
    cursor: cursor.toISOString(),
    page_count: pages.length,
    pages,
  });
});
