ALTER TABLE "projects" DROP CONSTRAINT "projects_main_commit_fk";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "main_commit_id";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "evidence_revision";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "source_routing";--> statement-breakpoint
DROP TABLE "graph_proposals" CASCADE;--> statement-breakpoint
DROP TABLE "graph_commits" CASCADE;--> statement-breakpoint
DROP TABLE "mutation_receipts" CASCADE;--> statement-breakpoint
DROP TABLE "records" CASCADE;--> statement-breakpoint
DROP TABLE "record_versions" CASCADE;--> statement-breakpoint
UPDATE "agent_tokens" SET "scopes" = array_remove(array_remove(array_remove("scopes", 'records:import'), 'graph:propose'), 'graph:merge');
