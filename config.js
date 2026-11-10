/* Адрес сервера (API) — выбирается сам:
 *   - сайт открыт с localhost / 127.0.0.1           -> http://localhost:8000 (локальный бэкенд);
 *   - любой другой адрес (GitHub Pages, свой домен) -> https://itdeti.onrender.com.
 * Переопределение для проверки (только в своём браузере), в консоли:
 *   localStorage.setItem('itdeti_learn_api_override', 'http://127.0.0.1:8000')   // убрать: removeItem(...)
 * Адрес должен быть в списке connect-src в Content-Security-Policy (index.html), иначе браузер его заблокирует.
 * При переезде на свой домен здесь ничего менять не нужно. */
(function () {
  'use strict';
  var LOCAL_API = 'http://localhost:8000';
  var PROD_API = 'https://itdeti.onrender.com';
  var host = (window.location && window.location.hostname) || '';
  var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  var override = null;
  try {
    override = window.localStorage.getItem('itdeti_learn_api_override');
  } catch (_) { override = null; }
  if (override && !/^https?:\/\/[^\s/]+$/.test(override.replace(/\/+$/, ''))) override = null;
  window.ITDETI_LEARN_CONFIG = {
    API_URL: (override || (isLocal ? LOCAL_API : PROD_API)).replace(/\/+$/, '')
  };
})();
