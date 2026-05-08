import "server-only";
import { db } from "@/lib/db/client";
import { spaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ensureUserOrg } from "@/lib/org";

export type SidebarOrg = { id: string; name: string };
export type SidebarSpace = { id: string; name: string };

export async function getSidebarData(): Promise<{
  org: SidebarOrg;
  spaces: SidebarSpace[];
}> {
  const org = await ensureUserOrg();
  const orgSpaces = await db
    .select({ id: spaces.id, name: spaces.name })
    .from(spaces)
    .where(eq(spaces.orgId, org.id))
    .orderBy(spaces.name);
  return { org, spaces: orgSpaces };
}
