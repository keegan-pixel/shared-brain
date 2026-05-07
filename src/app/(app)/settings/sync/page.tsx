import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { syncConfigs } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";
import { SyncConfigsClient } from "./client";

export default async function SyncSettingsPage() {
  const org = await ensureUserOrg();
  const configs = await db
    .select()
    .from(syncConfigs)
    .where(eq(syncConfigs.orgId, org.id))
    .orderBy(syncConfigs.toolkit, syncConfigs.label);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Sync Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Auto-pull from any of your Composio-connected accounts. Items get
          AI-classified and filed into the vault. Uncertain items land in{" "}
          <code className="rounded bg-muted px-1 py-0.5">Inbox/</code> for you
          to review.
        </p>
      </div>
      <SyncConfigsClient initial={configs} />
    </div>
  );
}
