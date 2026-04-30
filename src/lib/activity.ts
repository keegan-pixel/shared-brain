import { db } from "@/lib/db/client";
import { activityFeed } from "@/lib/db/schema";

type LogActivity = {
  orgId: string;
  actorAgent: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
};

export async function logActivity(entry: LogActivity) {
  await db.insert(activityFeed).values({
    orgId: entry.orgId,
    actorAgent: entry.actorAgent,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    summary: entry.summary,
    metadata: entry.metadata ?? {},
  });
}
