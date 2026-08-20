export type {
  TelegramPlatform,
  TelegramSafeAreaInset,
  TelegramThemeParams,
  TelegramWebApp,
} from "./types";
import type {
  TelegramSafeAreaInset,
  TelegramThemeParams,
  TelegramWebApp,
} from "./types";

import { observeClientEnvironment } from "./environment";

// Telegram theme param -> our CSS custom property. Anything not sent by the
// current client (older apps omit newer keys) just keeps its CSS fallback.
const THEME_PARAM_TO_CSS_VAR: Partial<
  Record<keyof TelegramThemeParams, string>
> = {
  bg_color: "--tg-bg",
  secondary_bg_color: "--tg-secondary-bg",
  section_bg_color: "--tg-section-bg",
  text_color: "--tg-text",
  hint_color: "--tg-hint",
  subtitle_text_color: "--tg-subtitle",
  link_color: "--tg-link",
  button_color: "--tg-button",
  button_text_color: "--tg-button-text",
  accent_text_color: "--tg-accent",
  destructive_text_color: "--tg-destructive",
};

function applyThemeParams(
  root: HTMLElement,
  themeParams: TelegramThemeParams,
): void {
  for (const param of Object.keys(THEME_PARAM_TO_CSS_VAR) as Array<
    keyof TelegramThemeParams
  >) {
    const cssVar = THEME_PARAM_TO_CSS_VAR[param];
    const value = themeParams[param];
    if (value && cssVar) root.style.setProperty(cssVar, value);
  }
}

function applySafeArea(root: HTMLElement, webApp: TelegramWebApp): void {
  // safeAreaInset: the raw device notch/home-indicator/rounded-corner area
  // (matters most on iOS; Android/Desktop are usually all zeros).
  // contentSafeAreaInset: additionally excludes Telegram's own chrome
  // (its header bar, the expand handle) — what content padding should
  // actually use, per Telegram's Mini Apps docs.
  const sets: Array<[string, TelegramSafeAreaInset]> = [
    ["--tg-safe-area", webApp.safeAreaInset],
    ["--tg-content-safe-area", webApp.contentSafeAreaInset],
  ];
  for (const [prefix, inset] of sets) {
    root.style.setProperty(`${prefix}-top`, `${inset.top}px`);
    root.style.setProperty(`${prefix}-bottom`, `${inset.bottom}px`);
    root.style.setProperty(`${prefix}-left`, `${inset.left}px`);
    root.style.setProperty(`${prefix}-right`, `${inset.right}px`);
  }
}

function applyViewport(root: HTMLElement, webApp: TelegramWebApp): void {
  // Telegram's WebView doesn't always agree with the browser's own 100vh
  // (older Android in particular); these give the real usable height.
  // viewportStableHeight ignores the on-screen keyboard, so layout doesn't
  // jump for the (currently keyboard-less) screens in this app.
  root.style.setProperty("--tg-viewport-height", `${webApp.viewportHeight}px`);
  root.style.setProperty(
    "--tg-viewport-stable-height",
    `${webApp.viewportStableHeight}px`,
  );
}

/**
 * Wires the app's CSS variables to the host Telegram client's *live* theme,
 * safe area, and viewport height changes (the user flips their Telegram
 * theme, rotates, the keyboard opens), and normalizes a few behaviors that
 * otherwise differ across iOS/Android/Desktop/macOS.
 *
 * The *initial* sync — needed before first paint to avoid a flash of the
 * wrong theme, so it can't wait for this module to load and run — already
 * happened synchronously in <head>; see theme-sync.inline.js. This call
 * re-applies the same values (cheap, and correct either way if the two
 * ever raced) and adds the ongoing event listeners that file can't own
 * (it's plain inlined JS, gone once this module takes over). ready() and
 * expand() are likewise already called there — calling them again here
 * would be redundant, not incorrect, so this intentionally doesn't repeat
 * them.
 *
 * A no-op outside Telegram (window.Telegram.WebApp is only injected by its
 * in-app browser) — the CSS fallbacks in App.css (prefers-color-scheme,
 * env(safe-area-*), 100dvh) cover that case instead.
 */
export function initTelegram(): () => void {
  const webApp = window.Telegram?.WebApp;
  const root = document.documentElement;
  const stopEnvironment = observeClientEnvironment(root, webApp);

  if (!webApp) return stopEnvironment;

  const syncTheme = () => {
    root.dataset.tgColorScheme = webApp.colorScheme;
    root.style.colorScheme = webApp.colorScheme;
    applyThemeParams(root, webApp.themeParams);
    // Keeps Telegram's own header/background chrome the same color as ours
    // so there's no visible seam between native UI and app content — every
    // platform that implements these applies it identically.
    const bg = webApp.themeParams.bg_color;
    const sectionBg = webApp.themeParams.section_bg_color ?? bg;
    if (sectionBg) webApp.setHeaderColor?.(sectionBg);
    if (bg) webApp.setBackgroundColor?.(bg);
  };
  const syncSafeArea = () => applySafeArea(root, webApp);
  const syncViewport = () => applyViewport(root, webApp);

  syncTheme();
  syncSafeArea();
  syncViewport();

  webApp.onEvent("themeChanged", syncTheme);
  webApp.onEvent("safeAreaChanged", syncSafeArea);
  webApp.onEvent("contentSafeAreaChanged", syncSafeArea);
  webApp.onEvent("viewportChanged", syncViewport);

  // A long scrollable list (this app's main content) fighting Telegram's
  // own swipe-to-close gesture is an iOS/Android-specific papercut this
  // avoids; desktop/web clients simply don't have the gesture.
  if (webApp.isVersionAtLeast("7.7")) {
    webApp.disableVerticalSwipes?.();
  }

  return () => {
    stopEnvironment();
    webApp.offEvent("themeChanged", syncTheme);
    webApp.offEvent("safeAreaChanged", syncSafeArea);
    webApp.offEvent("contentSafeAreaChanged", syncSafeArea);
    webApp.offEvent("viewportChanged", syncViewport);
  };
}
