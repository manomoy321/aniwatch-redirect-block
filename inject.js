/**
 * FocusGuard - Main World Script (inject.js)
 * Injected into the page's execution context to intercept window.open and synthetic click events.
 */
(function () {
  'use strict';

  if (window.__focusguard_main_hook_active__) return;
  window.__focusguard_main_hook_active__ = true;

  // Safe helper to check extension status without throwing if documentElement is null
  function isProtectionDisabled() {
    if (!document.documentElement) return false;
    return document.documentElement.getAttribute('data-focusguard-disabled') === 'true';
  }

  function getProtectionMode() {
    if (!document.documentElement) return 'block_and_close';
    return document.documentElement.getAttribute('data-focusguard-mode') || 'block_and_close';
  }

  // Notify the content script about blocked actions
  function notifyBlocked(type, detail) {
    try {
      window.dispatchEvent(
        new CustomEvent('__focusguard_intercept__', {
          detail: {
            type: type,
            url: detail && detail.url ? String(detail.url) : '',
            reason: detail && detail.reason ? String(detail.reason) : '',
            timestamp: Date.now()
          }
        })
      );
    } catch (e) {}
  }

  // Harmless mock Window object to prevent site scripts from crashing when inspecting return value
  function createDummyWindow(targetUrl) {
    return {
      blur: function () {},
      close: function () {},
      closed: false,
      focus: function () {},
      frames: [],
      length: 0,
      location: {
        href: targetUrl || 'about:blank',
        assign: function () {},
        replace: function () {},
        reload: function () {}
      },
      opener: window,
      parent: window,
      postMessage: function () {},
      self: window,
      top: window,
      window: window
    };
  }

  // 1. Intercept window.open
  const rawWindowOpen = window.open;

  window.open = function (url, target, features) {
    if (isProtectionDisabled()) {
      return rawWindowOpen.apply(this, arguments);
    }

    const mode = getProtectionMode();
    const cleanUrl = url ? String(url).trim() : '';

    console.warn('[FocusGuard] Intercepted window.open:', cleanUrl || '(blank popup)', { target, features, mode });
    notifyBlocked('window_open', {
      url: cleanUrl,
      reason: 'Blocked rogue window.open() popup.'
    });

    if (mode === 'keep_focus' && cleanUrl && cleanUrl !== 'about:blank') {
      try {
        // Let the window open, background.js will lock focus to current tab
        const win = rawWindowOpen.call(window, cleanUrl, target || '_blank', features);
        return win || createDummyWindow(cleanUrl);
      } catch (err) {
        return createDummyWindow(cleanUrl);
      }
    }

    // Default mode: Block & Close - completely drop the popup and return safe dummy window
    return createDummyWindow(cleanUrl);
  };

  // 2. Intercept programmatic anchor .click()
  const rawAnchorClick = HTMLAnchorElement.prototype.click;

  HTMLAnchorElement.prototype.click = function () {
    if (isProtectionDisabled()) {
      return rawAnchorClick.apply(this, arguments);
    }

    const href = this.getAttribute('href') || this.href || '';
    const target = this.getAttribute('target') || this.target;
    const isDetached = !this.isConnected;
    const isHidden = (this.style && (this.style.display === 'none' || this.style.opacity === '0' || this.style.visibility === 'hidden'));

    if (isDetached || isHidden || target === '_blank') {
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        try {
          const currentHost = window.location.hostname;
          const targetHost = new URL(href, window.location.href).hostname;

          if (isDetached || isHidden || targetHost !== currentHost) {
            console.warn('[FocusGuard] Blocked programmatic anchor click hijack:', href);
            notifyBlocked('anchor_hijack', {
              url: href,
              reason: 'Blocked synthetic anchor click hijack.'
            });
            return;
          }
        } catch (e) {
          return;
        }
      }
    }

    return rawAnchorClick.apply(this, arguments);
  };

  // 3. Intercept dispatchEvent on anchors (ad networks doing a.dispatchEvent(new MouseEvent('click')))
  const rawDispatchEvent = EventTarget.prototype.dispatchEvent;

  EventTarget.prototype.dispatchEvent = function (event) {
    if (this instanceof HTMLAnchorElement && event && event.type === 'click') {
      if (!isProtectionDisabled()) {
        const href = this.getAttribute('href') || this.href || '';
        const target = this.getAttribute('target') || this.target;
        const isDetached = !this.isConnected;

        if (isDetached || target === '_blank') {
          if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
            try {
              const currentHost = window.location.hostname;
              const targetHost = new URL(href, window.location.href).hostname;
              if (isDetached || targetHost !== currentHost) {
                console.warn('[FocusGuard] Blocked synthetic dispatchEvent click on anchor:', href);
                notifyBlocked('anchor_hijack', {
                  url: href,
                  reason: 'Blocked synthetic dispatchEvent click hijack.'
                });
                return false;
              }
            } catch (e) {}
          }
        }
      }
    }

    return rawDispatchEvent.apply(this, arguments);
  };

  // 4. Proactively grant modern W3C permissions to all iframes upon creation
  const rawCreateElement = Document.prototype.createElement;
  Document.prototype.createElement = function (tagName, options) {
    const el = rawCreateElement.call(this, tagName, options);
    if (el && tagName && typeof tagName === 'string' && tagName.toLowerCase() === 'iframe') {
      try {
        el.setAttribute('allow', 'fullscreen *; autoplay *; encrypted-media *; picture-in-picture *');
      } catch (e) {}
    }
    return el;
  };

  console.log('[FocusGuard] Main World hooks armed.');
})();

