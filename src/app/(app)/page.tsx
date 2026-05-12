import { eq } from "drizzle-orm";
import { ensureUserOrg, requireUserId } from "@/lib/org";
import { db } from "@/lib/db/client";
import { spaces } from "@/lib/db/schema";
import { deriveOnboardingState } from "@/lib/onboarding";
import { OnboardingChecklist } from "@/components/onboarding-checklist";

export default async function Home() {
  const userId = await requireUserId();
  const org = await ensureUserOrg();
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
