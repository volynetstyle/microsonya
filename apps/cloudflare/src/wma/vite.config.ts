import { defineConfig } from "vitest/config";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  // Turnkey client mode: no index.html and no mount file — the plugin
  // generates the entries around src/App.tsx, wrapped in src/Document.tsx
  // (or a built-in shell). `vite build` prerenders the shell into
  // dist/client/index.html and emits a purely static dist/client.
  plugins: [solid({ start: true })],
  server: {
    host: "127.0.0.1",
    port: 3000,

    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },

    allowedHosts: [".trycloudflare.com"],
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./vitest-setup.ts"],
    // if you have few tests, try commenting this
    // out to improve performance:
    isolate: false,
  },
  build: {
    target: "esnext",
    // Keep images as asset files instead of inlining them into the JS bundle.
    assetsInlineLimit: 0,
  },
});
