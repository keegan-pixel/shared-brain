ALTER TABLE "backlinks" ADD COLUMN "kind" text DEFAULT 'explicit_link' NOT NULL;--> statement-breakpoint
ALTER TABLE "backlinks" ADD COLUMN "score" real;--> statement-breakpoint
ALTER TABLE "backlinks" ADD COLUMN "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "backlinks_kind_idx" ON "backlinks" USING btree ("kind");