/**
 * Phase 8 v2 MVP — refresh sync_configs from Composio.
 *
 * For new users (Jake, Richard): their /settings/sync page is empty
 * because no sync_configs rows have been seeded. This endpoint pulls
 * their connected accounts from Composio's MANAGE_CONNECTIONS meta-tool
 * and upserts a sync_configs row per connection, defaulting to mode='off'
 * so nothing auto-syncs until the user explicitly turns it on.
 *
 * Idempotent: existing rows (matched on connection_id) are kept as-is
 * with their current mode + filters. Only new connections get inserted.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { syncConfigs } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";
import { handle } from "@/lib/api";
import {
  callComposioToolDirect,
  executeComposioTool,
} from "@/lib/sync-watchers/composio-mcp-call";

type ComposioConnection = {
  id?: string;
  connection_id?: string;
  app?: string;
  toolkit?: string;
  app_unique_key?: string;
  status?: string;
  // Composio's response shape varies a bit by version; we try multiple
  // common field names. The shape is loosely:
  //   { id, app, app_unique_key, status, metadata: { user_email?, ... } }
  metadata?: {
    user_email?: string;
    email?: string;
    account_email?: string;
  };
  user_email?: string;
};

function deriveLabel(c: ComposioConnection, toolkit: string): string {
  // For MANAGE_CONNECTIONS responses, we stash the account's `alias` in
  // metadata.user_email so the same code path works.
  const alias =
    c.metadata?.user_email ||
    c.metadata?.email ||
    c.metadata?.account_email ||
    c.user_email;
  if (alias) return `${toolkit} — ${alias}`;
  return `${toolkit} (${c.id || c.connection_id || "unnamed"})`;
}

/**
 * Per-toolkit mapping: which Composio tool to call to identify the account,
 * and how to extract the identifier (email, username, workspace name, etc.).
 *
 * This runs as an enrichment pass AFTER parseActiveConnections, so each
 * connection's label reflects the actual account name even when Composio's
 * MANAGE_CONNECTIONS response doesn't include a useful `alias` (Richard's
 * case 2026-05-14 — his accounts came back without aliases).
 *
 * The shape of each profile-tool's response varies; the `extract` function
 * walks the typical shapes (data → results[0] → data → ...) to find the
 * identifier. Returns null if the tool errors or the field's missing —
 * fall back to deriveLabel's existing logic.
 */
type ProfileEnricher = {
  toolSlug: string;
  extract: (raw: unknown) => string | null;
};

/** Walk Composio's response wrapping to get at the actual tool output. */
function unwrapComposio(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const data = (raw as { data?: unknown }).data;
  if (data && typeof data === "object") {
    const results = (data as { results?: unknown }).results;
    if (Array.isArray(results) && results[0] && typeof results[0] === "object") {
      const r0 = (results[0] as { data?: unknown }).data;
      if (r0 !== undefined) return r0;
    }
    return data;
  }
  return raw;
}

