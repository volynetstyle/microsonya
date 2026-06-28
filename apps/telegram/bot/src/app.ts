import type { AppConfig } from "./config.js";
import { createServices } from "./services.js";
import { createTelegramBot } from "./telegramBot.js";

export type App = {
  start(): Promise<void>;
};

export function createApp(config: AppConfig): App {
  const services = createServices(config);
  const bot = createTelegramBot(config, services);

  return {
    async start() {
      await bot.launch();
    },
  };
}