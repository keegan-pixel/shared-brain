import type { ItemStatus, ItemType } from "./types";

/** Top stripe color for each kanban column. */
export const STATUS_STRIPE: Record<ItemStatus, string> = {
  backlog: "bg-slate-400 dark:bg-slate-600",
  not_started: "bg-zinc-400 dark:bg-zinc-500",
  research_planning: "bg-amber-400 dark:bg-amber-500",
  in_progress: "bg-blue-500 dark:bg-blue-400",
  review: "bg-purple-500 dark:bg-purple-400",
  completed: "bg-emerald-500 dark:bg-emerald-400",
};

/** Subtle column tint underneath the header (helps the eye separate columns). */
export const STATUS_COLUMN_TINT: Record<ItemStatus, string> = {
  backlog: "bg-slate-500/5 dark:bg-slate-300/5",
  not_started: "bg-zinc-500/5 dark:bg-zinc-300/5",
  research_planning: "bg-amber-500/5 dark:bg-amber-300/5",
  in_progress: "bg-blue-500/5 dark:bg-blue-300/5",
  review: "bg-purple-500/5 dark:bg-purple-300/5",
  completed: "bg-emerald-500/5 dark:bg-emerald-300/5",
};

/** Left-edge accent on each card, keyed by item type. */
export const TYPE_ACCENT: Record<ItemType, string> = {
  task: "bg-blue-500",
  note: "bg-amber-500",
  file: "bg-emerald-500",
  decision: "bg-purple-500",
};

/** Type badge background+text. Same color family as TYPE_ACCENT, lighter. */
export const TYPE_BADGE: Record<ItemType, string> = {
  task: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  note: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  file: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  decision: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
};
