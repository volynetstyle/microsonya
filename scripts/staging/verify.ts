import {
  printStagingTarget,
  stagingDatabaseTarget,
  withStagingClient,
} from "./database.js";

const target = stagingDatabaseTarget();
printStagingTarget(target);

await withStagingClient(async (client) => {
  const identity = await client.query<{
    database: string;
    user: string;
    server_version: string;
  }>(
    "select current_database() as database, current_user as user, version() as server_version",
  );
  const migrationTable = await client.query<{ exists: boolean }>(
    "select to_regclass('drizzle.__drizzle_migrations') is not null as exists",
  );

  const info = identity.rows[0];
  console.info(`Connected as ${info.user} to database ${info.database}.`);
  console.info(`PostgreSQL: ${info.server_version.split(",")[0]}.`);
  console.info(
    migrationTable.rows[0]?.exists
      ? "Drizzle migration history is present."
      : "Drizzle migration history is not present yet (a fresh staging database is valid).",
  );
});

console.info("Staging connection verification passed.");
