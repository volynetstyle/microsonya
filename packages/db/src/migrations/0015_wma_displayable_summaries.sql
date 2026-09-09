ALTER TABLE "summary_runs"
ADD CONSTRAINT "summary_runs_summarized_text_check"
CHECK ("status" <> 'summarized' OR "summary_text_ciphertext" IS NOT NULL)
NOT VALID;
-->
CREATE INDEX "idx_summary_runs_wma_page"
ON "summary_runs" ("chat_id", "created_at" DESC, "id" DESC);
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
-->
DELETE FROM "wma_chat_catalog" AS catalog
WHERE NOT EXISTS (
  SELECT 1
  FROM "summary_runs" AS run
  WHERE run."chat_id" = catalog."chat_id"
    AND run."status" = 'summarized'
    AND run."summary_text_ciphertext" IS NOT NULL
);
