import type { ParentProps } from "solid-js";
import { HydrationScript } from "@solidjs/web";
import prepaintScript from "./api/prepaint.inline.js?raw";
import "./Document.css";

// The document shell — the new index.html: picked up by the src/Document.*
// convention, it wraps the app in the plugin's generated entries and must
// render the full <html>. Head tags go here. It is compiled only into the
// prerendered static shell and ships zero client-side JS: in client mode
// <HydrationScript /> is stripped from the shell, and it activates when the
// app flips to SSR (`ssr: true` in vite.config.ts) — no document changes
// needed. Delete this file to fall back to the plugin's built-in shell.
export default function Document(props: ParentProps) {
  return (
    <html lang="uk">
      {/* HTML download ->
          parse <head> ->
          prepaint inline executes ->
          Telegram SDK starts downloading (defer, non-blocking) ->
          parse <body> + skeleton ->
          first paint ->
          HTML parsing complete ->
          Telegram SDK executes ->
          app entry executes ->
          hydrate/mount ->
          initTelegram() ->
          remove skeleton
      */}
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
        <title>Microsonya</title>
        {/* Establish theme and platform directly from Telegram launch params;
            no network request is allowed to block the first paint. */}
        <script>{prepaintScript}</script>
        <link rel="preconnect" href="https://telegram.org" />
        {/* The complete official API remains intact for runtime, but is no
            longer parser-blocking. This defer script precedes the generated
            application entry and therefore runs before initTelegram(). */}
        <script defer src="https://telegram.org/js/telegram-web-app.js" />
        <HydrationScript />
      </head>
      <body>
        {/* Static markup, present in the prerendered HTML before any JS
            runs — covers the gap between first paint and the app bundle
            hydrating. A fixed full-screen overlay (not laid out in flow)
            so it just disappears in one frame instead of the real content
            appending below/behind it for a beat first. App.tsx's mount
            effect removes it once real content has rendered. Not a Solid
            component: it must exist before the client JS that would
            render one has even loaded. */}
        <div id="app-skeleton" class="skeleton-overlay" aria-hidden="true">
          <div class="screen">
            <div class="skeleton-header">
              <div class="skeleton-line" style="width: 55%; height: 1.05rem" />
              <div class="skeleton-line" style="width: 35%; height: 0.85rem" />
            </div>
            <div class="topic-list">
              <div class="skeleton-card">
                <div class="skeleton-line" style="width: 70%; height: 1rem" />
                <div class="skeleton-line" style="width: 45%; height: 0.8rem" />
                <div
                  class="skeleton-line"
                  style="width: 90%; height: 0.85rem"
                />
                <div
                  class="skeleton-line"
                  style="width: 60%; height: 0.85rem"
                />
              </div>
              <div class="skeleton-card">
                <div class="skeleton-line" style="width: 40%; height: 1rem" />
                <div class="skeleton-line" style="width: 30%; height: 0.8rem" />
              </div>
              <div class="skeleton-card">
                <div class="skeleton-line" style="width: 25%; height: 1rem" />
                <div class="skeleton-line" style="width: 55%; height: 0.8rem" />
              </div>
            </div>
          </div>
        </div>
        {props.children}
      </body>
    </html>
  );
}
