import { and, eq } from "drizzle-orm";
import { get } from "@vercel/blob";
import { db } from "@/lib/db/client";
import { wikiPages } from "@/lib/db/schema";
import { ApiError, handle, jsonError } from "@/lib/api";
import { ensureUserOrg } from "@/lib/org";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Server-side proxy for files stored in Vercel Blob.
 *
 *   GET /api/files/<wikiPageId>             → inline (PDFs render in iframe)
 *   GET /api/files/<wikiPageId>?download=1  → forces attachment disposition
 *
 * Auth: Clerk session (via the global proxy.ts). The actual private blob URL
 * never reaches the client; @vercel/blob.get() handles auth using the
 * BLOB_READ_WRITE_TOKEN env var server-side.
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const forceDownload = url.searchParams.get("download") === "1";

  const org = await ensureUserOrg();
  const [page] = await db
    .select()
    .from(wikiPages)
    .where(and(eq(wikiPages.id, id), eq(wikiPages.orgId, org.id)));
  if (!page) throw new ApiError("Not found", 404);
  if (!page.blobUrl) throw new ApiError("This page has no associated file", 404);

  const result = await get(page.blobUrl, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) {
    return jsonError(`Blob fetch failed (status ${result?.statusCode ?? "unknown"})`, 502);
  }

  // Pull a friendly filename out of metadata.filePath (when synced from vault).
  const filePath =
    (page.metadata as { filePath?: string } | null)?.filePath ?? null;
  const filename = filePath
    ? filePath.split("/").pop()
    : page.title;
  const disposition = `${forceDownload ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(
    filename ?? "file",
  )}`;

  const headers = new Headers({
    "Content-Type": result.blob.contentType || "application/octet-stream",
    "Content-Disposition": disposition,
    "Cache-Control": "private, max-age=60",
  });
  if (typeof result.blob.size === "number") {
    headers.set("Content-Length", String(result.blob.size));
  }

  return new Response(result.stream, { status: 200, headers });
});
