(function () {
  var app = window.Telegram && window.Telegram.WebApp;
  
  if (app) {
    app.ready();
    app.expand();
  }
})();
