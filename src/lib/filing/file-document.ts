/**
 * Phase F4 v1 — AI Filing Engine writer.
 *
 * Saves an external document (email body, meeting transcript, fetched
 * file content, etc.) into the user's vault at an AI-classified
 * location.
 *
 * The CALLER is the classifier — typically a Claude agent that reads
 * `get_operating_instructions` (routing rules) + `get_active_state`
 * (current world state) + the document content, then picks the
 * targetPath itself. This module is the writer + safety net:
 *
 *   - If the caller provides a confident targetPath (≥0.7), write
 *     there.
 *   - If the caller is uncertain (<0.7) or didn't provide a path,
 *     route to `Inbox/<safe-title>.md` and stamp metadata so the
 *     reconciliation loop (Phase F4 v3) can learn from where the user
 *     subsequently moves the file.
 *
 * Always writes server-side first (wiki_pages + vault_sync_log) so
 * the file appears immediately in the platform. The vault sync
 * agent's pull-down (Phase F4d) then materializes it locally as a
 * markdown file at the same path, so the local Obsidian vault stays
 * a complete mirror.
 */

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { wikiPages, vaultSyncLog } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { embed, isEmbeddingsConfigured } from "@/lib/embeddings";
import { indexEntityLinks } from "@/lib/connections/extract";

export const FILE_DOCUMENT_CONFIDENCE_THRESHOLD = 0.7;
export const INBOX_FOLDER = "Inbox";

export type FileDocumentInput = {
  orgId: string;
  actorAgent: string;
  /** Document title (becomes the wiki page title and filename basename). */
  title: string;
  /** Body content — markdown text. The caller is responsible for
   * extracting text from binary sources first if needed. */
  content: string;
  /** Vault-relative path with `.md` extension. Omit for Inbox routing. */
  targetPath?: string;
  /** 0–1 self-assessment of targetPath correctness. <0.7 → Inbox. */
  confidence?: number;
  /** Optional tags array; gets serialized into frontmatter. */
  tags?: string[];
  /** Additional frontmatter fields (e.g. `from`, `meeting_date`, etc.). */
  frontmatter?: Record<string, unknown>;
  /** Origin descriptor — e.g. "gmail:keegan@viaops.co/msg/...". */
  source?: string;
  /** Why this targetPath was chosen — surfaces in activity log. */
  reasoning?: string;
};

export type FileDocumentResult = {
  filePath: string;
  pageId: string;
  /** True if the file landed in Inbox/ instead of the suggested path. */
  routedToInbox: boolean;
  /** Human-readable explanation of the routing decision. */
  reason: string;
};

function safeFilenameSegment(s: string): string {
  return s
    .replace(/[\/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function renderBody(fm: Record<string, unknown>, content: string): string {
  const keys = Object.keys(fm).filter((k) => fm[k] !== null && fm[k] !== undefined);
  if (keys.length === 0) return content;
  const lines: string[] = ["---"];
  for (const k of keys) {
    const v = fm[k];
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]`);
    } else if (typeof v === "object" && v !== null) {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    } else if (typeof v === "string") {
      const needsQuotes = /[:#\[\]{}&*!|>'"%@`]/.test(v) || /^\s|\s$/.test(v);
      lines.push(`${k}: ${needsQuotes ? JSON.stringify(v) : v}`);
    } else {
      lines.push(`${k}: ${String(v)}`);
    }
  }
  lines.push("---", "");
  return `${lines.join("\n")}${content}`;
}

