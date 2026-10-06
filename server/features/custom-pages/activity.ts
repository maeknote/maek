/** Only embedded previews receive this prelude. One-shot timers (including
 * saves) keep running; recurring function timers pause without losing DOM or
 * application state. Standalone artifacts keep their original behavior. */
const activityScript = `<script data-maek-preview-runtime>
(() => {
  if (window.parent === window) return;
  let active = false;
  const parentOrigin = new URL(location.href);
  parentOrigin.hostname = '127.0.0.1';
  const interval = window.setInterval.bind(window);
  window.setInterval = (callback, delay, ...args) => typeof callback === 'function'
    ? interval(() => { if (active && !document.hidden) callback.apply(window, args); }, delay)
    : interval(callback, delay, ...args);
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== parentOrigin.origin
      || event.data?.type !== 'maek:preview-activity' || typeof event.data.active !== 'boolean') return;
    if (active === event.data.active) return;
    active = event.data.active;
    window.dispatchEvent(new CustomEvent('maek:preview-activity', { detail: { active } }));
  });
  window.parent.postMessage({ type: 'maek:preview-ready' }, parentOrigin.origin);
})();
</script>`;

export function withPreviewActivity(html: string): string {
  if (/<head(?:\s[^>]*)?>/i.test(html))
    return html.replace(/<head(?:\s[^>]*)?>/i, head => head + activityScript);
  if (/<!doctype[^>]*>/i.test(html))
    return html.replace(/<!doctype[^>]*>/i, doctype => doctype + activityScript);
  return activityScript + html;
}
