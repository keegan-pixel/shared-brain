ALTER TABLE "vault_sync_log" ADD COLUMN "entity_type" text;--> statement-breakpoint
ALTER TABLE "vault_sync_log" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
CREATE INDEX "vault_sync_entity_idx" ON "vault_sync_log" USING btree ("entity_type","entity_id");