"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type State = {
  connected: boolean;
  keyHint: string | null;
  mcpUrl: string | null;
  updatedAt: string | null;
};

export function ConnectionsClient({ initial }: { initial: State }) {
  const [state, setState] = React.useState<State>(initial);
  const [apiKey, setApiKey] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function save() {
    if (!apiKey) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/orgs/composio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = (await res.json()) as { error?: string; ok?: boolean; hint?: string };
      if (!res.ok) {
        setMessage({
          kind: "error",
          text: data.error ?? `HTTP ${res.status}${data.hint ? ` — ${data.hint}` : ""}`,
        });
        return;
      }
      setMessage({ kind: "ok", text: "Saved + validated against Composio." });
      setApiKey("");
      setState({
        connected: true,
        keyHint: "newly-saved",
        mcpUrl: null,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Remove your Composio key? This disconnects every external service that runs through it.")) return;
    setSaving(true);
    try {
      const res = await fetch("/api/orgs/composio", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState({ connected: false, keyHint: null, mcpUrl: null, updatedAt: null });
      setMessage({ kind: "ok", text: "Removed." });
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-medium">Composio</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              One key, many services. Connect Gmail, Calendar, Drive, Notion,
              LinkedIn, Discord, QuickBooks, and more.{" "}
              <a
                href="https://app.composio.dev/signup"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Get an account →
              </a>{" "}
              then{" "}
              <a
                href="https://app.composio.dev/settings"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                grab your consumer key →
              </a>
            </p>
          </div>
          {state.connected && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/40 dark:text-green-400">
              Connected
            </span>
          )}
        </div>

        {state.connected ? (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <code className="rounded bg-muted px-2 py-1 text-xs">{state.keyHint}</code>
              {state.updatedAt && (
                <span className="text-xs text-muted-foreground">
                  Updated {new Date(state.updatedAt).toLocaleDateString()}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={remove} disabled={saving}>
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2">
              <Input
                type="password"
                placeholder="ck_... (paste your Composio consumer key)"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={saving}
              />
              <Button onClick={save} disabled={!apiKey || saving}>
                {saving ? "Validating..." : "Validate + Save"}
              </Button>
            </div>
            <ol className="ml-5 list-decimal space-y-1 text-xs text-muted-foreground">
              <li>
                Sign up at{" "}
                <a
                  href="https://app.composio.dev/signup"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  app.composio.dev
                </a>
              </li>
              <li>Connect the services you want (Gmail, Drive, Calendar, etc.)</li>
              <li>Open Settings → API Keys → copy your consumer key (starts with <code>ck_</code>)</li>
              <li>Paste it above</li>
            </ol>
          </div>
        )}

        {message && (
          <p
            className={
              message.kind === "ok"
                ? "mt-3 text-xs text-green-600"
                : "mt-3 text-xs text-red-600"
            }
          >
            {message.text}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-xs text-muted-foreground dark:border-zinc-700 dark:bg-zinc-900">
        Per-connection routing (toggle which Composio connections feed this
        org) comes in Phase 8 v2 v2.1. For now: every connection on your
        Composio key feeds this brain.
      </div>
    </div>
  );
}
