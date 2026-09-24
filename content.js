/**
 * FocusGuard - Content Script (content.js)
 * Injects the MAIN world stream sniffer hook so video streams can be captured for download.
 */
(function () {
  'use strict';

  function injectMainHook() {
    try {
      const target = document.head || document.documentElement || document.body;
      if (!target) {
        requestAnimationFrame(injectMainHook);
        return;
      }
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('inject.js');
      script.async = false;
      target.appendChild(script);
      script.onload = () => script.remove();
    } catch (e) {}
  }

  injectMainHook();
})();
