CREATE TABLE "participant_aliases" (
	"owner_user_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"display_label_ciphertext" "bytea" NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "participant_aliases_owner_user_id_participant_id_pk" PRIMARY KEY("owner_user_id","participant_id")
);
--> statement-breakpoint
ALTER TABLE "summary_runs" ADD COLUMN "summary_inline" jsonb;--> statement-breakpoint
CREATE INDEX "idx_participant_aliases_owner" ON "participant_aliases" USING btree ("owner_user_id");