import Link from "next/link";
import { Check, Circle, ChevronRight } from "lucide-react";
import { eq } from "drizzle-orm";
import { ensureUserOrg, requireUserId } from "@/lib/org";
import { db } from "@/lib/db/client";
import { spaces } from "@/lib/db/schema";
import { deriveOnboardingState } from "@/lib/onboarding";

export default async function Home() {
  const userId = await requireUserId();
  const org = await ensureUserOrg();
  const onboarding = await deriveOnboardingState(org.id, userId);
  const orgSpaces = await db.select().from(spaces).where(eq(spaces.orgId, org.id));

  const isOnboarding = onboarding.completed < onboarding.total;
  const progressPct = Math.round((onboarding.completed / onboarding.total) * 100);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{org.name}</h1>
        <p className="text-sm text-muted-foreground">
          {isOnboarding
            ? "Let's finish setting up your brain."
            : `${orgSpaces.length} space${orgSpaces.length === 1 ? "" : "s"}, and counting.`}
        </p>
      </div>

      {isOnboarding && (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-medium">Onboarding</h2>
            <span className="text-sm text-muted-foreground">
              {onboarding.completed} of {onboarding.total} · {progressPct}%
            </span>
          </div>
          <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full bg-zinc-900 transition-all dark:bg-zinc-100"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <ul className="space-y-3">
            {onboarding.steps.map((step) => (
              <li
                key={step.key}
                className="flex items-start gap-3 rounded-md border border-transparent p-2 transition-colors hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-800 dark:hover:bg-zinc-900"
              >
                <div className="mt-0.5 flex-shrink-0">
                  {step.status === "done" ? (
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
                        step.status === "done"
                          ? "text-sm text-muted-foreground line-through"
                          : "text-sm font-medium"
                      }
                    >
                      {step.title}
                    </div>
                    {step.action && step.status !== "done" && (
                      <Link
                        href={step.action.href}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {step.action.label}
                        <ChevronRight className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {step.description}
                  </div>
                  {step.hint && step.status !== "done" && (
                    <div className="mt-0.5 text-xs italic text-muted-foreground">
                      {step.hint}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isOnboarding && (
        <div className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
          <h2 className="font-medium">Spaces</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {orgSpaces.length === 0
              ? "No spaces yet. Ask Claude to set them up: \"Set up my org with these spaces: ...\""
              : `${orgSpaces.length} space${orgSpaces.length === 1 ? "" : "s"}.`}
          </p>
        </div>
      )}
    </div>
  );
}
