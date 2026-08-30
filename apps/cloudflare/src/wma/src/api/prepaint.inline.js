// Runs synchronously before first paint without waiting for the full Telegram
// SDK. Telegram puts Mini App launch parameters in location.hash; the runtime
// SDK parses the same values later and takes over updates and native APIs.
(function () {
  var root = document.documentElement;
  var hash = location.hash.slice(1);
  var queryIndex = hash.indexOf("?");

  if (queryIndex >= 0) {
    hash = hash.slice(queryIndex + 1);
  }

  var params = new URLSearchParams(hash);
  var platform = params.get("tgWebAppPlatform");
  var rawTheme = params.get("tgWebAppThemeParams");
  var theme;

  if (rawTheme) {
    try {
      theme = JSON.parse(rawTheme);
      sessionStorage.setItem("__telegram__themeParams", JSON.stringify(theme));
    } catch {
      // Invalid launch data falls through to the last valid session theme.
    }
  }

  if (!theme) {
    try {
      var persistedTheme = sessionStorage.getItem("__telegram__themeParams");
      if (persistedTheme) theme = JSON.parse(persistedTheme);
    } catch {
      // Storage can be unavailable in restricted WebViews; CSS has fallbacks.
    }
  }

  if (theme) {
    for (var key in theme) {
      if (!Object.prototype.hasOwnProperty.call(theme, key)) continue;

      var value = theme[key];
      if (typeof value !== "string") continue;

      root.style.setProperty("--tg-theme-" + key.replaceAll("_", "-"), value);
    }
  }

  var bg = theme && theme.bg_color;
  var colorScheme = bg && isDark(bg) ? "dark" : "light";

  root.dataset.host = platform ? "telegram" : "browser";
  if (platform) root.dataset.tgPlatform = platform;
  root.dataset.tgColorScheme = colorScheme;
  root.style.colorScheme = colorScheme;

  var coarsePointer = matchMedia("(pointer: coarse)").matches;
  var canHover = matchMedia("(hover: hover)").matches;
  var reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  root.dataset.input = coarsePointer ? "touch" : "pointer";
  root.dataset.hover = canHover ? "available" : "none";
  root.dataset.motion = reducedMotion ? "reduced" : "full";

  var performanceMatch = navigator.userAgent.match(
    /Telegram-Android\/[^\s]+[^)]*;\s*(LOW|AVERAGE|HIGH)\s*\)/i,
  );
  if (performanceMatch) {
    root.dataset.devicePerformance = performanceMatch[1].toLowerCase();
  }

  // HSP brightness test used by Telegram's SDK for colorScheme.
  function isDark(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return false;

    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);

    return Math.sqrt(0.299 * r * r + 0.587 * g * g + 0.114 * b * b) < 120;
  }
})();
