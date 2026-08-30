(function () {
  var app = window.Telegram && window.Telegram.WebApp;
  if (!app) return;
  app.ready();
  app.expand();
})();
