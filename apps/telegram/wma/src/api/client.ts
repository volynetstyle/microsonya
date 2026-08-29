import type { TelegramPlatform } from "./webapp";

export type TelegramClientFamily = "mobile" | "desktop" | "web" | "unknown";

export function getTelegramClientFamily(
  platform: TelegramPlatform,
): TelegramClientFamily {
  switch (platform) {
    case "ios":
    case "android":
    case "android_x":
      return "mobile";

    case "macos":
    case "tdesktop":
    case "unigram":
      return "desktop";

    case "web":
    case "weba":
    case "webk":
      return "web";

    default:
      return "unknown";
  }
}
