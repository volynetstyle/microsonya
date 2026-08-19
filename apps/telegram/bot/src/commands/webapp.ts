const COMMAND_NAME = "app";

export const telegramCommands = [
  {
    command: COMMAND_NAME,
    description: "Open the Microsonya mini app",
  },
];

// Telegram rejects non-https URLs in inline keyboard buttons outright
// (both `url` and `web_app` buttons), so a local dev URL can only be sent
// as plain text for the user to open manually.
export function buildWebAppMarkup(wmaUrl: string) {
  if (!wmaUrl.startsWith("https://")) return undefined;

  return {
    inline_keyboard: [[{ text: "Open mini app", web_app: { url: wmaUrl } }]],
  };
}
