ALTER TABLE "organizations" ADD COLUMN "mcp_api_key" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_mcp_api_key_unique" UNIQUE("mcp_api_key");