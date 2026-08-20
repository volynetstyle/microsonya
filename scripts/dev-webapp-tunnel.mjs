#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import net from "node:net";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

const config = {
  wmaHost: "127.0.0.1",
  wmaPort: 3000,
  wmaTimeout: 30_000,
  tunnelTimeout: 30_000,
};

const TUNNEL_URL_RE = /https:\/\/[\w.-]+\.trycloudflare\.com/;

const children = new Set();
let shuttingDown = false;

// -----------------------------------------------------------------------------
// Processes
// -----------------------------------------------------------------------------

function spawnProcess(command, args, options = {}) {
  const spawnOptions = {
    cwd: repoRoot,
    ...options,
    // On Unix this gives us a process group, so cleanup can kill pnpm + Vite,
    // not just the immediate pnpm process.
    detached: !isWindows,
  };

  const child = isWindows
    ? spawn("cmd.exe", ["/d", "/s", "/c", command, ...args], spawnOptions)
    : spawn(command, args, spawnOptions);

  children.add(child);
  child.once("exit", () => children.delete(child));

  return child;
}

function commandExists(command) {
  return (
    spawnSync(isWindows ? "where" : "which", [command], {
      stdio: "ignore",
    }).status === 0
  );
}

function killProcess(child) {
  if (!child.pid || child.killed) return;

  try {
    if (isWindows) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
      });
    } else {
      // Negative PID = kill the whole process group.
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    // Process may already be gone. Humanity survives.
  }
}

function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    killProcess(child);
  }

  children.clear();
}

function shutdown(code = 0) {
  cleanup();
  process.exit(code);
}

// -----------------------------------------------------------------------------
// Waiting
// -----------------------------------------------------------------------------

function waitForPort(port, { host = "127.0.0.1", timeout = 30_000 } = {}) {
  return new Promise((resolvePort, reject) => {
    const startedAt = Date.now();

    function probe() {
      const socket = net.createConnection({ host, port });

      socket.once("connect", () => {
        socket.destroy();
        resolvePort();
      });

      socket.once("error", () => {
        socket.destroy();

        if (Date.now() - startedAt >= timeout) {
          reject(
            new Error(
              `Port ${host}:${port} did not become ready within ${timeout / 1000}s.`,
            ),
          );
          return;
        }

        setTimeout(probe, 100);
      });
    }

    probe();
  });
}

function waitForTunnelUrl(tunnel, timeout = 30_000) {
  return new Promise((resolveUrl, reject) => {
    let output = "";
    let settled = false;

    const timer = setTimeout(() => {
      finish(
        reject,
        new Error(
          `Could not detect tunnel URL within ${timeout / 1000}s.\n\n${output}`,
        ),
      );
    }, timeout);

    function cleanupListeners() {
      clearTimeout(timer);

      tunnel.stdout?.off("data", onData);
      tunnel.stderr?.off("data", onData);
      tunnel.off("exit", onExit);
      tunnel.off("error", onError);
    }

    function finish(callback, value) {
      if (settled) return;
      settled = true;

      cleanupListeners();
      callback(value);
    }

    function onData(chunk) {
      output += chunk.toString();

      // Enough for diagnostics without accumulating arbitrary log output.
      if (output.length > 16_384) {
        output = output.slice(-16_384);
      }

      const url = output.match(TUNNEL_URL_RE)?.[0];

      if (url) {
        finish(resolveUrl, url);
      }
    }

    function onExit(code) {
      finish(
        reject,
        new Error(
          `cloudflared exited before creating a tunnel (code ${code ?? "unknown"}).`,
        ),
      );
    }

    function onError(error) {
      finish(reject, error);
    }

    tunnel.stdout?.on("data", onData);
    tunnel.stderr?.on("data", onData);
    tunnel.once("exit", onExit);
    tunnel.once("error", onError);
  });
}

function waitForProcessOr(process, promise, name) {
  return new Promise((resolveValue, reject) => {
    let settled = false;

    function finish(callback, value) {
      if (settled) return;
      settled = true;

      process.off("exit", onExit);
      callback(value);
    }

    function onExit(code) {
      finish(
        reject,
        new Error(
          `${name} exited before becoming ready (code ${code ?? "unknown"}).`,
        ),
      );
    }

    process.once("exit", onExit);

    promise.then(
      (value) => finish(resolveValue, value),
      (error) => finish(reject, error),
    );
  });
}

// -----------------------------------------------------------------------------
// Services
// -----------------------------------------------------------------------------

function startWma() {
  return spawnProcess(
    "pnpm",
    [
      "--filter",
      "@microsonya/telegram-wma",
      "dev",
      "--",
      "--port",
      String(config.wmaPort),
      "--host",
      config.wmaHost,
      "--strictPort",
    ],
    {
      stdio: "inherit",
    },
  );
}

function startTunnel() {
  return spawnProcess(
    "cloudflared",
    ["tunnel", "--url", `http://${config.wmaHost}:${config.wmaPort}`],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function startBot(wmaUrl) {
  return spawnProcess("pnpm", ["--filter", "@microsonya/telegram-bot", "dev"], {
    stdio: "inherit",
    env: {
      ...process.env,
      STORAGE_MODE: "memory",
      MODELS_MODE: "disabled",
      WMA_URL: wmaUrl,
    },
  });
}

// -----------------------------------------------------------------------------
// Supervisor
// -----------------------------------------------------------------------------

function supervise(child, name) {
  child.once("exit", (code, signal) => {
    if (shuttingDown) return;

    if (signal) {
      console.error(`${name} terminated by ${signal}.`);
    } else {
      console.error(`${name} exited with code ${code ?? "unknown"}.`);
    }

    shutdown(code ?? 1);
  });

  child.once("error", (error) => {
    if (shuttingDown) return;

    console.error(`${name} failed:`, error);
    shutdown(1);
  });
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  if (!commandExists("cloudflared")) {
    console.error(`
cloudflared not found.

Windows:
  winget install --id Cloudflare.cloudflared

macOS:
  brew install cloudflared
`);

    return 1;
  }

  console.log("1/3 Starting WMA...");

  const wma = startWma();

  await waitForProcessOr(
    wma,
    waitForPort(config.wmaPort, {
      host: config.wmaHost,
      timeout: config.wmaTimeout,
    }),
    "WMA",
  );

  console.log(`    WMA ready on ${config.wmaHost}:${config.wmaPort}`);

  // From this point onward, unexpected WMA exit is fatal.
  supervise(wma, "WMA");

  console.log("2/3 Starting tunnel...");

  const tunnel = startTunnel();

  const wmaUrl = await waitForProcessOr(
    tunnel,
    waitForTunnelUrl(tunnel, config.tunnelTimeout),
    "cloudflared",
  );

  console.log(`    Tunnel ready: ${wmaUrl}`);

  supervise(tunnel, "cloudflared");

  console.log("3/3 Starting bot...");

  const bot = startBot(wmaUrl);

  supervise(bot, "Bot");

  console.log("");
  console.log("Development environment ready.");
  console.log(`WMA_URL=${wmaUrl}`);
  console.log("Send /app to the bot.");
}

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));

try {
  const exitCode = await main();

  if (typeof exitCode === "number") {
    shutdown(exitCode);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));

  shutdown(1);
}
