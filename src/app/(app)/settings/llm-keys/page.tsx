import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orgLlmConfig } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";
import { LlmKeysClient } from "./client";

export default async function LlmKeysSettingsPage() {
  const org = await ensureUserOrg();
  const rows = await db
    .select({
      id: orgLlmConfig.id,
      provider: orgLlmConfig.provider,
      defaultModel: orgLlmConfig.defaultModel,
      useFor: orgLlmConfig.useFor,
      monthlyTokenCap: orgLlmConfig.monthlyTokenCap,
      apiKey: orgLlmConfig.apiKey,
      updatedAt: orgLlmConfig.updatedAt,
    })
    .from(orgLlmConfig)
    .where(eq(orgLlmConfig.orgId, org.id));

  const masked = rows.map((r) => ({
    provider: r.provider as "anthropic" | "openai" | "gemini",
    defaultModel: r.defaultModel,
    useFor: r.useFor,
    monthlyTokenCap: r.monthlyTokenCap,
    keyHint: `${r.apiKey.slice(0, 6)}...${r.apiKey.slice(-4)}`,
    updatedAt: r.updatedAt.toISOString(),
  }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">LLM API keys</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The brain doesn&rsquo;t pay for AI tokens — you do. Bring your own
          Anthropic or OpenAI key. We&rsquo;ll validate it before saving.
        </p>
      </div>
      <LlmKeysClient initial={masked} />
    </div>
  );
}
