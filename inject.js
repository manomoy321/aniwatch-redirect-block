/**
 * FocusGuard - Stream Sniffer (inject.js)
 * Injected into the page's MAIN world context to sniff HLS .m3u8 and video streams
 * from embedded players (JWPlayer, MegaPlay, RapidCloud, VidSrc, etc.) for downloading.
 */
(function () {
  'use strict';

  if (window.__focusguard_stream_sniffer_active__) return;
  window.__focusguard_stream_sniffer_active__ = true;

  // Video Stream Sniffer & Playlist Text Interceptor (.m3u8, .mp4)
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

  // JWPlayer Sniffer for embedded players (megaplay.buzz, vidsrc, etc.)
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

  console.log('[FocusGuard Downloader] Stream Sniffer armed in MAIN world.');
})();
