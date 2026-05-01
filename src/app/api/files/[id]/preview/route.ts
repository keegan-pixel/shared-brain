import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { head } from "@vercel/blob";
import { db } from "@/lib/db/client";
import { wikiPages } from "@/lib/db/schema";
import { ApiError, handle } from "@/lib/api";
import { ensureUserOrg } from "@/lib/org";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Returns rendered HTML for files we can preview server-side.
 *
 *   - DOCX → mammoth convertToHtml
 *   - XLSX/XLS → SheetJS sheet_to_html (one section per sheet)
 *   - CSV     → simple table render
 *
 * Returned shape: `{ html: string, sheets?: string[] }`. The wiki page UI
 * mounts the html with dangerouslySetInnerHTML inside a sandboxed wrapper.
 */
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const org = await ensureUserOrg();

  const [page] = await db
    .select()
    .from(wikiPages)
    .where(and(eq(wikiPages.id, id), eq(wikiPages.orgId, org.id)));
  if (!page) throw new ApiError("Not found", 404);
  if (!page.blobUrl) throw new ApiError("This page has no associated file", 404);

  const filePath = (page.metadata as { filePath?: string } | null)?.filePath ?? "";
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";

  if (!["docx", "xlsx", "xls", "csv"].includes(ext)) {
    throw new ApiError(`No preview available for .${ext}`, 415);
  }

  // Resolve a temporary download URL for private blobs.
  let downloadUrl: string;
  try {
    const meta = await head(page.blobUrl);
    downloadUrl = meta.downloadUrl ?? page.blobUrl;
  } catch {
    downloadUrl = page.blobUrl;
  }

  const upstream = await fetch(downloadUrl);
  if (!upstream.ok) throw new ApiError(`Blob fetch failed: ${upstream.status}`, 502);
  const arrayBuf = await upstream.arrayBuffer();
  const buf = Buffer.from(arrayBuf);

  if (ext === "docx") {
    const mammoth = (await import("mammoth")) as unknown as {
      convertToHtml: (arg: { buffer: Buffer }) => Promise<{ value: string }>;
    };
    const result = await mammoth.convertToHtml({ buffer: buf });
    return NextResponse.json({ html: result.value, sheets: null });
  }

  if (ext === "xlsx" || ext === "xls" || ext === "csv") {
    const XLSX = (await import("xlsx")) as unknown as {
      read: (data: Buffer, opts: { type: "buffer" }) => {
        SheetNames: string[];
        Sheets: Record<string, unknown>;
      };
      utils: {
        sheet_to_html: (sheet: unknown) => string;
      };
    };
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheets = wb.SheetNames;
    const html = sheets
      .map((name) => {
        const tableHtml = XLSX.utils.sheet_to_html(wb.Sheets[name]);
        return `<section data-sheet="${escapeHtmlAttr(name)}"><h3>${escapeHtmlText(name)}</h3>${tableHtml}</section>`;
      })
      .join("\n");
    return NextResponse.json({ html, sheets });
  }

  throw new ApiError(`No preview available for .${ext}`, 415);
});

function escapeHtmlText(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
function escapeHtmlAttr(s: string): string {
  return escapeHtmlText(s);
}
