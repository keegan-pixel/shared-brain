"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Provider = "anthropic" | "openai" | "gemini";

type KeyRow = {
  provider: Provider;
  defaultModel: string | null;
  useFor: string[];
  monthlyTokenCap: number | null;
  keyHint: string;
  updatedAt: string;
};

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  gemini: "Google Gemini",
};

const PROVIDER_LINKS: Record<Provider, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  gemini: "https://aistudio.google.com/apikey",
};

const RECOMMENDED: Record<Provider, { use_for: string[]; reason: string }> = {
  anthropic: {
    use_for: ["chat", "filing", "classification", "semantic", "all"],
    reason: "Best for chat + AI filing decisions. Claude Sonnet for chat, Haiku for cheap classification.",
  },
  openai: {
    use_for: ["embeddings"],
    reason: "Cheapest embeddings (text-embedding-3-small ≈ $0.02 per 1M tokens). Skip if you'd rather use Anthropic for everything.",
  },
  gemini: {
    use_for: ["all"],
    reason: "Optional. Set if you want to use Gemini models specifically.",
  },
};

export function LlmKeysClient({ initial }: { initial: KeyRow[] }) {
  const [keys, setKeys] = React.useState<KeyRow[]>(initial);
  return (
    <div className="space-y-6">
      {(["anthropic", "openai", "gemini"] as const).map((provider) => {
        const existing = keys.find((k) => k.provider === provider) ?? null;
        return (
          <ProviderCard
            key={provider}
            provider={provider}
            existing={existing}
            onSaved={(row) => {
              setKeys((prev) => {
                const filtered = prev.filter((k) => k.provider !== provider);
                return [...filtered, row];
              });
            }}
            onDeleted={() => {
              setKeys((prev) => prev.filter((k) => k.provider !== provider));
            }}
          />
        );
      })}
    </div>
  );
}

function ProviderCard({
  provider,
  existing,
  onSaved,
  onDeleted,
}: {
  provider: Provider;
  existing: KeyRow | null;
  onSaved: (row: KeyRow) => void;
  onDeleted: () => void;
}) {
  const [apiKey, setApiKey] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const recommended = RECOMMENDED[provider];

  async function save() {
    if (!apiKey) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/orgs/llm-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          apiKey,
          useFor: recommended.use_for,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        hint?: string;
        ok?: boolean;
        validation?: { modelExamples?: string[] };
      };
      if (!res.ok) {
        setMessage({
          kind: "error",
          text: data.error ?? `HTTP ${res.status}` + (data.hint ? ` — ${data.hint}` : ""),
        });
        return;
      }
      const examples = data.validation?.modelExamples?.join(", ");
      setMessage({
        kind: "ok",
        text: `Saved + validated.${examples ? ` Models available: ${examples}` : ""}`,
      });
      setApiKey("");
      onSaved({
        provider,
        defaultModel: null,
        useFor: recommended.use_for,
        monthlyTokenCap: null,
        keyHint: "newly-saved",
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove the ${PROVIDER_LABELS[provider]} key?`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/orgs/llm-keys?provider=${provider}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onDeleted();
      setMessage({ kind: "ok", text: "Removed." });
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{PROVIDER_LABELS[provider]}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {recommended.reason}{" "}
            <a
              href={PROVIDER_LINKS[provider]}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Get a key →
            </a>
          </p>
        </div>
        {existing && (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/40 dark:text-green-400">
            Connected
          </span>
        )}
      </div>

      {existing ? (
        <div className="mt-3 flex items-center gap-3 text-sm">
          <code className="rounded bg-muted px-2 py-1 text-xs">{existing.keyHint}</code>
          <span className="text-xs text-muted-foreground">
            for: {existing.useFor.join(", ")}
          </span>
          <Button variant="outline" size="sm" onClick={remove} disabled={saving}>
            Remove
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <Input
            type="password"
            placeholder={`Paste your ${PROVIDER_LABELS[provider]} key`}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={saving}
          />
          <Button onClick={save} disabled={!apiKey || saving}>
            {saving ? "Validating..." : "Validate + Save"}
          </Button>
        </div>
      )}

      {message && (
        <p
          className={
            message.kind === "ok"
              ? "mt-2 text-xs text-green-600"
              : "mt-2 text-xs text-red-600"
          }
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
