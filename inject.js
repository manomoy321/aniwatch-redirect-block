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
        HlsConstructor.DefaultConfig.maxBufferLength = 60;      // 60s ahead ensures ultra-smooth playback without buffer pressure
        HlsConstructor.DefaultConfig.maxMaxBufferLength = 120;  // up to 2 minutes
        HlsConstructor.DefaultConfig.maxBufferSize = 60 * 1024 * 1024; // 60MB safe memory allocation
        HlsConstructor.DefaultConfig.backBufferLength = 30;     // Evict past 30s to prevent SourceBuffer QuotaExceededError
      }
      if (HlsConstructor.prototype && HlsConstructor.prototype.loadSource) {
        const origLoadSource = HlsConstructor.prototype.loadSource;
        HlsConstructor.prototype.loadSource = function (url) {
          try {
            if (url && typeof url === 'string') {
              notifyStreamDetected(url, 'hls');
            }
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

  // 7. Universal Video Stream Sniffer & Network Interceptor (.m3u8, .mp4, webm, mov, etc.)
  function isManifestUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const clean = url.toLowerCase();
    // Exclude segment chunks (.m4s, .ts, .aac, .m4a, /segment, /frag-) from ever being considered manifests!
    if (clean.includes('.m4s') || clean.includes('.ts') || clean.includes('.aac') || clean.includes('.m4a') || 
        clean.includes('/segment') || clean.includes('/frag-') || clean.includes('/range/')) {
      return false;
    }
    return clean.includes('.m3u8') || clean.includes('.mpd') || clean.includes('/manifest') || 
           clean.includes('chunklist') || clean.includes('playlist') || clean.includes('master') ||
           clean.includes('/hls/');
  }

  function isStandaloneVideoUrl(url) {
    if (!url || typeof url !== 'string' || url.startsWith('blob:') || url.startsWith('data:')) return false;
    const clean = url.toLowerCase();
    if (clean.includes('.m4s') || clean.includes('.ts') || clean.includes('/segment') || clean.includes('/frag-')) return false;
    return clean.includes('.mp4') || clean.includes('.webm') || clean.includes('.m4v') || 
           clean.includes('.mov') || clean.includes('.mkv') || clean.includes('.flv') || clean.includes('.ogv');
  }

  function isSegmentChunkUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const clean = url.toLowerCase();
    return clean.includes('.m4s') || clean.includes('.ts') || clean.includes('/segment') || clean.includes('/frag-');
  }

  function isVideoUrl(url) {
    if (!url || typeof url !== 'string' || url.startsWith('blob:') || url.startsWith('data:')) return false;
    return isManifestUrl(url) || isStandaloneVideoUrl(url) || isSegmentChunkUrl(url);
  }

  window.__focusguard_detected_streams__ = window.__focusguard_detected_streams__ || [];

  // Hook SourceBuffer.prototype.appendBuffer to capture fMP4 init segment and MSE chunks
  try {
    if (typeof SourceBuffer !== 'undefined' && SourceBuffer.prototype && SourceBuffer.prototype.appendBuffer) {
      const origAppendBuffer = SourceBuffer.prototype.appendBuffer;
      SourceBuffer.prototype.appendBuffer = function (buffer) {
        try {
          if (buffer) {
            let rawBuf = null;
            if (buffer instanceof ArrayBuffer) {
              rawBuf = buffer;
            } else if (buffer.buffer instanceof ArrayBuffer) {
              rawBuf = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
            }
            if (rawBuf && rawBuf.byteLength >= 8) {
              const u8 = new Uint8Array(rawBuf);
              // Inspect ISO BMFF 4-char box type at offset 4
              const box = String.fromCharCode(u8[4], u8[5], u8[6], u8[7]);
              if (box === 'ftyp' || box === 'moov') {
                window.__focusguard_mse_init_segment__ = rawBuf.slice(0);
              }
            }
          }
        } catch (e) {}
        return origAppendBuffer.apply(this, arguments);
      };
    }
  } catch (e) {}

  function notifyStreamDetected(url, type = 'stream', playlistText = null) {
    if (!url || typeof url !== 'string' || url.startsWith('blob:') || url.startsWith('data:')) return;
    try {
      const isManifest = isManifestUrl(url) || (playlistText && playlistText.includes('#EXTM3U'));
      const isStandalone = isStandaloneVideoUrl(url);

      // Only record and dispatch manifests and standalone videos — NEVER segment chunks (.m4s, .ts)
      if (isManifest || isStandalone) {
        window.__focusguard_active_stream__ = url;
        window.__focusguard_embed_url__ = window.location.href;
        if (!window.__focusguard_detected_streams__.includes(url)) {
          window.__focusguard_detected_streams__.push(url);
          if (window.__focusguard_detected_streams__.length > 25) {
            window.__focusguard_detected_streams__.shift();
          }
        }

        // Bridge to ISOLATED world via DOM attributes and shared JSON bridge element
        try {
          if (document.documentElement) {
            document.documentElement.setAttribute('data-focusguard-active-stream', url);
            document.documentElement.setAttribute('data-focusguard-embed-url', window.location.href);
            if (isStandalone) {
              document.documentElement.setAttribute('data-focusguard-mp4-stream', url);
            }
            if (isManifest) {
              document.documentElement.setAttribute('data-focusguard-hls-stream', url);
            }

            let dataEl = document.getElementById('__fg_stream_data__');
            if (!dataEl) {
              dataEl = document.createElement('script');
              dataEl.id = '__fg_stream_data__';
              dataEl.type = 'application/json';
              dataEl.style.display = 'none';
              document.documentElement.appendChild(dataEl);
            }
            let currentPayload = {};
            try { currentPayload = JSON.parse(dataEl.textContent || '{}'); } catch (e) {}
            currentPayload.activeStream = url;
            currentPayload.embedUrl = window.location.href;
            if (isStandalone) {
              currentPayload.mp4Stream = url;
              currentPayload.mp4Streams = currentPayload.mp4Streams || [];
              if (!currentPayload.mp4Streams.includes(url)) currentPayload.mp4Streams.push(url);
            }
            if (isManifest) {
              currentPayload.hlsStream = url;
              currentPayload.hlsStreams = currentPayload.hlsStreams || [];
              if (!currentPayload.hlsStreams.includes(url)) currentPayload.hlsStreams.push(url);
            }
            dataEl.textContent = JSON.stringify(currentPayload);

            if (playlistText) {
              let cacheEl = document.getElementById('__fg_playlist_cache__');
              if (!cacheEl) {
                cacheEl = document.createElement('script');
                cacheEl.id = '__fg_playlist_cache__';
                cacheEl.type = 'text/plain';
                cacheEl.style.display = 'none';
                document.documentElement.appendChild(cacheEl);
              }
              cacheEl.textContent = playlistText;
            }
          }
        } catch (domErr) {}

        window.dispatchEvent(new CustomEvent('__focusguard_stream_detected__', {
          detail: {
            url: url,
            type: type,
            isChunk: false,
            isManifest: isManifest,
            embedUrl: window.location.href,
            playlistText: playlistText
          }
        }));
      }
    } catch (e) {}
  }

  // Hook HTMLMediaElement & HTMLSourceElement src setters to catch media assigned directly to <video> or <source>
  try {
    const rawMediaSrcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (rawMediaSrcDesc && rawMediaSrcDesc.set) {
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        configurable: true,
        enumerable: true,
        get: function () {
          return rawMediaSrcDesc.get.call(this);
        },
        set: function (val) {
          try {
            if (val && typeof val === 'string' && !val.startsWith('blob:') && !val.startsWith('data:')) {
              this.__fg_stream_url__ = val;
              notifyStreamDetected(val, 'media_src');
            }
          } catch (e) {}
          return rawMediaSrcDesc.set.call(this, val);
        }
      });
    }
  } catch (e) {}

  try {
    const rawSourceSrcDesc = Object.getOwnPropertyDescriptor(HTMLSourceElement.prototype, 'src');
    if (rawSourceSrcDesc && rawSourceSrcDesc.set) {
      Object.defineProperty(HTMLSourceElement.prototype, 'src', {
        configurable: true,
        enumerable: true,
        get: function () {
          return rawSourceSrcDesc.get.call(this);
        },
        set: function (val) {
          try {
            if (val && typeof val === 'string' && !val.startsWith('blob:') && !val.startsWith('data:')) {
              this.__fg_stream_url__ = val;
              if (this.parentElement && this.parentElement.tagName === 'VIDEO') {
                this.parentElement.__fg_stream_url__ = val;
              }
              notifyStreamDetected(val, 'source_src');
            }
          } catch (e) {}
          return rawSourceSrcDesc.set.call(this, val);
        }
      });
    }
  } catch (e) {}

  // Intercept fetch requests for video streams and capture playlist response text
  const rawFetch = window.fetch;
  if (rawFetch) {
    window.fetch = function (resource, init) {
      const p = rawFetch.apply(this, arguments);
      try {
        const url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
        if (url) {
          if (isVideoUrl(url)) {
            if (url.includes('.m3u8') || url.includes('/hls/') || url.includes('playlist') || url.includes('master')) {
              p.then((response) => {
                try {
                  if (response && response.ok) {
                    const clone = response.clone();
                    clone.text().then((text) => {
                      if (text && text.includes('#EXTM3U')) {
                        window.__focusguard_cached_playlist__ = text;
                        notifyStreamDetected(url, 'fetch_hls', text);
                      } else if (text) {
                        extractAndNotifyStreamsFromText(text, 'fetch_text');
                        notifyStreamDetected(url, 'fetch');
                      } else {
                        notifyStreamDetected(url, 'fetch');
                      }
                    }).catch(() => notifyStreamDetected(url, 'fetch'));
                  }
                } catch (e) {}
              }).catch(() => {});
            } else {
              notifyStreamDetected(url, 'fetch');
            }
          } else {
            // Also inspect response Content-Type header in case video URL has no direct extension
            p.then((response) => {
              try {
                if (response && response.ok && response.headers) {
                  const ct = (response.headers.get('content-type') || '').toLowerCase();
                  if (ct.includes('video/') || ct.includes('mpegurl') || ct.includes('dash+xml')) {
                    if (ct.includes('mpegurl')) {
                      const clone = response.clone();
                      clone.text().then((text) => {
                        if (text && text.includes('#EXTM3U')) {
                          window.__focusguard_cached_playlist__ = text;
                          notifyStreamDetected(url, 'fetch_ct_hls', text);
                        } else {
                          notifyStreamDetected(url, 'fetch_ct');
                        }
                      }).catch(() => notifyStreamDetected(url, 'fetch_ct'));
                    } else {
                      notifyStreamDetected(url, 'fetch_ct');
                    }
                  } else if (ct.includes('json') || ct.includes('text') || ct.includes('javascript')) {
                    const clone = response.clone();
                    clone.text().then((text) => {
                      if (text && (text.includes('.m3u8') || text.includes('.mp4') || text.includes('.webm'))) {
                        extractAndNotifyStreamsFromText(text, 'fetch_api');
                      }
                    }).catch(() => {});
                  }
                }
              } catch (e) {}
            }).catch(() => {});
          }
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
      if (targetUrl) {
        this.addEventListener('load', () => {
          try {
            const ct = (this.getResponseHeader && this.getResponseHeader('Content-Type') ? this.getResponseHeader('Content-Type') : '').toLowerCase();
            const isVid = isVideoUrl(targetUrl) || ct.includes('video/') || ct.includes('mpegurl') || ct.includes('dash+xml');
            if (isVid) {
              if ((this.responseType === '' || this.responseType === 'text') && this.responseText) {
                if (this.responseText.includes('#EXTM3U')) {
                  window.__focusguard_cached_playlist__ = this.responseText;
                  notifyStreamDetected(targetUrl, 'xhr_hls', this.responseText);
                } else if (this.responseText.includes('.m3u8') || this.responseText.includes('.mp4') || this.responseText.includes('.webm')) {
                  extractAndNotifyStreamsFromText(this.responseText, 'xhr_body');
                } else {
                  notifyStreamDetected(targetUrl, 'xhr');
                }
              } else {
                notifyStreamDetected(targetUrl, 'xhr');
              }
            } else if ((ct.includes('json') || ct.includes('text') || targetUrl.includes('api') || targetUrl.includes('player') || targetUrl.includes('source') || targetUrl.includes('stream')) && (this.responseType === '' || this.responseType === 'text') && this.responseText) {
              if (this.responseText.includes('.m3u8') || this.responseText.includes('.mp4') || this.responseText.includes('.webm')) {
                extractAndNotifyStreamsFromText(this.responseText, 'xhr_api');
              }
            }
          } catch (e) {}
        });
      }
      return rawXhrSend.apply(this, arguments);
    };
  }

  // 8. Universal Web Video Player Hooks (JWPlayer, Video.js, Plyr, DPlayer, ArtPlayer)
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

  // Video.js Hook
  function hookVideoJs(vjs) {
    if (!vjs || vjs.__focusguard_hooked__) return vjs;
    try {
      if (typeof vjs.hook === 'function') {
        vjs.hook('setup', (player) => {
          try {
            player.on('loadstart', () => {
              const src = player.currentSrc ? player.currentSrc() : '';
              if (src) notifyStreamDetected(src, 'videojs');
            });
          } catch (e) {}
        });
      }
      vjs.__focusguard_hooked__ = true;
    } catch (e) {}
    return vjs;
  }

  let currentVjs = window.videojs;
  if (currentVjs) hookVideoJs(currentVjs);
  try {
    Object.defineProperty(window, 'videojs', {
      configurable: true,
      enumerable: true,
      get: function () { return currentVjs; },
      set: function (val) {
        currentVjs = hookVideoJs(val);
      }
    });
  } catch (e) {}

  // 10. Hook HTMLMediaElement.prototype.play and load to catch direct streams as playback begins
  try {
    const rawPlay = HTMLMediaElement.prototype.play;
    if (rawPlay) {
      HTMLMediaElement.prototype.play = function () {
        try {
          const s = this.currentSrc || this.src;
          if (s && typeof s === 'string' && !s.startsWith('blob:') && !s.startsWith('data:')) {
            notifyStreamDetected(s, 'video_play');
          }
          if (this.querySelectorAll) {
            const sources = this.querySelectorAll('source');
            for (let i = 0; i < sources.length; i++) {
              const src = sources[i].src || sources[i].getAttribute('src');
              if (src && !src.startsWith('blob:') && !src.startsWith('data:')) {
                notifyStreamDetected(src, 'video_play_source');
              }
            }
          }
        } catch (e) {}
        return rawPlay.apply(this, arguments);
      };
    }
  } catch (e) {}

  // 11. Extract and notify streams from text or JSON data (handles JSON-escaped slashes)
  function extractAndNotifyStreamsFromText(text, source = 'text') {
    if (!text || typeof text !== 'string') return;
    try {
      // Unescape all backslashes and HTML entities to correctly extract JSON-escaped URLs
      const cleanText = text.replace(/\\/g, '').replace(/&amp;/g, '&');

      const m3u8Matches = cleanText.match(/https?:\/\/[^"'\s\\]+?\.m3u8[^"'\s\\]*/g);
      if (m3u8Matches) {
        m3u8Matches.forEach(raw => {
          if (isManifestUrl(raw)) {
            notifyStreamDetected(raw, source + '_m3u8');
          }
        });
      }

      const mp4Matches = cleanText.match(/https?:\/\/[^"'\s\\]+?\.(?:mp4|webm|m4v|mov|mkv)[^"'\s\\]*/g);
      if (mp4Matches) {
        mp4Matches.forEach(raw => {
          if (isStandaloneVideoUrl(raw)) {
            notifyStreamDetected(raw, source + '_mp4');
          }
        });
      }
    } catch (e) {}
  }

  // Helper: Recursively walk JavaScript objects (window.initials, xplayerSettings, playerConfig, etc.)
  function extractStreamsFromObject(obj, maxDepth = 6, currentDepth = 0) {
    if (!obj || typeof obj !== 'object' || currentDepth > maxDepth) return;
    try {
      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          const item = obj[i];
          if (typeof item === 'string') {
            extractAndNotifyStreamsFromText(item, 'obj_array');
          } else if (item && typeof item === 'object') {
            extractStreamsFromObject(item, maxDepth, currentDepth + 1);
          }
        }
        return;
      }

      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (typeof val === 'string') {
          if (val.includes('.m3u8') || val.includes('.mp4') || val.includes('.webm') || val.includes('/hls/')) {
            extractAndNotifyStreamsFromText(val, `obj_${key}`);
          }
        } else if (val && typeof val === 'object') {
          extractStreamsFromObject(val, maxDepth, currentDepth + 1);
        }
      }
    } catch (e) {}
  }

  // 12. Universal Page Global & Script Sniffer (Supports xHamster window.initials, JSON-LD, and tube players)
  function scanPageGlobalsForStreams() {
    try {
      // 1. Inspect structured window objects
      const knownKeys = ['initials', 'xplayerSettings', 'videoModel', 'flashvars', 'playerConfig', 'videoData', 'xplayer', 'video_config', '__PLAYER_CONFIG__', 'jwplayerSettings', 'vjsConfig', '__NEXT_DATA__'];
      knownKeys.forEach(key => {
        if (typeof window[key] === 'object' && window[key]) {
          try {
            extractStreamsFromObject(window[key]);
            extractAndNotifyStreamsFromText(JSON.stringify(window[key]), `page_globals_${key}`);
          } catch (e) {}
        }
      });

      // 2. Scan all inline scripts in DOM
      if (typeof document !== 'undefined') {
        const scripts = document.querySelectorAll('script:not([src]), script[type="application/json"], script[type="application/ld+json"], script#initials, script[data-initials]');
        for (let i = 0; i < scripts.length; i++) {
          const content = scripts[i].textContent;
          if (content && (content.includes('.m3u8') || content.includes('.mp4') || content.includes('.webm') || content.includes('initials') || content.includes('contentUrl') || content.includes('sources'))) {
            extractAndNotifyStreamsFromText(content, 'inline_script');
          }
        }
      }

      // 3. Scan DOM <video> and <source> tags
      if (typeof document !== 'undefined') {
        const vids = document.querySelectorAll('video');
        for (let i = 0; i < vids.length; i++) {
          const v = vids[i];
          const src = v.currentSrc || v.src || v.getAttribute('src');
          if (src && !isSegmentChunkUrl(src)) {
            notifyStreamDetected(src, 'dom_video');
          }
          const sources = v.querySelectorAll('source');
          for (let j = 0; j < sources.length; j++) {
            const sSrc = sources[j].src || sources[j].getAttribute('src');
            if (sSrc && !isSegmentChunkUrl(sSrc)) {
              notifyStreamDetected(sSrc, 'dom_source');
            }
          }
        }
      }
    } catch (e) {}
  }

  // Listen for on-demand stream scan requests from ISOLATED world (e.g. when user clicks Download)
  window.addEventListener('__focusguard_request_stream_scan__', () => {
    scanPageGlobalsForStreams();
  });

  // Run global sniffer at key lifecycle stages
  scanPageGlobalsForStreams();
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scanPageGlobalsForStreams, { once: true });
    }
    window.addEventListener('load', scanPageGlobalsForStreams, { once: true });
  }
  setTimeout(scanPageGlobalsForStreams, 1000);
  setTimeout(scanPageGlobalsForStreams, 3000);

  console.log('[FocusGuard] Main World hooks armed.');
})();


