ALTER TABLE "messages" ADD COLUMN "author_name_ciphertext" "bytea";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "text_ciphertext" "bytea";--> statement-breakpoint
ALTER TABLE "summary_feedback" ADD COLUMN "comment_ciphertext" "bytea";--> statement-breakpoint
ALTER TABLE "summary_run_messages" ADD COLUMN "author_name_ciphertext" "bytea";--> statement-breakpoint
ALTER TABLE "summary_run_messages" ADD COLUMN "forward_origin_ciphertext" "bytea";