import OpenAI from "openai";
import { resolveOrgLlmKey } from "@/lib/llm-keys";

const EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * Phase 8 v2 — per-org embeddings.
 *
 * Each org brings its own OpenAI key (recommended for cheap embeddings)
 * or Anthropic key. The resolver picks the right provider for the
 * `embeddings` use case. Env-var fallback preserved for Keegan's
 * existing setup until he configures keys per-org via the UI.
 *
 * Note: callers that don't have an orgId in scope (e.g. legacy paths)
 * can pass `null` and we fall back to env-var resolution only. This
 * is the "config not yet migrated" path, not the new product-correct
 * path. Migrate callers as they're touched.
 */

let _envClient: OpenAI | null = null;
const _orgClients = new Map<string, OpenAI>();

function envClient(): OpenAI | null {
  if (_envClient) return _envClient;
  if (!process.env.OPENAI_API_KEY) return null;
  _envClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _envClient;
}

async function orgClient(orgId: string): Promise<OpenAI | null> {
  const cached = _orgClients.get(orgId);
  if (cached) return cached;
  const resolved = await resolveOrgLlmKey({
    orgId,
    useCase: "embeddings",
    provider: "openai",
  });
  if (!resolved) return null;
  const client = new OpenAI({ apiKey: resolved.apiKey });
  _orgClients.set(orgId, client);
  return client;
}

/**
 * Backwards-compat. True if ANY embeddings path is configured:
 * env var OR (eventually) at least one org has a key. The org-level
 * check is expensive to do here so we only check env. Callers that
 * need precise per-org status should call `isOrgEmbeddingsConfigured(orgId)`.
 */
export function isEmbeddingsConfigured() {
  return !!process.env.OPENAI_API_KEY;
}

export async function isOrgEmbeddingsConfigured(orgId: string): Promise<boolean> {
  const resolved = await resolveOrgLlmKey({
    orgId,
    useCase: "embeddings",
    provider: "openai",
  });
  return !!resolved;
}

/**
 * Generate an embedding vector. Pass `orgId` to use that org's key
 * (preferred); omit to use the env-var fallback (legacy path).
 */
export async function embed(text: string, orgId?: string): Promise<number[] | null> {
  const c = orgId ? await orgClient(orgId) : envClient();
  if (!c) return null;
  const trimmed = text.slice(0, 8000);
  const res = await c.embeddings.create({ model: EMBEDDING_MODEL, input: trimmed });
  return res.data[0]?.embedding ?? null;
}
