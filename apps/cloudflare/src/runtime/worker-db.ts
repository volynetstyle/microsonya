import {
  dataEncryptionFromBase64,
  openWorkerDb,
  type DataEncryption,
  type MicrosonyaDb,
} from "@microsonya/db";

export type WorkerDatabaseEnv = Readonly<{
  HYPERDRIVE: Hyperdrive;
  MICROSONYA_DATA_ENCRYPTION_KEY: string;
}>;

/**
 * Opens one request-scoped PostgreSQL client through Hyperdrive and guarantees
 * it is released before control returns to the Worker handler.
 */
export async function withWorkerDatabase<T>(
  env: WorkerDatabaseEnv,
  operation: (db: MicrosonyaDb, encryption: DataEncryption) => Promise<T>,
): Promise<T> {
  const client = await openWorkerDb(env.HYPERDRIVE.connectionString);
  try {
    return await operation(
      client.db,
      dataEncryptionFromBase64(env.MICROSONYA_DATA_ENCRYPTION_KEY),
    );
  } finally {
    await client.close();
  }
}
