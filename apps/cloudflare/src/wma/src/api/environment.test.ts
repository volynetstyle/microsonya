import { describe, expect, it } from "vitest";
import { getTelegramClientFamily } from "./client";
import {
  getClientEnvironment,
  getTelegramAndroidPerformanceClass,
  type EnvironmentSource,
} from "./environment";
import type { TelegramPlatform, TelegramWebApp } from "./webapp";

describe("getTelegramClientFamily", () => {
  it.each([
    ["ios", "mobile"],
    ["android", "mobile"],
    ["android_x", "mobile"],
    ["macos", "desktop"],
    ["tdesktop", "desktop"],
    ["unigram", "desktop"],
    ["web", "web"],
    ["weba", "web"],
    ["webk", "web"],
    ["unknown", "unknown"],
  ] satisfies Array<[TelegramPlatform, string]>)(
    "%s maps to %s",
    (platform, family) => {
      expect(getTelegramClientFamily(platform)).toBe(family);
    },
  );
});

describe("getClientEnvironment", () => {
  it("keeps Telegram family and input capabilities on independent axes", () => {
    const environment = getClientEnvironment(
      { platform: "webk" } as TelegramWebApp,
      source({ coarse: true, hover: false, reduced: false }),
    );

    expect(environment).toMatchObject({
      host: "telegram",
      telegram: { platform: "webk", client: "web" },
      device: { input: "touch", hover: false },
      motion: { reduced: false },
    });
  });

  it("classifies a plain pointer browser without inventing a Telegram client", () => {
    const environment = getClientEnvironment(
      undefined,
      source({ coarse: false, hover: true, reduced: true }),
    );

    expect(environment).toEqual({
      host: "browser",
      device: { input: "pointer", hover: true },
      motion: { reduced: true },
    });
  });
});

describe("getTelegramAndroidPerformanceClass", () => {
  it.each([
    ["Telegram-Android/11.0 (Google Pixel; Android 15; SDK 35; LOW)", "low"],
    [
      "Telegram-Android/11.0 (Samsung SM-S921B; Android 14; SDK 34; AVERAGE)",
      "average",
    ],
    ["Telegram-Android/11.0 (Xiaomi 15; Android 15; SDK 35; HIGH)", "high"],
  ])("parses %s", (userAgent, expected) => {
    expect(getTelegramAndroidPerformanceClass(userAgent)).toBe(expected);
  });

  it("ignores unrelated and incomplete user agents", () => {
    expect(
      getTelegramAndroidPerformanceClass("Mozilla/5.0 Chrome"),
    ).toBeUndefined();
    expect(
      getTelegramAndroidPerformanceClass(
        "Telegram-Android/11.0 (Google Pixel; Android 15; SDK 35)",
      ),
    ).toBeUndefined();
  });
});

function source(options: {
  coarse: boolean;
  hover: boolean;
  reduced: boolean;
  userAgent?: string;
}): EnvironmentSource {
  return {
    matchMedia(query) {
      return {
        matches:
          query === "(pointer: coarse)"
            ? options.coarse
            : query === "(hover: hover)"
              ? options.hover
              : options.reduced,
      };
    },
    userAgent: options.userAgent ?? "Mozilla/5.0",
  };
}
