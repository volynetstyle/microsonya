ALTER TABLE "summary_run_lifecycle" ADD COLUMN "delivery_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "summary_run_lifecycle" ADD COLUMN "lease_token" text;--> statement-breakpoint
ALTER TABLE "summary_run_lifecycle" ADD COLUMN "retry_stage" text;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "orchestration_run_id" text;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "orchestration_attempt" integer;--> statement-breakpoint
UPDATE "summary_run_lifecycle"
SET "retry_stage" = CASE
      WHEN "summary_ciphertext" IS NULL THEN 'processing'
      ELSE 'delivery'
    END
WHERE "status" = 'retry_wait';--> statement-breakpoint
UPDATE "summary_run_lifecycle"
SET "retry_stage" = 'delivery'
WHERE "status" = 'queued'
  AND "summary_ciphertext" IS NOT NULL;--> statement-breakpoint
UPDATE "summary_run_lifecycle"
SET "status" = 'retry_wait',
    "retry_stage" = CASE
      WHEN "summary_ciphertext" IS NULL THEN 'processing'
      ELSE 'delivery'
    END,
    "next_retry_at" = "updated_at",
    "last_error_code" = 'MIGRATION_LEASE_INVALIDATED',
    "last_error_at" = "updated_at",
    "lease_expires_at" = NULL
WHERE "status" IN ('processing', 'delivering');--> statement-breakpoint
CREATE UNIQUE INDEX "idx_summary_runs_orchestration_attempt" ON "summary_runs" USING btree ("orchestration_run_id","orchestration_attempt");--> statement-breakpoint
ALTER TABLE "summary_run_lifecycle" ADD CONSTRAINT "summary_run_lifecycle_delivery_attempt_check" CHECK ("summary_run_lifecycle"."delivery_attempt" >= 0);--> statement-breakpoint
ALTER TABLE "summary_run_lifecycle" ADD CONSTRAINT "summary_run_lifecycle_lease_check" CHECK (("summary_run_lifecycle"."status" in ('processing', 'delivering') and "summary_run_lifecycle"."lease_token" is not null and "summary_run_lifecycle"."lease_expires_at" is not null) or ("summary_run_lifecycle"."status" not in ('processing', 'delivering') and "summary_run_lifecycle"."lease_token" is null and "summary_run_lifecycle"."lease_expires_at" is null));--> statement-breakpoint
ALTER TABLE "summary_run_lifecycle" ADD CONSTRAINT "summary_run_lifecycle_retry_stage_check" CHECK (("summary_run_lifecycle"."status" = 'retry_wait' and "summary_run_lifecycle"."retry_stage" in ('processing', 'delivery')) or ("summary_run_lifecycle"."status" = 'queued' and ("summary_run_lifecycle"."retry_stage" is null or "summary_run_lifecycle"."retry_stage" in ('processing', 'delivery'))) or ("summary_run_lifecycle"."status" not in ('retry_wait', 'queued') and "summary_run_lifecycle"."retry_stage" is null));--> statement-breakpoint
ALTER TABLE "summary_run_lifecycle" ADD CONSTRAINT "summary_run_lifecycle_delivery_summary_check" CHECK (("summary_run_lifecycle"."status" not in ('summary_ready', 'delivering', 'completed') and "summary_run_lifecycle"."retry_stage" is distinct from 'delivery') or "summary_run_lifecycle"."summary_ciphertext" is not null);--> statement-breakpoint
ALTER TABLE "summary_runs" ADD CONSTRAINT "summary_runs_orchestration_attempt_check" CHECK (("summary_runs"."orchestration_run_id" is null and "summary_runs"."orchestration_attempt" is null) or ("summary_runs"."orchestration_run_id" is not null and "summary_runs"."orchestration_attempt" is not null and "summary_runs"."orchestration_attempt" > 0));
