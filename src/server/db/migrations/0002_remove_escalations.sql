DROP TABLE "escalation_analyses" CASCADE;--> statement-breakpoint
DROP TABLE "escalations" CASCADE;
--> statement-breakpoint
UPDATE "agent_tokens" SET "scopes" = array_remove("scopes", 'escalations:write');
