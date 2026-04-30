import { itemStatusValues, itemTypeValues } from "@/lib/db/schema";

export type ItemStatus = (typeof itemStatusValues)[number];
export type ItemType = (typeof itemTypeValues)[number];

export type Item = {
  id: string;
  projectId: string;
  type: ItemType;
  title: string;
  content: string | null;
  status: ItemStatus;
  createdByAgent: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export const STATUS_ORDER: ItemStatus[] = [
  "backlog",
  "not_started",
  "research_planning",
  "in_progress",
  "review",
  "completed",
];

export const STATUS_LABELS: Record<ItemStatus, string> = {
  backlog: "Backlog",
  not_started: "Not Started",
  research_planning: "Research / Planning",
  in_progress: "In Progress",
  review: "Review",
  completed: "Completed",
};
