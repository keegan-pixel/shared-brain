"use client";

import * as React from "react";
import { Download, ExternalLink } from "lucide-react";

type FilePreviewProps = {
  pageId: string;
  fileExt: string | null;
  obsidianHref?: string | null;
  isImage: boolean;
  /** Synthetic alt text — usually the wiki page title. */
  title: string;
};

const RENDERABLE_AS_HTML = new Set(["docx", "xlsx", "xls", "csv"]);

export function FilePreview({
  pageId,
  fileExt,
  obsidianHref,
  isImage,
  title,
}: FilePreviewProps) {
  const proxyUrl = `/api/files/${pageId}`;
  const downloadUrl = `${proxyUrl}?download=1`;
  const previewUrl = `${proxyUrl}/preview`;
  const isPdf = fileExt === "pdf";
  const isHtmlPreview = fileExt ? RENDERABLE_AS_HTML.has(fileExt) : false;

  const [htmlPreview, setHtmlPreview] = React.useState<string | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isHtmlPreview) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(previewUrl, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { html: string };
        if (!cancelled) setHtmlPreview(json.html);
      } catch (err) {
        if (!cancelled) setPreviewError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isHtmlPreview, previewUrl]);

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={downloadUrl}
          className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90"
        >
          <Download className="h-3.5 w-3.5" />
          Download {fileExt ? fileExt.toUpperCase() : "file"}
        </a>
        <a
          href={proxyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          Open in browser
        </a>
        {obsidianHref && (
          <a
            href={obsidianHref}
            className="inline-flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] hover:underline"
          >
            Open in Obsidian
          </a>
        )}
      </div>

      {/* Image preview */}
      {isImage && (
        <div className="mt-3 overflow-hidden rounded border border-[hsl(var(--border))]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={proxyUrl} alt={title} className="block max-h-[60vh] w-auto" loading="lazy" />
        </div>
      )}

      {/* PDF — browser native viewer via iframe */}
      {isPdf && (
        <div className="mt-3 overflow-hidden rounded border border-[hsl(var(--border))]">
          <iframe src={proxyUrl} title={title} className="h-[70vh] w-full bg-white" />
        </div>
      )}

      {/* DOCX / XLSX rendered as HTML */}
      {isHtmlPreview && (
        <div className="mt-3 overflow-hidden rounded border border-[hsl(var(--border))]">
          {previewError ? (
            <div className="p-4 text-xs text-[hsl(var(--muted-foreground))]">
              Couldn&apos;t render preview: {previewError}
            </div>
          ) : htmlPreview === null ? (
            <div className="p-4 text-xs text-[hsl(var(--muted-foreground))]">Loading preview…</div>
          ) : (
            <div
              className="file-preview-html max-h-[70vh] overflow-y-auto p-4"
              dangerouslySetInnerHTML={{ __html: htmlPreview }}
            />
          )}
        </div>
      )}

      {/* Other types — link only */}
      {!isImage && !isPdf && !isHtmlPreview && (
        <div className="mt-3 rounded border border-dashed border-[hsl(var(--border))] p-4 text-xs text-[hsl(var(--muted-foreground))]">
          No inline preview for{" "}
          <code className="rounded bg-[hsl(var(--muted))] px-1 py-0.5">.{fileExt ?? "file"}</code>{" "}
          — use Download above or the extracted-text snippet below.
        </div>
      )}

    </div>
  );
}
