#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import net from "node:net";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const instanceId = `microsonya-dev-${randomUUID()}`;
const instanceDirectory = resolve(repoRoot, ".data");
const instanceFile = resolve(
  instanceDirectory,
  "dev-webapp-tunnel.instance.json",
);

const config = {
  wmaHost: "127.0.0.1",
  wmaPort: 3000,
  // 3001 was Vite's former fallback when 3000 was occupied. Release both so
  // interrupted older supervisors cannot leave a competing WMA behind.
  staleWmaPorts: [3000, 3001],
  portReleaseTimeout: 5_000,
  wmaTimeout: 30_000,
  tunnelTimeout: 30_000,
};

// cloudflared diagnostics may mention https://api.trycloudflare.com; that is
// not the allocated tunnel hostname and must not satisfy readiness.
const TUNNEL_URL_RE = /https:\/\/(?!api\.)[\w.-]+\.trycloudflare\.com/;

const children = new Set();
let shuttingDown = false;

// -----------------------------------------------------------------------------
// Processes
// -----------------------------------------------------------------------------

function spawnProcess(command, args, options = {}) {
  const spawnOptions = {
    cwd: repoRoot,
    ...options,
    env: {
      ...process.env,
      ...options.env,
      MICROSONYA_DEV_INSTANCE_ID: instanceId,
    },
    // On Unix this gives us a process group, so cleanup can kill pnpm + Vite,
    // not just the immediate pnpm process.
    detached: !isWindows,
  };

  const child = isWindows
    ? spawn("cmd.exe", ["/d", "/s", "/c", command, ...args], spawnOptions)
    : spawn(command, args, spawnOptions);

  children.add(child);
  persistInstance();
  child.once("exit", () => {
    children.delete(child);
    persistInstance();
  });

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

function killProcessTree(pid, { group = true } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return;

  if (isWindows) {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(group ? -pid : pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function processCommandLine(pid) {
  const result = isWindows
    ? spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$process = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" -ErrorAction SilentlyContinue; if ($process) { $process.CommandLine }`,
        ],
        { encoding: "utf8", windowsHide: true },
      )
    : spawnSync("ps", ["-p", String(pid), "-o", "args="], {
        encoding: "utf8",
      });

  return String(result.stdout ?? "").trim();
}

function readInstanceFile() {
  try {
    return JSON.parse(readFileSync(instanceFile, "utf8"));
  } catch {
    return undefined;
  }
}

function stopPreviousInstance() {
  const previous = readInstanceFile();
  const pid = Number(previous?.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return;

  const commandLine = processCommandLine(pid);
  if (!commandLine.includes("dev-webapp-tunnel.mjs")) return;

  console.log(
    `    Stopping previous ${previous.instanceId ?? "Microsonya dev instance"} (PID ${pid})...`,
  );

  for (const childPid of previous.childPids ?? []) {
    killProcessTree(Number(childPid));
  }

  killProcessTree(pid, { group: false });
}

function persistInstance({ force = false } = {}) {
  const current = readInstanceFile();
  if (!force && current && current.instanceId !== instanceId) return;

  mkdirSync(instanceDirectory, { recursive: true });
  writeFileSync(
    instanceFile,
    `${JSON.stringify(
      {
        instanceId,
        pid: process.pid,
        childPids: [...children]
          .map((child) => child.pid)
          .filter((pid) => Number.isSafeInteger(pid) && pid > 0),
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function registerInstance() {
  persistInstance({ force: true });
}

function unregisterInstance() {
  const current = readInstanceFile();
  if (current?.instanceId !== instanceId) return;

  try {
    unlinkSync(instanceFile);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    killProcess(child);
  }

  children.clear();
  unregisterInstance();
}

function shutdown(code = 0) {
  cleanup();
  process.exit(code);
}

function listenerPids(port) {
  const result = isWindows
    ? spawnSync("netstat", ["-ano", "-p", "tcp"], {
        encoding: "utf8",
        windowsHide: true,
      })
    : spawnSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], {
        encoding: "utf8",
      });

  if (result.error && result.error.code !== "ENOENT") throw result.error;

  const lines = String(result.stdout ?? "").split(/\r?\n/u);
  const rawPids = isWindows
    ? lines.flatMap((line) => {
        const columns = line.trim().split(/\s+/u);
        if (columns.length < 5 || columns[3] !== "LISTENING") return [];

        const localAddress = columns[1];
        const localPort = Number(
          localAddress.slice(localAddress.lastIndexOf(":") + 1),
        );
        return localPort === port ? [columns[4]] : [];
      })
    : lines;

  return rawPids
    .map(Number)
    .filter(
      (pid) => Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid,
    );
}

async function releasePort(port) {
  const pids = [...new Set(listenerPids(port))];
  if (pids.length === 0) return;

  console.log(
    `    Stopping stale listener(s) on :${port} (PID ${pids.join(", ")})...`,
  );

  for (const pid of pids) {
    if (isWindows) {
      const result = spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      if (result.status !== 0) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // It may have exited between discovery and termination. The socket
          // check below, rather than taskkill's exit code, is authoritative.
        }
      }
    } else {
      try {
        process.kill(pid, "SIGTERM");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
  }

  try {
    await waitForPortToClose(port, {
      host: config.wmaHost,
      timeout: config.portReleaseTimeout,
    });
  } catch {
    throw new Error(
      `Could not release ${config.wmaHost}:${port} (PID ${pids.join(", ")}). ` +
        "Terminate it manually or run this command with permission to stop that process.",
    );
  }
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

function waitForPortToClose(
  port,
  { host = "127.0.0.1", timeout = 5_000 } = {},
) {
  return new Promise((resolvePort, reject) => {
    const startedAt = Date.now();

    function probe() {
      const socket = net.createConnection({ host, port });

      socket.once("connect", () => {
        socket.destroy();

        if (Date.now() - startedAt >= timeout) {
          reject(
            new Error(
              `Port ${host}:${port} remained occupied after terminating its listener.`,
            ),
          );
          return;
        }

        setTimeout(probe, 50);
      });

      socket.once("error", () => {
        socket.destroy();
        resolvePort();
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

  console.log(`Instance: ${instanceId}`);
  console.log("1/3 Stopping the previous instance and starting WMA...");

  stopPreviousInstance();
  registerInstance();

  for (const port of config.staleWmaPorts) {
    await releasePort(port);
  }

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
