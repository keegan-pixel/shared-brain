import { eq } from "drizzle-orm";
import { ensureUserOrg } from "@/lib/org";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema";
import { DaemonInstallClient } from "./client";

export default async function DaemonSettingsPage() {
  const org = await ensureUserOrg();
  // Refresh — ensureUserOrg returns a stable shape but the sync key
  // may have been generated lazily; re-fetch to be safe.
  const [fresh] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, org.id))
    .limit(1);

  const syncKey = fresh?.mcpApiKey ?? "";
  // We surface a *masked* key by default for screen safety; reveal-on-tap
  // lets the user copy it. Slug is used as the daemon's user-tag.
  const userTag = fresh?.slug ?? "user";

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Local sync daemon</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A background process that watches a folder on your Mac and pushes
          changes to the brain within seconds. Required if you keep work
          documents locally; skip if you're cloud-only.
        </p>
      </div>
      <DaemonInstallClient
        userTag={userTag}
        vaultName={fresh?.vaultName ?? ""}
        syncKey={syncKey}
      />
    </div>
  );
}
