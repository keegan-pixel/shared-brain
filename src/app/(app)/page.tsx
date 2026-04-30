import { ensureUserOrg } from "@/lib/org";
import { db } from "@/lib/db/client";
import { spaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export default async function Home() {
  const org = await ensureUserOrg();
  const orgSpaces = await db.select().from(spaces).where(eq(spaces.orgId, org.id));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{org.name}</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Shared Brain — Phase 0 foundation. UI shell, schema, auth, and CRUD API are live. Vault
          sync, MCP server, kanban, and wiki ship in later phases.
        </p>
      </div>
      <div className="rounded-lg border border-[hsl(var(--border))] p-6">
        <h2 className="font-medium">Spaces</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          {orgSpaces.length === 0
            ? "No spaces yet. Create one via POST /api/spaces."
            : `${orgSpaces.length} space${orgSpaces.length === 1 ? "" : "s"}.`}
        </p>
      </div>
    </div>
  );
}
