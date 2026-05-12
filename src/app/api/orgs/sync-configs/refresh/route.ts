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

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { syncConfigs } from "@/lib/db/schema";
import { ensureUserOrg } from "@/lib/org";
import { handle } from "@/lib/api";
import { executeComposioTool } from "@/lib/sync-watchers/composio-mcp-call";

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

export const POST = handle(async () => {
  const org = await ensureUserOrg();

  // Ask Composio for the user's connections via the meta-tool surface.
  const result = await executeComposioTool({
    toolSlug: "COMPOSIO_MANAGE_CONNECTIONS",
    arguments: { action: "list" },
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

  // Parse the connections list out of Composio's response. Their shape:
  //   { connections: [...] } or { items: [...] } or just an array.
  const raw = result.data as unknown;
  let connections: ComposioConnection[] = [];
  if (Array.isArray(raw)) {
    connections = raw as ComposioConnection[];
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const candidate =
      (obj.connections as ComposioConnection[]) ||
      (obj.items as ComposioConnection[]) ||
      (obj.data as ComposioConnection[]) ||
      [];
    connections = Array.isArray(candidate) ? candidate : [];
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
