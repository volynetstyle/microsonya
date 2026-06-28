import { Telegraf } from "telegraf";
import type { AppConfig } from "./config.js";
import type { AppServices } from "./services.js";
import { createMessageHandler } from "./telegramHandlers.js";

export function createTelegramBot(
  config: AppConfig,
  services: AppServices,
): Telegraf {
  const bot = new Telegraf(config.telegramToken);

  bot.on("message", createMessageHandler(services));

  return bot;
}