// Classic (non-module) script loaded in <head> so the saved theme is applied before first paint.
// lib/theme.js keeps this localStorage mirror up to date from the real setting.
(function () {
  try {
    var t = localStorage.getItem('opcTheme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage unavailable: fall back to the system theme */ }
})();
