/**
 * FocusGuard - Content Script (content.js)
 * Handles click interception, transparent overlay destruction, HUD toasts, and sync.
 */
(function () {
  'use strict';

  let settings = {
    enabled: true,
    mode: 'block_and_close', // 'block_and_close' | 'keep_focus'
    blockOverlays: true,
    whitelist: []
  };

  const currentHost = window.location.hostname;

  // Apply settings to document element so inject.js can read them
  function syncSettingsToDOM() {
    const isWhitelisted = settings.whitelist.includes(currentHost);
    const isDisabled = !settings.enabled || isWhitelisted;

    if (document.documentElement) {
      document.documentElement.setAttribute('data-focusguard-disabled', isDisabled ? 'true' : 'false');
      document.documentElement.setAttribute('data-focusguard-mode', settings.mode);
    }
  }

  // Fetch settings from local storage
  function updateSettings() {
    chrome.storage.local.get(['enabled', 'mode', 'blockOverlays', 'whitelist'], function (res) {
      if (res.enabled !== undefined) settings.enabled = res.enabled;
      if (res.mode !== undefined) settings.mode = res.mode;
      if (res.blockOverlays !== undefined) settings.blockOverlays = res.blockOverlays;
      if (Array.isArray(res.whitelist)) settings.whitelist = res.whitelist;

      syncSettingsToDOM();
    });
  }

  updateSettings();

  // Watch for dynamic settings changes from popup
  chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (namespace === 'local') {
      updateSettings();
    }
  });

  // Ensure DOM gets settings once ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncSettingsToDOM);
  } else {
    syncSettingsToDOM();
  }

  // Robust fallback to inject inject.js into main world if needed
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

  // Silent background interception handler for inject.js events
  window.addEventListener('__focusguard_intercept__', function (e) {
    const detail = e.detail || {};
    const type = detail.type || 'redirect';
    const targetUrl = detail.url || '';
    const reason = detail.reason || 'Blocked redirect attempt.';

    chrome.runtime.sendMessage({
      action: 'record_blocked',
      domain: currentHost,
      type: type,
      url: targetUrl,
      reason: reason
    });
  });

  // Check if an element acts as a transparent click-stealing overlay
  function isClickjackOverlay(el) {
    if (!el || el === document.body || el === document.documentElement) return false;

    // Never treat legitimate player controls, buttons, sliders, or video elements as overlays!
    const tag = el.tagName ? el.tagName.toUpperCase() : '';
    if (tag === 'VIDEO' || tag === 'AUDIO' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'SVG' || tag === 'PATH' || tag === 'LABEL') return false;

    if (el.closest && el.closest('.jw-controls, .jw-controlbar, .jw-slider, .jw-knob, .vjs-control-bar, .vjs-control, .player-controls, [class*="control-bar"], [class*="controls"], [class*="player-ui"], [class*="progress"], [class*="slider"], .controls, .control-bar, #controls, [role="button"], [role="slider"]')) {
      return false;
    }

    try {
      const style = window.getComputedStyle(el);
      const pos = style.position;
      const zIndex = parseInt(style.zIndex, 10);
      const opacity = parseFloat(style.opacity);
      const isTransparent = style.backgroundColor === 'transparent' || 
                           (style.backgroundColor.startsWith('rgba(') && style.backgroundColor.endsWith(', 0)'));

      const rect = el.getBoundingClientRect();
      const coversViewport = (rect.width >= window.innerWidth * 0.6 && rect.height >= window.innerHeight * 0.6);

      if ((pos === 'fixed' || pos === 'absolute') && coversViewport) {
        if (opacity === 0 || isTransparent || isNaN(zIndex) || zIndex >= 800) {
          return true;
        }
      }
    } catch (e) {}

    return false;
  }

  // Helper to check for rogue ad redirect URLs on clicked links
  function isAdUrl(href) {
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return false;
    try {
      const parsed = new URL(href, window.location.href);
      const host = parsed.hostname.toLowerCase();
      const hrefLower = parsed.href.toLowerCase();

      // Same host is never an ad redirect link
      if (host === currentHost || host.endsWith('.' + currentHost.replace(/^www\./, ''))) {
        return false;
      }

      const adKeywords = [
        'adsterra', 'popads', 'syndication', 'propeller', 'clickadu', 'adcash', 'exoclick',
        'trafficjunky', 'bet365', '1xbet', 'melbet', 'parimatch', 'stake.com', 'vidoomy',
        'monetag', 'hilltopads', 'richads', 'popcash', 'doubleclick', 'googleadservices',
        'directrev', 'forthesakeof', 'deloton', 'highcpmgate', 'trafficgate', 'topcreativeformat',
        'effectivecpmcontent', 'profitablecpmrate', 'alwingulla', 'wpadmngr', 'onclick'
      ];
      for (const kw of adKeywords) {
        if (host.includes(kw)) return true;
      }
      if (/(?:[?&])(?:zoneid|traffic_source|click_id|aff_id|offer_id|pub_id|ad_id|landing_id)=/i.test(parsed.search)) return true;
      if (/(?:^|\.)(?:ads?|pop|popunder|track|tracker|affiliate|casino|betting)\./i.test(host)) return true;
      if (/\/redirect\.(?:php|html|js)|(?:\/go|\/click|\/out|\/hop)\.php\?/i.test(hrefLower)) return true;
    } catch (e) {}
    return false;
  }

  // Record user gestures ONLY for deliberate link interactions that could open a new tab
  // (middle-click, Ctrl/Cmd+click, target="_blank", or right-click context menu on a legitimate link)
  function notifyUserGesture(e, el) {
    try {
      const anchor = el ? (el.closest ? el.closest('a') : null) : (e && e.target && e.target.closest ? e.target.closest('a') : null);
      if (!anchor) return; // Non-anchor clicks (video, player controls, overlays) NEVER authorize a new tab!

      const rawHref = anchor.getAttribute('href') || anchor.href || '';
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return;

      // Ad links must never be registered as legitimate user intent
      if (isAdUrl(rawHref)) return;

      let targetUrl = '';
      let targetHost = '';
      try {
        const parsed = new URL(rawHref, window.location.href);
        targetUrl = parsed.href;
        targetHost = parsed.hostname;
      } catch (err) {
        return;
      }

      // Check if interaction is genuinely intended to open a new tab:
      // 1. Middle click (e.button === 1)
      // 2. Ctrl / Cmd + click
      // 3. Right-click context menu
      // 4. Explicit target="_blank"
      const isMiddleClick = (e && e.button === 1);
      const isCtrlClick = (e && (e.ctrlKey || e.metaKey));
      const isContextMenu = (e && e.type === 'contextmenu');
      const isBlankTarget = (anchor.getAttribute('target') === '_blank' || anchor.target === '_blank');

      if (isMiddleClick || isCtrlClick || isContextMenu || isBlankTarget) {
        chrome.runtime.sendMessage({
          action: 'allow_user_tab',
          targetUrl: targetUrl,
          targetHost: targetHost,
          timestamp: Date.now()
        });
      }
    } catch (err) {}
  }

  // Intercept user mouse actions at the capture phase for deliberate tab openings
  document.addEventListener('mousedown', function (e) {
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
      notifyUserGesture(e, e.target);
    }
  }, true);

  document.addEventListener('contextmenu', function (e) {
    notifyUserGesture(e, e.target);
  }, true);

  document.addEventListener('auxclick', function (e) {
    if (e.button === 1) {
      notifyUserGesture(e, e.target);
    }
  }, true);

  // Capture phase click handler
  document.addEventListener('click', function (e) {
    if (!settings.enabled || settings.whitelist.includes(currentHost)) return;

    // 1. Detect and destroy transparent clickjack overlay layers
    if (settings.blockOverlays) {
      let target = e.target;
      let depth = 0;

      while (target && depth < 4) {
        if (isClickjackOverlay(target)) {
          console.warn('[FocusGuard] Destroyed clickjack overlay layer:', target);
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          target.style.pointerEvents = 'none';
          target.style.display = 'none';
          try { target.remove(); } catch (err) {}

          // Silently record blocked event in background
          chrome.runtime.sendMessage({
            action: 'record_blocked',
            domain: currentHost,
            reason: 'Destroyed transparent clickjacking overlay.'
          });
          return;
        }
        target = target.parentElement;
        depth++;
      }
    }

    // 2. Detect unauthorized rogue ad redirect links
    const anchor = e.target.closest('a');
    if (anchor) {
      const href = anchor.getAttribute('href') || anchor.href;

      // Check if clicked link targets a known rogue ad/redirect signature
      if (isAdUrl(href)) {
        console.warn('[FocusGuard] Blocked ad redirect click on link:', href);

        if (settings.mode === 'block_and_close') {
          // Completely stop link navigation to ad silently
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          chrome.runtime.sendMessage({
            action: 'record_blocked',
            domain: currentHost,
            reason: 'Blocked external ad redirect link click.'
          });
          return;
        } else if (settings.mode === 'keep_focus') {
          chrome.runtime.sendMessage({
            action: 'record_blocked',
            domain: currentHost,
            reason: 'Redirect opened; focus locked to main tab.'
          });
        }
      } else {
        // Legitimate link clicked by user: allow navigation and inform background
        notifyUserGesture(e, anchor);
      }
    }
  }, true); // useCapture = true guarantees FocusGuard executes before page handlers

  // 3. Complete Iframe Permissions Enforcer
  // Grants fullscreen, autoplay, and media permissions via both modern W3C Permissions Policy ('allow')
  // and legacy attributes ('allowfullscreen') so player libraries (JWPlayer, MegaCloud) recognize fullscreen capability.
  function enableIframeFullscreen(ifr) {
    if (!ifr || ifr.nodeType !== 1) return;
    try {
      if (!ifr.hasAttribute('allowfullscreen')) ifr.setAttribute('allowfullscreen', 'true');
      if (!ifr.hasAttribute('webkitallowfullscreen')) ifr.setAttribute('webkitallowfullscreen', 'true');
      if (!ifr.hasAttribute('mozallowfullscreen')) ifr.setAttribute('mozallowfullscreen', 'true');

      let currentAllow = ifr.getAttribute('allow') || '';
      const neededPolicies = ['fullscreen', 'autoplay', 'encrypted-media', 'picture-in-picture'];
      let modified = false;

      for (const policy of neededPolicies) {
        if (!currentAllow.includes(policy)) {
          currentAllow = (currentAllow ? currentAllow + '; ' : '') + `${policy} *`;
          modified = true;
        }
      }

      if (modified) {
        ifr.setAttribute('allow', currentAllow);
      }
    } catch (e) {}
  }

  function enforceAllIframes() {
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(enableIframeFullscreen);
  }

  // Scan immediately and on DOM readiness
  enforceAllIframes();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enforceAllIframes);
  }

  // Continuously watch for dynamically injected iframes
  const iframeObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) {
          if (node.tagName === 'IFRAME') {
            enableIframeFullscreen(node);
          } else if (node.querySelectorAll) {
            node.querySelectorAll('iframe').forEach(enableIframeFullscreen);
          }
        }
      }
    }
  });

  if (document.documentElement) {
    iframeObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

})();

