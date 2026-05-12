/**
 * Phase 8 v2 — onboarding state derivation.
 *
 * Derives per-step completion from the DB. No new "onboarding state"
 * table needed for v2.0 MVP — the signals we need (org named, LLM key
 * set, Composio set, daemon syncing, Claude connected) are already
 * captured by existing tables.
 *
 * Returns a structured checklist so the UI can render status indicators
 * and the next-action CTA for each step.
 *
 * **Per-user scoping (fix shipped 2026-05-12):** the daemon-connected
 * and claude-connected signals MUST be scoped per-user/per-org. The
 * first cut used global recent activity, which incorrectly showed
 * Jake those steps as "done" because Keegan's daemon and Claude were
 * active on shared tables. Now:
 *   - daemon-connected = recent activity_feed row in THIS org's id
 *   - claude-connected = active OAuth token tied to THIS user's id
 */

import { and, desc, eq, gt, isNull, like, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  activityFeed,
  oauthAccessTokens,
  orgComposioConfig,
  orgLlmConfig,
  organizations,
  vaultSyncLog,
} from "@/lib/db/schema";

export type OnboardingStep =
  | "org-named"
  | "llm-keys"
  | "composio"
  | "daemon-connected"
  | "claude-connected";

export type StepStatus = "done" | "pending";

export type OnboardingState = {
  completed: number;
  total: number;
  steps: Array<{
    key: OnboardingStep;
    title: string;
    description: string;
    status: StepStatus;
    hint?: string;
    action?: { label: string; href: string };
  }>;
};

const RECENT_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function deriveOnboardingState(
  orgId: string,
  userId: string,
): Promise<OnboardingState> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) throw new Error(`Org ${orgId} not found`);

  // Step 1: org has a name that's not the auto-default. Any name that
  // doesn't end with "'s Brain" (or the literal "My Brain" fallback)
  // counts as intentionally set.
  const isAutoName = /'s Brain$/.test(org.name) || org.name === "My Brain";

  // Step 2: at least one LLM key configured.
  const [llmRow] = await db
    .select({ id: orgLlmConfig.id })
    .from(orgLlmConfig)
    .where(eq(orgLlmConfig.orgId, orgId))
    .limit(1);

  // Step 3: Composio key configured.
  const [composioRow] = await db
    .select({ id: orgComposioConfig.id })
    .from(orgComposioConfig)
    .where(eq(orgComposioConfig.orgId, orgId))
    .limit(1);

  // Step 4: daemon has synced something TO THIS ORG recently.
  // The daemon calls /api/sync/* which writes activity_feed rows with
  // action like 'sync_*' scoped to the authenticated org. Per-org
  // signal, not global.
  const since = new Date(Date.now() - RECENT_MS);
  const [daemonRow] = await db
    .select({ id: activityFeed.id })
    .from(activityFeed)
    .where(
      and(
        eq(activityFeed.orgId, orgId),
        or(
          like(activityFeed.action, "sync_%"),
          eq(activityFeed.actorAgent, "vault-sync"),
        ),
        gt(activityFeed.createdAt, since),
      ),
    )
    .orderBy(desc(activityFeed.createdAt))
    .limit(1);
  // Fallback signal: any vault_sync_log row scoped to a wiki_page in
  // this org. vault_sync_log itself doesn't have org_id, but its
  // entity_id points at wiki_pages.id which does. For new orgs this
  // returns nothing — and any wiki page row pushed via sync IS in
  // this org.
  let daemonConnected = !!daemonRow;
  if (!daemonConnected) {
    const result = await db.execute(sql`
      select v.id
      from vault_sync_log v
      join wiki_pages w on w.id = v.entity_id
      where w.org_id = ${orgId}
        and v.last_synced_at > ${since.toISOString()}
      limit 1
    `);
    const rows = ((result as unknown as { rows?: unknown[] }).rows ??
      (result as unknown as unknown[])) as unknown[];
    daemonConnected = rows.length > 0;
  }

  // Step 5: Claude (or any AI client) authenticated as THIS USER via
  // OAuth. Scoped by Clerk userId on the issued token. Doesn't matter
  // if Keegan's Claude is making requests — we only count tokens
  // issued to Jake's userId.
  const [tokenRow] = await db
    .select({ token: oauthAccessTokens.token })
    .from(oauthAccessTokens)
    .where(
      and(
        eq(oauthAccessTokens.userId, userId),
        isNull(oauthAccessTokens.revokedAt),
        gt(oauthAccessTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const claudeConnected = !!tokenRow;

  const steps: OnboardingState["steps"] = [
    {
      key: "org-named",
      title: "Name your brain",
      description: "Pick a name that suits how you'll think of it.",
      status: isAutoName ? "pending" : "done",
      action: { label: "Rename", href: "/settings/org" },
    },
    {
      key: "llm-keys",
      title: "Add an LLM API key",
      description: "Anthropic for chat + filing; OpenAI for cheap embeddings. You bring the keys.",
      status: llmRow ? "done" : "pending",
      action: { label: "Add keys", href: "/settings/llm-keys" },
    },
    {
      key: "composio",
      title: "Connect Composio",
      description: "One key gives Claude access to Gmail, Calendar, Drive, Notion, and more.",
      status: composioRow ? "done" : "pending",
      action: { label: "Connect", href: "/settings/connections" },
    },
    {
      key: "daemon-connected",
      title: "Install the local sync daemon",
      description: "Watches your vault folder and pushes changes to the brain within seconds.",
      status: daemonConnected ? "done" : "pending",
      hint: "Optional — skip if you don't keep work documents on this Mac.",
      action: { label: "View install command", href: "/settings/daemon" },
    },
    {
      key: "claude-connected",
      title: "Connect Claude (Custom Connector)",
      description: "Paste the brain's MCP URL into Claude Desktop or claude.ai → Settings → Connectors.",
      status: claudeConnected ? "done" : "pending",
      action: { label: "Setup instructions", href: "/settings/claude" },
    },
  ];

  const completed = steps.filter((s) => s.status === "done").length;

  return { completed, total: steps.length, steps };
}

// Stub kept for any future caller that wants the global count.
export async function totalSyncedFiles(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(vaultSyncLog);
  return row?.count ?? 0;
}