function pickString(obj: unknown, keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

const PROFILE_ENRICHERS: Record<string, ProfileEnricher> = {
  gmail: {
    toolSlug: "GMAIL_GET_PROFILE",
    extract: (raw) => pickString(unwrapComposio(raw), ["emailAddress", "email"]),
  },
  googlecalendar: {
    toolSlug: "GOOGLECALENDAR_LIST_CALENDARS",
    extract: (raw) => {
      const data = unwrapComposio(raw);
      // Primary calendar's id is conventionally the account's email.
      const items = (data as { items?: Array<Record<string, unknown>> })?.items;
      if (!Array.isArray(items)) return null;
      const primary = items.find((i) => i.primary === true);
      if (primary && typeof primary.id === "string") return primary.id;
      // Fallback: first calendar's id.
      if (items[0] && typeof items[0].id === "string") return items[0].id as string;
      return null;
    },
  },
  googledrive: {
    toolSlug: "GOOGLEDRIVE_GET_ABOUT",
    extract: (raw) => {
      const data = unwrapComposio(raw);
      const user = (data as { user?: Record<string, unknown> })?.user;
      return pickString(user, ["emailAddress", "email", "displayName"]);
    },
  },
  notion: {
    toolSlug: "NOTION_GET_ABOUT_ME",
    extract: (raw) => {
      const data = unwrapComposio(raw);
      return (
        pickString(data, ["name", "workspace_name"]) ||
        pickString((data as { bot?: unknown })?.bot, ["workspace_name"]) ||
        pickString((data as { person?: unknown })?.person, ["email"])
      );
    },
  },
  slack: {
    toolSlug: "SLACK_TEST_AUTH",
    extract: (raw) => {
      const data = unwrapComposio(raw);
      const team = pickString(data, ["team"]);
      const user = pickString(data, ["user"]);
      if (team && user) return `${user} @ ${team}`;
      return team || user;
    },
  },
  hubspot: {
    toolSlug: "HUBSPOT_GET_USER_DETAILS",
    extract: (raw) => pickString(unwrapComposio(raw), ["email", "user", "hub_domain"]),
  },
  github: {
    toolSlug: "GITHUB_GET_THE_AUTHENTICATED_USER",
    extract: (raw) => pickString(unwrapComposio(raw), ["login", "email", "name"]),
  },
  linkedin: {
    toolSlug: "LINKEDIN_GET_MY_INFO",
    extract: (raw) => {
      const data = unwrapComposio(raw);
      return (
        pickString(data, ["email", "vanityName", "localizedFirstName"]) ||
        pickString((data as { profile?: unknown })?.profile, ["vanityName"])
      );
    },
  },
};

/**
 * Run the per-toolkit profile call to enrich a connection's label.
 * Returns the human identifier (email, username, workspace, etc.) or null
 * if no enricher is configured / the call fails / the field is missing.
 */
async function enrichConnectionLabel(
  c: ComposioConnection,
  toolkit: string,
  orgId: string,
): Promise<string | null> {
  const enricher = PROFILE_ENRICHERS[toolkit];
  if (!enricher) return null;
  const connectionId = c.id || c.connection_id;
  if (!connectionId) return null;
  try {
    // executeComposioTool (not callComposioToolDirect) because we need to
    // route to a SPECIFIC connection — users typically have multiple
    // accounts per toolkit (e.g. 4 Gmail accounts), and we need each
    // account's own email/profile. executeComposioTool's `account` param
    // does that routing via Composio's MULTI_EXECUTE wrapper, which is
    // fine for regular toolkit tools (just not for Composio meta-tools).
    const res = await executeComposioTool({
      toolSlug: enricher.toolSlug,
      arguments: {},
      account: connectionId,
      orgId,
    });
    if (!res.success) return null;
    return enricher.extract(res.data);
  } catch {
    return null;
  }
}

/**
 * Parse Composio's MANAGE_CONNECTIONS response. Confirmed shape:
 *   raw.data.results.<toolkit>.accounts[] = [
 *     { id, alias?, status: "active" | "initializing" | "initiated", is_default }
 *   ]
 *
 * Only "active" accounts are real, working connections. The other
 * statuses are pollution — MANAGE_CONNECTIONS auto-initiates new
 * auth flows for toolkits in our query list that the user doesn't
 * have, creating "initialized" entries with 10-min expiry. We
 * filter those out.
 */
function parseActiveConnections(raw: unknown): ComposioConnection[] {
  if (!raw || typeof raw !== "object") return [];
  const data = (raw as { data?: unknown }).data;
  if (!data || typeof data !== "object") return [];
  const results = (data as { results?: unknown }).results;
  if (!results || typeof results !== "object") return [];

  const out: ComposioConnection[] = [];
  for (const [toolkit, entryRaw] of Object.entries(results)) {
    if (!entryRaw || typeof entryRaw !== "object") continue;
    const entry = entryRaw as { accounts?: unknown };
    const accounts = entry.accounts;
    if (!Array.isArray(accounts)) continue;
    for (const acctRaw of accounts) {
      if (!acctRaw || typeof acctRaw !== "object") continue;
      const acct = acctRaw as {
        id?: string;
        alias?: string;
        status?: string;
        is_default?: boolean;
      };
      if (acct.status !== "active") continue;
      if (!acct.id) continue;
      out.push({
        id: acct.id,
        toolkit,
        // Use alias as the human label when available, else "{toolkit} ({id})".
        metadata: acct.alias ? { user_email: acct.alias } : undefined,
      });
    }
  }
  return out;
}

export const POST = handle(async (req: NextRequest) => {
  const org = await ensureUserOrg();
  const debug = new URL(req.url).searchParams.get("debug") === "1";

  // COMPOSIO_MANAGE_CONNECTIONS requires a `toolkits` field. Side
  // effect we hit during Jake's install: passing toolkits the user
  // DOESN'T have triggers Composio to auto-initiate new auth flows
  // (10-min expiry connection_ids appear in their dashboard).
  //
  // Mitigation: query the user's account FIRST to learn which toolkits
  // they actually have. Composio's GET /api/v3/connected_accounts
  // returns existing connections without initiating new ones — but
  // it's NOT exposed as an MCP tool. So we use COMPOSIO_CHECK_ACTIVE_CONNECTION
  // per toolkit, which lists existing only.
  //
  // For users who want exhaustive discovery (catches obscure
  // toolkits we don't list here), they can re-run MANAGE_CONNECTIONS
  // manually via Claude with an explicit toolkit list. For the
  // common case, this list covers ~95% of users without polluting
  // their Composio dashboard.
  const COMMON_TOOLKITS = [
    "gmail",
    "googlecalendar",
    "googledrive",
    "notion",
    "slack",
    "hubspot",
    "figma",
    "linkedin",
    "discord",
    "quickbooks",
    "calendly",
    "github",
    "asana",
    "linear",
    "trello",
    "airtable",
    "salesforce",
    "zoom",
    "dropbox",
    "outlook",
    "monday",
    "clickup",
    "todoist",
    "instagram",
    "facebook",
  ];

  const result = await callComposioToolDirect({
    toolSlug: "COMPOSIO_MANAGE_CONNECTIONS",
    arguments: { toolkits: COMMON_TOOLKITS },
    orgId: org.id,
  });

  if (!result.success) {
    return NextResponse.json(
      {
        error: `Composio call failed: ${result.error}`,
        hint: "Make sure your Composio key at /settings/connections is valid.",
      },
      { status: 502 },
    );
  }

  const connections = parseActiveConnections(result.data);

  if (debug) {
    return NextResponse.json({
      debug: true,
      raw_top_level_keys:
        result.data && typeof result.data === "object"
          ? Object.keys(result.data as Record<string, unknown>)
          : null,
      raw_data: result.data,
      parsed_count: connections.length,
      first_parsed: connections[0] ?? null,
    });
  }

  if (connections.length === 0) {
    return NextResponse.json({
      ok: true,
      count: 0,
      created: 0,
      existing: 0,
      hint: "Composio returned 0 connections. Make sure you've connected services at app.composio.dev, then try again.",
    });
  }

  // Upsert one sync_configs row per connection. For each connection we
  // also run a per-toolkit profile-call to enrich the label with the
  // actual account identifier (email / username / workspace). The MANAGE_CONNECTIONS
  // response often doesn't include alias for some users (e.g. Richard's
  // install 2026-05-14) — the enrichment gives "gmail — richard@..." instead
  // of "gmail (gmail_xxx-yyy)".
  let created = 0;
  let existing = 0;
  let relabeled = 0;
  const enrichmentFailures: Array<{ connectionId: string; toolkit: string }> = [];

  for (const c of connections) {
    const connectionId = c.id || c.connection_id;
    const toolkit = (c.toolkit || c.app || c.app_unique_key || "unknown").toLowerCase();
    if (!connectionId) continue;

    // 1. Try to enrich the label via the toolkit's profile call.
    const enrichedIdentifier = await enrichConnectionLabel(c, toolkit, org.id);
    if (PROFILE_ENRICHERS[toolkit] && !enrichedIdentifier) {
      enrichmentFailures.push({ connectionId, toolkit });
    }
    // Inject the enriched identifier into the connection's metadata so
    // deriveLabel picks it up via the same code path as the alias case.
    const enrichedConnection: ComposioConnection = enrichedIdentifier
      ? { ...c, metadata: { ...c.metadata, user_email: enrichedIdentifier } }
      : c;
    const computedLabel = deriveLabel(enrichedConnection, toolkit);

    const [existingRow] = await db
      .select({ id: syncConfigs.id, label: syncConfigs.label })
      .from(syncConfigs)
      .where(
        and(
          eq(syncConfigs.orgId, org.id),
          eq(syncConfigs.connectionId, connectionId),
        ),
      )
      .limit(1);

    if (existingRow) {
      // If we now have a BETTER label (enriched, vs. the cryptic
      // "{toolkit} ({id})" fallback that was stored previously), update
      // it. Skip if the user has already manually renamed (any label
      // that doesn't match either format we generate).
      const isCrypticFallback = existingRow.label === `${toolkit} (${connectionId})`;
      if (enrichedIdentifier && isCrypticFallback && existingRow.label !== computedLabel) {
        await db
          .update(syncConfigs)
          .set({ label: computedLabel, updatedAt: new Date() })
          .where(
            and(
              eq(syncConfigs.orgId, org.id),
              eq(syncConfigs.connectionId, connectionId),
            ),
          );
        relabeled++;
      } else {
        existing++;
      }
      continue;
    }

    await db.insert(syncConfigs).values({
      orgId: org.id,
      connectionId,
      toolkit,
      label: computedLabel,
      mode: "off", // user opts in explicitly per connection
      sourceFilter: {},
    });
    created++;
  }

  return NextResponse.json({
    ok: true,
    count: connections.length,
    created,
    existing,
    relabeled,
    enrichment_failures: enrichmentFailures.length,
    enrichment_failure_details: enrichmentFailures.slice(0, 10),
  });
});
