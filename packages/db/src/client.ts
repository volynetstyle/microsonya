import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type MicrosonyaDb = BetterSQLite3Database<typeof schema>;

export type DbClient = {
  sqlite: Database.Database;
  db: MicrosonyaDb;
};

export function openDb(path = "microsonya.sqlite"): DbClient {
  const sqlite = new Database(path);

  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
  };
}
