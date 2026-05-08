CREATE TABLE "mcp_request_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"http_method" text NOT NULL,
	"status" text NOT NULL,
	"http_status" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"client_ip" text,
	"user_agent" text,
	"error_message" text
);
--> statement-breakpoint
CREATE INDEX "mcp_log_created_idx" ON "mcp_request_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mcp_log_status_idx" ON "mcp_request_log" USING btree ("status");