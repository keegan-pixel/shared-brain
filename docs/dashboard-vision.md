---
title: Shared Brain — Dashboard Vision (homepage)
created: 2026-04-30
updated: 2026-04-30
status: living-document
tags: [viaops-internal, shared-brain, dashboard, design]
related: "[[AI-Native PM Platform - MVP Spec]]"
---

# Shared Brain — Dashboard Vision

**Status:** Capturing ideas during the build. Implementation is post-Phase 5
(after activity feed + built-in Claude land), since the dashboard composes
data those phases produce.

The current homepage is a deliberate placeholder showing a stale Phase 0
message. Don't touch it during Phases 3–5 — it's intentionally a no-op
until we design the dashboard properly.

> **Related:**
> - [[AI-Native PM Platform - MVP Spec]] — overall plan
> - [[Build Log]] — phase-by-phase progress
> - [[Decisions]] — architectural choices

---

## North star

> Whoever logs in lands on **their** dashboard — a personal, at-a-glance
> view that helps them decide where to spend their next 15 minutes,
> whether they're a solo guinea pig (Keegan) or a team member at a future
> client.

Per-user, not org-wide. Two people on the same team see different
dashboards because they're working on different things.

---

## Core surface — what's worth surfacing

### Active work
- **Active projects** you're touching most — quick-jump cards
- **Active clients / spaces** — recent activity per space
- **Items needing attention** — overdue tasks, things stuck in `review`
  longer than X days, items moved into `in_progress` with no recent
  updates

### Daily brief
- **Calendar today** — Google Calendar via Composio. What's on, what's
  next, what gaps you have.
- **Important emails** — *deferred decision*. Need a privacy /
  signal-vs-noise model before we surface email summaries on the
  homepage. Probably starts as "just count unread from priority senders"
  and grows from there.
- **Recent Granola meetings** — anything new since you last opened the
  app? Surface the summary + linked items.

### AI access
- **Quick AI prompt box** — type a question, get an answer right from
  the dashboard. Floats over the dashboard or sits in a card. Routes
  to the same Claude chat panel as the topbar toggle (Phase 5).
- **Suggested actions** — proactive recommendations the AI generated
  overnight ("3 items moved to review without reviewers — assign?"
  etc.).

### Personal context
- **What I shipped this week** — mini activity feed scoped to
  user-driven actions.
- **What other agents shipped on my projects** — separate stream so
  agent activity doesn't drown the user signal.

---

## Personalization & layout

- **Per-user, not org-wide.** Multiple users on the same org each see
  their own dashboard.
- **Customizable widgets** — drag-rearrange? Or fixed layout with
  toggles? TBD; lean toward fixed-with-toggles for v1, drag-rearrange
  later if there's demand.
- **Spaces filter** — global "I'm working on X today" mode that filters
  every widget to the chosen space.

---

## Data sources

| Widget | Source |
|---|---|
| Active projects / spaces | Platform DB (org-scoped) |
| Items needing attention | `items` table + heuristics over `updated_at`, `status` |
| Calendar | Composio → Google Calendar |
| Email signals | TBD (privacy model first) |
| Granola summaries | Composio → Granola |
| Activity streams | `activity_feed` table, filtered by user vs. agent |
| Suggested actions | Built-in Claude over the above signals |

---

## Open design questions (tracked)

These also live as `decision`-type items in the `Shared Brain` project
inside the platform:

1. **Email integration** — what's the privacy model? Do we even fetch?
2. **Customization vs. opinionation** — drag-rearrange widgets or fixed?
3. **Activity stream split** — surface user vs. agent actions separately
   or in one stream?
4. **Suggested actions cadence** — overnight batch? On every load?
5. **Per-user ranking signals** — how do we infer "what you're working
   on most" without explicit input?

---

## Notes captured during the build (running log)

> Append observations here as they come up during phases 3–5. Anything
> that *would have been useful* on the dashboard while you were
> building.

- *2026-04-30:* The vault sync agent currently surfaces zero
  user-visible signal — you have to tail logs to see what synced.
  Dashboard should surface the last sync timestamp + any errors as a
  small status pill.
- *2026-04-30:* Sidebar shows org → spaces, but doesn't tell you which
  ones changed recently. Dashboard could collapse "12 spaces" into
  "3 spaces touched this week."
