/**
 * Shared DOM/HTML helpers. Load before other page scripts:
 *   <script src="/js/dom-utils.js"></script>
 *
 * All catalogue text is user-entered scholarly data and must be escaped
 * before being placed into innerHTML. Prefer textContent where possible;
 * where template strings are unavoidable, wrap every interpolated value in
 * escapeHtml() (text/attribute context) or safeUrl() (href/src context).
 */
(function (global) {
  'use strict';

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Alias for attribute context — same escaping, clearer intent at call sites.
  const escapeAttr = escapeHtml;

  // Only allow http(s) (and site-relative) URLs in href/src; blocks
  // javascript:, data:, vbscript: and other script-bearing schemes.
  function safeUrl(value) {
    const s = String(value === null || value === undefined ? '' : value).trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return escapeHtml(s);
    // Site-relative paths (but not protocol-relative //evil.com).
    if (/^\/(?!\/)/.test(s)) return escapeHtml(s);
    return '';
  }

  const api = { escapeHtml, escapeAttr, safeUrl };

  // Expose both as a namespace and as globals (many inline scripts already
  // call a bare escapeHtml()).
  global.domUtils = api;
  if (typeof global.escapeHtml !== 'function') global.escapeHtml = escapeHtml;
  if (typeof global.safeUrl !== 'function') global.safeUrl = safeUrl;
})(window);
