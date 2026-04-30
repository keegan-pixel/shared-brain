import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  customType,
} from "drizzle-orm/pg-core";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]) {
    return `[${value.join(",")}]`;
  },
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerUserId: text("owner_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const spaces = pgTable(
  "spaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type", { enum: ["client", "dept", "team"] }).notNull(),
    accessRoles: text("access_roles").array().notNull().default(sql`ARRAY[]::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("spaces_org_id_idx").on(t.orgId)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("projects_space_id_idx").on(t.spaceId)],
);

export const itemStatusValues = [
  "backlog",
  "not_started",
  "research_planning",
  "in_progress",
  "review",
  "completed",
] as const;
export type ItemStatus = (typeof itemStatusValues)[number];

export const itemTypeValues = ["task", "note", "file", "decision"] as const;
export type ItemType = (typeof itemTypeValues)[number];

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: text("type", { enum: itemTypeValues }).notNull(),
    title: text("title").notNull(),
    content: text("content"),
    status: text("status", { enum: itemStatusValues }).notNull().default("backlog"),
    createdByAgent: text("created_by_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("items_project_id_idx").on(t.projectId),
    index("items_status_idx").on(t.status),
  ],
);

export const wikiPages = pgTable(
  "wiki_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    accessRoles: text("access_roles").array().notNull().default(sql`ARRAY[]::text[]`),
    embedding: vector("embedding"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("wiki_pages_org_id_idx").on(t.orgId)],
);

export const backlinkEntityValues = ["item", "wiki_page"] as const;
export type BacklinkEntity = (typeof backlinkEntityValues)[number];

export const backlinks = pgTable(
  "backlinks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceType: text("source_type", { enum: backlinkEntityValues }).notNull(),
    sourceId: uuid("source_id").notNull(),
    targetType: text("target_type", { enum: backlinkEntityValues }).notNull(),
    targetId: uuid("target_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("backlinks_source_idx").on(t.sourceType, t.sourceId),
    index("backlinks_target_idx").on(t.targetType, t.targetId),
  ],
);

export const activityFeed = pgTable(
  "activity_feed",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorAgent: text("actor_agent").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_org_id_idx").on(t.orgId),
    index("activity_created_at_idx").on(t.createdAt),
  ],
);

export const vaultSyncLog = pgTable(
  "vault_sync_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filePath: text("file_path").notNull().unique(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    contentHash: text("content_hash").notNull(),
    status: text("status", { enum: ["synced", "error", "pending"] }).notNull().default("synced"),
    errorMessage: text("error_message"),
  },
  (t) => [index("vault_sync_path_idx").on(t.filePath)],
);

export type Organization = typeof organizations.$inferSelect;
export type Space = typeof spaces.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Item = typeof items.$inferSelect;
export type WikiPage = typeof wikiPages.$inferSelect;
export type Backlink = typeof backlinks.$inferSelect;
export type ActivityFeedEntry = typeof activityFeed.$inferSelect;
export type VaultSyncEntry = typeof vaultSyncLog.$inferSelect;
