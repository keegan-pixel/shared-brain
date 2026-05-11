import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  customType,
  real,
  integer,
} from "drizzle-orm/pg-core";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]) {
    return `[${value.join(",")}]`;
  },
  // Postgres returns vectors as strings like "[0.12,-0.34,...]". Without
  // this, callers get the raw string and fail when they expect an array.
  fromDriver(value: string): number[] {
    if (!value) return [];
    return value.replace(/^\[|\]$/g, "").split(",").map(Number);
  },
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerUserId: text("owner_user_id").notNull(),
  /** Obsidian vault name for deep-links — null if user has no local vault. */
  vaultName: text("vault_name"),
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
  (t) => [
    index("spaces_org_id_idx").on(t.orgId),
    // Prevent duplicate spaces with the same name within an org. Without
    // this, /api/sync/space's check-then-insert pattern races under
    // concurrent calls (caught Garden Hero double-create on 2026-05-06).
    uniqueIndex("spaces_org_name_unique_idx").on(t.orgId, t.name),
  ],
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
    /** Vercel Blob URL for non-markdown files (PDFs, images, etc.). null for prose pages. */
    blobUrl: text("blob_url"),
    /** Plain-text content extracted from binary files (PDF text, DOCX body, etc.). */
    extractedText: text("extracted_text"),
    /** Roughly the word count of extracted_text — surfaced in UI to indicate indexing depth. */
    extractedWordCount: integer("extracted_word_count"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("wiki_pages_org_id_idx").on(t.orgId)],
);

export const backlinkEntityValues = [
  "wiki_page",
  "item",
  "space",
  "project",
  "activity",
] as const;
export type BacklinkEntity = (typeof backlinkEntityValues)[number];

/**
 * Kinds of connection edges. Cheap deterministic kinds are computed at write
 * time; fuzzy ones (semantic, ai) live in the same table with a score.
 */
export const backlinkKindValues = [
  "explicit_link", // [[Page Title]] in markdown
  "frontmatter_related", // related: field in YAML frontmatter
  "tag_overlap", // shared tags (computed at read time, may also be cached)
  "folder_sibling", // same parent dir in metadata.filePath
  "semantic_similar", // pgvector cosine similarity
  "keyword_overlap", // extracted keyword/topic overlap (background)
  "hierarchy", // parent-child structure (project→space, item→project, etc.)
  "co_mention", // mentioned in same meeting / daily note
  "ai_suggested", // AI-asserted relationship
] as const;
export type BacklinkKind = (typeof backlinkKindValues)[number];

