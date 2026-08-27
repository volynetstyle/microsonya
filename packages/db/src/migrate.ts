import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { openDb } from "./client.js";

for (const envPath of [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env"),
]) {
  if (existsSync(envPath)) loadEnv({ path: envPath, override: false });
}

const directory = dirname(fileURLToPath(import.meta.url));
const client = openDb();

try {
  await migrate(client.db, {
    migrationsFolder: resolve(directory, "migrations"),
  });
  console.info("Database migrations applied successfully.");
} finally {
  await client.close();
}
