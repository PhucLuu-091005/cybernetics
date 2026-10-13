CREATE TABLE "agent_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"prefix" text NOT NULL,
	"hash" text NOT NULL,
	"label" text NOT NULL,
	"scopes" text[] NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_key" text,
	CONSTRAINT "agent_tokens_hash_unique" UNIQUE("hash"),
	CONSTRAINT "agent_tokens_creation_key_unique" UNIQUE("user_id","project_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "escalation_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"escalation_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"graph_commit_id" uuid NOT NULL,
	"evidence_revision" integer NOT NULL,
	"claims" jsonb NOT NULL,
	"answer_text" text NOT NULL,
	"author" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"approval" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "escalation_analyses_escalation_revision_unique" UNIQUE("escalation_id","revision")
);
--> statement-breakpoint
CREATE TABLE "escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"complaint" text NOT NULL,
	"author" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_commits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"parent_id" uuid,
	"snapshot" jsonb NOT NULL,
	"snapshot_hash" text NOT NULL,
	"actor" jsonb NOT NULL,
	"message" text NOT NULL,
	"kind" text NOT NULL,
	"proposal_id" uuid,
	"target_commit_id" uuid,
	"reviewed_evidence_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_commits_project_sequence_unique" UNIQUE("project_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "graph_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"base_commit_id" uuid NOT NULL,
	"candidate" jsonb NOT NULL,
	"revision" integer NOT NULL,
	"author" jsonb NOT NULL,
	"title" text NOT NULL,
	"rationale" text NOT NULL,
	"evidence_revision" integer NOT NULL,
	"status" text NOT NULL,
	"merged_commit_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mutation_receipts" (
	"project_id" uuid NOT NULL,
	"actor_key" text NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mutation_receipts_project_id_actor_key_operation_idempotency_key_pk" PRIMARY KEY("project_id","actor_key","operation","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"client_name" text NOT NULL,
	"main_commit_id" uuid,
	"evidence_revision" integer DEFAULT 0 NOT NULL,
	"source_routing" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"digest" text NOT NULL,
	"source" text NOT NULL,
	"source_label" text NOT NULL,
	"external_id" text,
	"thread_external_id" text,
	"parent_external_id" text,
	"title" text NOT NULL,
	"body_text" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"occurred_date" date,
	"occurred_time_zone" text,
	"time_precision" text NOT NULL,
	"author" jsonb NOT NULL,
	"recipients" jsonb NOT NULL,
	"quoted_ranges" jsonb NOT NULL,
	"attachment_names" jsonb NOT NULL,
	"permalink" text,
	"provenance" jsonb NOT NULL,
	"evidence_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_versions_record_version_unique" UNIQUE("record_id","version_no")
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text,
	"current_version_id" uuid,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_reason" text,
	CONSTRAINT "records_project_source_external_unique" UNIQUE("project_id","source","external_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_subject_unique" UNIQUE("subject")
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_analyses" ADD CONSTRAINT "escalation_analyses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_analyses" ADD CONSTRAINT "escalation_analyses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_analyses" ADD CONSTRAINT "escalation_analyses_escalation_id_escalations_id_fk" FOREIGN KEY ("escalation_id") REFERENCES "public"."escalations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_analyses" ADD CONSTRAINT "escalation_analyses_graph_commit_id_graph_commits_id_fk" FOREIGN KEY ("graph_commit_id") REFERENCES "public"."graph_commits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_commits" ADD CONSTRAINT "graph_commits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_commits" ADD CONSTRAINT "graph_commits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_commits" ADD CONSTRAINT "graph_commits_parent_id_graph_commits_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."graph_commits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_commits" ADD CONSTRAINT "graph_commits_proposal_id_graph_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."graph_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_commits" ADD CONSTRAINT "graph_commits_target_commit_id_graph_commits_id_fk" FOREIGN KEY ("target_commit_id") REFERENCES "public"."graph_commits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_proposals" ADD CONSTRAINT "graph_proposals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_proposals" ADD CONSTRAINT "graph_proposals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_proposals" ADD CONSTRAINT "graph_proposals_base_commit_id_graph_commits_id_fk" FOREIGN KEY ("base_commit_id") REFERENCES "public"."graph_commits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_proposals" ADD CONSTRAINT "graph_proposals_merged_commit_id_graph_commits_id_fk" FOREIGN KEY ("merged_commit_id") REFERENCES "public"."graph_commits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutation_receipts" ADD CONSTRAINT "mutation_receipts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_main_commit_id_graph_commits_id_fk" FOREIGN KEY ("main_commit_id") REFERENCES "public"."graph_commits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_versions" ADD CONSTRAINT "record_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_versions" ADD CONSTRAINT "record_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_versions" ADD CONSTRAINT "record_versions_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_current_version_id_record_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."record_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_tokens_project_idx" ON "agent_tokens" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "escalations_project_idx" ON "escalations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "graph_commits_parent_idx" ON "graph_commits" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "graph_proposals_project_status_idx" ON "graph_proposals" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "projects_workspace_idx" ON "projects" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "record_versions_project_occurred_idx" ON "record_versions" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");