export async function fileDocument(input: FileDocumentInput): Promise<FileDocumentResult> {
  const conf = input.confidence ?? 0;
  const wantsTarget = !!input.targetPath?.trim();
  const routedToInbox = !wantsTarget || conf < FILE_DOCUMENT_CONFIDENCE_THRESHOLD;

  const safeTitle = safeFilenameSegment(input.title);
  const filePath = routedToInbox
    ? `${INBOX_FOLDER}/${safeTitle}.md`
    : input.targetPath!;

  // Frontmatter that always rides along with filed documents.
  const fm: Record<string, unknown> = {
    title: input.title,
    filed_at: new Date().toISOString(),
    filed_by: input.actorAgent,
    ...(input.frontmatter ?? {}),
  };
  if (input.tags && input.tags.length > 0) fm.tags = input.tags;
  if (input.source) fm.source = input.source;
  if (routedToInbox) {
    fm.filed_to_inbox = true;
    // Stamp the path the AI suggested but didn't get to use, so the
    // Phase F4 v3 reconciliation loop can compare against the path
    // the user ultimately moves the file to.
    if (wantsTarget) fm.suggested_path = input.targetPath;
    if (input.confidence !== undefined) fm.confidence = input.confidence;
    if (input.reasoning) fm.filing_reason = input.reasoning;
  }

  const body = renderBody(fm, input.content);
  // SHA1 to match the vault sync agent's hash function (`sha1(raw)`
  // in agent/src/hash.ts). Same hash space → server's
  // skip-if-unchanged check on push-back will return `skipped:true`
  // when the agent reads the file we wrote and round-trips it.
  const contentHash = createHash("sha1").update(body).digest("hex");

  // Embedding (best-effort).
  let embedding: number[] | null = null;
  if (isEmbeddingsConfigured()) {
    try {
      embedding = await embed(`${input.title}\n\n${input.content.slice(0, 6000)}`);
    } catch {
      /* swallow */
    }
  }

  // Check if a wiki page already exists at this path.
  const [existingLog] = await db
    .select()
    .from(vaultSyncLog)
    .where(eq(vaultSyncLog.filePath, filePath))
    .limit(1);

  // Stamp `platform_origin: 'file_document'` on the metadata so the
  // pull-down endpoint (Phase F4d) can distinguish file-document
  // writes from vault-pushed-up pages and bring them down to the
  // local Obsidian vault on the next sync. Without this flag, the
  // pull filter excludes any page that already has a vault_sync_log
  // row, including the ones we just created.
  const wikiMetadata = {
    filePath,
    frontmatter: fm,
    platform_origin: "file_document",
  };

  let pageId: string;
  let action: "created" | "updated";
  if (existingLog?.entityId && existingLog.entityType === "wiki_page") {
    pageId = existingLog.entityId;
    action = "updated";
    await db
      .update(wikiPages)
      .set({
        title: input.title,
        content: input.content,
        metadata: wikiMetadata,
        ...(embedding ? { embedding } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(wikiPages.id, pageId), eq(wikiPages.orgId, input.orgId)));
  } else {
    const [created] = await db
      .insert(wikiPages)
      .values({
        orgId: input.orgId,
        title: input.title,
        content: input.content,
        metadata: wikiMetadata,
        ...(embedding ? { embedding } : {}),
      })
      .returning({ id: wikiPages.id });
    pageId = created.id;
    action = "created";
  }

  // Upsert vault_sync_log. The pull-down endpoint (F4d) uses this to
  // know which platform-side wiki pages belong at which file paths,
  // and the agent's push-back skip-if-unchanged check uses
  // contentHash to avoid round-trip duplicates.
  await db
    .insert(vaultSyncLog)
    .values({
      filePath,
      entityType: "wiki_page",
      entityId: pageId,
      contentHash,
      status: "synced",
      lastSyncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: vaultSyncLog.filePath,
      set: {
        entityType: "wiki_page",
        entityId: pageId,
        contentHash,
        status: "synced",
        lastSyncedAt: new Date(),
        errorMessage: null,
      },
    });

  // Index any [[wikilinks]] that appear in the body — same treatment
  // as the regular wiki sync route gives to incoming edits.
  try {
    await indexEntityLinks({
      orgId: input.orgId,
      source: { type: "wiki_page", id: pageId },
      body: input.content,
      frontmatter: fm,
    });
  } catch {
    /* swallow — non-fatal */
  }

  await logActivity({
    orgId: input.orgId,
    actorAgent: input.actorAgent,
    action: routedToInbox ? "file_document_inbox" : "file_document",
    entityType: "wiki_page",
    entityId: pageId,
    summary: routedToInbox
      ? `Filed "${input.title}" → Inbox (confidence ${(conf * 100).toFixed(0)}%)`
      : `Filed "${input.title}" → ${filePath}${input.reasoning ? ` (${input.reasoning})` : ""}`,
    metadata: {
      filePath,
      routedToInbox,
      action,
      ...(input.targetPath ? { suggestedPath: input.targetPath } : {}),
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
      ...(input.source ? { source: input.source } : {}),
      ...(input.reasoning ? { reasoning: input.reasoning } : {}),
    },
  });

  return {
    filePath,
    pageId,
    routedToInbox,
    reason: routedToInbox
      ? wantsTarget
        ? `Confidence ${(conf * 100).toFixed(0)}% < ${(FILE_DOCUMENT_CONFIDENCE_THRESHOLD * 100).toFixed(0)}% threshold; routed to Inbox. Suggested path was: ${input.targetPath}`
        : "No targetPath provided; routed to Inbox for user review."
      : input.reasoning ?? "AI-classified destination",
  };
}
