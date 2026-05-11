import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { filingRules, spaces, vaultSyncLog, wikiPages } from "@/lib/db/schema";
import { handle, parseJson } from "@/lib/api";
import { embed } from "@/lib/embeddings";
import { logActivity } from "@/lib/activity";
import { indexEntityLinks } from "@/lib/connections/extract";
import { SYNC_ACTOR, resolveSyncOrg } from "@/lib/sync/context";
import { requireSyncAuth } from "@/lib/sync/auth";

const Schema = z.object({
  filePath: z.string().min(1),
  title: z.string().min(1).max(240),
  content: z.string(),
  contentHash: z.string().min(1),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  blobUrl: z.string().url().optional(),
  extractedText: z.string().optional(),
  extractedWordCount: z.number().int().nonnegative().optional(),
});

/**
 * Map a vault file path to the space it belongs to so the activity feed's
 * space filter (which checks metadata.spaceId) can scope synced wiki
 * pages correctly. Returns null for cross-cutting / global content like
 * `Knowledge/`, `Pipeline/`, `Meetings/` (top-level), `Dashboard/`, etc.
 */
async function deriveSpaceIdFromPath(
  orgId: string,
  filePath: string,
): Promise<string | null> {
  const segs = filePath.split("/");
  if (segs.length < 2) return null;
  let spaceName: string | null = null;
  if (segs[0] === "Clients") spaceName = segs[1];
  else if (segs[0] === "SimHouse.io") spaceName = "SimHouse.io";
  else if (segs[0] === "Coaching") spaceName = "Coaching";
  if (!spaceName) return null;
  const [row] = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(and(eq(spaces.orgId, orgId), eq(spaces.name, spaceName)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Build the input string we send to the embedding model. For prose pages
 * (no extracted_text), we use title + content. For binary files with
 * extracted text, we prefer title + extracted_text (the synthetic content
 * is mostly metadata; the actual document text is what users want to find).
 *
 * Cap at ~6000 chars to stay well under the 8K-token limit of
 * text-embedding-3-small.
 */
function buildEmbeddingInput(args: {
  title: string;
  content: string;
  extractedText?: string;
}): string {
  const MAX_CHARS = 6000;
  if (args.extractedText && args.extractedText.trim()) {
    return `${args.title}\n\n${args.extractedText.slice(0, MAX_CHARS)}`;
  }
  return `${args.title}\n\n${args.content.slice(0, MAX_CHARS)}`;
}

export const POST = handle(async (req: Request) => {
  requireSyncAuth(req);
  const body = await parseJson(req, Schema);
  const { orgId } = await resolveSyncOrg();

  const [logRow] = await db
    .select()
    .from(vaultSyncLog)
    .where(eq(vaultSyncLog.filePath, body.filePath));

  if (logRow && logRow.contentHash === body.contentHash && logRow.entityId) {
    return NextResponse.json({ ok: true, skipped: true, pageId: logRow.entityId });
  }

  const embeddingInput = buildEmbeddingInput({
    title: body.title,
    content: body.content,
    extractedText: body.extractedText,
  });
  // Embeddings are best-effort — never let a bad input vector 500 the whole
  // sync. We still create/update the page; semantic search just won't hit
  // this entry until the next successful embed.
  let embedding: number[] | null = null;
  try {
    embedding = await embed(embeddingInput, orgId);
  } catch (err) {
    console.warn(`[sync] embed failed for ${body.filePath}: ${(err as Error).message}`);
  }

  const metadata = {
    filePath: body.filePath,
    frontmatter: body.frontmatter ?? {},
    tags: body.tags ?? [],
  };

  // ─── Phase F4 v3 — Move detection + rule learning ────────────────
  // When a no-log-row push comes in (potential new file), check
  // whether it's actually a MOVE of an existing Inbox-routed page.
  // If so: update the existing page's filePath in place + delete the
  // stale Inbox log row + record the rule for future short-circuit.
  let movedFromInbox: { fromPath: string; pageId: string; frontmatter: Record<string, unknown> } | null = null;
  if (!logRow) {
    const [candidate] = await db
      .select({ id: wikiPages.id, metadata: wikiPages.metadata, fromLog: vaultSyncLog.filePath })
      .from(wikiPages)
      .innerJoin(
        vaultSyncLog,
        and(eq(vaultSyncLog.entityType, "wiki_page"), eq(vaultSyncLog.entityId, wikiPages.id)),
      )
      .where(
        and(
          eq(wikiPages.orgId, orgId),
          eq(wikiPages.title, body.title),
          eq(vaultSyncLog.contentHash, body.contentHash),
        ),
      )
      .limit(1);
    if (candidate) {
      const meta = (candidate.metadata ?? {}) as {
        platform_origin?: string;
        frontmatter?: Record<string, unknown>;
      };
      const fm = meta.frontmatter ?? {};
      // Only treat as a learnable move if the source was an
      // Inbox-routed file_document write. Regular vault-pushed-up
      // files moving around shouldn't trigger rule creation — that
      // would be noisy.
      if (meta.platform_origin === "file_document" && fm.filed_to_inbox) {
        movedFromInbox = { fromPath: candidate.fromLog, pageId: candidate.id, frontmatter: fm };
        // Delete the stale Inbox log row; the new one gets written below.
        await db.delete(vaultSyncLog).where(eq(vaultSyncLog.filePath, candidate.fromLog));
      }
    }
  }

  let pageId: string;
  if (movedFromInbox) {
    // Update the existing page in place — clear filed_to_inbox + the
    // suggested_path stamp since the user has now placed it where it
    // belongs. Update the filePath metadata to the new location.
    const oldFm = (movedFromInbox.frontmatter ?? {}) as Record<string, unknown>;
    const cleanedFm: Record<string, unknown> = { ...oldFm };
    delete cleanedFm.filed_to_inbox;
    delete cleanedFm.suggested_path;
    delete cleanedFm.confidence;
    delete cleanedFm.filing_reason;
    const movedMetadata = {
      filePath: body.filePath,
      frontmatter: cleanedFm,
      tags: body.tags ?? [],
      // Drop platform_origin so the pull endpoint doesn't keep
      // surfacing this page as needing materialization.
    };
    const [updated] = await db
      .update(wikiPages)
      .set({
        title: body.title,
        content: body.content,
        metadata: movedMetadata,
        ...(embedding ? { embedding } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(wikiPages.id, movedFromInbox.pageId), eq(wikiPages.orgId, orgId)))
      .returning({ id: wikiPages.id });
    pageId = updated.id;

    // ── RULE LEARNING ──────────────────────────────────────────────
    // If the original Inbox file had a recognizable source pattern
    // (e.g. `email_from`), record the {match → target_path} mapping
    // so the next file_document call with the same source skips
    // Inbox and goes straight to this folder.
    const targetFolder = body.filePath.includes("/")
      ? body.filePath.slice(0, body.filePath.lastIndexOf("/")) + "/"
      : "/";

    const ruleCandidates: Array<{ kind: string; value: string }> = [];
    if (typeof oldFm.email_from === "string" && oldFm.email_from.length > 0) {
      ruleCandidates.push({ kind: "gmail_from", value: oldFm.email_from });
    }
    // (Future: meeting_attendee, drive_folder_id, etc.)

    for (const rule of ruleCandidates) {
      const existing = await db
        .select()
        .from(filingRules)
        .where(
          and(
            eq(filingRules.orgId, orgId),
            eq(filingRules.matchKind, rule.kind),
            eq(filingRules.matchValue, rule.value),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        await db
          .update(filingRules)
          .set({
            targetPath: targetFolder,
            hitCount: existing[0].hitCount + 1,
            lastMatchedAt: new Date(),
          })
          .where(eq(filingRules.id, existing[0].id));
      } else {
        await db.insert(filingRules).values({
          orgId,
          matchKind: rule.kind,
          matchValue: rule.value,
          targetPath: targetFolder,
        });
      }
      console.info(
        `[F4 v3] learned filing rule: ${rule.kind}=${rule.value} → ${targetFolder} (from move out of Inbox)`,
      );
    }
  } else if (logRow?.entityType === "wiki_page" && logRow.entityId) {
    const [updated] = await db
      .update(wikiPages)
      .set({
        title: body.title,
        content: body.content,
        metadata,
        ...(embedding ? { embedding } : {}),
        ...(body.blobUrl !== undefined ? { blobUrl: body.blobUrl } : {}),
        ...(body.extractedText !== undefined ? { extractedText: body.extractedText } : {}),
        ...(body.extractedWordCount !== undefined
          ? { extractedWordCount: body.extractedWordCount }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(wikiPages.id, logRow.entityId), eq(wikiPages.orgId, orgId)))
      .returning({ id: wikiPages.id });
    pageId = updated.id;
  } else {
    const [created] = await db
      .insert(wikiPages)
      .values({
        orgId,
        title: body.title,
        content: body.content,
        metadata,
        ...(embedding ? { embedding } : {}),
        blobUrl: body.blobUrl ?? null,
        extractedText: body.extractedText ?? null,
        extractedWordCount: body.extractedWordCount ?? null,
      })
      .returning({ id: wikiPages.id });
    pageId = created.id;
  }

  await db
    .insert(vaultSyncLog)
    .values({
      filePath: body.filePath,
      entityType: "wiki_page",
      entityId: pageId,
      contentHash: body.contentHash,
      status: "synced",
      lastSyncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: vaultSyncLog.filePath,
      set: {
        entityType: "wiki_page",
        entityId: pageId,
        contentHash: body.contentHash,
        status: "synced",
        lastSyncedAt: new Date(),
        errorMessage: null,
      },
    });

  // Resolve which space this file belongs to so the activity-feed
  // space filter scopes correctly. Null for cross-cutting content.
  const derivedSpaceId = await deriveSpaceIdFromPath(orgId, body.filePath);

  await logActivity({
    orgId,
    actorAgent: SYNC_ACTOR,
    action: logRow ? "sync_wiki_update" : "sync_wiki_create",
    entityType: "wiki_page",
    entityId: pageId,
    summary: `${logRow ? "Updated" : "Created"} wiki page "${body.title}" from ${body.filePath}`,
    metadata: {
      filePath: body.filePath,
      ...(derivedSpaceId ? { spaceId: derivedSpaceId } : {}),
    },
  });

  await indexEntityLinks({
    orgId,
    source: { type: "wiki_page", id: pageId },
    body: body.content,
    frontmatter: body.frontmatter,
  });

  return NextResponse.json({ ok: true, pageId, action: logRow ? "updated" : "created" });
});
