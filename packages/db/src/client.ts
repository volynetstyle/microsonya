import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type MicrosonyaDb = NodePgDatabase<typeof schema>;

export type DbClient = {
  pool: pg.Pool;
  db: MicrosonyaDb;
  close(): Promise<void>;
};

export function openDb(connectionString = requiredDatabaseUrl()): DbClient {
  const pool = new pg.Pool({ connectionString });

  return {
    pool,
    db: drizzle(pool, { schema }),
    close: () => pool.end(),
  };
}

function requiredDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  return databaseUrl;
}
