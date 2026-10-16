CREATE TABLE "tracker_commits" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"rev" integer NOT NULL,
	"cr_id" uuid NOT NULL,
	"merged_by" uuid NOT NULL,
	"merged_at" timestamp with time zone NOT NULL,
	"ops" jsonb NOT NULL,
	"resolutions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "tracker_commits_project_id_rev_pk" PRIMARY KEY("project_id","rev")
);
--> statement-breakpoint
CREATE TABLE "tracker_cr_asks" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"cr_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracker_cr_asks_cr_id_member_id_pk" PRIMARY KEY("cr_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "tracker_cr_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "tracker_cr_comments_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"cr_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text,
	"op_index" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracker_cr_shares" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"cr_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "tracker_cr_shares_cr_id_member_id_pk" PRIMARY KEY("cr_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "tracker_crs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"num" integer NOT NULL,
	"title" text NOT NULL,
	"author" uuid NOT NULL,
	"editor" uuid NOT NULL,
	"status" text NOT NULL,
	"ops" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"merged_rev" integer,
	"merged_by" uuid,
	"merged_at" timestamp with time zone,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"closed_rev" integer,
	"resolutions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "tracker_crs_project_num_unique" UNIQUE("project_id","num"),
	CONSTRAINT "tracker_crs_project_id_unique" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "tracker_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "tracker_members_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role_label" text NOT NULL,
	"color" text NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracker_members_project_id_unique" UNIQUE("project_id","id"),
	CONSTRAINT "tracker_members_project_user_unique" UNIQUE("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tracker_projects" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"base" jsonb NOT NULL,
	"time_zone" text DEFAULT 'Asia/Ho_Chi_Minh' NOT NULL,
	"window_start" date,
	"as_of" timestamp with time zone,
	"demo" boolean DEFAULT false NOT NULL,
	"owner_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracker_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"added_by_member" uuid,
	"added_by_agent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tracker_commits" ADD CONSTRAINT "tracker_commits_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_commits" ADD CONSTRAINT "tracker_commits_cr_fk" FOREIGN KEY ("project_id","cr_id") REFERENCES "public"."tracker_crs"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_commits" ADD CONSTRAINT "tracker_commits_merged_by_fk" FOREIGN KEY ("project_id","merged_by") REFERENCES "public"."tracker_members"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_cr_asks" ADD CONSTRAINT "tracker_cr_asks_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_cr_asks" ADD CONSTRAINT "tracker_cr_asks_cr_fk" FOREIGN KEY ("project_id","cr_id") REFERENCES "public"."tracker_crs"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_cr_asks" ADD CONSTRAINT "tracker_cr_asks_member_fk" FOREIGN KEY ("project_id","member_id") REFERENCES "public"."tracker_members"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_cr_comments" ADD CONSTRAINT "tracker_cr_comments_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_cr_comments" ADD CONSTRAINT "tracker_cr_comments_cr_fk" FOREIGN KEY ("project_id","cr_id") REFERENCES "public"."tracker_crs"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_cr_comments" ADD CONSTRAINT "tracker_cr_comments_member_fk" FOREIGN KEY ("project_id","member_id") REFERENCES "public"."tracker_members"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_cr_shares" ADD CONSTRAINT "tracker_cr_shares_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_cr_shares" ADD CONSTRAINT "tracker_cr_shares_cr_fk" FOREIGN KEY ("project_id","cr_id") REFERENCES "public"."tracker_crs"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_cr_shares" ADD CONSTRAINT "tracker_cr_shares_member_fk" FOREIGN KEY ("project_id","member_id") REFERENCES "public"."tracker_members"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_crs" ADD CONSTRAINT "tracker_crs_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_crs" ADD CONSTRAINT "tracker_crs_author_fk" FOREIGN KEY ("project_id","author") REFERENCES "public"."tracker_members"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_crs" ADD CONSTRAINT "tracker_crs_editor_fk" FOREIGN KEY ("project_id","editor") REFERENCES "public"."tracker_members"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_crs" ADD CONSTRAINT "tracker_crs_merged_by_fk" FOREIGN KEY ("project_id","merged_by") REFERENCES "public"."tracker_members"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_crs" ADD CONSTRAINT "tracker_crs_closed_by_fk" FOREIGN KEY ("project_id","closed_by") REFERENCES "public"."tracker_members"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_members" ADD CONSTRAINT "tracker_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_members" ADD CONSTRAINT "tracker_members_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_projects" ADD CONSTRAINT "tracker_projects_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_projects" ADD CONSTRAINT "tracker_projects_owner_fk" FOREIGN KEY ("project_id","owner_member_id") REFERENCES "public"."tracker_members"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_queue" ADD CONSTRAINT "tracker_queue_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_queue" ADD CONSTRAINT "tracker_queue_added_by_fk" FOREIGN KEY ("project_id","added_by_member") REFERENCES "public"."tracker_members"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tracker_commits_cr_idx" ON "tracker_commits" USING btree ("cr_id");--> statement-breakpoint
CREATE INDEX "tracker_cr_asks_project_idx" ON "tracker_cr_asks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tracker_cr_comments_cr_idx" ON "tracker_cr_comments" USING btree ("cr_id");--> statement-breakpoint
CREATE INDEX "tracker_cr_comments_project_idx" ON "tracker_cr_comments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tracker_cr_shares_project_idx" ON "tracker_cr_shares" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tracker_queue_project_idx" ON "tracker_queue" USING btree ("project_id");