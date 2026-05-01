import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { vaultSyncLog, wikiPages } from "@/lib/db/schema";
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
  const embedding = await embed(embeddingInput);

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

  await logActivity({
    orgId,
    actorAgent: SYNC_ACTOR,
    action: logRow ? "sync_wiki_update" : "sync_wiki_create",
    entityType: "wiki_page",
    entityId: pageId,
    summary: `${logRow ? "Updated" : "Created"} wiki page "${body.title}" from ${body.filePath}`,
    metadata: { filePath: body.filePath },
  });

  await indexEntityLinks({
    orgId,
    source: { type: "wiki_page", id: pageId },
    body: body.content,
    frontmatter: body.frontmatter,
  });

  return NextResponse.json({ ok: true, pageId, action: logRow ? "updated" : "created" });
});
