// Inlined verbatim into <head> by Document.tsx (via `?raw`) as a classic
// blocking script — it must run synchronously, before the browser paints
// anything, or the skeleton (and then the real UI) briefly flashes the
// CSS fallback theme before snapping to Telegram's actual colors. That's
// the one job of this file; ongoing updates (themeChanged, viewport,
// safe-area events) are handled later, once the app hydrates, by
// initTelegram() in ./webapp.ts — keep THEME_PARAM_TO_CSS_VAR there in
// sync with the map below if either changes.
(function () {
  var webApp = window.Telegram && window.Telegram.WebApp;
  if (!webApp) return;

  var root = document.documentElement;
  var coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  var canHover = window.matchMedia("(hover: hover)").matches;
  var reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  root.dataset.host = "telegram";
  root.dataset.input = coarsePointer ? "touch" : "pointer";
  root.dataset.hover = canHover ? "available" : "none";
  root.dataset.motion = reducedMotion ? "reduced" : "full";

  var performanceMatch = navigator.userAgent.match(
    /Telegram-Android\/[^\s]+[^)]*;\s*(LOW|AVERAGE|HIGH)\s*\)/i,
  );
  if (performanceMatch) {
    root.dataset.devicePerformance = performanceMatch[1].toLowerCase();
  }

  var themeVars = {
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
  for (var param in themeVars) {
    var value = webApp.themeParams && webApp.themeParams[param];
    if (value) root.style.setProperty(themeVars[param], value);
  }

  root.dataset.tgPlatform = webApp.platform;
  root.dataset.tgColorScheme = webApp.colorScheme;
  root.style.colorScheme = webApp.colorScheme;

  // Safe area / viewport height too: skipping them here would just trade
  // the color flash for a layout jump (padding/height snapping in) once
  // webapp.ts's initTelegram() applies them a beat later.
  var insets = [
    ["--tg-safe-area", webApp.safeAreaInset],
    ["--tg-content-safe-area", webApp.contentSafeAreaInset],
  ];
  for (var i = 0; i < insets.length; i++) {
    var prefix = insets[i][0];
    var inset = insets[i][1];
    if (!inset) continue;
    root.style.setProperty(prefix + "-top", inset.top + "px");
    root.style.setProperty(prefix + "-bottom", inset.bottom + "px");
    root.style.setProperty(prefix + "-left", inset.left + "px");
    root.style.setProperty(prefix + "-right", inset.right + "px");
  }
  if (webApp.viewportStableHeight) {
    root.style.setProperty(
      "--tg-viewport-height",
      webApp.viewportHeight + "px",
    );
    root.style.setProperty(
      "--tg-viewport-stable-height",
      webApp.viewportStableHeight + "px",
    );
  }

  // Fires as early as physically possible: dismisses Telegram's own native
  // loading spinner and locks in the expanded viewport before our skeleton
  // even paints, instead of waiting for the full JS bundle to hydrate.
  webApp.ready();
  webApp.expand();
})();
