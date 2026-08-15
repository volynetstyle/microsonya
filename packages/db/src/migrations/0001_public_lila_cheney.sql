CREATE TABLE "memory_operations" (
	"chat_id" text NOT NULL,
	"id" text NOT NULL,
	"item_id" text NOT NULL,
	"created_item_id" text,
	"op" jsonb NOT NULL,
	"from_message_id" integer NOT NULL,
	"to_message_id" integer NOT NULL,
	"input_hash" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"state_version" integer NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "memory_operations_chat_id_id_pk" PRIMARY KEY("chat_id","id")
);
--> statement-breakpoint
CREATE TABLE "memory_states" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"processed_through_message_id" integer,
	"next_memory_sequence" integer NOT NULL,
	"next_operation_sequence" integer NOT NULL,
	"items" jsonb NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_operations" ADD CONSTRAINT "memory_operations_chat_id_memory_states_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."memory_states"("chat_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_memory_operations_chat_state" ON "memory_operations" USING btree ("chat_id","state_version");--> statement-breakpoint
CREATE INDEX "idx_memory_operations_chat_range" ON "memory_operations" USING btree ("chat_id","from_message_id","to_message_id");