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

    // Allow legitimate file download anchors!
    if (this.hasAttribute('download') || this.download || this.hasAttribute('data-focusguard-download')) {
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
        // Allow legitimate file download anchors!
        if (this.hasAttribute('download') || this.download || this.hasAttribute('data-focusguard-download')) {
          return rawDispatchEvent.apply(this, arguments);
        }

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

  // 4. Proactively grant full permissions (fullscreen, autoplay, pip) to all iframes upon creation
  const rawCreateElement = Document.prototype.createElement;
  Document.prototype.createElement = function (tagName, options) {
    const el = rawCreateElement.call(this, tagName, options);
    if (el && tagName && typeof tagName === 'string' && tagName.toLowerCase() === 'iframe') {
      try {
        el.setAttribute('allowfullscreen', 'true');
        el.setAttribute('webkitallowfullscreen', 'true');
        el.setAttribute('mozallowfullscreen', 'true');
        el.setAttribute('allow', 'fullscreen *; autoplay *; encrypted-media *; picture-in-picture *');
        el.setAttribute('scrolling', 'no');
        el.style.setProperty('overflow', 'hidden', 'important');
        el.style.setProperty('scrollbar-width', 'none', 'important');
      } catch (e) {}
    }
    return el;
  };

  // 5. Intercept iframe contentWindow.open hijacking used by aggressive ad scripts
  try {
    const rawContentWindowGetter = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    if (rawContentWindowGetter && rawContentWindowGetter.get) {
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        configurable: true,
        get: function () {
          const win = rawContentWindowGetter.get.call(this);
          if (win && !win.__focusguard_hooked__) {
            try {
              win.__focusguard_hooked__ = true;
              win.open = window.open;
            } catch (e) {}
          }
          return win;
        }
      });
    }
  } catch (e) {}

  // 6. Smooth Playback & Video Stream Sniffer (HLS.js, Fetch, and Media elements)
  function hookHls(HlsConstructor) {
    if (!HlsConstructor || HlsConstructor.__focusguard_hooked__) return HlsConstructor;
    try {
      if (HlsConstructor.DefaultConfig) {
        HlsConstructor.DefaultConfig.maxBufferLength = 180;      // 3 minutes ahead
        HlsConstructor.DefaultConfig.maxMaxBufferLength = 600;   // up to 10 minutes
        HlsConstructor.DefaultConfig.maxBufferSize = 120 * 1024 * 1024; // 120MB buffer limit
        HlsConstructor.DefaultConfig.maxBufferHole = 0.5;
        HlsConstructor.DefaultConfig.backBufferLength = 90;      // Retain 90s behind
      }
      if (HlsConstructor.prototype && HlsConstructor.prototype.loadSource) {
        const origLoadSource = HlsConstructor.prototype.loadSource;
        HlsConstructor.prototype.loadSource = function (url) {
          try {
            window.__focusguard_active_stream__ = url;
            window.dispatchEvent(new CustomEvent('__focusguard_stream_detected__', {
              detail: { url: String(url), type: 'hls' }
            }));
          } catch (e) {}
          return origLoadSource.apply(this, arguments);
        };
      }
      HlsConstructor.__focusguard_hooked__ = true;
    } catch (e) {}
    return HlsConstructor;
  }

  let currentHls = window.Hls;
  if (currentHls) hookHls(currentHls);
  try {
    Object.defineProperty(window, 'Hls', {
      configurable: true,
      enumerable: true,
      get: function () { return currentHls; },
      set: function (val) {
        currentHls = hookHls(val);
      }
    });
  } catch (e) {}

  // 7. Video Stream Sniffer & Playlist Text Interceptor (.m3u8, .mp4)
  function notifyStreamDetected(url, type = 'stream', playlistText = null) {
    if (!url || typeof url !== 'string' || url.startsWith('blob:')) return;
    try {
      if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('/hls/')) {
        window.__focusguard_active_stream__ = url;
        window.__focusguard_embed_url__ = window.location.href;
        window.dispatchEvent(new CustomEvent('__focusguard_stream_detected__', {
          detail: {
            url: url,
            type: type,
            embedUrl: window.location.href,
            playlistText: playlistText
          }
        }));
      }
    } catch (e) {}
  }

  // Intercept fetch requests for video streams and capture playlist response text
  const rawFetch = window.fetch;
  if (rawFetch) {
    window.fetch = function (resource, init) {
      const p = rawFetch.apply(this, arguments);
      try {
        const url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
        if (url && (url.includes('.m3u8') || url.includes('/hls/') || url.includes('playlist') || url.includes('master'))) {
          p.then((response) => {
            try {
              if (response && response.ok) {
                const clone = response.clone();
                clone.text().then((text) => {
                  if (text && text.includes('#EXTM3U')) {
                    window.__focusguard_cached_playlist__ = text;
                    notifyStreamDetected(url, 'fetch', text);
                  } else if (text && text.includes('.m3u8')) {
                    const m = text.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/);
                    if (m) {
                      const cleanUrl = m[0].replace(/\\/g, '');
                      notifyStreamDetected(cleanUrl, 'fetch_json');
                    }
                  } else {
                    notifyStreamDetected(url, 'fetch');
                  }
                }).catch(() => notifyStreamDetected(url, 'fetch'));
              }
            } catch (e) {}
          }).catch(() => {});
        } else if (url && (url.includes('.mp4') || url.includes('.webm'))) {
          notifyStreamDetected(url, 'fetch');
        }
      } catch (e) {}
      return p;
    };
  }

  // Intercept XMLHttpRequest for video streams and capture playlist response text
  const rawXhrOpen = XMLHttpRequest.prototype.open;
  const rawXhrSend = XMLHttpRequest.prototype.send;
  if (rawXhrOpen && rawXhrSend) {
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__fg_target_url = typeof url === 'string' ? url : String(url);
      return rawXhrOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      const targetUrl = this.__fg_target_url;
      if (targetUrl && (targetUrl.includes('.m3u8') || targetUrl.includes('.mp4') || targetUrl.includes('/hls/') || targetUrl.includes('playlist') || targetUrl.includes('master'))) {
        this.addEventListener('load', () => {
          try {
            if ((this.responseType === '' || this.responseType === 'text') && this.responseText) {
              if (this.responseText.includes('#EXTM3U')) {
                window.__focusguard_cached_playlist__ = this.responseText;
                notifyStreamDetected(targetUrl, 'xhr', this.responseText);
              } else if (this.responseText.includes('.m3u8')) {
                const m = this.responseText.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/);
                if (m) {
                  const cleanUrl = m[0].replace(/\\/g, '');
                  notifyStreamDetected(cleanUrl, 'xhr_json');
                }
              }
            } else {
              notifyStreamDetected(targetUrl, 'xhr');
            }
          } catch (e) {}
        });
      }
      return rawXhrSend.apply(this, arguments);
    };
  }

  // 8. JWPlayer Sniffer for embedded players (megaplay.buzz, vidsrc, etc.)
  function hookJwplayer(jwConstructor) {
    if (!jwConstructor || jwConstructor.__focusguard_hooked__) return jwConstructor;
    try {
      const origJw = jwConstructor;
      const wrappedJw = function () {
        const inst = origJw.apply(this, arguments);
        if (inst && typeof inst.on === 'function' && !inst.__fg_sniffed__) {
          inst.__fg_sniffed__ = true;
          inst.on('playlistItem', (item) => {
            if (item && item.item && item.item.file && typeof item.item.file === 'string') {
              notifyStreamDetected(item.item.file, 'jwplayer');
            }
          });
          inst.on('ready', () => {
            const cur = (typeof inst.getPlaylistItem === 'function') ? inst.getPlaylistItem() : null;
            if (cur && cur.file && typeof cur.file === 'string') {
              notifyStreamDetected(cur.file, 'jwplayer');
            }
          });
        }
        return inst;
      };
      wrappedJw.prototype = origJw.prototype;
      wrappedJw.__focusguard_hooked__ = true;
      return wrappedJw;
    } catch (e) {
      return jwConstructor;
    }
  }

  let currentJw = window.jwplayer;
  if (currentJw) window.jwplayer = hookJwplayer(currentJw);
  try {
    Object.defineProperty(window, 'jwplayer', {
      configurable: true,
      enumerable: true,
      get: function () { return currentJw; },
      set: function (val) {
        currentJw = hookJwplayer(val);
      }
    });
  } catch (e) {}

  console.log('[FocusGuard] Main World hooks armed.');
})();

