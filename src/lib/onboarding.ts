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
 */

import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  mcpRequestLog,
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

export async function deriveOnboardingState(orgId: string): Promise<OnboardingState> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) throw new Error(`Org ${orgId} not found`);

  // Step 1: org has a name that's not the auto-default. We consider any
  // name that doesn't end with "'s Brain" (the auto-generated form) as
  // intentionally set. Also: if the user has visited /settings/org and
  // saved, that counts (we use updated_at, but the row doesn't track
  // updated_at explicitly — for now just check the name pattern).
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

  // Step 4: daemon has synced something recently. Signal: any
  // vault_sync_log row updated in the last 24h. (When we have multi-org
  // vault_sync_log scoping in proper Phase 8 v2, this becomes per-org;
  // for v2.0 MVP the table is org-mute, so we just check existence.)
  const since = new Date(Date.now() - RECENT_MS);
  const [syncRow] = await db
    .select({ id: vaultSyncLog.id })
    .from(vaultSyncLog)
    .where(gt(vaultSyncLog.lastSyncedAt, since))
    .orderBy(desc(vaultSyncLog.lastSyncedAt))
    .limit(1);

  // Step 5: a successful MCP request from a Claude OAuth-authed call
  // in the last 24h. The mcp_request_log doesn't currently track userId
  // (Phase 8 v2 spec'd it but v2.0 doesn't ship it yet), so use a
  // simple "any successful 200 in the last 24h" heuristic.
  const [mcpRow] = await db
    .select({ id: mcpRequestLog.id })
    .from(mcpRequestLog)
    .where(and(eq(mcpRequestLog.status, "ok"), gt(mcpRequestLog.createdAt, since)))
    .orderBy(desc(mcpRequestLog.createdAt))
    .limit(1);

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
      status: syncRow ? "done" : "pending",
      hint: "Optional — skip if you don't keep work documents on this Mac.",
      action: { label: "View install command", href: "/settings/daemon" },
    },
    {
      key: "claude-connected",
      title: "Connect Claude (Custom Connector)",
      description: "Paste the brain's MCP URL into Claude Desktop or claude.ai → Settings → Connectors.",
      status: mcpRow ? "done" : "pending",
      action: { label: "Setup instructions", href: "/settings/claude" },
    },
  ];

  const completed = steps.filter((s) => s.status === "done").length;

  return { completed, total: steps.length, steps };
}

// Stub query for vaultSyncLog count if needed elsewhere; keep here so we
// don't bloat the SQL import surface in pages.
export async function totalSyncedFiles(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(vaultSyncLog);
  return row?.count ?? 0;
}
