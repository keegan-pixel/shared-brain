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
  const email =
    c.metadata?.user_email ||
    c.metadata?.email ||
    c.metadata?.account_email ||
    c.user_email;
  if (email) return `${toolkit} (${email})`;
  return c.id || c.connection_id || `${toolkit} connection`;
}

/**
 * Walk a deeply-nested response from Composio's MULTI_EXECUTE wrapper
 * to find the actual array of connections. The shape varies; the
 * wrapper looks like:
 *   { results: [{ tool_slug, success, data: { items: [...] }}] }
 * or:
 *   { data: [{ data: { items: [...] }}] }
 * or sometimes:
 *   { items: [...] }
 *
 * We search recursively for the first array of objects that looks
 * like connection records (has `id` + `app`-ish fields).
 */
function findConnectionsArray(raw: unknown, depth = 0): ComposioConnection[] {
  if (depth > 6) return [];
  if (!raw) return [];
  if (Array.isArray(raw)) {
    // Is this an array of connection-like objects?
    const items = raw as Array<Record<string, unknown>>;
    if (items.length === 0) return [];
    const first = items[0];
    if (
      first &&
      typeof first === "object" &&
      (("id" in first) || ("connection_id" in first)) &&
      (("app" in first) || ("toolkit" in first) || ("app_unique_key" in first))
    ) {
      return items as ComposioConnection[];
    }
    // Not connections — walk each entry to see if a child is.
    for (const entry of items) {
      const nested = findConnectionsArray(entry, depth + 1);
      if (nested.length > 0) return nested;
    }
    return [];
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    // Common-key shortcuts before recursing.
    for (const key of [
      "connections",
      "connectedAccounts",
      "accounts",
      "items",
      "data",
      "results",
    ]) {
      if (key in obj) {
        const found = findConnectionsArray(obj[key], depth + 1);
        if (found.length > 0) return found;
      }
    }
    // Generic walk.
    for (const v of Object.values(obj)) {
      const found = findConnectionsArray(v, depth + 1);
      if (found.length > 0) return found;
    }
  }
  return [];
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

  const connections = findConnectionsArray(result.data);

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
