import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orgComposioConfig } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";
import { ConnectionsClient } from "./client";

export default async function ConnectionsSettingsPage() {
  const org = await ensureUserOrg();
  const [row] = await db
    .select()
    .from(orgComposioConfig)
    .where(eq(orgComposioConfig.orgId, org.id))
    .limit(1);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Connections</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Composio gives you access to Gmail, Calendar, Drive, Notion,
          LinkedIn, and dozens more services through one key. The brain uses
          it to ingest content and let Claude take actions on your behalf.
        </p>
      </div>
      <ConnectionsClient
        initial={
          row
            ? {
                connected: true,
                keyHint: `${row.apiKey.slice(0, 6)}...${row.apiKey.slice(-4)}`,
                mcpUrl: row.mcpUrl,
                updatedAt: row.updatedAt.toISOString(),
              }
            : { connected: false, keyHint: null, mcpUrl: null, updatedAt: null }
        }
      />
    </div>
  );
}
