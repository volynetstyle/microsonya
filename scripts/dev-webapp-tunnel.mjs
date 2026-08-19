#!/usr/bin/env node
// Runs the WMA dev server + a cloudflared tunnel + the bot together,
// wiring the tunnel's https URL into the bot as WMA_URL automatically.
// No manual copy-pasting into .env, no restart needed.

import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const pnpmCmd = "pnpm";

// On Windows, pnpm/cloudflared resolve to .cmd shims or need PATH lookup that
// spawn() only does through a shell — but shell:true with an args array
// triggers Node's DEP0190 warning. Route through cmd.exe /c ourselves
// instead: same effect, no warning, and all our args are static (no
// untrusted input reaches the command line).
function spawnCommand(command, args, options) {
  if (isWindows) {
    return spawn("cmd.exe", ["/d", "/s", "/c", command, ...args], options);
  }
  return spawn(command, args, options);
}

function findCloudflared() {
  const probe = spawnSync(isWindows ? "where" : "which", ["cloudflared"], {
    stdio: "ignore",
  });
  return probe.status === 0;
}

if (!findCloudflared()) {
  console.error("cloudflared not found. Install it first:");
  console.error("  winget install --id Cloudflare.cloudflared   (Windows)");
  console.error("  brew install cloudflared                     (macOS)");
  process.exit(1);
}

const children = [];

function cleanup() {
  // On Windows, spawn() with shell:true wraps the real process tree (pnpm ->
  // node -> vite/tsx) in a cmd.exe shell; killing just that shell leaves the
  // rest running, so tear down the whole tree via taskkill instead.
  for (const child of children) {
    if (child.killed || child.pid === undefined) continue;
    if (isWindows) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
      });
    } else {
      child.kill();
    }
  }
}

process.once("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.once("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

console.log("Starting Vite dev server for apps/telegram/wma...");
const wma = spawnCommand(
  pnpmCmd,
  ["--filter", "@microsonya/telegram-wma", "dev"],
  { cwd: repoRoot, stdio: "ignore" },
);
children.push(wma);

console.log("Starting cloudflared tunnel...");
const tunnel = spawnCommand(
  "cloudflared",
  ["tunnel", "--url", "http://localhost:3000"],
  { cwd: repoRoot },
);
children.push(tunnel);

let tunnelOutput = "";
let wmaUrl;
const wmaUrlPromise = new Promise((resolveUrl, rejectUrl) => {
  const timeout = setTimeout(() => {
    rejectUrl(
      new Error(
        `Could not detect the tunnel URL after 30s. cloudflared output:\n${tunnelOutput}`,
      ),
    );
  }, 30_000);

  function onData(chunk) {
    tunnelOutput += chunk.toString();
    const match = tunnelOutput.match(
      /https:\/\/[a-zA-Z0-9.-]+\.trycloudflare\.com/,
    );
    if (match) {
      clearTimeout(timeout);
      tunnel.stdout.off("data", onData);
      tunnel.stderr.off("data", onData);
      resolveUrl(match[0]);
    }
  }

  tunnel.stdout.on("data", onData);
  tunnel.stderr.on("data", onData);
});

try {
  wmaUrl = await wmaUrlPromise;
} catch (error) {
  console.error(error.message);
  cleanup();
  process.exit(1);
}

console.log(`Tunnel ready: ${wmaUrl}`);
console.log(
  `Starting the bot (STORAGE_MODE=memory, MODELS_MODE=disabled, WMA_URL=${wmaUrl})...`,
);
console.log("Send /app to the bot once it's up.");

const bot = spawnCommand(
  pnpmCmd,
  ["--filter", "@microsonya/telegram-bot", "dev"],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      STORAGE_MODE: "memory",
      MODELS_MODE: "disabled",
      WMA_URL: wmaUrl,
    },
  },
);
children.push(bot);

bot.on("exit", (code) => {
  cleanup();
  process.exit(code ?? 0);
});
