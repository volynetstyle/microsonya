import type { SummaryJob } from "@microsonya/contracts";
import { tracing } from "cloudflare:workers";
import { handleSummaryQueue } from "./summary-queue-consumer.js";
import { handleTelegramWebhook } from "./telegram-webhook-handler.js";
type CloudflareEnv = Omit<Env, "SUMMARY_JOBS"> & {
  readonly SUMMARY_JOBS: Queue<SummaryJob>;
};
const worker = {
  async fetch(request, env, context): Promise<Response> {
    return tracing.enterSpan("telegram.ingress", async (span) => {
      span.setAttribute("microsonya.transport", "telegram");
      return handleTelegramWebhook(request, env, span, context);
    });
  },

  async queue(batch: MessageBatch<SummaryJob>, env): Promise<void> {
    await handleSummaryQueue(batch, env);
  },
} satisfies ExportedHandler<CloudflareEnv, SummaryJob>;

export default worker;
