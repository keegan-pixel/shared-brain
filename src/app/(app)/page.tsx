import Link from "next/link";
import { redirect } from "next/navigation";
import { Bot, Cable, KeyRound, RefreshCw } from "lucide-react";
import { eq } from "drizzle-orm";
import { ensureUserOrg, requireUserId } from "@/lib/org";
import { db } from "@/lib/db/client";
import { spaces } from "@/lib/db/schema";
import { deriveOnboardingState } from "@/lib/onboarding";
import { OnboardingChecklist } from "@/components/onboarding-checklist";

export default async function Home() {
  // Defensive: Clerk's session cookie can race with the redirect-after-
  // signup flow. If we get here before the cookie is visible to auth(),
  // requireUserId() throws UNAUTHENTICATED. Without this catch, the page
  // 500s and the user has to hard-refresh to recover. Redirecting to
  // /sign-in is correct: Clerk re-establishes the session and redirects
  // back to the original URL.
  let userId: string;
  let org: Awaited<ReturnType<typeof ensureUserOrg>>;
  try {
    userId = await requireUserId();
    org = await ensureUserOrg();
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHENTICATED") {
      redirect("/sign-in?redirect_url=/");
    }
    throw err;
  }

  const onboarding = await deriveOnboardingState(org.id, userId);
  const orgSpaces = await db.select().from(spaces).where(eq(spaces.orgId, org.id));

  const isOnboarding = onboarding.completed < onboarding.total;

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

      {isOnboarding && <OnboardingChecklist initial={onboarding} />}

      {!isOnboarding && (
        <>
          <div className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
            <h2 className="font-medium">Spaces</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {orgSpaces.length === 0
                ? "No spaces yet. Ask Claude to set them up via your AXIS / lead agent."
                : `${orgSpaces.length} space${orgSpaces.length === 1 ? "" : "s"}.`}
            </p>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="font-medium">Quick links</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Setup is complete — keep these handy for tweaks, key rotations,
              and re-running Claude&rsquo;s discovery interview when you add a
              new context.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {[
                { href: "/settings/claude", icon: Bot, label: "Claude setup + Project Instructions" },
                { href: "/settings/connections", icon: Cable, label: "Composio key" },
                { href: "/settings/llm-keys", icon: KeyRound, label: "LLM API keys" },
                { href: "/settings/sync", icon: RefreshCw, label: "Sync settings (per-connection)" },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  <item.icon className="h-4 w-4 text-zinc-500" />
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
