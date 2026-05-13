"use client";

import { useState, useTransition } from "react";
import type { SyncConfig } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";

const TOOLKIT_LABELS: Record<string, string> = {
  gmail: "Gmail",
  googlecalendar: "Google Calendar",
  googledrive: "Google Drive",
  notion: "Notion",
  linkedin: "LinkedIn",
  discord: "Discord",
  quickbooks: "QuickBooks",
};

const SUPPORTED_TOOLKITS = new Set(["gmail", "googlecalendar"]);

function modeBadge(mode: string) {
  const styles: Record<string, string> = {
    off: "bg-muted text-muted-foreground",
    manual: "bg-blue-500/20 text-blue-700 dark:text-blue-300",
    auto: "bg-green-500/20 text-green-700 dark:text-green-300",
  };
  return styles[mode] ?? styles.off;
}

function fmtRelative(d: Date | null | string): string {
  if (!d) return "never";
  const date = typeof d === "string" ? new Date(d) : d;
  const ms = Date.now() - date.getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export function SyncConfigsClient({ initial }: { initial: SyncConfig[] }) {
  const [configs, setConfigs] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refreshFromComposio = async () => {
    setRefreshing(true);
    setError(null);
    setRefreshMessage(null);
    try {
      const res = await fetch("/api/orgs/sync-configs/refresh", {
        method: "POST",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        count?: number;
        created?: number;
        existing?: number;
        error?: string;
        hint?: string;
      };
      if (!res.ok) {
        setError(`${data.error ?? `HTTP ${res.status}`}${data.hint ? ` — ${data.hint}` : ""}`);
        return;
      }
      if (data.count === 0) {
        setRefreshMessage(data.hint ?? "Composio returned 0 connections.");
        return;
      }
      setRefreshMessage(
        `Found ${data.count} connection${data.count === 1 ? "" : "s"}: ${data.created} new, ${data.existing} already configured.`,
      );
      // Reload to pick up the new rows.
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  // Group by toolkit for cleaner rendering.
  const byToolkit = new Map<string, SyncConfig[]>();
  for (const c of configs) {
    const list = byToolkit.get(c.toolkit) ?? [];
    list.push(c);
    byToolkit.set(c.toolkit, list);
  }

  const setMode = (cfg: SyncConfig, newMode: "off" | "manual" | "auto") => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/sync-configs/${cfg.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: newMode }),
        });
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        const { config: updated } = (await res.json()) as { config: SyncConfig };
        setConfigs((prev) => prev.map((c) => (c.id === cfg.id ? updated : c)));
      } catch (err) {
        setError((err as Error).message);
      }
    });
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {refreshMessage && (
        <div className="rounded border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-300">
          {refreshMessage}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Pull connections from Composio</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {configs.length === 0
                ? "No connections set up yet. Click to fetch your Composio-connected accounts and seed this list."
                : "Re-fetch to pick up any new connections you've added on Composio's side since last refresh."}
            </p>
          </div>
          <Button
            onClick={refreshFromComposio}
            disabled={refreshing}
            variant={configs.length === 0 ? "default" : "outline"}
          >
            {refreshing ? "Fetching..." : configs.length === 0 ? "Fetch connections" : "Refresh"}
          </Button>
        </div>
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
          <strong>Heads up:</strong> Composio&rsquo;s MANAGE_CONNECTIONS
          meta-tool creates short-lived (10-min expiry) auth links for
          toolkits we ask about that you don&rsquo;t have connected.
          You might see a few extra &ldquo;Connect [toolkit]&rdquo; entries
          appear briefly in your Composio dashboard — those expire on their
          own and don&rsquo;t affect your real connections. Only the
          connections you ACTUALLY have show up below.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card/40 px-4 py-3 text-sm text-muted-foreground">
        <strong className="text-foreground">Phase F4 v2 status:</strong> Gmail
        and Google Calendar are currently wired for cron auto-sync. Other
        toolkits accept the toggle but won&apos;t actually poll yet — adapter
        implementations land per-toolkit in follow-ups.
      </div>

      {[...byToolkit.entries()].map(([toolkit, list]) => (
        <section key={toolkit} className="rounded-lg border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-medium">
              {TOOLKIT_LABELS[toolkit] ?? toolkit}
              {!SUPPORTED_TOOLKITS.has(toolkit) && (
                <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-normal text-amber-700 dark:text-amber-300">
                  not yet wired
                </span>
              )}
            </h2>
            <span className="text-xs text-muted-foreground">
              {list.filter((c) => c.mode === "auto").length} on auto ·{" "}
              {list.filter((c) => c.mode === "manual").length} manual
            </span>
          </header>
          <ul className="divide-y divide-border">
            {list.map((cfg) => (
              <li key={cfg.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{cfg.label}</div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                    <code className="rounded bg-muted px-1 py-0.5">{cfg.connectionId}</code>
                    <span>last synced: {fmtRelative(cfg.lastSyncedAt)}</span>
                  </div>
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-medium ${modeBadge(cfg.mode)}`}
                >
                  {cfg.mode}
                </span>
                <div className="flex gap-1.5">
                  {(["off", "manual", "auto"] as const).map((m) => (
                    <Button
                      key={m}
                      size="sm"
                      variant={cfg.mode === m ? "default" : "outline"}
                      disabled={pending}
                      onClick={() => setMode(cfg, m)}
                      className="h-7 text-xs"
                    >
                      {m}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
