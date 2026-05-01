import fs from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";

export function isBlobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/**
 * Upload a local file to Vercel Blob. Returns the public blob URL.
 * Caller decides what path-name to use; we mirror the vault-relative path
 * so blob URLs are predictable per file.
 */
export async function uploadFileToBlob(args: {
  absPath: string;
  vaultRelPath: string;
}): Promise<string | null> {
  if (!isBlobConfigured()) return null;
  const buf = await fs.readFile(args.absPath);
  // Normalize the blob pathname — keep the vault structure for browseability.
  const pathname = args.vaultRelPath.replace(/^\/+/, "");
  const result = await put(pathname, buf, {
    access: "public",
    contentType: contentTypeFor(args.absPath),
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return result.url;
}

function contentTypeFor(absPath: string): string {
  const ext = path.extname(absPath).slice(1).toLowerCase();
  const map: Record<string, string> = {
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
  return map[ext] ?? "application/octet-stream";
}
