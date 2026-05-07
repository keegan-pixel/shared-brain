import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { spaces, vaultSyncLog, wikiPages } from "@/lib/db/schema";
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
    embedding = await embed(embeddingInput);
  } catch (err) {
    console.warn(`[sync] embed failed for ${body.filePath}: ${(err as Error).message}`);
  }

  const metadata = {
    filePath: body.filePath,
    frontmatter: body.frontmatter ?? {},
    tags: body.tags ?? [],
  };

  let pageId: string;
  if (logRow?.entityType === "wiki_page" && logRow.entityId) {
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
