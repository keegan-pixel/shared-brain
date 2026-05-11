CREATE TABLE "org_composio_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"api_key" text NOT NULL,
	"mcp_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_composio_config_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
ALTER TABLE "org_composio_config" ADD CONSTRAINT "org_composio_config_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_composio_config_org_idx" ON "org_composio_config" USING btree ("org_id");