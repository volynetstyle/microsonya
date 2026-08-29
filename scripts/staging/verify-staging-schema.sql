-- This script intentionally writes only inside the surrounding transaction.
-- scripts/staging/smoke.ts always rolls that transaction back.
DO $$
DECLARE
  probe_id text := 'staging-smoke-' || txid_current()::text;
BEGIN
  IF to_regclass('public.summary_run_lifecycle') IS NULL THEN
    RAISE EXCEPTION 'summary_run_lifecycle is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'summary_run_lifecycle'
      AND indexname = 'idx_summary_run_lifecycle_idempotency'
  ) THEN
    RAISE EXCEPTION 'idempotency unique index is missing';
  END IF;

  INSERT INTO summary_run_lifecycle (
    id, idempotency_key, chat_id, chat_id_ciphertext, command_message_id,
    command_date, mode, requested_count, status, created_at, updated_at, attempt
  ) VALUES (
    probe_id, probe_id, 'staging-smoke-chat', decode('00', 'hex'), 1,
    0, 'recent', NULL, 'created', 0, 0, 0
  );

  BEGIN
    INSERT INTO summary_run_lifecycle (
      id, idempotency_key, chat_id, chat_id_ciphertext, command_message_id,
      command_date, mode, requested_count, status, created_at, updated_at, attempt
    ) VALUES (
      probe_id || '-duplicate', probe_id, 'staging-smoke-chat', decode('00', 'hex'), 1,
      0, 'recent', NULL, 'created', 0, 0, 0
    );
    RAISE EXCEPTION 'idempotency uniqueness was not enforced';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    UPDATE summary_run_lifecycle SET status = 'not-a-status' WHERE id = probe_id;
    RAISE EXCEPTION 'status check was not enforced';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE summary_run_lifecycle SET mode = 'not-a-mode' WHERE id = probe_id;
    RAISE EXCEPTION 'mode check was not enforced';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE summary_run_lifecycle SET attempt = -1 WHERE id = probe_id;
    RAISE EXCEPTION 'attempt check was not enforced';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE summary_run_lifecycle SET mode = 'count', requested_count = NULL WHERE id = probe_id;
    RAISE EXCEPTION 'count-mode check was not enforced';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

SELECT
  count(*) AS constraint_count
FROM pg_constraint
WHERE conrelid = 'public.summary_run_lifecycle'::regclass
  AND contype = 'c';
