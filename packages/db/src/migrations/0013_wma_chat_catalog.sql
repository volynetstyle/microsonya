CREATE TABLE "wma_chat_catalog" (
  "chat_id" text PRIMARY KEY NOT NULL,
  "summary_count" integer DEFAULT 0 NOT NULL,
  "message_count" integer DEFAULT 0 NOT NULL,
  "last_summary_at" bigint,
  "updated_at" bigint NOT NULL
);
-->
CREATE INDEX "idx_wma_chat_catalog_last_summary" ON "wma_chat_catalog" USING btree ("last_summary_at");
-->
INSERT INTO "wma_chat_catalog" ("chat_id", "summary_count", "message_count", "last_summary_at", "updated_at")
SELECT
  "chat_id",
  count(*)::integer,
  coalesce(sum("message_count"), 0)::integer,
  max("completed_at"),
  max("completed_at")
FROM "summary_runs"
WHERE "status" = 'summarized'
GROUP BY "chat_id";
