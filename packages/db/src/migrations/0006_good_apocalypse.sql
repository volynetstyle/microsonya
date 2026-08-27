ALTER TABLE "messages" ALTER COLUMN "author_name_ciphertext" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "text_ciphertext" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "summary_run_messages" ALTER COLUMN "author_name_ciphertext" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "summary_run_messages" ALTER COLUMN "text_ciphertext" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "author_name";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "text";--> statement-breakpoint
ALTER TABLE "summary_feedback" DROP COLUMN "comment";--> statement-breakpoint
ALTER TABLE "summary_run_messages" DROP COLUMN "author_name";--> statement-breakpoint
ALTER TABLE "summary_run_messages" DROP COLUMN "forward_origin";--> statement-breakpoint
ALTER TABLE "summary_runs" DROP COLUMN "text";