/**
 * Phase F4 v2 — Google Calendar source adapter.
 *
 * Refactored 2026-05-15 (MF-18) to use the shared adapter framework.
 * Behavior unchanged from the original — same arguments to
 * GOOGLECALENDAR_EVENTS_LIST, same title/body construction, same
 * tags, same cancelled-event skip.
 *
 * Composio response shape:
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

import type { AdapterConfig, SyncRunSummary } from "./adapter";
import { runComposioSyncAdapter, unwrapComposioResults } from "./adapter";
import type { SyncConfig } from "@/lib/db/schema";

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

function eventStartIso(ev: CalendarEvent): string | null {
  const t = ev.start ?? {};
  if (t.dateTime) return t.dateTime;
  if (t.date) return `${t.date}T00:00:00Z`;
  return null;
}

function eventDateStr(ev: CalendarEvent): string {
  const iso = eventStartIso(ev);
  if (!iso) return new Date().toISOString().slice(0, 10);
  return iso.slice(0, 10);
}

function fmtAttendee(a: CalendarAttendee): string {
  const name = safeString(a.displayName).trim();
  const email = safeString(a.email).trim();
  const status = safeString(a.responseStatus).trim();
  const who = name && email ? `${name} <${email}>` : name || email || "(unknown)";
  return status && status !== "needsAction" ? `${who} — *${status}*` : who;
}

function conferenceLink(ev: CalendarEvent): string | null {
  if (ev.hangoutLink) return ev.hangoutLink;
  const eps = ev.conferenceData?.entryPoints ?? [];
  const video = eps.find((e) => e.entryPointType === "video");
  return video?.uri ?? null;
}

export const calendarAdapter: AdapterConfig<CalendarEvent> = {
  toolkit: "googlecalendar",
  toolSlug: "GOOGLECALENDAR_EVENTS_LIST",
  defaultMaxItems: 50,
  defaultLookbackMs: 7 * 24 * 60 * 60 * 1000, // 7 days first run

  buildArgs: (ctx) => {
    const calendarId =
      typeof ctx.filter.calendar_id === "string" ? ctx.filter.calendar_id : "primary";
    return {
      calendar_id: calendarId,
      time_min: (ctx.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).toISOString(),
      time_max: ctx.now.toISOString(),
      max_results: ctx.maxItems,
      single_events: true,
      order_by: "startTime",
    };
  },

  extractItems: (raw) => {
    const data = unwrapComposioResults(raw);
    const items = (data as { items?: CalendarEvent[] })?.items;
    return Array.isArray(items) ? items : [];
  },

  shouldSkipItem: (ev) => ev.status === "cancelled",

  toDoc: (ev, ctx) => {
    const eventTitle = safeString(ev.summary).trim() || "(untitled event)";
    const dateStr = eventDateStr(ev);
    const title = `${dateStr} · ${eventTitle}`;
    const startIso = eventStartIso(ev);
    const endIso = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T23:59:59Z` : null);
    const attendees = (ev.attendees ?? []).filter((a) => a.email !== ev.organizer?.email);
    const conf = conferenceLink(ev);
    const organizer = ev.organizer
      ? safeString(ev.organizer.displayName) || safeString(ev.organizer.email) || "(unknown)"
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

    return {
      title,
      content: body,
      source: `googlecalendar:${ctx.connectionId}/${ev.id ?? "?"}`,
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
    };
  },
};

/**
 * Back-compat wrapper for the cron handler. Same signature as the
 * pre-refactor runCalendarSync.
 */
export async function runCalendarSync(args: {
  orgId: string;
  config: SyncConfig;
  maxItems?: number;
}): Promise<SyncRunSummary> {
  return runComposioSyncAdapter({
    orgId: args.orgId,
    config: args.config,
    adapter: calendarAdapter,
    maxItems: args.maxItems,
  });
}
