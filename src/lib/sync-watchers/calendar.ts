/**
 * Phase F4 v2 — Google Calendar source adapter.
 *
 * For an auto-mode googlecalendar sync_config, fetches events that
 * STARTED since the last successful poll and pipes each through
 * file_document for AI classification + filing.
 *
 * Design choices that mirror the Gmail adapter (src/lib/sync-watchers/gmail.ts):
 *   - Pull PAST events (`time_min = lastSyncedAt`, `time_max = now`). Future
 *     events get a follow-up implementation when there's user demand for
 *     "what's coming up" auto-syncing.
 *   - Conservative cap: 50 events per run.
 *   - No pre-classification — pass content to file_document with no target_path,
 *     so events route to Inbox/ (or active filing rules in F4 v3) for the
 *     user to refile. Phase F4 v2.x can add a Haiku classifier here.
 *
 * Composio response shape (confirmed from GOOGLECALENDAR_EVENTS_LIST):
 *   data.results[0].data.items[] = Array<{
 *     id, summary, description, location, htmlLink,
 *     start: { dateTime?, date?, timeZone? },
 *     end:   { dateTime?, date?, timeZone? },
 *     attendees?: Array<{ email, displayName?, responseStatus? }>,
 *     organizer?: { email, displayName? },
 *     status?: "confirmed" | "tentative" | "cancelled",
 *     hangoutLink?, conferenceData?,
 *     recurringEventId?,
 *   }>
 */

import { fileDocument } from "@/lib/filing/file-document";
import type { SyncConfig } from "@/lib/db/schema";
import { executeComposioTool } from "./composio-mcp-call";
import type { SyncRunSummary } from "./gmail";

type CalendarTime = {
  dateTime?: string;
  date?: string;
  timeZone?: string;
};

type CalendarAttendee = {
  email?: string;
  displayName?: string;
  responseStatus?: string;
};

type CalendarEvent = {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: CalendarTime;
  end?: CalendarTime;
  attendees?: CalendarAttendee[];
  organizer?: { email?: string; displayName?: string };
  status?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ uri?: string; entryPointType?: string }> };
  recurringEventId?: string;
};

function safeString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Extract a sortable ISO timestamp from a Calendar event's start time. */
function eventStartIso(ev: CalendarEvent): string | null {
  const t = ev.start ?? {};
  if (t.dateTime) return t.dateTime;
  if (t.date) return `${t.date}T00:00:00Z`;
  return null;
}

/** Build a human-readable date string for the title (YYYY-MM-DD). */
function eventDateStr(ev: CalendarEvent): string {
  const iso = eventStartIso(ev);
  if (!iso) return new Date().toISOString().slice(0, 10);
  return iso.slice(0, 10);
}

/** Format an attendee for the body. */
function fmtAttendee(a: CalendarAttendee): string {
  const name = safeString(a.displayName).trim();
  const email = safeString(a.email).trim();
  const status = safeString(a.responseStatus).trim();
  const who = name && email ? `${name} <${email}>` : name || email || "(unknown)";
  return status && status !== "needsAction" ? `${who} — *${status}*` : who;
}

/** Extract a conference link (Meet, Zoom, etc.) if present. */
function conferenceLink(ev: CalendarEvent): string | null {
  if (ev.hangoutLink) return ev.hangoutLink;
  const eps = ev.conferenceData?.entryPoints ?? [];
  const video = eps.find((e) => e.entryPointType === "video");
  return video?.uri ?? null;
}

export async function runCalendarSync(args: {
  orgId: string;
  config: SyncConfig;
  /** Cap on items processed per run. */
  maxItems?: number;
}): Promise<SyncRunSummary> {
  const { config, orgId } = args;
  const maxItems = args.maxItems ?? 50;
  const filter = (config.sourceFilter ?? {}) as Record<string, unknown>;

  // Pull events with start times in [lastSyncedAt, now]. First run with
  // no cursor: default to the last 7 days so we don't backfill the
  // entire calendar history.
  const since = config.lastSyncedAt
    ? new Date(config.lastSyncedAt)
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const now = new Date();

  const summary: SyncRunSummary = {
    toolkit: config.toolkit,
    connection_id: config.connectionId,
    fetched: 0,
    filed: 0,
    filed_to_inbox: 0,
    errors: [],
    cursor: now.toISOString(),
  };

  // Calendar ID: user can override via sourceFilter.calendar_id; default
  // to "primary" which is the account's main calendar.
  const calendarId = typeof filter.calendar_id === "string" ? filter.calendar_id : "primary";

  const fetchResult = await executeComposioTool({
    toolSlug: "GOOGLECALENDAR_EVENTS_LIST",
    arguments: {
      calendar_id: calendarId,
      time_min: since.toISOString(),
      time_max: now.toISOString(),
      max_results: maxItems,
      single_events: true,
      order_by: "startTime",
    },
    account: config.connectionId,
    orgId,
  });

  if (!fetchResult.success) {
    summary.errors.push(`fetch: ${fetchResult.error}`);
    return summary;
  }

  // Unwrap Composio's MULTI_EXECUTE response shape.
  const data = fetchResult.data ?? {};
  const tools = (data as { results?: Array<{ data?: { items?: CalendarEvent[] } }> }).results ?? [];
  const events: CalendarEvent[] = tools[0]?.data?.items ?? [];

  summary.fetched = events.length;

  for (const ev of events) {
    try {
      // Skip cancelled events — they're noise.
      if (ev.status === "cancelled") continue;

      const eventTitle = safeString(ev.summary).trim() || "(untitled event)";
      const dateStr = eventDateStr(ev);
      const title = `${dateStr} · ${eventTitle}`;

      const startIso = eventStartIso(ev);
      const endIso = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T23:59:59Z` : null);

      const attendees = (ev.attendees ?? []).filter((a) => a.email !== ev.organizer?.email);
      const conf = conferenceLink(ev);
      const organizer = ev.organizer
        ? safeString(ev.organizer.displayName) ||
          safeString(ev.organizer.email) ||
          "(unknown)"
        : null;

      const body = [
        `**Event:** ${eventTitle}`,
        startIso ? `**Start:** ${startIso}` : null,
        endIso ? `**End:** ${endIso}` : null,
        organizer ? `**Organizer:** ${organizer}` : null,
        ev.location ? `**Location:** ${ev.location}` : null,
        conf ? `**Conference:** [Join](${conf})` : null,
        ev.htmlLink ? `**Calendar link:** [Open in Google Calendar](${ev.htmlLink})` : null,
        attendees.length > 0
          ? `\n**Attendees (${attendees.length}):**\n${attendees.map((a) => `- ${fmtAttendee(a)}`).join("\n")}`
          : null,
        ev.description ? `\n---\n\n${safeString(ev.description)}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const result = await fileDocument({
        orgId,
        actorAgent: "cron-sync-watcher",
        title,
        content: body,
        source: `googlecalendar:${config.connectionId}/${ev.id ?? "?"}`,
        frontmatter: {
          tags: ["meeting", "calendar-sync"],
          event_summary: eventTitle,
          event_start: startIso,
          event_end: endIso,
          event_organizer: organizer,
          event_location: ev.location ?? null,
          event_attendee_count: attendees.length,
          calendar_event_id: ev.id,
          calendar_html_link: ev.htmlLink,
          recurring_event_id: ev.recurringEventId,
        },
      });
      summary.filed++;
      if (result.routedToInbox) summary.filed_to_inbox++;
    } catch (err) {
      summary.errors.push(`file: ${(err as Error).message}`);
    }
  }

  return summary;
}
