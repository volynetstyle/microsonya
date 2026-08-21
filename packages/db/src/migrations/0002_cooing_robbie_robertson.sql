ALTER TABLE "memory_operations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memory_states" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "segment_summaries" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "memory_operations" CASCADE;--> statement-breakpoint
DROP TABLE "memory_states" CASCADE;--> statement-breakpoint
DROP TABLE "segment_summaries" CASCADE;--> statement-breakpoint
DROP INDEX "idx_messages_chat_message";--> statement-breakpoint
DROP INDEX "idx_summary_runs_chat_range";