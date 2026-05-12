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
import { callComposioToolDirect } from "@/lib/sync-watchers/composio-mcp-call";

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

  // COMPOSIO_MANAGE_CONNECTIONS requires a `toolkits` field — empirically
  // confirmed via the debug response Jake hit ("Required at toolkits").
  // Passing a comprehensive list of all toolkits we know about; Composio
  // will return connections for whichever the user actually has.
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
    "granola",
    "calendly",
    "github",
    "asana",
    "linear",
    "trello",
    "airtable",
    "salesforce",
    "zoom",
    "dropbox",
    "onedrive",
    "outlook",
    "monday",
    "clickup",
    "todoist",
    "evernote",
    "twitter",
    "instagram",
    "facebook",
    "tiktok",
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

  // Upsert one sync_configs row per connection.
  let created = 0;
  let existing = 0;
  for (const c of connections) {
    const connectionId = c.id || c.connection_id;
    const toolkit = (c.toolkit || c.app || c.app_unique_key || "unknown").toLowerCase();
    if (!connectionId) continue;

    const [existingRow] = await db
      .select({ id: syncConfigs.id })
      .from(syncConfigs)
      .where(
        and(
          eq(syncConfigs.orgId, org.id),
          eq(syncConfigs.connectionId, connectionId),
        ),
      )
      .limit(1);

    if (existingRow) {
      existing++;
      continue;
    }

    await db.insert(syncConfigs).values({
      orgId: org.id,
      connectionId,
      toolkit,
      label: deriveLabel(c, toolkit),
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
  });
});
