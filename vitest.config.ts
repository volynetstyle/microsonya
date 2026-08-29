import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // WMA owns a separate jsdom/Solid configuration and is executed by its
    // workspace script. Root tests stay in the Node environment.
    exclude: [
      ...configDefaults.exclude,
      "apps/telegram/wma/**",
      "apps/cloudflare/**",
    ],
  },
});
