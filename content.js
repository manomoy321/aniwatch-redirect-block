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

  // Toast Notification HUD
  let toastHost = null;

  function getToastHost() {
    if (!toastHost || !toastHost.isConnected) {
      toastHost = document.getElementById('focusguard-toast-host');
      if (!toastHost) {
        toastHost = document.createElement('div');
        toastHost.id = 'focusguard-toast-host';
        const root = document.body || document.documentElement;
        if (root) root.appendChild(toastHost);
      }
    }
    return toastHost;
  }

  let lastToastTime = 0;

  function showBlockedToast(title, message) {
    const now = Date.now();
    if (now - lastToastTime < 600) return; // Prevent toast flooding
    lastToastTime = now;

    const host = getToastHost();
    if (!host) return;

    const toast = document.createElement('div');
    toast.className = 'fg-toast';
    toast.innerHTML = `
      <div class="fg-toast-icon">🛡️</div>
      <div class="fg-toast-content">
        <span class="fg-toast-title">${title}</span>
        <span class="fg-toast-message">${message}</span>
      </div>
      <button class="fg-toast-close" title="Dismiss">&times;</button>
    `;

    const closeBtn = toast.querySelector('.fg-toast-close');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissToast(toast);
    });

    host.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('fg-toast-visible');
    });

    const timer = setTimeout(() => {
      dismissToast(toast);
    }, 3000);

    function dismissToast(el) {
      clearTimeout(timer);
      el.classList.remove('fg-toast-visible');
      el.classList.add('fg-toast-hiding');
      setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 300);
    }
  }

  // Listen for messages from background script (e.g. when popup tab was closed by background)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.action === 'show_toast') {
      showBlockedToast(msg.title || 'FocusGuard Protected', msg.message || 'Blocked redirect.');
    }
  });

  // Handle interception events from inject.js
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

    showBlockedToast('FocusGuard Protected', reason);
  });

  // Check if an element acts as a transparent click-stealing overlay
  function isClickjackOverlay(el) {
    if (!el || el === document.body || el === document.documentElement) return false;

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

  // Intercept user mouse actions at the capture phase
  document.addEventListener('mousedown', function (e) {
    // Detect intentional user actions to open tabs (middle click or Ctrl/Cmd + click)
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
      chrome.runtime.sendMessage({ action: 'allow_user_tab' });
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

          showBlockedToast('FocusGuard Protected', 'Killed invisible overlay. Your click is now safe.');
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

    // 2. Detect unauthorized external target="_blank" links
    const anchor = e.target.closest('a');
    if (anchor) {
      const href = anchor.getAttribute('href') || anchor.href;
      const target = anchor.getAttribute('target') || anchor.target;

      // If user did NOT intentionally middle-click or Ctrl-click
      const isDeliberate = (e.button === 1 || e.ctrlKey || e.metaKey);

      if (!isDeliberate && target === '_blank' && href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        try {
          const targetUrl = new URL(href, window.location.href);
          // If destination domain is external (different from current site)
          if (targetUrl.hostname && targetUrl.hostname !== currentHost) {
            console.warn('[FocusGuard] Blocked external redirect click on link:', href);

            if (settings.mode === 'block_and_close') {
              // Completely stop link navigation
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();

              showBlockedToast('FocusGuard Protected', 'Blocked external redirect link.');
              chrome.runtime.sendMessage({
                action: 'record_blocked',
                domain: currentHost,
                reason: 'Blocked external redirect link click.'
              });
              return;
            } else if (settings.mode === 'keep_focus') {
              // In keep_focus mode, background will lock focus to main tab
              chrome.runtime.sendMessage({
                action: 'record_blocked',
                domain: currentHost,
                reason: 'Redirect opened; focus locked to main tab.'
              });
            }
          }
        } catch (err) {}
      }
    }
  }, true); // useCapture = true guarantees FocusGuard executes before page handlers

  // 3. Iframe Fullscreen Permissions Enforcer
  // Guarantees embedded video players inside iframes (MegaCloud, RapidCloud, StreamTape, etc.)
  // have full browser permission delegation to enter fullscreen mode.
  function enableIframeFullscreen(ifr) {
    if (!ifr || ifr.nodeType !== 1) return;
    try {
      ifr.setAttribute('allowfullscreen', 'true');
      ifr.setAttribute('webkitallowfullscreen', 'true');
      ifr.setAttribute('mozallowfullscreen', 'true');

      let allow = ifr.getAttribute('allow') || '';
      const neededPolicies = ['fullscreen', 'autoplay', 'encrypted-media', 'picture-in-picture'];
      let modified = false;

      for (const policy of neededPolicies) {
        if (!allow.includes(policy)) {
          allow = (allow ? allow + '; ' : '') + policy;
          modified = true;
        }
      }

      if (modified) {
        ifr.setAttribute('allow', allow);
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