export const backlinks = pgTable(
  "backlinks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceType: text("source_type", { enum: backlinkEntityValues }).notNull(),
    sourceId: uuid("source_id").notNull(),
    targetType: text("target_type", { enum: backlinkEntityValues }).notNull(),
    targetId: uuid("target_id").notNull(),
    kind: text("kind", { enum: backlinkKindValues }).notNull().default("explicit_link"),
    /** 0.0–1.0 confidence/similarity for fuzzy edges; null for deterministic ones. */
    score: real("score"),
    /** Why this edge exists — depends on kind. e.g. {tags: ["ai"]} for tag_overlap. */
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("backlinks_source_idx").on(t.sourceType, t.sourceId),
    index("backlinks_target_idx").on(t.targetType, t.targetId),
    index("backlinks_kind_idx").on(t.kind),
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

export const vaultSyncEntityValues = ["wiki_page", "item", "space", "project", "activity"] as const;
export type VaultSyncEntity = (typeof vaultSyncEntityValues)[number];

export const vaultSyncLog = pgTable(
  "vault_sync_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filePath: text("file_path").notNull().unique(),
    entityType: text("entity_type", { enum: vaultSyncEntityValues }),
    entityId: uuid("entity_id"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    contentHash: text("content_hash").notNull(),
    status: text("status", { enum: ["synced", "error", "pending"] }).notNull().default("synced"),
    errorMessage: text("error_message"),
  },
  (t) => [
    index("vault_sync_path_idx").on(t.filePath),
    index("vault_sync_entity_idx").on(t.entityType, t.entityId),
  ],
);

// ─── Phase F4 v2 — Composio sync configs ────────────────────────────

export const syncConfigModeValues = ["off", "manual", "auto"] as const;
export type SyncConfigMode = (typeof syncConfigModeValues)[number];

/**
 * One row per (org, Composio connected account). Lets the user toggle
 * auto-sync per connection from the platform's Settings → Sync UI,
 * and the cron job at /api/cron/auto-sync walks active rows and pulls
 * new items via Composio → file_document → vault.
 */
export const syncConfigs = pgTable(
  "sync_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Composio account ID (e.g. "gmail_berret-drinn"). */
    connectionId: text("connection_id").notNull(),
    /** Composio toolkit slug (gmail, googlecalendar, googledrive, etc.). */
    toolkit: text("toolkit").notNull(),
    /** Human-readable label (e.g. "ViaOps Gmail (keegan@viaops.co)"). */
    label: text("label").notNull(),
    /** Off = ignore. Manual = surface in chat tools but don't auto-poll. Auto = cron polls. */
    mode: text("mode", { enum: syncConfigModeValues }).notNull().default("off"),
    /**
     * Free-form per-toolkit filter. e.g. { query: "is:unread", labels: ["INBOX"] }
     * for Gmail, { folder_ids: [...] } for Drive. Adapter-specific.
     */
    sourceFilter: jsonb("source_filter").$type<Record<string, unknown>>().notNull().default({}),
    /** Last successful poll. Used as the "since" cursor for the next run. */
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    /** Last cron-run summary (item counts, errors). Surfaced in the UI. */
    lastSyncSummary: jsonb("last_sync_summary").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sync_configs_org_idx").on(t.orgId),
    index("sync_configs_mode_idx").on(t.mode),
    uniqueIndex("sync_configs_org_conn_uniq").on(t.orgId, t.connectionId),
  ],
);

// ─── Phase F4 v3 — Active-learning filing rules (forward-declared) ──
// Schema lives here so v3 can land later without migration ordering.

/**
 * Learned rules from user reconciliation. When a user moves a file
 * out of `Inbox/` to a real folder, we record (source_pattern,
 * target_path) so file_document's classifier can short-circuit to
 * the right path on subsequent matches.
 */
export const filingRules = pgTable(
  "filing_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** What kind of source the rule matches against. e.g. "gmail_from", "title_contains", "source_prefix". */
    matchKind: text("match_kind").notNull(),
    /** The pattern value. e.g. "matt@xpflow.com" for gmail_from. */
    matchValue: text("match_value").notNull(),
    /** Where to file matches. e.g. "Clients/XP Flow/Meetings/". */
    targetPath: text("target_path").notNull(),
    /** How many times this rule has been confirmed by the user. Higher = more confidence. */
    hitCount: integer("hit_count").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastMatchedAt: timestamp("last_matched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("filing_rules_org_idx").on(t.orgId),
    index("filing_rules_match_idx").on(t.matchKind, t.matchValue),
  ],
);

// ─── Phase 8 v1 — OAuth 2.1 for /api/mcp ─────────────────────────────

/**
 * OAuth client registrations. v1 supports manually-created clients
 * (one per AI platform — Claude Desktop, Claude.ai web, future
 * GPT/Gemini). Dynamic Client Registration (RFC 7591) deferred.
 */
