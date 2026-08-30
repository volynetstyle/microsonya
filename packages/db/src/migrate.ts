import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { applyMigrations } from "./migrateRunner.js";

for (const envPath of [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env"),
]) {
  if (existsSync(envPath)) loadEnv({ path: envPath, override: false });
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

await applyMigrations(databaseUrl);
console.info("Database migrations applied successfully.");
