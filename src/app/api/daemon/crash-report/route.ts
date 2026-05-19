/**
 * Phase 8 v2 — Daemon crash-report endpoint (MF-21).
 *
 * The daemon POSTs its last error log (and optionally stdout log) here
 * on every startup, BEFORE doing any work. If the previous instance
 * died (whether via thrown error, SIGKILL from OOM, launchd timeout,
 * etc.), the err file will have content. This endpoint captures it
 * server-side so we never have to bug users for logs again.
 *
 * Storage: activity_feed row with action='daemon_crash_report'.
 * The metadata field holds the full log payload. Surfaces on
 * /settings/daemon for the user to see.
 *
 * Auth: Bearer per-org sync key, same as /api/sync/*.
 *
 * Bounded: caller is expected to send max 200 lines of err + 100 lines
 * of stdout. Server-side cap at 64KB total to prevent abuse.
 *
 * Idempotent: daemon truncates its err log after a successful report
 * so the same crash isn't reported repeatedly. If a single crash
 * generates a multi-MB err log, we only capture the tail.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { activityFeed } from "@/lib/db/schema";
import { handle, parseJson } from "@/lib/api";
import { requireSyncAuth } from "@/lib/sync/auth";

const MAX_PAYLOAD_BYTES = 64 * 1024; // 64KB total

const Schema = z.object({
  /** Last N lines of stderr (the actual crash signal). */
  errLog: z.string().max(MAX_PAYLOAD_BYTES),
  /** Last N lines of stdout (recent activity before the crash). Optional. */
  stdoutLog: z.string().max(MAX_PAYLOAD_BYTES).optional(),
  /** Approx when the daemon detected the previous instance died. */
  detectedAt: z.string().datetime().optional(),
  /** ISO mtime of the err file when read — helps correlate with timing. */
  errMtime: z.string().datetime().optional(),
  /** Userd-friendly version stamp (current daemon git SHA, if available). */
  daemonVersion: z.string().max(120).optional(),
});

function truncate(s: string, maxBytes: number): string {
  // Conservative — JS string length isn't bytes, but for ASCII-heavy
  // logs it's close enough. Cap to keep DB rows small.
  if (s.length <= maxBytes) return s;
  return s.slice(0, maxBytes) + "\n…[truncated by server]";
}

export const POST = handle(async (req: Request) => {
  const { orgId } = await requireSyncAuth(req);
  const body = await parseJson(req, Schema);

  // Skip if the err log is empty — daemon will POST on every startup
  // and most startups are clean. Cheap no-op.
  if (!body.errLog.trim()) {
    return NextResponse.json({ ok: true, recorded: false, reason: "empty err log" });
  }

  const errClipped = truncate(body.errLog, 32 * 1024);
  const stdoutClipped = body.stdoutLog ? truncate(body.stdoutLog, 16 * 1024) : undefined;

  // Surface a useful summary line — try to extract the first error-ish
  // line from the err log so the activity_feed snippet is informative.
  const errFirstLine =
    errClipped
      .split("\n")
      .find((l) => /error|exception|throw|cannot|fatal|EACCES|ENOENT|undefined is not/i.test(l))
      ?.slice(0, 240) ?? errClipped.split("\n")[0]?.slice(0, 240) ?? "(crash with empty err output)";

  await db.insert(activityFeed).values({
    orgId,
    actorAgent: "daemon",
    action: "daemon_crash_report",
    entityType: "daemon",
    summary: `Daemon crash detected: ${errFirstLine}`,
    metadata: {
      errLog: errClipped,
      stdoutLog: stdoutClipped,
      detectedAt: body.detectedAt,
      errMtime: body.errMtime,
      daemonVersion: body.daemonVersion,
    },
  });

  return NextResponse.json({ ok: true, recorded: true });
});