export const oauthClients = pgTable(
  "oauth_clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Public client identifier surfaced to AI platforms. */
    clientId: text("client_id").notNull().unique(),
    /** Hashed (bcrypt-style) client secret. NEVER store plaintext. */
    clientSecretHash: text("client_secret_hash").notNull(),
    /** Human-readable name (e.g. "Claude Desktop", "Claude.ai web"). */
    name: text("name").notNull(),
    /** Whitelist of allowed redirect URIs. Claude uses claude.ai/api/mcp/auth_callback or similar. */
    redirectUris: text("redirect_uris").array().notNull().default(sql`ARRAY[]::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("oauth_clients_client_id_idx").on(t.clientId)],
);

/**
 * Short-lived authorization codes issued at /oauth/authorize and
 * exchanged for access tokens at /oauth/token. PKCE required.
 * Single-use: marked `used=true` on first redemption.
 */
export const oauthAuthorizationCodes = pgTable(
  "oauth_authorization_codes",
  {
    code: text("code").primaryKey(),
    clientId: text("client_id").notNull(),
    /** Clerk user ID who approved the grant. */
    userId: text("user_id").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    /** PKCE code_challenge (SHA256 of verifier, base64url). */
    codeChallenge: text("code_challenge").notNull(),
    /** Always 'S256' for v1. */
    codeChallengeMethod: text("code_challenge_method").notNull().default("S256"),
    scope: text("scope").notNull().default(""),
    used: text("used").notNull().default("false"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("oauth_codes_expires_idx").on(t.expiresAt)],
);

/**
 * Issued access tokens. Opaque random strings (no JWT — DB lookup is
 * fine at our scale + lets us revoke instantly). Bound to a Clerk
 * user_id; the MCP middleware resolves the user's org from this.
 */
export const oauthAccessTokens = pgTable(
  "oauth_access_tokens",
  {
    token: text("token").primaryKey(),
    clientId: text("client_id").notNull(),
    userId: text("user_id").notNull(),
    scope: text("scope").notNull().default(""),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** When set, the token has been revoked. Validation must check this. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("oauth_tokens_user_idx").on(t.userId),
    index("oauth_tokens_expires_idx").on(t.expiresAt),
  ],
);

// ─── MCP Reliability Hardening — request log ─────────────────────────

export const mcpRequestStatusValues = ["ok", "auth_fail", "error"] as const;
export type McpRequestStatus = (typeof mcpRequestStatusValues)[number];

/**
 * Per-request log of MCP traffic. Used by the /status page and
 * /api/status endpoint to surface health metrics. Privacy: we
 * intentionally do NOT log request bodies, tool arguments, or
 * response data — only metadata about the request itself.
 */
export const mcpRequestLog = pgTable(
  "mcp_request_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    httpMethod: text("http_method").notNull(),
    status: text("status", { enum: mcpRequestStatusValues }).notNull(),
    httpStatus: integer("http_status").notNull(),
    durationMs: integer("duration_ms").notNull(),
    /** Source IP / forwarded-for, useful for rate-limit forensics later. */
    clientIp: text("client_ip"),
    /** User-Agent header — helps distinguish Desktop vs mcp-remote vs API. */
    userAgent: text("user_agent"),
    errorMessage: text("error_message"),
  },
  (t) => [
    index("mcp_log_created_idx").on(t.createdAt),
    index("mcp_log_status_idx").on(t.status),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type Space = typeof spaces.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Item = typeof items.$inferSelect;
export type WikiPage = typeof wikiPages.$inferSelect;
export type Backlink = typeof backlinks.$inferSelect;
export type ActivityFeedEntry = typeof activityFeed.$inferSelect;
export type VaultSyncEntry = typeof vaultSyncLog.$inferSelect;
export type SyncConfig = typeof syncConfigs.$inferSelect;
export type FilingRule = typeof filingRules.$inferSelect;
export type McpRequestLog = typeof mcpRequestLog.$inferSelect;
export type OAuthClient = typeof oauthClients.$inferSelect;
export type OAuthAuthorizationCode = typeof oauthAuthorizationCodes.$inferSelect;
export type OAuthAccessToken = typeof oauthAccessTokens.$inferSelect;
