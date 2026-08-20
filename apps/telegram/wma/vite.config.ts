import { fileRoutes } from "filesystem-routing/vite";
import { defineConfig } from "vitest/config";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  // Turnkey client mode: no index.html and no mount file — the plugin
  // generates the entries around src/App.tsx, wrapped in src/Document.tsx
  // (or a built-in shell). `vite build` prerenders the shell into
  // dist/client/index.html and emits a purely static dist/client.
  plugins: [
    // `extensions` makes @solidjs/vite-plugin also compile the `?pick=` route
    // modules the fileRoutes plugin emits (their ids end in a query string).
    solid({ start: true, extensions: [".jsx", ".tsx"] }), // add `ssr: true` for streaming SSR
    // codeSplitting: false — a single route isn't worth a second network
    // round-trip (main bundle, then a dynamic import of the route chunk)
    // before real content can render; bundle it in eagerly instead. Revisit
    // once there's more than one route and splitting starts paying for itself.
    fileRoutes({ types: true, codeSplitting: false }),
  ],
  server: {
    // Keep the dev server and scripts/dev-webapp-tunnel.mjs readiness probe
    // on the same address. On Windows, localhost may resolve to IPv6 ::1
    // while the supervisor probes IPv4 127.0.0.1.
    host: "127.0.0.1",
    port: 3000,
    // Quick `cloudflared tunnel` runs (see pnpm dev:webapp:tunnel) get a
    // random *.trycloudflare.com host each time, which Vite's dev-server
    // host check rejects by default.
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
