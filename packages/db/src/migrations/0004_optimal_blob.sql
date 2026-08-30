CREATE TABLE "dataset_candidates" (
	"run_id" text PRIMARY KEY NOT NULL,
	"priority" integer NOT NULL,
	"reasons" text[] NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_invocations" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"stage" text NOT NULL,
	"model" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"output_json" jsonb,
	"output_text_ciphertext" "bytea",
	"status" text NOT NULL,
	"error_code" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "summary_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"source" text NOT NULL,
	"signal" text NOT NULL,
	"comment" text,
	"corrected_summary_ciphertext" "bytea",
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "summary_run_messages" (
	"run_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"chat_id" text NOT NULL,
	"message_id" integer NOT NULL,
	"role" text NOT NULL,
	"author_id" text NOT NULL,
	"author_name" text,
	"text_ciphertext" "bytea",
	"sent_at" bigint NOT NULL,
	"reply_to_id" integer,
	"forward_origin" jsonb,
	CONSTRAINT "summary_run_messages_run_id_ordinal_pk" PRIMARY KEY("run_id","ordinal")
);
--> statement-breakpoint
ALTER TABLE "summary_runs" ALTER COLUMN "from_message_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "summary_runs" ALTER COLUMN "to_message_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "summary_runs" ALTER COLUMN "message_count" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "summary_runs" ALTER COLUMN "action" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "summary_runs" ALTER COLUMN "text" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "started_at" bigint;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "completed_at" bigint;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "checkpoint_before" integer;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "checkpoint_after" integer;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "eligible_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "context_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "classifier_model" text;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "summarizer_model" text;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "classifier_prompt_hash" text;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "summary_prompt_hash" text;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "policy_hash" text;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "classifier_latency_ms" integer;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "summarizer_latency_ms" integer;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "total_latency_ms" integer;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "summary_text_ciphertext" "bytea";--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "input_hash" text;--> statement-breakpoint
UPDATE "summary_runs"
SET
	"started_at" = "created_at",
	"completed_at" = "created_at",
	"checkpoint_after" = "to_message_id",
	"eligible_count" = "message_count",
	"policy_hash" = 'legacy',
	"input_hash" = 'legacy:' || "id";--> statement-breakpoint
ALTER TABLE "summary_runs" ALTER COLUMN "started_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "summary_runs" ALTER COLUMN "policy_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "summary_runs" ALTER COLUMN "input_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset_candidates" ADD CONSTRAINT "dataset_candidates_run_id_summary_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."summary_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_invocations" ADD CONSTRAINT "model_invocations_run_id_summary_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."summary_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_feedback" ADD CONSTRAINT "summary_feedback_run_id_summary_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."summary_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_run_messages" ADD CONSTRAINT "summary_run_messages_run_id_summary_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."summary_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dataset_candidates_queue" ON "dataset_candidates" USING btree ("status","priority");--> statement-breakpoint
CREATE INDEX "idx_model_invocations_run_stage" ON "model_invocations" USING btree ("run_id","stage");--> statement-breakpoint
CREATE INDEX "idx_summary_feedback_run_created" ON "summary_feedback" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_summary_run_messages_source" ON "summary_run_messages" USING btree ("chat_id","message_id");
