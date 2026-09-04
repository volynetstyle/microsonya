ALTER TABLE "summary_runs" ADD COLUMN "build_sha" text;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "classifier_policy_version" text;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "summary_prompt_version" text;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "summary_plan_schema_version" text;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "classifier_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "classifier_action" text;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "plan_validation_status" text;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "plan_retry_count" integer;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "plan_hash" text;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "stream_mode" text;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "planner_latency_ms" integer;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "realizer_latency_ms" integer;