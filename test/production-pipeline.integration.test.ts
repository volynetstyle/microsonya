import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createTestHarness } from "wrangler";

if (process.env.MICROSONYA_PIPELINE_INTEGRATION === "1") {
  loadEnv({ path: resolve(process.cwd(), ".env.staging"), override: false });
}

const databaseUrl =
  process.env.PIPELINE_DATABASE_URL ??
  process.env.STAGING_PIPELINE_DATABASE_URL ??
  process.env.STAGING_DATABASE_URL;
if (process.env.MICROSONYA_PIPELINE_INTEGRATION === "1" && !databaseUrl) {
  throw new Error(
    "test:pipeline requires STAGING_PIPELINE_DATABASE_URL (or an explicit PIPELINE_DATABASE_URL).",
  );
}

const encryptionKey = randomBytes(32).toString("base64");
const webhookSecret = "pipeline-webhook-secret";
const network = setupServer(
  http.post("https://api.telegram.org/bot*/sendMessage", () =>
    HttpResponse.json({ ok: true, result: { message_id: 987_654 } }),
  ),
  http.post("https://ollama.com/api/chat", async ({ request }) => {
    const body = (await request.json()) as {
      messages?: Array<{ content?: string }>;
    };
    const prompt = body.messages?.[0]?.content ?? "";
    const content = prompt.includes("CLASSIFICATION_POLICY")
      ? JSON.stringify({
          durable: true,
          essentialReferentsResolved: true,
          visiblyIncomplete: false,
          alreadyCompact: false,
          primarilyReaction: false,
          primarilyBanter: false,
          requiresSynthesis: true,
        })
      : JSON.stringify({
          summary:
            "Staging pipeline confirmed the durable deployment plan and its verification gates.",
        });
    return HttpResponse.json({
      model: "pipeline-mock",
      created_at: "2026-08-29T00:00:00.000Z",
      message: { role: "assistant", content },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 1,
      eval_count: 1,
    });
  }),
);

type PipelineWorkerConfig = {
  main: string;
  hyperdrive?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

async function stagingWorkerConfig(
  configPath: string,
  main: string,
): Promise<PipelineWorkerConfig> {
  const config = JSON.parse(
    (await readFile(resolve(process.cwd(), configPath), "utf8")).replace(
      /,\s*([}\]])/g,
      "$1",
    ),
  ) as PipelineWorkerConfig;
  return {
    ...config,
    main,
    hyperdrive: config.hyperdrive?.map((binding) => ({
      ...binding,
      // Test-only local runtime wiring. Binding ID/name/service topology remains
      // the exact staging configuration read above.
      localConnectionString:
        databaseUrl ??
        "postgresql://microsonya:microsonya@localhost:5432/microsonya",
    })),
  };
}

const [ingressConfig, lifecycleConfig, processorConfig] = await Promise.all([
  stagingWorkerConfig(
    "apps/cloudflare/workers/ingress/wrangler.staging.jsonc",
    "apps/cloudflare/src/ingress/worker.ts",
  ),
  stagingWorkerConfig(
    "apps/cloudflare/workers/lifecycle/wrangler.staging.jsonc",
    "apps/cloudflare/src/lifecycle/worker.ts",
  ),
  stagingWorkerConfig(
    "apps/cloudflare/workers/processor/wrangler.staging.jsonc",
    "apps/cloudflare/src/processor/worker.ts",
  ),
]);
const harness = createTestHarness({
  root: process.cwd(),
  workers: [
    {
      config: ingressConfig as never,
      secrets: {
        TELEGRAM_WEBHOOK_SECRET: webhookSecret,
        MICROSONYA_DATA_ENCRYPTION_KEY: encryptionKey,
      },
    },
    {
      config: lifecycleConfig as never,
      secrets: { MICROSONYA_DATA_ENCRYPTION_KEY: encryptionKey },
    },
    {
      config: processorConfig as never,
      secrets: {
        MICROSONYA_DATA_ENCRYPTION_KEY: encryptionKey,
        OLLAMA_API_KEY: "unused-for-empty-window",
        TELEGRAM_BOT_TOKEN: "pipeline-token",
      },
    },
  ],
});

describe("production multi-Worker pipeline", () => {
  let database: Client;

  beforeAll(async () => {
    network.listen({ onUnhandledRequest: "error" });
    database = new Client({ connectionString: databaseUrl });
    await database.connect();
    await database.query("select 1 from summary_run_lifecycle limit 0");
    await harness.listen();
  });

  afterAll(async () => {
    network.close();
    await harness.close();
    await database?.end();
  });

  it("persists an ordinary Telegram message and completes a model-backed summary run", async () => {
    const commandMessageId = Math.floor(100_000 + Math.random() * 1_000_000);
    const ordinaryMessageId = commandMessageId - 1;
    const chatId = -100_900_000_001;
    const ordinary = await harness.fetch("/telegram", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": webhookSecret,
      },
      body: JSON.stringify({
        update_id: ordinaryMessageId,
        message: {
          message_id: ordinaryMessageId,
          date: Math.floor(Date.now() / 1_000),
          chat: { id: chatId, type: "supergroup" },
          from: { id: 9001, first_name: "Pipeline" },
          text: "Deploy staging only after migrations, Hyperdrive, Queue, and DLQ have passed their gates.",
        },
      }),
    });
    expect(ordinary.status).toBe(200);

    const response = await harness.fetch("/telegram", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": webhookSecret,
      },
      body: JSON.stringify({
        update_id: commandMessageId,
        message: {
          message_id: commandMessageId,
          date: Math.floor(Date.now() / 1_000),
          chat: { id: chatId, type: "supergroup" },
          text: "/summary",
          entities: [{ type: "bot_command", offset: 0, length: 8 }],
        },
      }),
    });
    expect(response.status).toBe(200);

    const terminal = await poll(async () => {
      const result = await database.query<{
        status: string;
        attempt: number;
        last_error_code: string | null;
        processor_version: string | null;
        model: string | null;
        prompt_version: string | null;
        delivered_at: string | null;
        telegram_message_id: number | null;
        summary_ciphertext: Buffer | null;
      }>(
        `select status, attempt, last_error_code, processor_version, model,
                prompt_version, delivered_at::text, telegram_message_id,
                summary_ciphertext
         from summary_run_lifecycle
         where command_message_id = $1
         order by created_at desc
         limit 1`,
        [commandMessageId],
      );
      return result.rows[0]?.status === "completed"
        ? result.rows[0]
        : undefined;
    });

    expect(terminal).toMatchObject({
      status: "completed",
      attempt: 1,
      last_error_code: null,
      processor_version: "0.1.0-staging",
      model: "configured-profile",
      prompt_version: "summarize-package",
      telegram_message_id: 987_654,
    });
    expect(terminal.delivered_at).not.toBeNull();
    expect(terminal.summary_ciphertext).not.toBeNull();

    const persisted = await database.query<{ message_id: number }>(
      `select message_id from messages where message_id = $1 limit 1`,
      [ordinaryMessageId],
    );
    expect(persisted.rows).toEqual([{ message_id: ordinaryMessageId }]);
  });
});

async function poll<T>(read: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Pipeline did not reach a terminal state within 20 seconds.");
}
