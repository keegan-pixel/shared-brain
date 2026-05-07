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

import { eq, gt, and, isNull, or, sql } from "drizzle-orm";
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
        // Two classes of "platform-only, needs materialization":
        //   (a) no vault_sync_log row at all (pages created directly via DB
        //       or chat tools without going through the writer)
        //   (b) metadata.platform_origin = 'file_document' (pages created
        //       by the F4 v1 AI Filing Engine — these have a log row
        //       written immediately for round-trip duplicate prevention,
        //       but the local file doesn't exist yet)
        or(
          isNull(vaultSyncLog.filePath),
          sql`${wikiPages.metadata}->>'platform_origin' = 'file_document'`,
        ),
        isNull(wikiPages.blobUrl),
      ),
    );

  // Build the agent-friendly response. We pre-render the body the
  // agent should write (frontmatter + content) and pre-compute the
  // expected contentHash. Critically, we also INSERT a vault_sync_log
  // row for each pulled page if one doesn't exist — this prevents the
  // round-trip duplicate bug (file gets pulled → written locally →
  // chokidar fires → push-up can't find a log → creates a 2nd wiki
  // page with the same title).
  const pages: Array<{
    id: string;
    filePath: string;
    title: string;
    body: string;
    contentHash: string;
    updatedAt: Date;
    hasExistingLog: boolean;
  }> = [];

  for (const r of rows) {
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
    // SHA1 to match (a) agent/src/hash.ts (`sha1(raw)`), (b)
    // file_document.ts. Single hash space across all three sites is
    // what makes move-detection + skip-if-unchanged work.
    const contentHash = createHash("sha1").update(body).digest("hex");

    // Idempotent: insert log row if missing, do nothing if it already
    // exists. Uses ON CONFLICT on file_path (the unique key).
    if (!r.logFilePath) {
      await db
        .insert(vaultSyncLog)
        .values({
          filePath,
          entityType: "wiki_page",
          entityId: r.id,
          contentHash,
          status: "synced",
          lastSyncedAt: new Date(),
        })
        .onConflictDoNothing({ target: vaultSyncLog.filePath });
    }

    pages.push({
      id: r.id,
      filePath,
      title: r.title,
      body,
      contentHash,
      updatedAt: r.updatedAt,
      hasExistingLog: r.logFilePath != null,
    });
  }

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
