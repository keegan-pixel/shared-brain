import OpenAI from "openai";

const EMBEDDING_MODEL = "text-embedding-3-small";

let _client: OpenAI | null = null;

function client() {
  if (_client) return _client;
  if (!process.env.OPENAI_API_KEY) return null;
  _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

export function isEmbeddingsConfigured() {
  return !!process.env.OPENAI_API_KEY;
}

export async function embed(text: string): Promise<number[] | null> {
  const c = client();
  if (!c) return null;
  const trimmed = text.slice(0, 8000);
  const res = await c.embeddings.create({ model: EMBEDDING_MODEL, input: trimmed });
  return res.data[0]?.embedding ?? null;
}
