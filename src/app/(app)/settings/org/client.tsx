"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  initial: { name: string; slug: string; vaultName: string | null };
};

export function OrgSettingsClient({ initial }: Props) {
  const [name, setName] = React.useState(initial.name);
  const [vaultName, setVaultName] = React.useState(initial.vaultName ?? "");
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const dirty = name !== initial.name || (vaultName || null) !== initial.vaultName;

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/orgs", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          vaultName: vaultName.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setMessage({ kind: "ok", text: "Saved." });
      // Refresh the page so server-rendered components pick up the new name.
      setTimeout(() => window.location.reload(), 500);
    } catch (err) {
      setMessage({
        kind: "error",
        text: (err as Error).message || "Save failed.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Field
        label="Brain name"
        hint="What you call this brain in the app. You can change this anytime."
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Brain"
          maxLength={120}
        />
      </Field>

      <Field
        label="URL slug"
        hint="Used in URLs. Stable — does not change when you rename."
      >
        <Input value={initial.slug} disabled />
      </Field>

      <Field
        label="Obsidian vault name"
        hint={
          <>
            If you use Obsidian locally, set this so file links open directly
            in your vault. Leave empty if you don&rsquo;t use Obsidian.
          </>
        }
      >
        <Input
          value={vaultName}
          onChange={(e) => setVaultName(e.target.value)}
          placeholder="e.g. MyVault"
          maxLength={120}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving..." : "Save changes"}
        </Button>
        {message && (
          <span
            className={
              message.kind === "ok"
                ? "text-sm text-green-600"
                : "text-sm text-red-600"
            }
          >
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
