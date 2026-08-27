ALTER TABLE "summary_runs" ADD COLUMN "message_count" integer;--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "action" text;--> statement-breakpoint
UPDATE "summary_runs" AS "run"
SET
	"message_count" = (
		SELECT count(*)::integer
		FROM "messages" AS "message"
		WHERE "message"."chat_id" = "run"."chat_id"
			AND "message"."message_id" BETWEEN "run"."from_message_id" AND "run"."to_message_id"
			AND "message"."kind" = 'text'
			AND "message"."is_command" = false
			AND btrim(coalesce("message"."text", '')) <> ''
	),
	"action" = CASE
		WHEN "run"."status" = 'empty' THEN 'SKIP_NO_VALUE'
		ELSE 'SUMMARIZE'
	END,
	"status" = CASE
		WHEN "run"."status" = 'ok' THEN 'summarized'
		WHEN "run"."status" = 'empty' THEN 'skipped'
		ELSE "run"."status"
	END;--> statement-breakpoint
ALTER TABLE "summary_runs" ALTER COLUMN "message_count" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "summary_runs" ALTER COLUMN "action" SET NOT NULL;
