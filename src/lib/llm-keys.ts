/**
 * Phase 8 v2 — per-org LLM API key resolution + validation.
 *
 * The brain doesn't pay for embeddings or chat. Each org brings its
 * own provider key(s). This module is the central resolver: given an
 * org and a use-case (`chat`, `embeddings`, `filing`, etc.), it
 * returns the right (provider, key, model) tuple.
 *
 * Fallback order:
 *   1. Exact match: row with `provider = ?` AND use_for includes the
 *      specific use-case → return it.
 *   2. Provider match: row with `provider = ?` AND use_for includes
 *      `'all'` → return it.
 *   3. Env-var fallback: process.env.ANTHROPIC_API_KEY /
 *      OPENAI_API_KEY. Logs a deprecation warning. This is the
 *      legacy path that keeps Keegan's existing setup working until
 *      he sets keys via the UI.
 *   4. null → caller decides graceful degradation (skip embeddings,
 *      surface error to user, etc.).
 *
 * Key validation: a quick API call to the provider's `models` endpoint
 * (or equivalent low-cost call) before we save. Returns ok / error.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orgLlmConfig, type OrgLlmProvider } from "@/lib/db/schema";

export type LlmUseCase = "chat" | "embeddings" | "filing" | "classification" | "semantic" | "all";

export type ResolvedLlmKey = {
  provider: OrgLlmProvider;
  apiKey: string;
  defaultModel: string | null;
  source: "org-config" | "env-fallback";
};

const ENV_FALLBACK: Record<OrgLlmProvider, () => string | undefined> = {
  anthropic: () => process.env.ANTHROPIC_API_KEY,
  openai: () => process.env.OPENAI_API_KEY,
  gemini: () => process.env.GEMINI_API_KEY,
};

/**
 * Resolve a key for an org + use case. Specify `provider` if you need
 * a specific one (e.g. embeddings → openai). Otherwise the resolver
 * walks providers in a sensible order based on the use case.
 */
export async function resolveOrgLlmKey(args: {
  orgId: string;
  useCase: LlmUseCase;
  provider?: OrgLlmProvider;
}): Promise<ResolvedLlmKey | null> {
  const { orgId, useCase } = args;

  // Try requested provider first; else walk preferred order.
  const providersToTry: OrgLlmProvider[] = args.provider
    ? [args.provider]
    : preferredProviders(useCase);

  for (const provider of providersToTry) {
    // Specific use_for match first.
    const [exact] = await db
      .select()
      .from(orgLlmConfig)
      .where(
        and(
          eq(orgLlmConfig.orgId, orgId),
          eq(orgLlmConfig.provider, provider),
          sql`${orgLlmConfig.useFor} @> ARRAY[${useCase}]::text[]`,
        ),
      )
      .limit(1);
    if (exact) {
      return {
        provider,
        apiKey: exact.apiKey,
        defaultModel: exact.defaultModel,
        source: "org-config",
      };
    }
    // 'all' fallback within the provider.
    const [generic] = await db
      .select()
      .from(orgLlmConfig)
      .where(
        and(
          eq(orgLlmConfig.orgId, orgId),
          eq(orgLlmConfig.provider, provider),
          sql`${orgLlmConfig.useFor} @> ARRAY['all']::text[]`,
        ),
      )
      .limit(1);
    if (generic) {
      return {
        provider,
        apiKey: generic.apiKey,
        defaultModel: generic.defaultModel,
        source: "org-config",
      };
    }
  }

  // Env-var fallback (legacy path).
  for (const provider of providersToTry) {
    const envKey = ENV_FALLBACK[provider]();
    if (envKey) {
      if (process.env.NODE_ENV !== "test") {
        console.warn(
          `[llm-keys] org=${orgId} use=${useCase} provider=${provider} — using env-var fallback (no org config set)`,
        );
      }
      return {
        provider,
        apiKey: envKey,
        defaultModel: null,
        source: "env-fallback",
      };
    }
  }

  return null;
}

function preferredProviders(useCase: LlmUseCase): OrgLlmProvider[] {
  // Most cost-effective default per use case. Caller can override.
  switch (useCase) {
    case "embeddings":
      return ["openai", "anthropic", "gemini"]; // OpenAI text-embedding-3-small is cheap
    case "filing":
    case "classification":
      return ["anthropic", "openai", "gemini"]; // Haiku is fast + cheap
    case "chat":
    case "semantic":
    case "all":
    default:
      return ["anthropic", "openai", "gemini"];
  }
}

// ─── Validation ─────────────────────────────────────────────────────

export type KeyValidationResult =
  | { ok: true; modelExamples?: string[] }
  | { ok: false; error: string };

/**
 * Quick validation: do a minimal API call to confirm the key works.
 * - Anthropic: GET /v1/models (cheap, no token spend)
 * - OpenAI: GET /v1/models (cheap, no token spend)
 * - Gemini: GET /v1/models (cheap)
 *
 * 5s timeout. We don't want to hang the save button.
 */
export async function validateLlmKey(
  provider: OrgLlmProvider,
  apiKey: string,
): Promise<KeyValidationResult> {
  if (!apiKey || apiKey.length < 10) {
    return { ok: false, error: "Key looks too short to be valid." };
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: ac.signal,
      });
      if (res.status === 401) return { ok: false, error: "Anthropic rejected the key (401)." };
      if (!res.ok) return { ok: false, error: `Anthropic returned ${res.status}.` };
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      return { ok: true, modelExamples: data.data?.slice(0, 3).map((m) => m.id) };
    }
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: ac.signal,
      });
      if (res.status === 401) return { ok: false, error: "OpenAI rejected the key (401)." };
      if (!res.ok) return { ok: false, error: `OpenAI returned ${res.status}.` };
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      return { ok: true, modelExamples: data.data?.slice(0, 3).map((m) => m.id) };
    }
    if (provider === "gemini") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(apiKey)}`,
        { signal: ac.signal },
      );
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "Gemini rejected the key." };
      }
      if (!res.ok) return { ok: false, error: `Gemini returned ${res.status}.` };
      return { ok: true };
    }
    return { ok: false, error: `Unknown provider: ${provider}` };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return { ok: false, error: "Validation timed out after 5s." };
    }
    return { ok: false, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
