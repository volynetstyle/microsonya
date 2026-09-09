import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type MicrosonyaDb = NodePgDatabase<typeof schema>;

export type DbClient = {
  pool: pg.Pool;
  db: MicrosonyaDb;
  close(): Promise<void>;
};

/**
 * Request-scoped connection for edge runtimes such as Cloudflare Workers.
 * Hyperdrive owns the durable connection pool; retaining a pg.Pool in a
 * Worker global can leave a dead socket attached to a later invocation.
 */
export type WorkerDbClient = {
  db: MicrosonyaDb;
  close(): Promise<void>;
};

export function openDb(connectionString = requiredDatabaseUrl()): DbClient {
  const pool = new pg.Pool({ connectionString });

  return {
    pool,
    db: drizzle(pool, { schema }),
    close: () => pool.end(),
  } satisfies DbClient;
}

export async function openWorkerDb(
  connectionString: string,
): Promise<WorkerDbClient> {
  let client: pg.Client;
  try {
    client = new pg.Client({ connectionString });
  } catch (cause) {
    throw new TypeError(
      `Invalid Worker database connection string (${connectionStringMetadata(connectionString)}).`,
      { cause },
    );
  }
  await client.connect();
  return {
    db: drizzle(client, { schema }),
    close: () => client.end(),
  } satisfies WorkerDbClient;
}

function connectionStringMetadata(value: unknown): string {
  if (typeof value !== "string") return `type=${typeof value}`;
  const protocol = value.match(/^([a-z][a-z0-9+.-]*):/iu)?.[1] ?? "missing";
  return [
    `length=${value.length}`,
    `protocol=${protocol}`,
    `leadingWhitespace=${/^\s/u.test(value)}`,
    `trailingWhitespace=${/\s$/u.test(value)}`,
    `invalidPercentEscape=${/%(?![0-9a-f]{2})/iu.test(value)}`,
  ].join(", ");
}

function requiredDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  return databaseUrl;
}
