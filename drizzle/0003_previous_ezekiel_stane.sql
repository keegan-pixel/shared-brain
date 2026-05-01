ALTER TABLE "wiki_pages" ADD COLUMN "blob_url" text;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD COLUMN "extracted_text" text;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD COLUMN "extracted_word_count" integer;