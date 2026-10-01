/* Decisions of the service worker as pure functions, so they can be unit-tested (see lib/sw-logic.test.ts).
   Loaded by sw.js through importScripts, and by the tests through require. */
(function (root) {
  var DEFAULT = { title: 'HemCenter', body: 'Новое сообщение', tag: 'hemcenter', url: '/chats' };

  /** A relative path inside this site; anything else (other origins, "//host", javascript:) falls back to /chats. */
  function safeUrl(url) {
    if (typeof url !== 'string') return DEFAULT.url;
    if (url.charAt(0) !== '/' || url.charAt(1) === '/' || url.charAt(1) === '\\') return DEFAULT.url;
    return url.length > 300 ? DEFAULT.url : url;
  }

  function str(v, fallback, max) {
    return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : fallback;
  }

  /** Malformed or empty payloads still produce a harmless generic notification. */
  function parsePayload(text) {
    var data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = null;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return Object.assign({}, DEFAULT);
    return {
      title: str(data.title, DEFAULT.title, 80),
      body: str(data.body, DEFAULT.body, 200),
      tag: str(data.tag, DEFAULT.tag, 100),
      url: safeUrl(data.url),
    };
  }

  /**
   * Browsers require a visible notification for every push, except when a window of the site is on screen.
   * In that case the app itself shows the message (toast, counters), so a system notification would only duplicate it.
   */
  function shouldShow(windowClients) {
    return !windowClients.some(function (c) {
      return c.visibilityState === 'visible';
    });
  }

  function notificationOptions(payload) {
    return {
      body: payload.body,
      tag: payload.tag, // one notification per chat; a newer message replaces the older one
      renotify: true,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: payload.url },
    };
  }

  /** Prefer a window that is already open on this site. */
  function pickClient(windowClients) {
    for (var i = 0; i < windowClients.length; i++) if (windowClients[i].visibilityState === 'visible') return windowClients[i];
    return windowClients[0] || null;
  }

  var api = { DEFAULT: DEFAULT, safeUrl: safeUrl, parsePayload: parsePayload, shouldShow: shouldShow, notificationOptions: notificationOptions, pickClient: pickClient };
  root.HC_SW = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
