/* Service-worker registration. Lives in its own file so index.html carries
 * no inline script and the CSP can stay script-src 'self'. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
