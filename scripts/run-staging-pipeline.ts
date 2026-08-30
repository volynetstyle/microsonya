import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

const stagingEnvPath = resolve(process.cwd(), ".env.staging");
if (!existsSync(stagingEnvPath)) {
  throw new Error("test:pipeline:staging requires a local .env.staging file.");
}

loadEnv({ path: stagingEnvPath, override: false });
const databaseUrl =
  process.env.STAGING_PIPELINE_DATABASE_URL ?? process.env.STAGING_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "Set STAGING_PIPELINE_DATABASE_URL (or the temporary STAGING_DATABASE_URL fallback) in .env.staging.",
  );
}

const isWindows = process.platform === "win32";
const child = spawn(
  isWindows ? "cmd.exe" : "pnpm",
  isWindows ? ["/d", "/s", "/c", "pnpm.cmd test:pipeline"] : ["test:pipeline"],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PIPELINE_DATABASE_URL: databaseUrl,
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: databaseUrl,
    },
    stdio: "inherit",
  },
);

const exitCode = await new Promise<number>((resolveExit, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    resolveExit(code ?? (signal ? 1 : 0));
  });
});

process.exitCode = exitCode;
