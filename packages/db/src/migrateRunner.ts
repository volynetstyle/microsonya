import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { openDb } from "./client.js";

export async function applyMigrations(connectionString: string): Promise<void> {
  const directory = dirname(fileURLToPath(import.meta.url));
  const client = openDb(connectionString);

  try {
    await migrate(client.db, {
      migrationsFolder: resolve(directory, "migrations"),
    });
  } finally {
    await client.close();
  }
}
