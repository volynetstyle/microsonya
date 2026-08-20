import { getTelegramClientFamily, type TelegramClientFamily } from "./client";
import type { TelegramPlatform, TelegramWebApp } from "./webapp";

export type InputMode = "touch" | "pointer";
export type MotionPreference = "full" | "reduced";
export type DevicePerformanceClass = "low" | "average" | "high";

export type ClientEnvironment = {
  host: "telegram" | "browser";
  telegram?: {
    platform: TelegramPlatform;
    client: TelegramClientFamily;
  };
  device: {
    input: InputMode;
    hover: boolean;
  };
  motion: {
    reduced: boolean;
  };
  performance?: {
    class: DevicePerformanceClass;
  };
};

export type EnvironmentSource = {
  matchMedia(query: string): {
    matches: boolean;
    addEventListener?(
      type: "change",
      listener: (event: MediaQueryListEvent) => void,
    ): void;
    removeEventListener?(
      type: "change",
      listener: (event: MediaQueryListEvent) => void,
    ): void;
  };
  userAgent: string;
};

export function getClientEnvironment(
  webApp: TelegramWebApp | undefined,
  source: EnvironmentSource = {
    matchMedia: (query) => window.matchMedia(query),
    userAgent: navigator.userAgent,
  },
): ClientEnvironment {
  const coarsePointer = source.matchMedia("(pointer: coarse)").matches;
  const canHover = source.matchMedia("(hover: hover)").matches;
  const reducedMotion = source.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const performanceClass = getTelegramAndroidPerformanceClass(source.userAgent);

  return {
    host: webApp ? "telegram" : "browser",
    ...(webApp
      ? {
          telegram: {
            platform: webApp.platform,
            client: getTelegramClientFamily(webApp.platform),
          },
        }
      : {}),
    device: {
      input: coarsePointer ? "touch" : "pointer",
      hover: canHover,
    },
    motion: { reduced: reducedMotion },
    ...(performanceClass ? { performance: { class: performanceClass } } : {}),
  };
}

export function applyClientEnvironment(
  root: HTMLElement,
  environment: ClientEnvironment,
): void {
  root.dataset.host = environment.host;
  root.dataset.input = environment.device.input;
  root.dataset.hover = environment.device.hover ? "available" : "none";
  root.dataset.motion = environment.motion.reduced ? "reduced" : "full";

  if (environment.telegram) {
    root.dataset.tgPlatform = environment.telegram.platform;
    root.dataset.tgClient = environment.telegram.client;
  } else {
    delete root.dataset.tgPlatform;
    delete root.dataset.tgClient;
  }

  if (environment.performance) {
    root.dataset.devicePerformance = environment.performance.class;
  } else {
    delete root.dataset.devicePerformance;
  }
}

export function observeClientEnvironment(
  root: HTMLElement,
  webApp: TelegramWebApp | undefined,
  source: EnvironmentSource = {
    matchMedia: (query) => window.matchMedia(query),
    userAgent: navigator.userAgent,
  },
): () => void {
  const queries = [
    source.matchMedia("(pointer: coarse)"),
    source.matchMedia("(hover: hover)"),
    source.matchMedia("(prefers-reduced-motion: reduce)"),
  ];
  const sync = () =>
    applyClientEnvironment(root, getClientEnvironment(webApp, source));

  sync();
  for (const query of queries) query.addEventListener?.("change", sync);

  return () => {
    for (const query of queries) query.removeEventListener?.("change", sync);
  };
}

export function getTelegramAndroidPerformanceClass(
  userAgent: string,
): DevicePerformanceClass | undefined {
  if (!/Telegram-Android\//iu.test(userAgent)) return undefined;

  const match = userAgent.match(/;\s*(LOW|AVERAGE|HIGH)\s*\)/iu);
  switch (match?.[1]?.toUpperCase()) {
    case "LOW":
      return "low";
    case "AVERAGE":
      return "average";
    case "HIGH":
      return "high";
    default:
      return undefined;
  }
}
