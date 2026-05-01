import { and, eq } from "drizzle-orm";
import { head } from "@vercel/blob";
import { db } from "@/lib/db/client";
import { wikiPages } from "@/lib/db/schema";
import { ApiError, handle, jsonError } from "@/lib/api";
import { ensureUserOrg } from "@/lib/org";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Server-side proxy for files stored in Vercel Blob. Auth'd via the same
 * Clerk session as the rest of the app, so any signed-in org member can
 * download / preview files even though the underlying blob is private.
 *
 * - GET /api/files/<wikiPageId>           → inline (PDFs render in browser viewer)
 * - GET /api/files/<wikiPageId>?download=1 → forces attachment disposition
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

  // Resolve the actual download URL via blob head() — works for both public
  // and private stores. For private blobs head() returns metadata including
  // a temporary signed downloadUrl we can fetch from the server.
  let downloadUrl: string;
  try {
    const meta = await head(page.blobUrl);
    downloadUrl = meta.downloadUrl ?? page.blobUrl;
  } catch {
    // Fall back to the stored URL — works if the store is public.
    downloadUrl = page.blobUrl;
  }

  // Stream the bytes back to the caller.
  const upstream = await fetch(downloadUrl);
  if (!upstream.ok || !upstream.body) {
    return jsonError(`Upstream blob fetch failed: ${upstream.status}`, 502);
  }

  const contentType =
    upstream.headers.get("content-type") ?? "application/octet-stream";
  const contentLength = upstream.headers.get("content-length");

  // Pull a friendly filename out of metadata.filePath (if synced from vault).
  const filePath =
    (page.metadata as { filePath?: string } | null)?.filePath ?? null;
  const filename = filePath
    ? filePath.split("/").pop()
    : page.title + extensionFromContentType(contentType);
  const disposition = `${forceDownload ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(
    filename ?? "file",
  )}`;

  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": disposition,
    // Brief private cache so repeated previews don't re-fetch from blob.
    "Cache-Control": "private, max-age=60",
  });
  if (contentLength) headers.set("Content-Length", contentLength);

  return new Response(upstream.body, { status: 200, headers });
});

function extensionFromContentType(ct: string): string {
  const map: Record<string, string> = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "image/webp": ".webp",
    "text/plain": ".txt",
    "text/html": ".html",
    "text/csv": ".csv",
    "application/json": ".json",
    "application/zip": ".zip",
  };
  return map[ct] ?? "";
}
