CREATE TABLE "filing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"match_kind" text NOT NULL,
	"match_value" text NOT NULL,
	"target_path" text NOT NULL,
	"hit_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_matched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" text NOT NULL,
	"toolkit" text NOT NULL,
	"label" text NOT NULL,
	"mode" text DEFAULT 'off' NOT NULL,
	"source_filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "filing_rules" ADD CONSTRAINT "filing_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_configs" ADD CONSTRAINT "sync_configs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "filing_rules_org_idx" ON "filing_rules" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "filing_rules_match_idx" ON "filing_rules" USING btree ("match_kind","match_value");--> statement-breakpoint
CREATE INDEX "sync_configs_org_idx" ON "sync_configs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "sync_configs_mode_idx" ON "sync_configs" USING btree ("mode");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_configs_org_conn_uniq" ON "sync_configs" USING btree ("org_id","connection_id");