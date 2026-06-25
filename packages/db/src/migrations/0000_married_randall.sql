CREATE TABLE "messages" (
	"chat_id" text NOT NULL,
	"message_id" integer NOT NULL,
	"date" bigint NOT NULL,
	"author_id" text NOT NULL,
	"author_name" text,
	"text" text,
	"reply_to_message_id" integer,
	"kind" text DEFAULT 'text' NOT NULL,
	"is_command" boolean DEFAULT false NOT NULL,
	CONSTRAINT "messages_chat_id_message_id_pk" PRIMARY KEY("chat_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "segment_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"from_message_id" integer NOT NULL,
	"to_message_id" integer NOT NULL,
	"hash" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"model" text,
	"title" text NOT NULL,
	"json" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "summary_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"command_message_id" integer NOT NULL,
	"from_message_id" integer NOT NULL,
	"to_message_id" integer NOT NULL,
	"created_at" bigint NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_messages_chat_date" ON "messages" USING btree ("chat_id","date");--> statement-breakpoint
CREATE INDEX "idx_messages_chat_message" ON "messages" USING btree ("chat_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_segment_summaries_cache" ON "segment_summaries" USING btree ("chat_id","from_message_id","to_message_id","hash","schema_version");--> statement-breakpoint
CREATE INDEX "idx_segment_summaries_chat_range" ON "segment_summaries" USING btree ("chat_id","from_message_id","to_message_id");--> statement-breakpoint
CREATE INDEX "idx_segment_summaries_chat_created" ON "segment_summaries" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_summary_runs_command" ON "summary_runs" USING btree ("chat_id","command_message_id");--> statement-breakpoint
CREATE INDEX "idx_summary_runs_chat_created" ON "summary_runs" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_summary_runs_chat_range" ON "summary_runs" USING btree ("chat_id","from_message_id","to_message_id");