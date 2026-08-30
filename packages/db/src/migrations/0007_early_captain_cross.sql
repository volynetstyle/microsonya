CREATE TABLE "summary_run_lifecycle" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"chat_id" text NOT NULL,
	"chat_id_ciphertext" "bytea" NOT NULL,
	"command_message_id" integer NOT NULL,
	"command_date" bigint NOT NULL,
	"mode" text NOT NULL,
	"requested_count" integer,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" bigint,
	"next_retry_at" bigint,
	"last_error_code" text,
	"last_error_at" bigint,
	"processor_version" text,
	"model" text,
	"prompt_version" text,
	"summary_ciphertext" "bytea",
	"delivered_at" bigint,
	"telegram_message_id" integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_summary_run_lifecycle_idempotency" ON "summary_run_lifecycle" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_summary_run_lifecycle_status_updated" ON "summary_run_lifecycle" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "idx_summary_run_lifecycle_retry" ON "summary_run_lifecycle" USING btree ("status","next_retry_at");