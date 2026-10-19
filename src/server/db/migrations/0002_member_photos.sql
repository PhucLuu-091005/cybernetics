ALTER TABLE "agent_tokens" ADD COLUMN "member_id" uuid;--> statement-breakpoint
ALTER TABLE "tracker_members" ADD COLUMN "avatar_key" text;--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_member_id_tracker_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."tracker_members"("id") ON DELETE cascade ON UPDATE no action;