import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { URL } from "node:url";
import { config as loadEnv } from "dotenv";
import pg from "pg";

export type StagingDatabaseTarget = {
  connectionString: string;
  database: string;
  host: string;
  port: string;
  user: string;
};

const confirmationValue = "microsonya-staging";

// Staging commands intentionally load only staging-specific local files. They
// must never inherit a general .env DATABASE_URL by accident.
for (const envPath of [
  resolve(process.cwd(), ".env.staging"),
  resolve(process.cwd(), ".env.staging.local"),
]) {
  if (existsSync(envPath)) loadEnv({ path: envPath, override: false });
}

export function stagingDatabaseTarget(): StagingDatabaseTarget {
  const connectionString = process.env.STAGING_DATABASE_URL;

  if (!connectionString) {
    if (process.env.STAGING_DATABASE_UR) {
      throw new Error(
        "Found STAGING_DATABASE_UR, but the required variable is STAGING_DATABASE_URL (with a final L).",
      );
    }

    throw new Error(
      "STAGING_DATABASE_URL is required. Put it in .env.staging or export it in this shell. Refusing to fall back to DATABASE_URL.",
    );
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(
      "STAGING_DATABASE_URL must be a valid PostgreSQL connection URL.",
    );
  }

  if (!url.protocol.startsWith("postgres")) {
    throw new Error("STAGING_DATABASE_URL must use a PostgreSQL protocol.");
  }

  return {
    connectionString,
    database: decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres",
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username) || "(default)",
  };
}

export function requireStagingMutationApproval(): void {
  if (process.env.MICROSONYA_STAGING_CONFIRM !== confirmationValue) {
    throw new Error(
      `Refusing a staging write. Set MICROSONYA_STAGING_CONFIRM=${confirmationValue} explicitly.`,
    );
  }
}

export async function withStagingClient<T>(
  operation: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const target = stagingDatabaseTarget();
  const client = new pg.Client({ connectionString: target.connectionString });

  await client.connect();
  try {
    return await operation(client);
  } finally {
    await client.end();
  }
}

export function printStagingTarget(target: StagingDatabaseTarget): void {
  // Deliberately do not print the connection string or any password/query parameters.
  console.info(
    `Staging target: postgres://${target.user}@${target.host}:${target.port}/${target.database}`,
  );
}
