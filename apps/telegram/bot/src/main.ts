import { createApp } from "./app.js";
import { readConfig } from "./config.js";

const app = createApp(readConfig());

await app.start();