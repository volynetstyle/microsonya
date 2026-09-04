import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  printStagingTarget,
  stagingDatabaseTarget,
  withStagingClient,
} from "./database.js";

type MigrationJournal = {
  entries: Array<{ tag: string; when: number }>;
};

const target = stagingDatabaseTarget();
printStagingTarget(target);

const journal = JSON.parse(
  await readFile(
    resolve("packages/db/src/migrations/meta/_journal.json"),
    "utf8",
  ),
) as MigrationJournal;

const repositoryMigrations = await Promise.all(
  journal.entries.map(async (entry) => ({
    ...entry,
    hashes: (() => {
      return [] as string[];
    })(),
  })),
);

for (const migration of repositoryMigrations) {
  const contents = await readFile(
    resolve(`packages/db/src/migrations/${migration.tag}.sql`),
    "utf8",
  );
  migration.hashes.push(createHash("sha256").update(contents).digest("hex"));
  const lf = contents.replace(/\r\n/g, "\n");
  if (lf !== contents) {
    migration.hashes.push(createHash("sha256").update(lf).digest("hex"));
  }
}

const appliedMigrations = await withStagingClient(async (client) => {
  const exists = await client.query<{ exists: boolean }>(
    "select to_regclass('drizzle.__drizzle_migrations') is not null as exists",
  );
  if (!exists.rows[0]?.exists) return [];

  const result = await client.query<{ hash: string; created_at: string }>(
    'select hash, created_at::text from drizzle."__drizzle_migrations" order by created_at asc',
  );
  return result.rows;
});

if (appliedMigrations.length > repositoryMigrations.length) {
  throw new Error("Staging has more Drizzle migrations than this repository.");
}

for (const [index, applied] of appliedMigrations.entries()) {
  const expected = repositoryMigrations[index];
  if (!expected || !expected.hashes.includes(applied.hash)) {
    throw new Error(
      `Migration history diverges at position ${index + 1}; refusing to propose a migration.`,
    );
  }
}

console.info(`Repository migrations: ${repositoryMigrations.length}.`);
console.info(`Recorded migrations on staging: ${appliedMigrations.length}.`);
for (const entry of repositoryMigrations.slice(appliedMigrations.length)) {
  console.info(`PENDING ${entry.tag}`);
}

if (appliedMigrations.length >= repositoryMigrations.length) {
  console.info("No repository migrations appear pending.");
  console.info("MIGRATIONS = PASS");
}
