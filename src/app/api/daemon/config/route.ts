/**
 * Phase 8 v2 — Daemon config self-report endpoint (MF-17).
 *
 * The daemon POSTs its current effective config here on startup (and
 * periodically thereafter, in case the platform's vault_paths got out
 * of sync). The platform updates `organizations.vault_paths` so the
 * `/settings/daemon` UI always reflects what the daemon is ACTUALLY
 * watching, regardless of whether the user ever clicked "Save folders."
 *
 * Auth: Bearer per-org sync key, same as /api/sync/*. The daemon
 * already has this from its plist environment.
 *
 * Idempotent: replace, not merge. Daemon sends its complete path list;
 * server overwrites.
 *
 * Why: Richard's 2026-05-14 install populated his plist with three
 * vault paths, but DB.vault_paths stayed empty because he never
 * clicked "Save folders." Sat down to help him 24h later → /settings/
 * daemon showed blank inputs. This endpoint closes that gap.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema";
import { handle, parseJson } from "@/lib/api";
import { requireSyncAuth } from "@/lib/sync/auth";

const Schema = z.object({
  /** All vault paths the daemon is watching (primary first, extras after). */
  vaultPaths: z.array(z.string().min(1).max(500)).max(20),
  /** Optional Obsidian vault name, if set. */
  vaultName: z.string().max(120).nullable().optional(),
});

function arrayEquals(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const POST = handle(async (req: Request) => {
  const { orgId } = await requireSyncAuth(req);
  const body = await parseJson(req, Schema);

  // Fast no-op path: if the daemon is reporting the same config we
  // already have, skip the UPDATE entirely. Cuts Neon compute when a
  // daemon is in a crash-loop or restart storm — each restart re-reports
  // the same paths and we used to write the same values 10x/min.
  // Discovered 2026-05-19 during Richard's daemon crash-loop incident.
  const [existing] = await db
    .select({
      vaultPaths: organizations.vaultPaths,
      vaultName: organizations.vaultName,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (existing) {
    const pathsMatch = arrayEquals(existing.vaultPaths, body.vaultPaths);
    const nameMatch =
      body.vaultName === undefined ||
      (body.vaultName || null) === (existing.vaultName ?? null);
    if (pathsMatch && nameMatch) {
      return NextResponse.json({
        ok: true,
        vault_paths: existing.vaultPaths,
        vault_name: existing.vaultName,
        skipped: true,
      });
    }
  }

  const update: { vaultPaths: string[]; vaultName?: string | null } = {
    vaultPaths: body.vaultPaths,
  };
  // Only update vaultName if the daemon explicitly sent one. (We don't
  // want a daemon that doesn't know about vault_name to NULL it out.)
  if (body.vaultName !== undefined) {
    update.vaultName = body.vaultName || null;
  }

  const [updated] = await db
    .update(organizations)
    .set(update)
    .where(eq(organizations.id, orgId))
    .returning({
      id: organizations.id,
      vaultPaths: organizations.vaultPaths,
      vaultName: organizations.vaultName,
    });

  return NextResponse.json({
    ok: true,
    vault_paths: updated.vaultPaths,
    vault_name: updated.vaultName,
  });
});
