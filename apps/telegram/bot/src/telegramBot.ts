import { Telegraf } from "telegraf";
import type { AppConfig } from "./config.js";
import type { BotServices } from "./telegramHandlers.js";
import { createMessageHandler } from "./telegramHandlers.js";

export function createTelegramBot(
  config: AppConfig,
  services: BotServices,
): Telegraf {
  const bot = new Telegraf(config.telegramToken);

  bot.on("message", createMessageHandler(services));

  return bot;
}
