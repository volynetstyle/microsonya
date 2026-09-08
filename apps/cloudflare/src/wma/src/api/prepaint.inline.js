// Runs synchronously before first paint without waiting for the full Telegram
// SDK. Telegram puts Mini App launch parameters in location.hash; the runtime
// SDK parses the same values later and takes over updates and native APIs.
(function () {
  var root = document.documentElement;
  var data = root.dataset;
  var style = root.style;
  var storageKey = "__telegram__themeParams";

  var hash = location.hash;
  var queryIndex = hash.indexOf("?");
  hash = hash.slice(queryIndex < 0 ? 1 : queryIndex + 1);

  var params = new URLSearchParams(hash);
  var platform = params.get("tgWebAppPlatform");
  var rawTheme = params.get("tgWebAppThemeParams");
  var theme;

  if (rawTheme) {
    try {
      theme = JSON.parse(rawTheme);
      sessionStorage.setItem(storageKey, rawTheme);
    } catch {}
  }

  if (!theme) {
    try {
      rawTheme = sessionStorage.getItem(storageKey);
      if (rawTheme) theme = JSON.parse(rawTheme);
    } catch {}
  }

  if (theme) {
    var hasOwn = Object.prototype.hasOwnProperty;

    for (var key in theme) {
      if (!hasOwn.call(theme, key)) continue;

      var value = theme[key];

      if (typeof value === "string") {
        style.setProperty("--tg-theme-" + key.replaceAll("_", "-"), value);
      }
    }
  }

  var bg = theme && theme.bg_color;
  var colorScheme = bg && isDark(bg) ? "dark" : "light";

  data.host = platform ? "telegram" : "browser";
  if (platform) data.tgPlatform = platform;

  data.tgColorScheme = colorScheme;
  style.colorScheme = colorScheme;

  data.input = matchMedia("(pointer:coarse)").matches ? "touch" : "pointer";

  data.hover = matchMedia("(hover:hover)").matches ? "available" : "none";

  data.motion = matchMedia("(prefers-reduced-motion:reduce)").matches
    ? "reduced"
    : "full";

  var performanceMatch = navigator.userAgent.match(
    /Telegram-Android\/\S+[^)]*;\s*(LOW|AVERAGE|HIGH)\s*\)/i,
  );

  if (performanceMatch) {
    data.devicePerformance = performanceMatch[1].toLowerCase();
  }

  function isDark(hex) {
    if (!/^#[\da-f]{6}$/i.test(hex)) return false;

    var rgb = parseInt(hex.slice(1), 16);
    var r = rgb >> 16;
    var g = (rgb >> 8) & 255;
    var b = rgb & 255;

    return 0.299 * r * r + 0.587 * g * g + 0.114 * b * b < 14400;
  }
})();
