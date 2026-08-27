import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("database migrations", () => {
  it("upgrades a non-empty v0.1 summary_runs table to the evidence ledger", async () => {
    const client = new PGlite();
    const migrationsDirectory = resolve(
      process.cwd(),
      "packages/db/src/migrations",
    );

    try {
      for (const name of [
        "0000_married_randall.sql",
        "0001_public_lila_cheney.sql",
        "0002_cooing_robbie_robertson.sql",
        "0003_sad_supernaut.sql",
      ]) {
        await client.exec(
          await readFile(resolve(migrationsDirectory, name), "utf8"),
        );
      }

      await client.exec(`
        INSERT INTO summary_runs (
          id, chat_id, command_message_id, from_message_id, to_message_id,
          message_count, created_at, mode, status, action, text
        ) VALUES (
          'legacy-run', 'chat-1', 100, 1, 2,
          2, 1700000000000, 'recent', 'summarized', 'SUMMARIZE', 'legacy text'
        );
      `);

      await client.exec(
        await readFile(
          resolve(migrationsDirectory, "0004_optimal_blob.sql"),
          "utf8",
        ),
      );

      const result = await client.query<{
        started_at: number;
        completed_at: number;
        checkpoint_after: number;
        eligible_count: number;
        policy_hash: string;
        input_hash: string;
      }>(`
        SELECT started_at, completed_at, checkpoint_after, eligible_count,
               policy_hash, input_hash
        FROM summary_runs
        WHERE id = 'legacy-run'
      `);
      expect(result.rows[0]).toMatchObject({
        started_at: 1_700_000_000_000,
        completed_at: 1_700_000_000_000,
        checkpoint_after: 2,
        eligible_count: 2,
        policy_hash: "legacy",
        input_hash: "legacy:legacy-run",
      });

      const tables = await client.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
      `);
      expect(tables.rows.map(({ table_name }) => table_name)).toEqual(
        expect.arrayContaining([
          "summary_runs",
          "summary_run_messages",
          "model_invocations",
          "summary_feedback",
          "dataset_candidates",
        ]),
      );
    } finally {
      await client.close();
    }
  });
});
