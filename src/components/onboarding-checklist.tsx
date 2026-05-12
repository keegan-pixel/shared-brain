"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Circle, ChevronRight, RefreshCw } from "lucide-react";
import type { OnboardingState } from "@/lib/onboarding";

const LOCAL_OVERRIDE_KEY = "shared-brain.onboarding.dismissed";

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
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LOCAL_OVERRIDE_KEY);
      if (raw) setDismissed(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* swallow */
    }
    setHydrated(true);
  }, []);

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
  const effective = initial.steps.map((s) => ({
    ...s,
    effectiveDone: s.status === "done" || (hydrated && dismissed.has(s.key)),
    locallyDismissed: hydrated && dismissed.has(s.key) && s.status !== "done",
  }));
  const completed = effective.filter((s) => s.effectiveDone).length;
  const progressPct = Math.round((completed / initial.total) * 100);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-medium">Onboarding</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {completed} of {initial.total} · {progressPct}%
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

      <ul className="space-y-3">
        {effective.map((step) => (
          <li
            key={step.key}
            className="flex items-start gap-3 rounded-md border border-transparent p-2 transition-colors hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-800 dark:hover:bg-zinc-900"
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
                  <Link
                    href={step.action.href}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {step.action.label}
                    <ChevronRight className="h-3 w-3" />
                  </Link>
                )}
                {step.locallyDismissed && (
                  <button
                    onClick={() => undoDone(step.key)}
                    className="text-xs text-zinc-500 hover:underline"
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
                  onClick={() => markDone(step.key)}
                  className="mt-1 text-xs text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  Mark as done →
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
