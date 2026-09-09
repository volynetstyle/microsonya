DROP INDEX "idx_summary_runs_command";--> statement-breakpoint
CREATE INDEX "idx_summary_runs_command" ON "summary_runs" USING btree ("chat_id","command_message_id");