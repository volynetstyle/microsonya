ALTER TABLE "wma_chat_catalog" ADD COLUMN "chat_id_ciphertext" bytea;
-->
UPDATE "wma_chat_catalog" AS catalog
SET "chat_id_ciphertext" = lifecycle."chat_id_ciphertext"
FROM (
  SELECT DISTINCT ON ("chat_id") "chat_id", "chat_id_ciphertext"
  FROM "summary_run_lifecycle"
  ORDER BY "chat_id", "updated_at" DESC
) AS lifecycle
WHERE catalog."chat_id" = lifecycle."chat_id";
-->
ALTER TABLE "wma_chat_catalog" ALTER COLUMN "chat_id_ciphertext" SET NOT NULL;
