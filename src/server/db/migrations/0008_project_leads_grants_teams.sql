CREATE TABLE "tracker_team_members" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"team_id" text NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracker_team_members_project_id_team_id_member_id_pk" PRIMARY KEY("project_id","team_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "tracker_teams" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"id" text NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "tracker_teams_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"lead_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracker_teams_project_id_id_pk" PRIMARY KEY("project_id","id")
);
--> statement-breakpoint
ALTER TABLE "tracker_members" ADD COLUMN "view_main" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tracker_members" ADD COLUMN "view_crs" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tracker_members" ADD COLUMN "create_crs" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tracker_members" ADD COLUMN "merge_crs" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tracker_team_members" ADD CONSTRAINT "tracker_team_members_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_team_members" ADD CONSTRAINT "tracker_team_members_team_fk" FOREIGN KEY ("project_id","team_id") REFERENCES "public"."tracker_teams"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_team_members" ADD CONSTRAINT "tracker_team_members_member_fk" FOREIGN KEY ("project_id","member_id") REFERENCES "public"."tracker_members"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_teams" ADD CONSTRAINT "tracker_teams_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_teams" ADD CONSTRAINT "tracker_teams_lead_fk" FOREIGN KEY ("project_id","lead_member_id") REFERENCES "public"."tracker_members"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Round 6 roles become grants: a member keeps View Main and View/Create change requests (the column defaults); a viewer keeps View Main.
UPDATE "tracker_members" SET "view_crs" = false, "create_crs" = false, "merge_crs" = false WHERE "access" = 'viewer';--> statement-breakpoint
-- The owner of Main becomes the project lead, who has every right.
UPDATE "tracker_members" AS m SET "view_main" = true, "view_crs" = true, "create_crs" = true, "merge_crs" = true, "role_label" = CASE WHEN m."role_label" = 'Project owner, owns Main' THEN 'Project lead' ELSE m."role_label" END FROM "tracker_projects" AS p WHERE p."project_id" = m."project_id" AND p."owner_member_id" = m."id";--> statement-breakpoint
-- Teams of the base first, then the teams that merged change requests added, in their order.
-- Only a round 6 member becomes a team lead, because a team lead may create change requests and a viewer could not.
INSERT INTO "tracker_teams" ("workspace_id", "project_id", "id", "name", "lead_member_id")
SELECT p."workspace_id", p."project_id", t.team->>'id', t.team->>'name',
  (SELECT m."id" FROM "tracker_members" AS m WHERE m."project_id" = p."project_id" AND m."id"::text = t.team->>'leadId' AND m."removed_at" IS NULL AND m."access" = 'member')
FROM "tracker_projects" AS p, jsonb_array_elements(p."base"->'teams') WITH ORDINALITY AS t(team, ord)
ORDER BY p."project_id", t.ord
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "tracker_teams" ("workspace_id", "project_id", "id", "name", "lead_member_id")
SELECT c."workspace_id", c."project_id", o.op->'a'->>'id', o.op->'a'->>'name',
  (SELECT m."id" FROM "tracker_members" AS m WHERE m."project_id" = c."project_id" AND m."id"::text = o.op->'a'->>'leadId' AND m."removed_at" IS NULL AND m."access" = 'member')
FROM "tracker_commits" AS c, jsonb_array_elements(c."ops") WITH ORDINALITY AS o(op, ord)
WHERE o.op->>'op' = 'addTeam'
ORDER BY c."project_id", c."rev", o.ord
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "tracker_team_members" ("workspace_id", "project_id", "team_id", "member_id")
SELECT "workspace_id", "project_id", "id", "lead_member_id" FROM "tracker_teams" WHERE "lead_member_id" IS NOT NULL
ON CONFLICT DO NOTHING;
