import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./packages/db/src/schema.ts",
  out: "./packages/db/src/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.MICROSONYA_DB ?? "microsonya.sqlite"
  }
});
