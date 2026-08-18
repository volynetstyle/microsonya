import { createApp } from "./app.js";
import { readConfig } from "./config.js";

const app = createApp(readConfig());

process.once("SIGINT", () => app.stop("SIGINT"));
process.once("SIGTERM", () => app.stop("SIGTERM"));

void (await app.start());
