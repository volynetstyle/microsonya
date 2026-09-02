UPDATE "summary_runs" AS run
SET "summary_text_ciphertext" = lifecycle."summary_ciphertext"
FROM "summary_run_lifecycle" AS lifecycle
WHERE run."orchestration_run_id" = lifecycle."id"
  AND run."status" = 'summarized'
  AND run."summary_text_ciphertext" IS NULL
  AND lifecycle."status" = 'completed'
  AND lifecycle."summary_ciphertext" IS NOT NULL;
-->
ALTER TABLE "summary_runs"
VALIDATE CONSTRAINT "summary_runs_summarized_text_check";
-->
WITH displayable AS (
  SELECT
    "chat_id",
    count(*)::integer AS "summary_count",
    coalesce(sum("message_count"), 0)::integer AS "message_count",
    max("created_at") AS "last_summary_at"
  FROM "summary_runs"
  WHERE "status" = 'summarized'
    AND "summary_text_ciphertext" IS NOT NULL
  GROUP BY "chat_id"
)
UPDATE "wma_chat_catalog" AS catalog
SET
  "summary_count" = displayable."summary_count",
  "message_count" = displayable."message_count",
  "last_summary_at" = displayable."last_summary_at",
  "updated_at" = displayable."last_summary_at"
FROM displayable
WHERE catalog."chat_id" = displayable."chat_id";
