import type { ParentProps } from 'solid-js';
import { HydrationScript } from '@solidjs/web';
import themeSyncScript from './telegram/theme-sync.inline.js?raw';

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
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
        <title>Microsonya</title>
        <link rel="preconnect" href="https://telegram.org" />
        {/* Telegram Mini Apps SDK: exposes window.Telegram.WebApp. Loaded
            blocking (no async/defer) — this and the inline script right
            after it must both run, in order, before anything paints, or
            the skeleton below flashes the CSS fallback theme before
            snapping to Telegram's real colors. */}
        <script src="https://telegram.org/js/telegram-web-app.js" />
        {/* Applies theme/safe-area/viewport synchronously and calls
            ready()/expand() as early as physically possible — see
            src/telegram/theme-sync.inline.js. Ongoing updates (the app is
            already open and the user flips a theme) are handled later by
            initTelegram() in src/telegram/webapp.ts. */}
        <script>{themeSyncScript}</script>
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
                <div class="skeleton-line" style="width: 90%; height: 0.85rem" />
                <div class="skeleton-line" style="width: 60%; height: 0.85rem" />
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
