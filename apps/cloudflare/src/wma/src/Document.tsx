import type { ParentProps } from "solid-js";
import { HydrationScript } from "@solidjs/web";
import prepaintScript from "./api/prepaint.inline.js?raw";
import telegramBootScript from "./telegram/boot.inline.js?raw";
import "./Document.css";

/** Static SPA shell. No placeholder app markup is emitted: it was creating a
 * second visual screen in Telegram before the client application mounted. */
export default function Document(props: ParentProps) {
  return (
    <html lang="uk">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
        <title>Microsonya</title>
        <script>{prepaintScript}</script>
        <link rel="preconnect" href="https://telegram.org" />
        <script defer src="https://telegram.org/js/telegram-web-app.js" />
        <script defer>{telegramBootScript}</script>
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  );
}
