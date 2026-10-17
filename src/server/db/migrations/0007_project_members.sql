ALTER TABLE "tracker_members" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "tracker_members" ADD COLUMN "access" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "tracker_members" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "tracker_members_user_idx" ON "tracker_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tracker_members_email_idx" ON "tracker_members" USING btree ("email");--> statement-breakpoint
ALTER TABLE "tracker_members" ADD CONSTRAINT "tracker_members_project_email_unique" UNIQUE("project_id","email");