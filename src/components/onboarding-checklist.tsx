"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Circle, ChevronRight, Cloud, HardDrive, RefreshCw } from "lucide-react";
import type { OnboardingState } from "@/lib/onboarding";

const LOCAL_OVERRIDE_KEY = "shared-brain.onboarding.dismissed";
const PATH_PREF_KEY = "shared-brain.onboarding.path";

type OnboardingPath = "local" | "cloud-only" | null;

/**
 * Phase 8 v2 MVP — onboarding checklist client wrapper.
 *
 * Server passes the auto-derived state. Client adds:
 *   - Per-step "Mark as done" button (localStorage-persisted; useful
 *     when auto-detect lags or the user knows they're done)
 *   - Manual refresh button (calls router.refresh() — re-runs the
 *     server component which re-queries DB state without a hard reload)
 *
 * Auto-detect remains the source of truth; dismissal is additive.
 */
export function OnboardingChecklist({ initial }: { initial: OnboardingState }) {
  const router = useRouter();
  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());
  const [path, setPath] = React.useState<OnboardingPath>(null);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LOCAL_OVERRIDE_KEY);
      if (raw) setDismissed(new Set(JSON.parse(raw) as string[]));
      const p = window.localStorage.getItem(PATH_PREF_KEY) as OnboardingPath;
      if (p === "local" || p === "cloud-only") setPath(p);
    } catch {
      /* swallow */
    }
    setHydrated(true);
  }, []);

  const choosePath = (next: OnboardingPath) => {
    setPath(next);
    try {
      if (next) window.localStorage.setItem(PATH_PREF_KEY, next);
      else window.localStorage.removeItem(PATH_PREF_KEY);
    } catch {
      /* swallow */
    }
  };

  // Auto-poll for server-side state changes while onboarding is incomplete.
  // The daemon-connected and Claude-connected signals can lag after the
  // user finishes the actual install — the page only updates on manual
  // Refresh otherwise.
  //
  // Cadence: 30 seconds (was 8s — tightened 2026-05-15 after the Vercel
  // edge-request spike. 30s is enough to feel "live" for an install flow
  // while cutting polling traffic to ~25% of the previous load).
  //
  // Gates:
  //   1. anyPending (no point polling for completed onboarding)
  //   2. visibilityState === "visible" (don't burn cycles on bg tabs)
  //   3. autoStopAfterMs (5 minutes of idle) — auto-stops so a forgotten
  //      tab can't accidentally generate thousands of requests overnight.
  //      User can hit "Refresh" to re-arm.
  const anyPending = initial.steps.some((s) => s.status === "pending");
  React.useEffect(() => {
    if (!anyPending) return;
    if (typeof document === "undefined") return;
    const startedAt = Date.now();
    const AUTO_STOP_AFTER_MS = 5 * 60 * 1000; // 5 minutes
    const POLL_INTERVAL_MS = 30 * 1000; // 30 seconds
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - startedAt > AUTO_STOP_AFTER_MS) {
        window.clearInterval(id);
        return;
      }
      router.refresh();
    };
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [anyPending, router]);

  const markDone = (key: string) => {
    const next = new Set(dismissed);
    next.add(key);
    setDismissed(next);
    try {
      window.localStorage.setItem(LOCAL_OVERRIDE_KEY, JSON.stringify([...next]));
    } catch {
      /* swallow */
    }
  };

  const undoDone = (key: string) => {
    const next = new Set(dismissed);
    next.delete(key);
    setDismissed(next);
    try {
      window.localStorage.setItem(LOCAL_OVERRIDE_KEY, JSON.stringify([...next]));
    } catch {
      /* swallow */
    }
  };

  // Effective steps: server-derived status OR locally-dismissed.
  // Path "cloud-only" hides the daemon step entirely (the user doesn't
  // keep work docs on this Mac, so daemon isn't part of their flow).
  const effective = initial.steps
    .filter((s) => {
      if (!hydrated) return true;
      if (path === "cloud-only" && s.key === "daemon-connected") return false;
      return true;
    })
    .map((s) => ({
      ...s,
      effectiveDone: s.status === "done" || (hydrated && dismissed.has(s.key)),
      locallyDismissed: hydrated && dismissed.has(s.key) && s.status !== "done",
    }));
  const completed = effective.filter((s) => s.effectiveDone).length;
  const total = effective.length;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-medium">Onboarding</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {completed} of {total} · {progressPct}%
          </span>
          <button
            onClick={() => router.refresh()}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            title="Re-check status from server"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
        </div>
      </div>
      <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full bg-zinc-900 transition-all dark:bg-zinc-100"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {hydrated && path === null && (
        <div className="mb-5 rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/40 dark:bg-blue-950/30">
          <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
            How are you using Shared Brain?
          </p>
          <p className="mt-1 text-xs text-blue-900/80 dark:text-blue-100/80">
            Pick a path so we can hide steps you don&rsquo;t need. You can
            switch later if your setup changes.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              onClick={() => choosePath("local")}
              className="flex flex-col items-start gap-1 rounded-md border border-blue-300 bg-white p-3 text-left text-sm hover:bg-blue-100/50 dark:border-blue-800 dark:bg-zinc-900 dark:hover:bg-blue-950/40"
            >
              <div className="flex items-center gap-2 font-medium text-blue-950 dark:text-blue-50">
                <HardDrive className="h-4 w-4" />
                Local vault
              </div>
              <p className="text-xs text-muted-foreground">
                I keep work documents on this Mac (Obsidian, Notes, etc.).
                Install the daemon to auto-sync.
              </p>
            </button>
            <button
              onClick={() => choosePath("cloud-only")}
              className="flex flex-col items-start gap-1 rounded-md border border-blue-300 bg-white p-3 text-left text-sm hover:bg-blue-100/50 dark:border-blue-800 dark:bg-zinc-900 dark:hover:bg-blue-950/40"
            >
              <div className="flex items-center gap-2 font-medium text-blue-950 dark:text-blue-50">
                <Cloud className="h-4 w-4" />
                Cloud-only
              </div>
              <p className="text-xs text-muted-foreground">
                My work lives in Gmail / Drive / Notion. Composio handles
                ingestion — no daemon needed.
              </p>
            </button>
          </div>
        </div>
      )}

      {hydrated && path !== null && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {path === "local" ? (
              <>
                <HardDrive className="h-3 w-3" />
                <span>Path: <strong className="font-medium text-foreground">Local vault</strong></span>
              </>
            ) : (
              <>
                <Cloud className="h-3 w-3" />
                <span>Path: <strong className="font-medium text-foreground">Cloud-only</strong> · daemon step hidden</span>
              </>
            )}
          </span>
          <button
            onClick={() => choosePath(null)}
            className="text-muted-foreground hover:text-foreground hover:underline"
          >
            Change
          </button>
        </div>
      )}

      <ul className="space-y-3">
        {effective.map((step) => (
          <StepRow
            key={step.key}
            href={step.action && !step.effectiveDone ? step.action.href : null}
          >
            <div className="mt-0.5 flex-shrink-0">
              {step.effectiveDone ? (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500">
                  <Check className="h-3 w-3 text-white" />
                </div>
              ) : (
                <Circle className="h-5 w-5 text-zinc-300 dark:text-zinc-600" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div
                  className={
                    step.effectiveDone
                      ? "text-sm text-muted-foreground line-through"
                      : "text-sm font-medium"
                  }
                >
                  {step.title}
                  {step.locallyDismissed && (
                    <span className="ml-2 text-xs italic text-muted-foreground">
                      (manually marked done)
                    </span>
                  )}
                </div>
                {step.action && !step.effectiveDone && (
                  <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                    {step.action.label}
                    <ChevronRight className="h-3 w-3" />
                  </span>
                )}
                {step.locallyDismissed && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      undoDone(step.key);
                    }}
                    className="relative z-10 text-xs text-zinc-500 hover:underline"
                  >
                    Undo
                  </button>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {step.description}
              </div>
              {step.hint && !step.effectiveDone && (
                <div className="mt-0.5 text-xs italic text-muted-foreground">
                  {step.hint}
                </div>
              )}
              {!step.effectiveDone && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    markDone(step.key);
                  }}
                  className="relative z-10 mt-1 text-xs text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  Mark as done →
                </button>
              )}
            </div>
          </StepRow>
        ))}
      </ul>
    </div>
  );
}

/**
 * Wraps each onboarding step in a clickable Link when an action is
 * available, so users can click anywhere on the row to navigate.
 * Falls back to a plain <li> when the step is done (no action) so
 * the whole row isn't a dead-link target.
 */
function StepRow({
  href,
  children,
}: {
  href: string | null;
  children: React.ReactNode;
}) {
  const baseClasses =
    "flex items-start gap-3 rounded-md border border-transparent p-2 transition-colors hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-800 dark:hover:bg-zinc-900";
  if (!href) {
    return <li className={baseClasses}>{children}</li>;
  }
  return (
    <li>
      <Link href={href} className={`${baseClasses} cursor-pointer`}>
        {children}
      </Link>
    </li>
  );
}
