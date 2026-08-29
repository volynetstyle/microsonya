import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createTestHarness } from "wrangler";

const databaseUrl = process.env.PIPELINE_DATABASE_URL;
if (process.env.MICROSONYA_PIPELINE_INTEGRATION === "1" && !databaseUrl) {
  throw new Error("test:pipeline requires PIPELINE_DATABASE_URL.");
}

const encryptionKey = randomBytes(32).toString("base64");
const webhookSecret = "pipeline-webhook-secret";
const network = setupServer(
  http.post("https://api.telegram.org/bot*/sendMessage", () =>
    HttpResponse.json({ ok: true, result: { message_id: 987_654 } }),
  ),
);
const harness = createTestHarness({
  root: process.cwd(),
  workers: [
    {
      configPath: "apps/cloudflare/workers/ingress/wrangler.jsonc",
      secrets: {
        TELEGRAM_WEBHOOK_SECRET: webhookSecret,
        MICROSONYA_DATA_ENCRYPTION_KEY: encryptionKey,
      },
    },
    {
      configPath: "apps/cloudflare/workers/lifecycle/wrangler.jsonc",
      secrets: { MICROSONYA_DATA_ENCRYPTION_KEY: encryptionKey },
    },
    {
      configPath: "apps/cloudflare/workers/processor/wrangler.jsonc",
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

  it("turns a Telegram update into one completed durable run", async () => {
    const commandMessageId = Math.floor(100_000 + Math.random() * 1_000_000);
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
          chat: { id: -100_900_000_001, type: "supergroup" },
          text: "/summary",
          entities: [{ type: "bot_command", offset: 0, length: 8 }],
        },
      }),
    });
    expect(response.status).toBe(200);

    const terminal = await poll(async () => {
      const result = await database.query<{
        status: string;
        telegram_message_id: number | null;
      }>(
        `select status, telegram_message_id
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

    expect(terminal).toEqual({
      status: "completed",
      telegram_message_id: 987_654,
    });
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
