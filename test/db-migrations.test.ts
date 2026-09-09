import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("database migrations", () => {
  it("builds the encrypted v0.1 schema from an empty database", async () => {
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

      await client.exec(
        await readFile(
          resolve(migrationsDirectory, "0004_optimal_blob.sql"),
          "utf8",
        ),
      );
      await client.exec(
        await readFile(
          resolve(migrationsDirectory, "0005_clever_korath.sql"),
          "utf8",
        ),
      );
      await client.exec(
        await readFile(
          resolve(migrationsDirectory, "0006_good_apocalypse.sql"),
          "utf8",
        ),
      );
      await client.exec(
        await readFile(
          resolve(migrationsDirectory, "0007_early_captain_cross.sql"),
          "utf8",
        ),
      );
      await client.exec(
        await readFile(
          resolve(migrationsDirectory, "0008_green_arachne.sql"),
          "utf8",
        ),
      );
      for (const name of [
        "0009_unknown_dragon_lord.sql",
        "0010_bouncy_bromley.sql",
        "0011_curious_genesis.sql",
        "0012_hesitant_gressill.sql",
      ]) {
        await client.exec(
          await readFile(resolve(migrationsDirectory, name), "utf8"),
        );
      }

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
          "summary_run_lifecycle",
        ]),
      );

      const privatePlaintextColumns = await client.query<{
        column_name: string;
      }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (
            (table_name = 'messages' AND column_name IN ('text', 'author_name'))
            OR (table_name = 'summary_runs' AND column_name = 'text')
            OR (table_name = 'summary_run_messages'
                AND column_name IN ('author_name', 'forward_origin'))
            OR (table_name = 'summary_feedback' AND column_name = 'comment')
          )
      `);
      expect(privatePlaintextColumns.rows).toEqual([]);
    } finally {
      await client.close();
    }
  }, 15_000);

  it("invalidates legacy active leases before adding fencing constraints", async () => {
    const client = new PGlite();
    const migrationsDirectory = resolve(
      process.cwd(),
      "packages/db/src/migrations",
    );
    try {
      for (let index = 0; index <= 9; index += 1) {
        const names = [
          "0000_married_randall.sql",
          "0001_public_lila_cheney.sql",
          "0002_cooing_robbie_robertson.sql",
          "0003_sad_supernaut.sql",
          "0004_optimal_blob.sql",
          "0005_clever_korath.sql",
          "0006_good_apocalypse.sql",
          "0007_early_captain_cross.sql",
          "0008_green_arachne.sql",
          "0009_unknown_dragon_lord.sql",
        ];
        await client.exec(
          await readFile(resolve(migrationsDirectory, names[index]!), "utf8"),
        );
      }
      await client.exec(`
        INSERT INTO summary_run_lifecycle (
          id, idempotency_key, chat_id, chat_id_ciphertext,
          command_message_id, command_date, mode, status,
          created_at, updated_at, attempt, lease_expires_at
        ) VALUES
          ('processing', 'key-processing', 'chat', '\\x01', 1, 1, 'recent', 'processing', 1, 2, 1, 999),
          ('delivering', 'key-delivering', 'chat', '\\x01', 2, 1, 'recent', 'delivering', 1, 2, 1, 999);
      `);
      await client.exec(
        await readFile(
          resolve(migrationsDirectory, "0010_bouncy_bromley.sql"),
          "utf8",
        ),
      );
      const migrated = await client.query<{
        status: string;
        retry_stage: string;
        lease_expires_at: number | null;
      }>(
        `SELECT status, retry_stage, lease_expires_at FROM summary_run_lifecycle ORDER BY id`,
      );
      expect(migrated.rows).toEqual([
        {
          status: "retry_wait",
          retry_stage: "processing",
          lease_expires_at: null,
        },
        {
          status: "retry_wait",
          retry_stage: "processing",
          lease_expires_at: null,
        },
      ]);
    } finally {
      await client.close();
    }
  }, 15_000);
});
