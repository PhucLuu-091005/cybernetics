CREATE TABLE "tracker_event_offsets" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"offset_minutes" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracker_event_offsets_project_id_user_id_event_id_pk" PRIMARY KEY("project_id","user_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "tracker_event_offsets" ADD CONSTRAINT "tracker_event_offsets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_event_offsets" ADD CONSTRAINT "tracker_event_offsets_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;