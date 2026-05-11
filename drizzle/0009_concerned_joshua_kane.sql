CREATE TABLE "org_llm_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"api_key" text NOT NULL,
	"default_model" text,
	"use_for" text[] DEFAULT ARRAY['all']::text[] NOT NULL,
	"monthly_token_cap" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_llm_config" ADD CONSTRAINT "org_llm_config_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_llm_config_org_idx" ON "org_llm_config" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_llm_config_org_provider_unique_idx" ON "org_llm_config" USING btree ("org_id","provider");