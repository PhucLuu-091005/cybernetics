ALTER TABLE "agent_tokens" DROP CONSTRAINT "agent_tokens_creation_key_unique";--> statement-breakpoint
ALTER TABLE "agent_tokens" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD COLUMN "kind" text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE "tracker_cr_comments" ADD COLUMN "via_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_key" text;--> statement-breakpoint
CREATE INDEX "agent_tokens_user_idx" ON "agent_tokens" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_creation_key_unique" UNIQUE NULLS NOT DISTINCT("user_id","project_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_kind_project" CHECK (("agent_tokens"."kind" = 'project' and "agent_tokens"."project_id" is not null) or ("agent_tokens"."kind" = 'personal' and "agent_tokens"."project_id" is null));