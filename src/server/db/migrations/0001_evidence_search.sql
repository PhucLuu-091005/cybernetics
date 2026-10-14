ALTER TABLE "record_versions" ADD COLUMN "search_text" text NOT NULL;--> statement-breakpoint
ALTER TABLE "record_versions" ADD COLUMN "search_title" text NOT NULL;--> statement-breakpoint
CREATE INDEX "record_versions_project_source_digest_idx" ON "record_versions" USING btree ("project_id","source","digest");