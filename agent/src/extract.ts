import fs from "node:fs/promises";
import path from "node:path";

export type ExtractResult = {
  text: string | null;
  wordCount: number;
  /** Why we didn't extract — null if extraction succeeded. Useful for logging. */
  skipReason: string | null;
};

const EMPTY: ExtractResult = { text: null, wordCount: 0, skipReason: null };

/**
 * Extract plain text from a binary file based on its extension. Returns null
 * text for file types we can't extract (images, audio, video) or when extraction
 * errors. The agent continues uploading the binary either way; only the
 * embedding/index step is affected.
 */
export async function extractText(absPath: string): Promise<ExtractResult> {
  const ext = path.extname(absPath).slice(1).toLowerCase();
  try {
    switch (ext) {
      case "pdf":
        return await extractPdf(absPath);
      case "docx":
        return await extractDocx(absPath);
      case "xlsx":
      case "xls":
      case "csv":
        return await extractSpreadsheet(absPath);
      case "txt":
      case "md":
      case "html":
      case "htm":
      case "json":
      case "yaml":
      case "yml":
      case "js":
      case "ts":
      case "py":
      case "sh":
        return await extractPlainText(absPath, ext);
      default:
        return { ...EMPTY, skipReason: `no extractor for .${ext}` };
    }
  } catch (err) {
    return { ...EMPTY, skipReason: `extract failed: ${(err as Error).message}` };
  }
}

async function extractPdf(absPath: string): Promise<ExtractResult> {
  // pdf-parse doesn't ship typings ergonomically; require it dynamically.
  const pdfParseMod = (await import("pdf-parse")) as unknown as {
    default: (buf: Buffer) => Promise<{ text: string }>;
  };
  const buf = await fs.readFile(absPath);
  const result = await pdfParseMod.default(buf);
  const text = (result.text ?? "").trim();
  return { text: text || null, wordCount: countWords(text), skipReason: null };
}

async function extractDocx(absPath: string): Promise<ExtractResult> {
  const mammoth = (await import("mammoth")) as unknown as {
    extractRawText: (arg: { path: string }) => Promise<{ value: string }>;
  };
  const result = await mammoth.extractRawText({ path: absPath });
  const text = (result.value ?? "").trim();
  return { text: text || null, wordCount: countWords(text), skipReason: null };
}

async function extractSpreadsheet(absPath: string): Promise<ExtractResult> {
  const XLSX = (await import("xlsx")) as unknown as {
    readFile: (path: string) => { SheetNames: string[]; Sheets: Record<string, unknown> };
    utils: { sheet_to_csv: (sheet: unknown) => string };
  };
  const wb = XLSX.readFile(absPath);
  const chunks: string[] = [];
  for (const name of wb.SheetNames) {
    chunks.push(`# Sheet: ${name}`);
    chunks.push(XLSX.utils.sheet_to_csv(wb.Sheets[name]));
    chunks.push("");
  }
  const text = chunks.join("\n").trim();
  return { text: text || null, wordCount: countWords(text), skipReason: null };
}

async function extractPlainText(absPath: string, ext: string): Promise<ExtractResult> {
  const raw = await fs.readFile(absPath, "utf8");
  let text = raw;
  // Strip HTML tags so search hits the words, not markup.
  if (ext === "html" || ext === "htm") {
    text = raw.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  }
  text = text.trim();
  return { text: text || null, wordCount: countWords(text), skipReason: null };
}

function countWords(text: string): number {
  if (!text) return 0;
  return (text.match(/\S+/g) ?? []).length;
}
