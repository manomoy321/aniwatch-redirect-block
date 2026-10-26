/**
 * FocusGuard - Video Player Controller (player_controller.js)
 * Delivers comprehensive keyboard shortcuts, cross-frame media synchronization,
 * rock-solid fullscreen fixes, auto-play, auto-skip intro/outro, and next episode automation.
 */
(function () {
  'use strict';

  // Default configuration
  // Default configuration
  let playerSettings = {
    enabled: true,
    enableKeyboardControls: true,
    enableFullscreenFix: true,
    enableAutoPlay: true,
    enableAutoNext: true,
    enableAutoSkipIntro: true,
    enableAutoSkipOutro: true,
    enableAutoSelectEng: true,
    enableSmoothPlayback: true,
    enableDownloadMetadata: false,
    preferredServerCategory: 'dub', // 'dub' | 'sub'
    preferredServerName: 'vidsrc',   // e.g. 'vidsrc', 'megacloud'
    skipIntroSeconds: 85,
    seekSeconds: 5,
    nextEpisodeDelay: 0,
    whitelist: []
  };

  const currentHost = typeof window !== 'undefined' && window.location ? window.location.hostname : '';
  let activeVideo = null;
  let knownVideos = new Set();
  let hudHost = null;
  let hudTimer = null;
  let nextEpCountdownTimer = null;
  let hasAttemptedAutoplay = false;
  let introSkippedForCurrentVideo = false;
  let outroSkippedForCurrentVideo = false;
  let activePlayerSource = null;
  let activePlayerIframe = null;
  const processedMessageIds = new Set();
  let lastEngSelectionCheck = 0;
  let hasSelectedEngServer = false;
  let hasSelectedEngTitle = false;
  let isDownloading = false;
  const tabPendingHlsQueue = [];
  const activeHlsAbortControllers = new Map();
  let detectedStreamUrl = null;
  let detectedEmbedUrl = null;
  let cachedPlaylistUrl = null;
  let cachedPlaylistText = null;
  let cachedEpisodeMeta = null;
  let userManuallySelectedCategory = null;
  let isAutoRecovering = false;
  var getAvailableQualities, resolveActiveStreamUrl, parseMasterPlaylist, parseHlsByteRange, formatDataSize;
  let playerErrorRecoveryCount = 0;
  let lastPlayerErrorCheckTime = 0;

  // Helper: Strictly check if a URL is an isolated segment chunk or invalid stream
  function isSegmentChunkUrl(u) {
    if (!u || typeof u !== 'string') return true;
    if (u.startsWith('blob:') || u.startsWith('data:')) return true;
    const clean = u.toLowerCase();
    if (clean.includes('.m4s') || clean.includes('.ts') || clean.includes('.aac') || clean.includes('.m4a')) return true;
    if (clean.includes('/segment') || clean.includes('/frag-') || clean.includes('/range/')) return true;
    return false;
  }

  // Listen for video stream sniffer events from inject.js
  window.addEventListener('__focusguard_stream_detected__', (e) => {
    if (e.detail && e.detail.url && !isSegmentChunkUrl(e.detail.url)) {
      detectedStreamUrl = e.detail.url;
      if (e.detail.embedUrl) detectedEmbedUrl = e.detail.embedUrl;
      if (e.detail.playlistText) cachedPlaylistText = e.detail.playlistText;

      // Proactively fetch playlist text if not attached yet
      if (!cachedPlaylistText && (detectedStreamUrl.includes('.m3u8') || detectedStreamUrl.includes('/hls/') || /manifest|playlist/i.test(detectedStreamUrl))) {
        fetchResourceSafe(detectedStreamUrl, detectedEmbedUrl, false).then(text => {
          if (text && text.includes('#EXTM3U')) cachedPlaylistText = text;
        }).catch(() => {});
      }

      if (window !== window.top) {
        try {
          window.top.postMessage({
            type: 'FOCUSGUARD_STREAM_DETECTED',
            streamUrl: detectedStreamUrl,
            embedUrl: detectedEmbedUrl,
            playlistText: cachedPlaylistText
          }, '*');
        } catch (err) {}
      }
    }
  });

  // Initialize server preferences from sessionStorage if present
  try {
    const sessCat = sessionStorage.getItem('fg_pref_server_cat');
    if (sessCat) playerSettings.preferredServerCategory = sessCat;
    const sessName = sessionStorage.getItem('fg_pref_server_name');
    if (sessName) playerSettings.preferredServerName = sessName;
  } catch (e) {}

  // 1. Sync settings from chrome.storage
  function updatePlayerSettings() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return;
    }

    try {
      chrome.storage.local.get([
        'enabled',
        'enableKeyboardControls',
        'enableFullscreenFix',
        'enableAutoPlay',
        'enableAutoNext',
        'enableAutoSkipIntro',
        'enableAutoSkipOutro',
        'enableAutoSelectEng',
        'enableSmoothPlayback',
        'enableDownloadMetadata',
        'preferredServerCategory',
        'preferredServerName',
        'skipIntroSeconds',
        'seekSeconds',
        'nextEpisodeDelay',
        'whitelist'
      ], (res) => {
        if (chrome.runtime.lastError) return;
        if (res.enabled !== undefined) playerSettings.enabled = res.enabled;
        if (res.enableKeyboardControls !== undefined) playerSettings.enableKeyboardControls = res.enableKeyboardControls;
        if (res.enableFullscreenFix !== undefined) playerSettings.enableFullscreenFix = res.enableFullscreenFix;
        if (res.enableAutoPlay !== undefined) playerSettings.enableAutoPlay = res.enableAutoPlay;
        if (res.enableAutoNext !== undefined) playerSettings.enableAutoNext = res.enableAutoNext;
        if (res.enableAutoSkipIntro !== undefined) playerSettings.enableAutoSkipIntro = res.enableAutoSkipIntro;
        if (res.enableAutoSkipOutro !== undefined) playerSettings.enableAutoSkipOutro = res.enableAutoSkipOutro;
        if (res.enableAutoSelectEng !== undefined) playerSettings.enableAutoSelectEng = res.enableAutoSelectEng;
        if (res.enableSmoothPlayback !== undefined) playerSettings.enableSmoothPlayback = res.enableSmoothPlayback;
        if (res.enableDownloadMetadata !== undefined) playerSettings.enableDownloadMetadata = res.enableDownloadMetadata;
        if (res.preferredServerCategory) playerSettings.preferredServerCategory = res.preferredServerCategory;
        if (res.preferredServerName) playerSettings.preferredServerName = res.preferredServerName;
        if (res.skipIntroSeconds !== undefined) playerSettings.skipIntroSeconds = Number(res.skipIntroSeconds) || 85;
        if (res.seekSeconds !== undefined) playerSettings.seekSeconds = Number(res.seekSeconds) || 5;
        if (res.nextEpisodeDelay !== undefined) playerSettings.nextEpisodeDelay = Number(res.nextEpisodeDelay) || 0;
        if (Array.isArray(res.whitelist)) playerSettings.whitelist = res.whitelist;
      });
    } catch (e) {}
  }

  updatePlayerSettings();

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local') updatePlayerSettings();
    });
  }

  function isEnabled() {
    return playerSettings.enabled && !playerSettings.whitelist.includes(currentHost);
  }

  // 2. HUD (Heads-Up Display) Overlay Controller
  function getHudHost() {
    if (!hudHost || !hudHost.isConnected) {
      hudHost = document.getElementById('focusguard-hud-host');
      if (!hudHost) {
        hudHost = document.createElement('div');
        hudHost.id = 'focusguard-hud-host';
        const root = document.body || document.documentElement;
        if (root) root.appendChild(hudHost);
      }
    }
    return hudHost;
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function showHud(icon, text, options = {}) {
    const host = getHudHost();
    if (!host) return;

    // 1. Smooth In-Place Update: If a progress HUD is already active, update it in-place without blinking!
    const existingBadge = host.querySelector('.fg-hud-badge:not(.fg-hud-next-countdown)');
    if (existingBadge && options.progress !== undefined) {
      if (hudTimer) {
        clearTimeout(hudTimer);
        hudTimer = null;
      }

      const iconEl = existingBadge.querySelector('.fg-hud-icon');
      if (iconEl && icon) iconEl.textContent = icon;

      const textEl = existingBadge.querySelector('.fg-hud-text');
      if (textEl) textEl.textContent = text;

      let extraEl = existingBadge.querySelector('.fg-hud-extra');
      if (options.extra) {
        if (!extraEl) {
          extraEl = document.createElement('span');
          extraEl.className = 'fg-hud-extra';
          existingBadge.insertBefore(extraEl, existingBadge.querySelector('.fg-hud-progress-wrap'));
        }
        extraEl.textContent = options.extra;
        extraEl.style.display = 'inline';
      } else if (extraEl) {
        extraEl.style.display = 'none';
      }

      let fillEl = existingBadge.querySelector('.fg-hud-progress-fill');
      if (fillEl) {
        const pct = Math.max(0, Math.min(100, options.progress));
        fillEl.style.width = `${pct}%`;
      }

      existingBadge.classList.remove('fg-hud-hiding');
      existingBadge.classList.add('fg-hud-visible');

      hudTimer = setTimeout(() => {
        existingBadge.classList.remove('fg-hud-visible');
        existingBadge.classList.add('fg-hud-hiding');
        setTimeout(() => {
          if (existingBadge.parentNode) existingBadge.parentNode.removeChild(existingBadge);
        }, 250);
      }, options.duration || 1800);

      return;
    }

    if (hudTimer) {
      clearTimeout(hudTimer);
      hudTimer = null;
    }

    // Remove existing normal badges
    const oldBadges = host.querySelectorAll('.fg-hud-badge:not(.fg-hud-next-countdown)');
    oldBadges.forEach(b => b.remove());

    const badge = document.createElement('div');
    badge.className = 'fg-hud-badge' + 
      (options.isSkip ? ' fg-hud-skip' : '') + 
      (options.isDownload ? ' fg-hud-download' : '') + 
      (options.isSuccess ? ' fg-hud-success' : '');

    let extraHtml = '';
    if (options.extra) {
      extraHtml = `<span class="fg-hud-extra">${options.extra}</span>`;
    }

    let progressHtml = '';
    if (options.progress !== undefined) {
      const pct = Math.max(0, Math.min(100, options.progress));
      progressHtml = `
        <div class="fg-hud-progress-wrap">
          <div class="fg-hud-progress-fill" style="width: ${pct}%;"></div>
        </div>
      `;
    }

    badge.innerHTML = `
      <span class="fg-hud-icon">${icon}</span>
      <span class="fg-hud-text">${text}</span>
      ${extraHtml}
      ${progressHtml}
    `;

    host.appendChild(badge);

    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        badge.classList.add('fg-hud-visible');
      });
    } else {
      badge.classList.add('fg-hud-visible');
    }

    hudTimer = setTimeout(() => {
      badge.classList.remove('fg-hud-visible');
      badge.classList.add('fg-hud-hiding');
      setTimeout(() => {
        if (badge.parentNode) badge.parentNode.removeChild(badge);
      }, 250);
    }, options.duration || 900);
  }

  // Helper to maintain/restore fullscreen mode across skip buttons and episode transitions
  function ensureFullscreenMaintained(wasFs) {
    if (!wasFs) return;
    try { sessionStorage.setItem('fg_fullscreen_persisted', 'true'); } catch (e) {}

    // Check at multiple intervals if site/player triggered fullscreen exit
    [50, 150, 300, 600].forEach((ms) => {
      setTimeout(() => {
        if (wasFs && !isCurrentlyFullscreen()) {
          console.log('[FocusGuard] Fullscreen mode dropped after skip/transition! Re-engaging fullscreen...');
          toggleFullscreen(activeVideo);
        }
      }, ms);
    });
  }

  function showNextEpisodeCountdown(targetEl, targetUrl) {
    const delay = Number(playerSettings.nextEpisodeDelay) || 0;
    const wasFs = isCurrentlyFullscreen();
    if (wasFs) {
      try { sessionStorage.setItem('fg_fullscreen_persisted', 'true'); } catch (e) {}
      if (window !== window.top) {
        try { window.top.postMessage({ type: 'FOCUSGUARD_PERSIST_FULLSCREEN' }, '*'); } catch (e) {}
      }
    }

    // Zero delay (instant next episode)
    if (delay <= 0) {
      console.log('[FocusGuard] Instant Next Episode (delay: 0s)');
      showHud('⏭️', 'Auto-Next Episode (Instant)', { duration: 1000 });
      if (targetEl && typeof targetEl.click === 'function') {
        try { targetEl.click(); } catch (e) {}
      } else if (targetUrl) {
        window.location.href = targetUrl;
      }
      ensureFullscreenMaintained(wasFs);
      return;
    }

    const host = getHudHost();
    if (!host) return;

    if (nextEpCountdownTimer) clearInterval(nextEpCountdownTimer);

    // Remove existing countdown
    const existing = host.querySelector('.fg-hud-next-countdown');
    if (existing) existing.remove();

    let timeLeft = delay;
    const countdownBadge = document.createElement('div');
    countdownBadge.className = 'fg-hud-next-countdown';
    countdownBadge.innerHTML = `
      <span>⏭️ Next Episode in <strong id="fg-next-sec">${timeLeft}</strong>s</span>
      <button class="fg-hud-next-cancel" id="fg-btn-cancel-next">Cancel</button>
    `;

    host.appendChild(countdownBadge);

    const cancelBtn = countdownBadge.querySelector('#fg-btn-cancel-next');
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearInterval(nextEpCountdownTimer);
      countdownBadge.remove();
      showHud('⏸️', 'Auto-Next Cancelled');
    });

    nextEpCountdownTimer = setInterval(() => {
      timeLeft--;
      const secEl = countdownBadge.querySelector('#fg-next-sec');
      if (secEl) secEl.textContent = String(timeLeft);

      if (timeLeft <= 0) {
        clearInterval(nextEpCountdownTimer);
        countdownBadge.remove();
        if (targetEl && typeof targetEl.click === 'function') {
          targetEl.click();
        } else if (targetUrl) {
          window.location.href = targetUrl;
        }
        ensureFullscreenMaintained(wasFs);
      }
    }, 1000);
  }

  // 3. Finding and Binding Video Elements
  // Control directly through existing site controls + keyboard shortcuts (no floating dock overlay)
  function bindVideoEvents(video) {
    if (!video || knownVideos.has(video)) return;
    knownVideos.add(video);

    if (!activeVideo || activeVideo.paused) {
      activeVideo = video;
    }

    // Clean up any legacy overlay dock elements from earlier builds
    const legacyDock = document.getElementById('fg-player-shortcut-dock');
    if (legacyDock) legacyDock.remove();

    function notifyActiveVideo() {
      activeVideo = video;
      if (window !== window.top) {
        try {
          window.top.postMessage({ type: 'FOCUSGUARD_VIDEO_ACTIVE' }, '*');
        } catch (e) {}
      }
    }

    video.addEventListener('play', notifyActiveVideo);
    video.addEventListener('playing', notifyActiveVideo);
    video.addEventListener('click', notifyActiveVideo);
    video.addEventListener('pause', () => {
      // Retain active video reference
    });

    // Double-click to toggle fullscreen
    video.addEventListener('dblclick', (e) => {
      if (!isEnabled() || !playerSettings.enableFullscreenFix) return;
      e.preventDefault();
      e.stopPropagation();
      toggleFullscreen(video);
    });

    // Aggressive buffer preloading & hardware decoding setup
    try {
      if (playerSettings.enableSmoothPlayback) {
        video.preload = 'auto';
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
      }
    } catch (e) {}

    // Video error detection & auto-recovery notification
    video.addEventListener('error', () => {
      console.warn('[FocusGuard] Video element error encountered:', video.error);
      if (window !== window.top) {
        try { window.top.postMessage({ type: 'FOCUSGUARD_PLAYER_ERROR', errorCode: 'video_error' }, '*'); } catch (e) {}
      }
      handlePlayerErrorAutoRecovery();
    });

    // Playback stall & buffer underrun watchdog
    let videoWaitingTimer = null;
    video.addEventListener('waiting', () => {
      if (isDownloading) {
        if (videoWaitingTimer) clearTimeout(videoWaitingTimer);
        videoWaitingTimer = setTimeout(() => {
          if (!video.paused && !video.ended && video.readyState < 3) {
            handlePlaybackStallRecovery(video);
          }
        }, 3500);
      }
    });

    video.addEventListener('stalled', () => {
      if (isDownloading) {
        if (videoWaitingTimer) clearTimeout(videoWaitingTimer);
        videoWaitingTimer = setTimeout(() => {
          if (!video.paused && !video.ended && video.readyState < 3) {
            handlePlaybackStallRecovery(video);
          }
        }, 3500);
      }
    });

    video.addEventListener('playing', () => {
      if (videoWaitingTimer) {
        clearTimeout(videoWaitingTimer);
        videoWaitingTimer = null;
      }
      stallDurationSeconds = 0;
    });

    // Hook JWPlayer error events if present
    try {
      if (typeof window.jwplayer === 'function') {
        const jw = window.jwplayer();
        if (jw && typeof jw.on === 'function' && !jw.__fg_error_hooked__) {
          jw.__fg_error_hooked__ = true;
          jw.on('error', (err) => {
            const code = (err && err.code) ? String(err.code) : '232403';
            console.warn('[FocusGuard] JWPlayer error event:', code, err);
            if (window !== window.top) {
              try { window.top.postMessage({ type: 'FOCUSGUARD_PLAYER_ERROR', errorCode: code }, '*'); } catch (e) {}
            }
            handlePlayerErrorAutoRecovery();
          });
          jw.on('setupError', () => {
            if (window !== window.top) {
              try { window.top.postMessage({ type: 'FOCUSGUARD_PLAYER_ERROR', errorCode: 'setup_error' }, '*'); } catch (e) {}
            }
            handlePlayerErrorAutoRecovery();
          });
        }
      }
    } catch (e) {}

    // Reset skip & language flags on new media
    video.addEventListener('loadedmetadata', () => {
      introSkippedForCurrentVideo = false;
      outroSkippedForCurrentVideo = false;
      hasSelectedEngServer = false;
      hasSelectedEngTitle = false;
      optimizeVideoBuffering(video);
      checkAutoPlay(video);
      autoSelectEnglish(video);

      // Restore persisted fullscreen on next episode or new video load
      try {
        if (sessionStorage.getItem('fg_fullscreen_persisted') === 'true' && !isCurrentlyFullscreen()) {
          setTimeout(() => {
            if (!isCurrentlyFullscreen()) {
              console.log('[FocusGuard] Auto-restoring fullscreen mode on new episode metadata');
              toggleFullscreen(video);
            }
          }, 120);
        }
      } catch (e) {}
    });

    // Watch playback progress for auto-skip, auto-next, and language
    video.addEventListener('timeupdate', () => {
      if (!activeVideo || activeVideo.paused) {
        activeVideo = video;
      }
      handleTimeUpdate(video);
      autoSelectEnglish(video);
    });

    video.addEventListener('ended', () => {
      handleVideoEnded(video);
    });

    // Trigger initial autoplay & language check if video is already ready
    if (video.readyState >= 1) {
      optimizeVideoBuffering(video);
      checkAutoPlay(video);
      autoSelectEnglish(video);
    }
    mountDownloadButton(video);
  }

  // 3.5 Video Downloader & Universal Filename / Metadata Resolver
  function getEpisodeMetadata(targetDoc, quality = null, targetVideo = null) {
    const doc = targetDoc || (typeof document !== 'undefined' ? document : null);
    const qSuffix = quality ? ` [${quality}]` : '';
    if (!doc) return { isEpisode: false, episodeNum: '01', animeTitle: '', title: 'Video', baseName: `Episode 01${qSuffix}`, filename: `Episode 01${qSuffix}.mp4`, quality: quality || null };

    if (!targetDoc && !quality && !targetVideo && cachedEpisodeMeta && cachedEpisodeMeta.timestamp && (Date.now() - cachedEpisodeMeta.timestamp < 1000)) {
      return cachedEpisodeMeta;
    }
    const targetDocToUse = doc;

    let episodeNum = null;
    let animeTitle = null;
    let hasExplicitEpisode = false;

    // A. Priority 1: Active episode button in selector list
    const epSelectors = [
      '.ep-item.active',
      '.ssl-item.ep-item.active',
      '.episode-item.active',
      '[data-number].active',
      '.btn-episode.active',
      '.ss-item.active',
      '.ep-item[class*="active"]',
      'li.active[data-number]',
      'a.active[data-number]',
      '.episodes-list .active'
    ];

    for (const sel of epSelectors) {
      try {
        const el = targetDocToUse.querySelector(sel);
        if (el) {
          const dataNum = el.getAttribute('data-number') || el.getAttribute('data-episode') || el.getAttribute('data-num');
          if (dataNum && /^\d+$/.test(dataNum.trim())) {
            episodeNum = dataNum.trim();
            hasExplicitEpisode = true;
            break;
          }
          const text = (el.textContent || '').trim();
          const m = text.match(/(?:Episode|Ep\.?|EP)?\s*(\d+)/i);
          if (m) {
            episodeNum = m[1];
            hasExplicitEpisode = true;
            break;
          }
        }
      } catch (e) {}
    }

    // B. Priority 2: Player header, breadcrumb, detail elements
    if (!episodeNum) {
      const headerSelectors = [
        '.player-title',
        '.watching-episode',
        '.server-notice',
        '#detail-page .heading-name',
        '.breadcrumb-item.active',
        '.breadcrumb li:last-child',
        '#player-wrapper .player-header',
        '.film-name'
      ];
      for (const sel of headerSelectors) {
        try {
          const el = targetDocToUse.querySelector(sel);
          if (el && el.textContent) {
            const m = el.textContent.match(/(?:Episode|Ep\.?|EP)?\s*(\d+)/i);
            if (m) {
              episodeNum = m[1];
              hasExplicitEpisode = true;
              break;
            }
          }
        } catch (e) {}
      }
    }

    // C. Priority 3: Page title and URL
    if (!episodeNum && targetDocToUse.title) {
      const titleMatch = targetDocToUse.title.match(/(?:Episode|Ep\.?|EP)\s*(\d+)/i);
      if (titleMatch) {
        episodeNum = titleMatch[1];
        hasExplicitEpisode = true;
      }
    }

    const canUseWindowLocation = !targetDoc || (typeof document !== 'undefined' && targetDoc === document);

    if (!episodeNum && canUseWindowLocation && typeof window !== 'undefined' && window.location) {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const epParam = urlParams.get('ep') || urlParams.get('episode') || urlParams.get('ep_number');
        if (epParam) {
          const m = epParam.match(/(\d+)/);
          if (m) {
            episodeNum = m[1];
            hasExplicitEpisode = true;
          }
        }
      } catch (e) {}
    }

    if (!episodeNum && canUseWindowLocation && typeof window !== 'undefined' && window.location) {
      try {
        const pathMatch = window.location.pathname.match(/ep(?:isode)?[-_/](\d+)/i);
        if (pathMatch) {
          episodeNum = pathMatch[1];
          hasExplicitEpisode = true;
        }
      } catch (e) {}
    }

    // Format episode number (zero-pad single digits: e.g. "1" -> "01")
    let formattedEp = '01';
    if (episodeNum) {
      const parsed = parseInt(episodeNum, 10);
      if (!isNaN(parsed)) {
        formattedEp = parsed < 10 ? String(parsed).padStart(2, '0') : String(parsed);
      } else {
        formattedEp = episodeNum.trim();
      }
    }

    // Extract Anime or Video Title
    const titleSelectors = [
      '.film-name',
      'h2.film-name',
      'h1.film-name',
      '#detail-page .heading-name',
      '.anime-title',
      '.player-title',
      'h1.title',
      '.video-title',
      '.watch-title',
      '.entry-title',
      '#film-name',
      '.dynamic-name'
    ];
    for (const sel of titleSelectors) {
      try {
        const el = targetDocToUse.querySelector(sel);
        if (el && el.textContent) {
          let txt = el.textContent.trim();
          txt = txt.replace(/^[🎬▶️\s]+/u, '');
          txt = txt.replace(/^Episode\s*\d+\s*[-–—:]\s*/i, '');
          txt = txt.replace(/\(Simulated Player\)/i, '');
          txt = txt.replace(/\s*[-–—:]\s*Episode\s*\d+.*$/i, '');
          txt = txt.trim();
          if (txt.length > 1) {
            animeTitle = txt;
            break;
          }
        }
      } catch (e) {}
    }

    // Check breadcrumb items (common on anime sites: Home > Anime > Title > Episode)
    if (!animeTitle) {
      try {
        const bc = targetDocToUse.querySelectorAll('.breadcrumb li, .breadcrumb-item, .breadcrumb a');
        if (bc && bc.length >= 2) {
          for (let i = bc.length - 1; i >= 0; i--) {
            let bText = (bc[i].textContent || '').trim();
            bText = bText.replace(/^Episode\s*\d+.*$/i, '').replace(/^[🎬▶️\s]+/u, '').trim();
            if (bText && !/^(?:home|anime|watch|series|movie|tv|all episodes)$/i.test(bText) && bText.length > 1) {
              animeTitle = bText;
              break;
            }
          }
        }
      } catch (e) {}
    }

    // Check targetVideo attributes or container headings if available
    if (!animeTitle && targetVideo) {
      try {
        const vTitle = targetVideo.getAttribute('title') || targetVideo.getAttribute('aria-label');
        if (vTitle && vTitle.trim().length > 1) {
          animeTitle = vTitle.trim();
        }
        if (!animeTitle) {
          const container = targetVideo.closest ? targetVideo.closest('[class*="player"], [id*="player"], figure') : null;
          if (container) {
            const h = container.querySelector('h1, h2, h3, .title, [class*="title"], [class*="heading"]');
            if (h && h.textContent && h.textContent.trim().length > 1) {
              animeTitle = h.textContent.trim();
            }
          }
        }
      } catch (e) {}
    }

    // Check page h1
    if (!animeTitle) {
      try {
        const pageH1 = targetDocToUse.querySelector('h1');
        if (pageH1 && pageH1.textContent && pageH1.textContent.trim().length > 1) {
          animeTitle = pageH1.textContent.trim();
        }
      } catch (e) {}
    }

    // Check meta tags (og:title, twitter:title)
    if (!animeTitle) {
      try {
        const ogTitle = targetDocToUse.querySelector('meta[property="og:title"], meta[name="twitter:title"]');
        if (ogTitle && ogTitle.getAttribute('content')) {
          animeTitle = ogTitle.getAttribute('content').trim();
        }
      } catch (e) {}
    }

    // Check URL pathname (e.g. /watch/solo-leveling-season-2-18718)
    if (!animeTitle && canUseWindowLocation && typeof window !== 'undefined' && window.location && window.location.pathname) {
      try {
        const path = window.location.pathname;
        const m = path.match(/\/(?:watch|anime|videos?|film|series)\/([^\/?#]+)/i);
        if (m) {
          let slug = m[1].replace(/-\d+$/, '').replace(/-/g, ' ').trim();
          if (slug.length > 1) {
            animeTitle = slug.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          }
        }
      } catch (e) {}
    }

    // Fallback to document title cleaned of site names
    if (!animeTitle && targetDocToUse.title) {
      let cleanDocTitle = targetDocToUse.title
        .replace(/^Watch\s+/i, '')
        .replace(/\s+English Sub\/Dub.*$/i, '')
        .replace(/\s+online free.*$/i, '')
        .replace(/\s*[-–—|]\s*(?:YouTube|Vimeo|Dailymotion|Facebook|Twitter|Twitch|TikTok|Reddit|HiAnime|Aniwatch|Zoro|Kaido|Gogoanime|Watch Anime|AnimeStream|Anime).*$/i, '')
        .replace(/\s*[-–—|:]*\s*Episode\s+\d+.*$/i, '')
        .replace(/^[\s\-_–—|:]+|[\s\-_–—|:]+$/g, '')
        .trim();
      if (cleanDocTitle.length > 1) {
        animeTitle = cleanDocTitle;
      }
    }

    if (animeTitle) {
      animeTitle = animeTitle
        .replace(/^Watch\s+/i, '')
        .replace(/\s*[-–—|]\s*(?:YouTube|Vimeo|Dailymotion|Facebook|Twitter|Twitch|TikTok|Reddit|HiAnime|Aniwatch|Zoro|Kaido|Gogoanime|Watch Anime|AnimeStream|Anime).*$/i, '')
        .replace(/\s*[-–—|:]*\s*Episode\s+\d+.*$/i, '')
        .replace(/^[\s\-_–—|:]+|[\s\-_–—|:]+$/g, '')
        .trim();
    }

    let baseName = '';
    if (hasExplicitEpisode) {
      if (animeTitle) {
        baseName = `${animeTitle} - Episode ${formattedEp}${qSuffix}`;
      } else {
        baseName = `Episode ${formattedEp}${qSuffix}`;
      }
    } else {
      if (animeTitle) {
        baseName = `${animeTitle}${qSuffix}`;
      } else {
        baseName = `Episode ${formattedEp}${qSuffix}`;
      }
    }

    const safeBase = baseName
      .replace(/[\/\\:*?"<>|]/g, '_')
      .replace(/\s*[-–—]+\s*[-–—]+\s*/g, ' - ')
      .replace(/\s+/g, ' ')
      .trim();
    const filename = `${safeBase}.mp4`;

    const meta = {
      isEpisode: hasExplicitEpisode,
      episodeNum: formattedEp,
      animeTitle: animeTitle || '',
      title: animeTitle || 'Video',
      baseName: safeBase,
      filename: filename,
      quality: quality || null,
      timestamp: Date.now()
    };

    if (!targetDoc && !quality && !targetVideo) {
      cachedEpisodeMeta = meta;
    }

    return meta;
  }

  // Find the best player container on any website
  function findBestPlayerContainer(video) {
    if (!video) return null;
    if (video.nodeType === 1 && video.tagName !== 'VIDEO') {
      return video;
    }
    const candidateSelectors = [
      '#player-wrapper', '.player-container', '#player-container', '#player',
      '.jwplayer', '.video-js', '.plyr', '.dplayer', '.art-video-player',
      '#movie_player', '.html5-video-player', '.video-stream-container',
      '[class*="player-wrapper"]', '[class*="player-container"]', '[class*="player-ui"]',
      '[class*="video-player"]', '[class*="videoplayer"]', '[class*="video-wrap"]',
      '.film-player', 'figure'
    ];
    for (const sel of candidateSelectors) {
      try {
        const found = video.closest(sel);
        if (found && found !== document.body && found !== document.documentElement) {
          return found;
        }
      } catch (e) {}
    }
    let p = video.parentElement;
    while (p && p !== document.body && p !== document.documentElement) {
      try {
        const style = window.getComputedStyle(p);
        if (style && style.display !== 'inline' && style.display !== 'contents') {
          return p;
        }
      } catch (e) {
        return p;
      }
      p = p.parentElement;
    }
    return video.parentElement || document.body;
  }

  // Resolve genuine master playlist or direct video URL across DOM, variables, and player instances
  function resolveActiveStreamUrl(targetVideo = null) {
    // 1. Attached stream property on target video
    if (targetVideo && targetVideo.__fg_stream_url__ && !isSegmentChunkUrl(targetVideo.__fg_stream_url__)) {
      return targetVideo.__fg_stream_url__;
    }

    // 2. Active detected stream variable in current frame
    if (detectedStreamUrl && !isSegmentChunkUrl(detectedStreamUrl)) {
      return detectedStreamUrl;
    }

    // 3. Shared JSON bridge element set by inject.js in DOM (__fg_stream_data__)
    try {
      if (typeof document !== 'undefined') {
        const dataEl = document.getElementById('__fg_stream_data__');
        if (dataEl && dataEl.textContent) {
          const payload = JSON.parse(dataEl.textContent);
          // Prioritize current activeStream detected by sniffer
          if (payload.activeStream && !isSegmentChunkUrl(payload.activeStream)) {
            return payload.activeStream;
          }
          if (payload.hlsStream && !isSegmentChunkUrl(payload.hlsStream)) {
            return payload.hlsStream;
          }
          if (payload.mp4Stream && !isSegmentChunkUrl(payload.mp4Stream)) {
            return payload.mp4Stream;
          }
        }
      }
    } catch (e) {}

    // 4. DocumentElement bridge attributes set by inject.js in current frame
    try {
      if (typeof document !== 'undefined' && document.documentElement) {
        const domMp4 = document.documentElement.getAttribute('data-focusguard-mp4-stream');
        if (domMp4 && !isSegmentChunkUrl(domMp4)) return domMp4;
        const domStream = document.documentElement.getAttribute('data-focusguard-active-stream');
        if (domStream && !isSegmentChunkUrl(domStream)) return domStream;
        const domHls = document.documentElement.getAttribute('data-focusguard-hls-stream');
        if (domHls && !isSegmentChunkUrl(domHls)) return domHls;
      }
    } catch (e) {}

    // 5. SessionStorage cache
    try {
      const sessStream = sessionStorage.getItem('fg_detected_stream_url');
      if (sessStream && !isSegmentChunkUrl(sessStream)) return sessStream;
    } catch (e) {}

    // 6. Inspect window globals (if in same world or Node test environment)
    try {
      if (typeof window !== 'undefined' && window.initials && typeof window.initials === 'object') {
        const str = JSON.stringify(window.initials).replace(/\\/g, '');
        const mMp4 = str.match(/https?:\/\/[^"'\s\\]+?\.(?:mp4|webm)[^"'\s\\]*/);
        if (mMp4 && !isSegmentChunkUrl(mMp4[0])) return mMp4[0];
        const m = str.match(/https?:\/\/[^"'\s\\]+?\.m3u8[^"'\s\\]*/);
        if (m && !isSegmentChunkUrl(m[0])) return m[0];
      }
    } catch (e) {}

    // 7. Inspect all inline scripts in DOM (unescaping JSON backslashes)
    try {
      if (typeof document !== 'undefined') {
        const initialsScript = document.getElementById('initials') || document.querySelector('script[data-initials]');
        if (initialsScript && initialsScript.textContent) {
          const cleanText = initialsScript.textContent.replace(/\\/g, '');
          const mMp4 = cleanText.match(/https?:\/\/[^"'\s\\]+?\.(?:mp4|webm)[^"'\s\\]*/);
          if (mMp4 && !isSegmentChunkUrl(mMp4[0])) return mMp4[0];
          const m = cleanText.match(/https?:\/\/[^"'\s\\]+?\.m3u8[^"'\s\\]*/);
          if (m && !isSegmentChunkUrl(m[0])) return m[0];
        }

        const allScripts = document.querySelectorAll('script:not([src])');
        for (let i = 0; i < allScripts.length; i++) {
          const txt = allScripts[i].textContent;
          if (txt && (txt.includes('.mp4') || txt.includes('.m3u8') || txt.includes('.webm'))) {
            const cleanText = txt.replace(/\\/g, '');
            const mMp4 = cleanText.match(/https?:\/\/[^"'\s\\]+?\.(?:mp4|webm)[^"'\s\\]*/);
            if (mMp4 && !isSegmentChunkUrl(mMp4[0])) return mMp4[0];
            const m = cleanText.match(/https?:\/\/[^"'\s\\]+?\.m3u8[^"'\s\\]*/);
            if (m && !isSegmentChunkUrl(m[0])) return m[0];
          }
        }
      }
    } catch (e) {}

    // 8. Inspect metadata tags (og:video, twitter:player:stream, preload links)
    try {
      if (typeof document !== 'undefined') {
        const ogVid = document.querySelector('meta[property="og:video"], meta[property="og:video:url"], meta[name="twitter:player:stream"]');
        if (ogVid && ogVid.content && !isSegmentChunkUrl(ogVid.content)) {
          return ogVid.content;
        }
        const linkVid = document.querySelector('link[rel="preload"][as="video"], link[rel="preload"][href*=".m3u8"], link[rel="preload"][href*=".mp4"]');
        if (linkVid && linkVid.href && !isSegmentChunkUrl(linkVid.href)) {
          return linkVid.href;
        }
        const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (let i = 0; i < ldScripts.length; i++) {
          try {
            const data = JSON.parse(ldScripts[i].textContent);
            const cUrl = data.contentUrl || (data.video && data.video.contentUrl);
            if (cUrl && typeof cUrl === 'string' && !isSegmentChunkUrl(cUrl)) return cUrl;
          } catch (err) {}
        }
      }
    } catch (e) {}

    // 9. Inspect player JS instances (Hls.js, JWPlayer, Video.js, Plyr, DPlayer, ArtPlayer)
    if (targetVideo) {
      if (targetVideo.player) {
        try {
          const vjsSrc = targetVideo.player.currentSrc ? targetVideo.player.currentSrc() : targetVideo.player.src();
          if (vjsSrc && !isSegmentChunkUrl(vjsSrc)) return vjsSrc;
        } catch (e) {}
      }
      if (targetVideo.plyr && targetVideo.plyr.source && !isSegmentChunkUrl(targetVideo.plyr.source)) {
        return targetVideo.plyr.source;
      }
      if (targetVideo.__hls__ && targetVideo.__hls__.url && !isSegmentChunkUrl(targetVideo.__hls__.url)) {
        return targetVideo.__hls__.url;
      }
    }

    if (typeof window !== 'undefined') {
      if (window.hls && window.hls.url && !isSegmentChunkUrl(window.hls.url)) {
        return window.hls.url;
      }
      if (window.dp && window.dp.video && window.dp.video.src && !isSegmentChunkUrl(window.dp.video.src)) {
        return window.dp.video.src;
      }
      if (window.art && window.art.url && !isSegmentChunkUrl(window.art.url)) {
        return window.art.url;
      }
      if (typeof window.jwplayer === 'function') {
        try {
          const jw = window.jwplayer();
          if (jw) {
            const item = (typeof jw.getPlaylistItem === 'function') ? jw.getPlaylistItem() : null;
            if (item && item.file && !isSegmentChunkUrl(item.file)) return item.file;
            const list = (typeof jw.getPlaylist === 'function') ? jw.getPlaylist() : null;
            if (list && list[0] && list[0].file && !isSegmentChunkUrl(list[0].file)) return list[0].file;
          }
        } catch (e) {}
      }
      if (Array.isArray(window.__focusguard_detected_streams__)) {
        const validM3u8 = window.__focusguard_detected_streams__.find(s => s.includes('.m3u8') && !isSegmentChunkUrl(s));
        if (validM3u8) return validM3u8;
        const valid = window.__focusguard_detected_streams__.find(s => !isSegmentChunkUrl(s));
        if (valid) return valid;
      }
    }

    // 10. Inspect candidate child iframes in document
    try {
      if (typeof document !== 'undefined') {
        const ifrs = document.querySelectorAll('iframe');
        for (let i = 0; i < ifrs.length; i++) {
          try {
            const ifrDoc = ifrs[i].contentDocument;
            if (ifrDoc && ifrDoc.documentElement) {
              const ifrStream = ifrDoc.documentElement.getAttribute('data-focusguard-active-stream') || ifrDoc.documentElement.getAttribute('data-focusguard-mp4-stream');
              if (ifrStream && !isSegmentChunkUrl(ifrStream)) return ifrStream;
            }
          } catch (e) {}
        }
      }
    } catch (e) {}

    // 11. Inspect <source> child tags on video
    if (targetVideo && targetVideo.querySelectorAll) {
      const sources = targetVideo.querySelectorAll('source');
      for (let i = 0; i < sources.length; i++) {
        const s = sources[i].src || sources[i].getAttribute('src') || sources[i].getAttribute('data-src');
        if (s && !isSegmentChunkUrl(s)) return s;
      }
    }

    // 12. Direct video element attributes
    if (targetVideo) {
      const direct = targetVideo.currentSrc || targetVideo.src || targetVideo.getAttribute('src') || targetVideo.getAttribute('data-src');
      if (direct && !isSegmentChunkUrl(direct)) return direct;
    }

    // 13. Fallback: inspect any other video element in DOM
    try {
      if (typeof document !== 'undefined') {
        const allVideos = document.querySelectorAll('video');
        for (let i = 0; i < allVideos.length; i++) {
          const other = allVideos[i];
          if (other && other !== targetVideo) {
            const oSrc = other.__fg_stream_url__ || other.currentSrc || other.src;
            if (oSrc && !isSegmentChunkUrl(oSrc)) return oSrc;
          }
        }
      }
    } catch (e) {}

    return null;
  }

  // Helper: Convert HLS BYTERANGE (length@offset) to HTTP Range header value (offset-end)
  function parseHlsByteRange(str) {
    if (!str) return null;
    const parts = String(str).trim().replace(/^"/, '').replace(/"$/, '').split('@');
    const length = parseInt(parts[0], 10);
    if (isNaN(length) || length <= 0) return null;
    const offset = parts[1] !== undefined ? parseInt(parts[1], 10) : 0;
    return `${offset}-${offset + length - 1}`;
  }

  // Format internet data consumption string
  function formatDataSize(bytes) {
    if (!bytes || isNaN(bytes) || bytes <= 0) return '~200 MB';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1000) {
      return `~${(mb / 1024).toFixed(1)} GB`;
    }
    return `~${Math.round(mb)} MB`;
  }

  // Parses master playlist for 1080p, 720p, 480p streams and calculates internet data required
  function parseMasterPlaylist(playlistText, baseUrl, videoDuration = null) {
    const duration = (videoDuration && !isNaN(videoDuration) && videoDuration > 60) ? videoDuration : 1440;

    const defaults = {
      '1080p': { label: '1080p Full HD', bandwidth: 2600000, desc: 'Ultra Crisp • Best Quality' },
      '720p':  { label: '720p HD',      bandwidth: 1350000, desc: 'Balanced • Standard HD' },
      '480p':  { label: '480p SD',      bandwidth: 650000,  desc: 'Data Saver • Fast Download' }
    };

    const tiers = {
      '1080p': { quality: '1080p', label: defaults['1080p'].label, desc: defaults['1080p'].desc, url: baseUrl, bandwidth: defaults['1080p'].bandwidth },
      '720p':  { quality: '720p',  label: defaults['720p'].label,  desc: defaults['720p'].desc,  url: baseUrl, bandwidth: defaults['720p'].bandwidth },
      '480p':  { quality: '480p',  label: defaults['480p'].label,  desc: defaults['480p'].desc,  url: baseUrl, bandwidth: defaults['480p'].bandwidth }
    };

    if (playlistText && playlistText.includes('#EXT-X-STREAM-INF')) {
      const lines = playlistText.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-STREAM-INF')) {
          let j = i + 1;
          while (j < lines.length && (!lines[j].trim() || lines[j].trim().startsWith('#'))) j++;
          if (j < lines.length) {
            let streamUrl = lines[j].trim();
            try {
              streamUrl = new URL(streamUrl, baseUrl).href;
            } catch (e) {}

            const resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
            const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
            const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
            const height = resMatch ? parseInt(resMatch[1], 10) : 0;

            if (height >= 1000 || /1080/i.test(lines[j])) {
              tiers['1080p'].url = streamUrl;
              if (bw > 0) tiers['1080p'].bandwidth = bw;
            } else if ((height >= 650 && height < 1000) || /720/i.test(lines[j])) {
              tiers['720p'].url = streamUrl;
              if (bw > 0) tiers['720p'].bandwidth = bw;
            } else if ((height >= 400 && height < 650) || /480/i.test(lines[j])) {
              tiers['480p'].url = streamUrl;
              if (bw > 0) tiers['480p'].bandwidth = bw;
            }
          }
        }
      }
    }

    return ['1080p', '720p', '480p'].map((q) => {
      const item = tiers[q];
      const totalBytes = (item.bandwidth / 8) * duration;
      return {
        quality: item.quality,
        label: item.label,
        desc: item.desc,
        url: item.url,
        estimatedBytes: totalBytes,
        dataSize: formatDataSize(totalBytes)
      };
    });
  }

  // Extracts audio renditions declared via #EXT-X-MEDIA:TYPE=AUDIO from master HLS playlist
  function extractAudioRenditions(playlistText, baseUrl, preferDub = false) {
    if (!playlistText || !playlistText.includes('#EXT-X-MEDIA')) return [];
    const lines = playlistText.split('\n');
    const renditions = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-MEDIA:') && /TYPE=AUDIO/i.test(line)) {
        const uriMatch = line.match(/URI=["']([^"']+)["']/i);
        if (!uriMatch) continue;
        const rawUri = uriMatch[1];
        let url = rawUri;
        try {
          url = new URL(rawUri, baseUrl).href;
        } catch (e) {}

        const groupIdMatch = line.match(/GROUP-ID=["']([^"']+)["']/i);
        const nameMatch = line.match(/NAME=["']([^"']+)["']/i);
        const langMatch = line.match(/LANGUAGE=["']([^"']+)["']/i);
        const isDefault = /DEFAULT=YES/i.test(line);
        const isAutoSelect = /AUTOSELECT=YES/i.test(line);
        const name = nameMatch ? nameMatch[1] : 'Audio';
        const language = langMatch ? langMatch[1] : '';
        const isDub = /dub|en|eng|english/i.test(name) || /en/i.test(language);

        renditions.push({
          url,
          groupId: groupIdMatch ? groupIdMatch[1] : '',
          name,
          language,
          isDefault,
          isAutoSelect,
          isDub
        });
      }
    }

    // Sort renditions based on preferDub and default settings
    renditions.sort((a, b) => {
      if (preferDub) {
        if (a.isDub && !b.isDub) return -1;
        if (!a.isDub && b.isDub) return 1;
      }
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return 0;
    });

    return renditions;
  }

  // Discovers and filters ONLY the qualities that actually exist on the player control or stream
  function getAvailableQualities(videoEl, playlistText, baseUrl, videoDuration = null) {
    const duration = (videoDuration && !isNaN(videoDuration) && videoDuration > 60) ? videoDuration : 
                     (videoEl && !isNaN(videoEl.duration) && videoEl.duration > 60 ? videoEl.duration : 1440);

    const foundQualities = new Map();

    const defaultMeta = {
      '4K':    { label: '4K Ultra HD',   desc: 'Cinema 2160p • Maximum Fidelity', bandwidth: 8500000 },
      '1440p': { label: '1440p 2K QHD',  desc: 'Quad HD • Crystal Clear',        bandwidth: 5000000 },
      '1080p': { label: '1080p Full HD', desc: 'Ultra Crisp • Best Quality',     bandwidth: 2600000 },
      '720p':  { label: '720p HD',       desc: 'Balanced • Standard HD',         bandwidth: 1350000 },
      '480p':  { label: '480p SD',       desc: 'Data Saver • Fast Download',     bandwidth: 650000 },
      '360p':  { label: '360p Low',      desc: 'Mobile Saver • Light Data',      bandwidth: 350000 },
      '240p':  { label: '240p Eco',      desc: 'Minimal Data • Fast',            bandwidth: 200000 }
    };

    function registerQuality(qName, url = baseUrl, bandwidth = null) {
      if (!qName) return;
      const cleanQ = String(qName).toLowerCase().trim();
      let norm = null;
      if (cleanQ.includes('2160') || cleanQ.includes('4k')) norm = '4K';
      else if (cleanQ.includes('1440') || cleanQ.includes('2k')) norm = '1440p';
      else if (cleanQ.includes('1080')) norm = '1080p';
      else if (cleanQ.includes('720')) norm = '720p';
      else if (cleanQ.includes('480')) norm = '480p';
      else if (cleanQ.includes('360')) norm = '360p';
      else if (cleanQ.includes('240')) norm = '240p';

      if (!norm) return;
      if (!foundQualities.has(norm)) {
        const def = defaultMeta[norm] || { label: norm, desc: 'Video Stream', bandwidth: 1000000 };
        foundQualities.set(norm, {
          quality: norm,
          label: def.label,
          desc: def.desc,
          url: url || baseUrl,
          bandwidth: bandwidth || def.bandwidth
        });
      } else if (bandwidth && bandwidth > foundQualities.get(norm).bandwidth) {
        foundQualities.get(norm).bandwidth = bandwidth;
        if (url) foundQualities.get(norm).url = url;
      }
    }

    // 1. Inspect DOM player control quality items
    try {
      let root = null;
      if (videoEl) {
        if (typeof videoEl.closest === 'function') {
          root = videoEl.closest('.player-container, #player, .film-player, .vjs-player, .jwplayer, .plyr, #player-wrapper, #player-container, .player, .video-player');
        }
        if (!root && (videoEl.parentElement || videoEl.parent)) {
          root = videoEl.parentElement || videoEl.parent;
        }
      }
      if (!root && typeof document !== 'undefined') {
        root = document;
      }
      if (root) {
        const qualitySelectors = [
          '.vjs-quality-selector .vjs-menu-item',
          '.vjs-resolution-button .vjs-menu-item',
          '.plyr__menu [data-plyr="quality"]',
          '.jw-settings-content-item[data-jw-enum="quality"]',
          '.art-control-quality-item',
          '.dplayer-quality-item',
          '[aria-label*="Quality" i] button',
          '[data-quality]',
          '.quality-item',
          '.btn-quality'
        ];
        const items = root.querySelectorAll(qualitySelectors.join(', '));
        if (items && items.length > 0) {
          items.forEach(el => {
            const txt = (el.getAttribute('data-quality') || el.textContent || '').trim();
            if (txt && !/auto/i.test(txt)) {
              registerQuality(txt);
            }
          });
        }
      }
    } catch (e) {}

    // 2. Inspect Player instance API (Hls.js, JWPlayer, Video.js)
    try {
      const hlsInst = (videoEl && videoEl.__hls__) || (typeof window !== 'undefined' ? window.hls : null);
      if (hlsInst && Array.isArray(hlsInst.levels) && hlsInst.levels.length > 0) {
        hlsInst.levels.forEach(lvl => {
          if (lvl && lvl.height) {
            let streamUrl = lvl.url || baseUrl;
            if (Array.isArray(streamUrl)) streamUrl = streamUrl[0];
            registerQuality(lvl.height + 'p', streamUrl, lvl.bitrate);
          }
        });
      }
    } catch (e) {}

    try {
      if (typeof window !== 'undefined' && typeof window.jwplayer === 'function') {
        const jw = window.jwplayer();
        if (jw && typeof jw.getQualityLevels === 'function') {
          const levels = jw.getQualityLevels() || [];
          levels.forEach(lvl => {
            const lbl = (lvl && lvl.label) ? String(lvl.label) : '';
            if (lbl && !/auto/i.test(lbl)) {
              registerQuality(lbl);
            }
          });
        }
      }
    } catch (e) {}

    // 3. Inspect <source> tags on video element
    try {
      if (videoEl && videoEl.querySelectorAll) {
        const sources = videoEl.querySelectorAll('source');
        if (sources && sources.length > 1) {
          sources.forEach(s => {
            const label = s.getAttribute('label') || s.getAttribute('size') || s.getAttribute('title') || s.getAttribute('res') || '';
            const src = s.src || s.getAttribute('src');
            if (label) {
              registerQuality(label, src);
            }
          });
        }
      }
    } catch (e) {}

    // 4. Inspect HLS Master Playlist if provided
    if (playlistText && playlistText.includes('#EXT-X-STREAM-INF')) {
      const lines = playlistText.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-STREAM-INF')) {
          let j = i + 1;
          while (j < lines.length && (!lines[j].trim() || lines[j].trim().startsWith('#'))) j++;
          if (j < lines.length) {
            let streamUrl = lines[j].trim();
            try {
              streamUrl = new URL(streamUrl, baseUrl).href;
            } catch (e) {}
            const resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
            const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
            const bw = bwMatch ? parseInt(bwMatch[1], 10) : null;
            const height = resMatch ? parseInt(resMatch[1], 10) : 0;
            if (height > 0) {
              registerQuality(height + 'p', streamUrl, bw);
            } else if (/1080/i.test(lines[j])) {
              registerQuality('1080p', streamUrl, bw);
            } else if (/720/i.test(lines[j])) {
              registerQuality('720p', streamUrl, bw);
            } else if (/480/i.test(lines[j])) {
              registerQuality('480p', streamUrl, bw);
            }
          }
        }
      }
    }

    // 5. Inspect __fg_stream_data__ bridge or DOM scripts for direct MP4 and HLS sources
    try {
      if (typeof document !== 'undefined') {
        const dataEl = document.getElementById('__fg_stream_data__');
        if (dataEl && dataEl.textContent) {
          const payload = JSON.parse(dataEl.textContent);
          if (payload.mp4Streams && typeof payload.mp4Streams === 'object') {
            if (Array.isArray(payload.mp4Streams)) {
              payload.mp4Streams.forEach(url => {
                const qMatch = url.match(/(2160|1440|1080|720|480|360|240)p?/i);
                if (qMatch) registerQuality(qMatch[1] + 'p', url);
              });
            } else {
              Object.keys(payload.mp4Streams).forEach(qKey => {
                registerQuality(qKey, payload.mp4Streams[qKey]);
              });
            }
          }
        }

        const initialsScript = document.getElementById('initials') || document.querySelector('script[data-initials]');
        if (initialsScript && initialsScript.textContent) {
          const cleanText = initialsScript.textContent.replace(/\\/g, '');
          const mp4Matches = cleanText.match(/https?:\/\/[^"'\s\\]+?\.(?:mp4|webm)[^"'\s\\]*/g);
          if (mp4Matches) {
            mp4Matches.forEach(url => {
              const qMatch = url.match(/(2160|1440|1080|720|480|360|240)p?/i);
              if (qMatch) registerQuality(qMatch[1] + 'p', url);
            });
          }
        }
      }
    } catch (e) {}

    const sortOrder = ['4K', '1440p', '1080p', '720p', '480p', '360p', '240p'];
    const result = [];
    for (const q of sortOrder) {
      if (foundQualities.has(q)) {
        const item = foundQualities.get(q);
        const totalBytes = (item.bandwidth / 8) * duration;
        result.push({
          quality: item.quality,
          label: item.label,
          desc: item.desc,
          url: item.url,
          bandwidth: item.bandwidth,
          estimatedBytes: totalBytes,
          dataSize: formatDataSize(totalBytes)
        });
      }
    }

    return result;
  }

  try {
    if (typeof window !== 'undefined') {
      window.__focusguard_get_available_qualities__ = getAvailableQualities;
      window.__focusguard_resolve_active_stream__ = resolveActiveStreamUrl;
      window.__focusguard_parse_playlist__ = parseMasterPlaylist;
      window.__focusguard_parse_byterange__ = parseHlsByteRange;
      window.__focusguard_format_size__ = formatDataSize;
    }
  } catch (e) {}

  // Mount cyber-sleek download button directly onto player container
  function mountDownloadButton(targetOrVideo) {
    if (!isEnabled() || !targetOrVideo) return;

    let container = null;
    let videoEl = null;

    if (targetOrVideo.tagName === 'VIDEO') {
      videoEl = targetOrVideo;
      container = findBestPlayerContainer(videoEl);
    } else {
      container = targetOrVideo;
      videoEl = container.querySelector('video') || activeVideo;
    }

    if (!container) return;

    if (container.querySelector('#focusguard-download-btn')) {
      updateDownloadButtonLabel(container.querySelector('#focusguard-download-btn'), videoEl);
      return;
    }

    try {
      const compStyle = window.getComputedStyle(container);
      if (compStyle.position === 'static') {
        container.style.position = 'relative';
      }
    } catch (e) {}

    const host = document.createElement('div');
    host.className = 'fg-download-btn-host fg-btn-visible';
    host.id = 'focusguard-download-btn-host';
    host.__fg_video__ = videoEl;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'focusguard-download-btn';
    btn.className = 'fg-player-download-btn';
    btn.setAttribute('aria-label', 'Download Video');
    btn.__fg_video__ = videoEl;

    const meta = getEpisodeMetadata(document, null, videoEl);
    btn.title = meta.isEpisode
      ? `Download Episode ${meta.episodeNum} (${meta.filename})`
      : `Download Video (${meta.filename})`;

    const badgeText = meta.isEpisode ? `EP ${meta.episodeNum}` : (meta.quality || 'HD');

    btn.innerHTML = `
      <span class="fg-player-download-icon">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </span>
      <span class="fg-player-download-label">Download</span>
      <span class="fg-player-download-badge" id="fg-download-ep-badge">${badgeText}</span>
    `;

    let lastDownloadClick = 0;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const now = Date.now();
      if (now - lastDownloadClick < 1200) {
        return; // Ignore rapid double clicks
      }
      lastDownloadClick = now;

      if (isDownloading) {
        showHud('⏳', 'Download already in progress...', { isDownload: true, duration: 2000 });
        return;
      }

      const v = (btn && btn.__fg_video__) || (host && host.__fg_video__) || activeVideo;
      const streamTarget = (typeof resolveActiveStreamUrl === 'function')
        ? resolveActiveStreamUrl(v)
        : ((typeof window !== 'undefined' && typeof window.__focusguard_resolve_active_stream__ === 'function')
            ? window.__focusguard_resolve_active_stream__(v)
            : null);

      let available = [];
      try {
        const getQualitiesFn = (typeof getAvailableQualities === 'function')
          ? getAvailableQualities
          : ((typeof window !== 'undefined' && typeof window.__focusguard_get_available_qualities__ === 'function')
              ? window.__focusguard_get_available_qualities__
              : null);
        if (getQualitiesFn) {
          available = getQualitiesFn(v, cachedPlaylistText, streamTarget);
        }
      } catch (qErr) {
        console.warn('[FocusGuard] Quality detection failed:', qErr);
      }

      // If multiple qualities actually exist on the player control, show quality selector
      if (available && available.length > 1) {
        toggleQualityPopover(host, btn);
      } else {
        // If not available, directly download at max quality possible as per the video!
        downloadActiveVideo('max', null, v);
      }
    });

    host.appendChild(btn);

    const overlayLayer = container.querySelector('#player-overlay-actions, .jw-overlays, .vjs-custom-overlay');
    if (overlayLayer) {
      overlayLayer.appendChild(host);
    } else {
      container.appendChild(host);
    }

    // Auto-hide when player is playing and mouse is idle
    let idleTimer = null;
    function resetActivity() {
      host.classList.remove('fg-btn-autohide');
      host.classList.add('fg-btn-visible');
      if (idleTimer) clearTimeout(idleTimer);
      if (videoEl && !videoEl.paused) {
        idleTimer = setTimeout(() => {
          if (videoEl && !videoEl.paused && !host.matches(':hover')) {
            host.classList.add('fg-btn-autohide');
            host.classList.remove('fg-btn-visible');
          }
        }, 3000);
      }
    }

    container.addEventListener('mousemove', resetActivity);
    container.addEventListener('touchstart', resetActivity, { passive: true });
    container.addEventListener('pointerdown', resetActivity, { passive: true });
    container.addEventListener('click', resetActivity, { passive: true });

    if (videoEl) {
      videoEl.addEventListener('play', resetActivity);
      videoEl.addEventListener('pause', () => {
        host.classList.remove('fg-btn-autohide');
        host.classList.add('fg-btn-visible');
      });
      videoEl.addEventListener('touchstart', resetActivity, { passive: true });
      videoEl.addEventListener('pointerdown', resetActivity, { passive: true });
    }
  }

  function updateDownloadButtonLabel(btn, targetVideo = null) {
    if (!btn) return;
    const v = targetVideo || btn.__fg_video__ || activeVideo;
    const meta = getEpisodeMetadata(null, null, v);
    const badge = btn.querySelector('#fg-download-ep-badge');
    const badgeText = meta.isEpisode ? `EP ${meta.episodeNum}` : (meta.quality || 'HD');
    if (badge && badge.textContent !== badgeText) {
      badge.textContent = badgeText;
    }
    const titleText = meta.isEpisode
      ? `Download Episode ${meta.episodeNum} (${meta.filename})`
      : `Download Video (${meta.filename})`;
    if (btn.title !== titleText) {
      btn.title = titleText;
    }
  }

  function checkAndMountPlayerDownloadButton() {
    if (!isEnabled()) return;
    // 1. Scan and mount on all discovered videos across DOM and Shadow DOMs
    const videos = getAllVideos(document);
    videos.forEach((v) => {
      mountDownloadButton(v);
    });

    // 2. Scan and mount on candidate embedded player iframes or their containers
    const iframes = document.querySelectorAll(
      'iframe[src*="embed"], iframe[src*="player"], iframe[src*="video"], iframe[src*="stream"], iframe[src*="vidsrc"], iframe[src*="megacloud"], iframe[src*="rapid-cloud"], iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="dailymotion"], iframe[allow*="fullscreen"], iframe[allowfullscreen], #iframe-embed, .film-player iframe'
    );
    iframes.forEach((ifr) => {
      const playerWrapper = ifr.closest('#player-wrapper, .player-container, #player, .film-player, [class*="player"], [id*="player"]') || ifr.parentElement;
      if (playerWrapper && !playerWrapper.querySelector('#focusguard-download-btn')) {
        mountDownloadButton(playerWrapper);
      }
    });
  }

  // Trigger file download via chrome.downloads or synthetic anchor fallback
  function triggerFileSave(target, filename) {
    if (!target) return;

    let cleanFilename = filename ? String(filename).trim() : 'video.mp4';
    if (cleanFilename.toLowerCase().endsWith('.json') || cleanFilename.toLowerCase().endsWith('.nfo') || cleanFilename.toLowerCase().endsWith('.txt')) {
      // Preserve companion metadata and subtitle extensions
    } else {
      cleanFilename = cleanFilename.replace(/\.(m4s|ts|m3u8|mpd)$/i, '');
      if (!cleanFilename.toLowerCase().endsWith('.mp4') && !cleanFilename.toLowerCase().endsWith('.ts')) {
        cleanFilename += '.mp4';
      }
    }
    filename = cleanFilename;

    // Case 1: Extension-assembled Blob object
    if (target instanceof Blob || (typeof Blob !== 'undefined' && target instanceof Blob)) {
      saveBlobDirectlyOrDelegate(target, filename);
      return;
    }

    // Case 2: String URL or string Blob URL
    if (typeof target === 'string') {
      // Safety check: Never try to download an external MediaSource blob URL directly
      if (target.startsWith('blob:') && (target.includes('megaplay.buzz') || target.includes('vidsrc') || target.includes('rapid-cloud') || target.includes('megacloud'))) {
        console.warn('[FocusGuard] Ignoring raw MediaSource blob URL in triggerFileSave:', target);
        return;
      }

      // Local Blob URL created by our extension
      if (target.startsWith('blob:')) {
        fallbackAnchorDownload(target, filename);
        return;
      }

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          chrome.runtime.sendMessage({
            action: 'download_video',
            url: target,
            filename: filename
          }, (res) => {
            if (chrome.runtime.lastError || (res && !res.success)) {
              fallbackAnchorDownload(target, filename);
            }
          });
          return;
        } catch (e) {}
      }
      fallbackAnchorDownload(target, filename);
    }
  }

  // Deduplication caches to eliminate duplicate downloads within rapid cooldown
  const recentSavedBlobs = new Map();
  function isRecentlySaved(key) {
    const now = Date.now();
    for (const [k, ts] of recentSavedBlobs.entries()) {
      if (now - ts > 10000) recentSavedBlobs.delete(k);
    }
    if (recentSavedBlobs.has(key) && (now - recentSavedBlobs.get(key) < 5000)) {
      return true;
    }
    recentSavedBlobs.set(key, now);
    return false;
  }

  const recentAnchorDownloads = new Map();
  function isRecentlyAnchorDownloaded(key) {
    const now = Date.now();
    for (const [k, ts] of recentAnchorDownloads.entries()) {
      if (now - ts > 10000) recentAnchorDownloads.delete(k);
    }
    if (recentAnchorDownloads.has(key) && (now - recentAnchorDownloads.get(key) < 4000)) {
      return true;
    }
    recentAnchorDownloads.set(key, now);
    return false;
  }

  // Delegates blob saving to top-level window if inside iframe, or downloads directly
  function saveBlobDirectlyOrDelegate(blob, filename) {
    if (!blob) return;

    // Deduplication check: drop duplicate save requests within cooldown
    const saveKey = filename || 'video.mp4';
    if (isRecentlySaved(saveKey)) {
      console.warn('[FocusGuard] Prevented duplicate blob save within cooldown for:', filename);
      return;
    }

    // If running inside a child frame / player iframe, delegate to top window so sandbox never blocks anchor download
    if (typeof window !== 'undefined' && window !== window.top) {
      try {
        window.top.postMessage({
          type: 'FOCUSGUARD_SAVE_BLOB',
          blob: blob,
          filename: filename
        }, '*');
        return;
      } catch (e) {
        console.warn('[FocusGuard] Could not postMessage blob to top window, trying local fallback:', e);
      }
    }

    try {
      const url = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(blob) : (blob.objectUrl || '');
      if (url) {
        fallbackAnchorDownload(url, filename);
        setTimeout(() => {
          try {
            if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
              URL.revokeObjectURL(url);
            }
          } catch (e) {}
        }, 12000);
      }
    } catch (err) {
      console.error('[FocusGuard] saveBlobDirectlyOrDelegate error:', err);
    }
  }

  function fallbackAnchorDownload(url, filename) {
    try {
      const dlKey = filename || (String(url).slice(-32));
      if (isRecentlyAnchorDownloaded(dlKey)) {
        console.warn('[FocusGuard] Prevented duplicate anchor download within cooldown for:', filename);
        return;
      }

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.setAttribute('data-focusguard-download', 'true');
      a.style.display = 'none';
      (document.body || document.documentElement).appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 2000);
    } catch (e) {}
  }

  // Off-thread native base64 decoder: decodes data URLs in browser C++ networking / Buffer in Node
  // completely eliminating multi-million iteration synchronous charCodeAt loops on the JS main thread
  async function decodeBase64ToArrayBuffer(base64Str) {
    if (!base64Str) return new ArrayBuffer(0);
    if (typeof fetch === 'function') {
      try {
        const res = await fetch('data:application/octet-stream;base64,' + base64Str);
        return await res.arrayBuffer();
      } catch (e) {}
    }
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
      const buf = Buffer.from(base64Str, 'base64');
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
    if (typeof Uint8Array !== 'undefined' && typeof Uint8Array.fromBase64 === 'function') {
      return Uint8Array.fromBase64(base64Str).buffer;
    }
    const binaryString = atob(base64Str);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Fetch stream resource safely: attempts direct fetch first (leveraging declarativeNetRequest headers),
  // and falls back gracefully to background proxy to guarantee zero HTTP 403 Forbidden without memory bloat.
  async function fetchResourceSafe(url, embedUrl = null, asBinary = false, byteRange = null) {
    let effectiveEmbed = embedUrl || detectedEmbedUrl;
    if (!effectiveEmbed) {
      if (window !== window.top) {
        effectiveEmbed = window.location.href;
      } else {
        const ifr = document.querySelector('iframe[src*="megacloud"], iframe[src*="rapid-cloud"], iframe[src*="embed"], iframe[src*="vidsrc"], iframe[src*="rabbitstream"], iframe[src*="player"], iframe[src*="stream"], iframe[src*="video"], .film-player iframe, #iframe-embed');
        if (ifr && (ifr.src || ifr.getAttribute('data-src') || ifr.getAttribute('data-url'))) {
          effectiveEmbed = ifr.src || ifr.getAttribute('data-src') || ifr.getAttribute('data-url');
        }
      }
    }
    if (!effectiveEmbed) effectiveEmbed = window.location.href;

    // Fast-path: Direct fetch attempt (bypasses IPC, avoids base64 memory overhead, DNR rules attach headers)
    if (typeof fetch === 'function') {
      const fetchOpts = {};
      if (byteRange) {
        fetchOpts.headers = { 'Range': `bytes=${byteRange}` };
      }
      const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      let timer = null;
      if (controller) {
        fetchOpts.signal = controller.signal;
        timer = setTimeout(() => {
          try { controller.abort(); } catch (e) {}
        }, 15000);
      }
      try {
        const res = await fetch(url, fetchOpts);
        if (res && res.ok) {
          return asBinary ? await res.arrayBuffer() : await res.text();
        }
      } catch (directErr) {
        // Direct fetch failed or restricted by CORS; fallback to background proxy below
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    // Resilient fallback: Background proxy via service worker
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        const res = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            action: 'fetch_stream_data',
            url: url,
            embedUrl: effectiveEmbed,
            asBinary: asBinary,
            byteRange: byteRange
          }, (response) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(response || { success: false, error: 'Empty background response' });
            }
          });
        });

        if (res && res.success) {
          if (asBinary && res.base64) {
            return await decodeBase64ToArrayBuffer(res.base64);
          }
          if (!asBinary && res.text) {
            return res.text;
          }
        }
      } catch (err) {}
    }

    throw new Error(`Failed to fetch stream resource: ${url}`);
  }

  // Toggles the quality selector popover directly beneath the download button
  function toggleQualityPopover(host, btn) {
    if (!host) return;
    const existing = host.querySelector('.fg-quality-popover');
    if (existing) {
      if (existing.classList.contains('fg-popover-open')) {
        closeQualityPopover(existing);
      } else {
        openQualityPopover(existing, host, btn);
      }
      return;
    }

    const popover = document.createElement('div');
    popover.className = 'fg-quality-popover';
    host.appendChild(popover);

    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => openQualityPopover(popover, host, btn));
    } else {
      openQualityPopover(popover, host, btn);
    }
  }

  function openQualityPopover(popover, host, btn) {
    if (!popover) return;
    renderQualityPopoverContent(popover, host, btn);
    popover.classList.add('fg-popover-open');

    function onOutsideClick(e) {
      if (host && !host.contains(e.target)) {
        closeQualityPopover(popover);
        if (typeof document !== 'undefined') {
          document.removeEventListener('click', onOutsideClick, true);
        }
      }
    }
    setTimeout(() => {
      if (typeof document !== 'undefined') {
        document.addEventListener('click', onOutsideClick, true);
      }
    }, 20);
  }

  function closeQualityPopover(popover) {
    if (!popover) return;
    popover.classList.remove('fg-popover-open');
  }

  function renderQualityPopoverContent(popover, host, btn) {
    if (!popover) return;
    const targetVideo = (btn && btn.__fg_video__) || (host && host.__fg_video__) || activeVideo;
    const meta = getEpisodeMetadata(null, '1080p', targetVideo);
    const duration = (targetVideo && !isNaN(targetVideo.duration) && targetVideo.duration > 30) ? targetVideo.duration : 1440;
    const streamTarget = (targetVideo && targetVideo.__fg_stream_url__) || detectedStreamUrl || (targetVideo ? (targetVideo.currentSrc || targetVideo.src) : null) || (typeof window !== 'undefined' ? window.location.href : '');
    let available = [];
    try {
      const getQualitiesFn = (typeof getAvailableQualities === 'function')
        ? getAvailableQualities
        : ((typeof window !== 'undefined' && typeof window.__focusguard_get_available_qualities__ === 'function')
            ? window.__focusguard_get_available_qualities__
            : null);
      if (getQualitiesFn) {
        available = getQualitiesFn(targetVideo, cachedPlaylistText, streamTarget, duration);
      }
    } catch (e) {}
    const tiers = (available && available.length > 0) ? available : parseMasterPlaylist(cachedPlaylistText, streamTarget, duration);

    let itemsHtml = '';
    tiers.forEach((tier) => {
      const tierClass = tier.quality === '4K' || tier.quality === '1080p' ? 'fg-tier-1080' :
                        tier.quality === '1440p' || tier.quality === '720p' ? 'fg-tier-720' : 'fg-tier-480';
      itemsHtml += `
        <div class="fg-quality-item" data-quality="${tier.quality}" role="button" tabindex="0">
          <div class="fg-quality-item-left">
            <span class="fg-quality-tier-badge ${tierClass}">${tier.quality}</span>
            <div class="fg-quality-label-wrap">
              <span class="fg-quality-tier-name">${tier.label}</span>
              <span class="fg-quality-tier-desc">${tier.desc}</span>
            </div>
          </div>
          <div class="fg-quality-item-right">
            <span class="fg-quality-data-badge">${tier.dataSize}</span>
            <span class="fg-quality-arrow">⬇</span>
          </div>
        </div>
      `;
    });

    const epPill = meta.isEpisode ? `EP ${meta.episodeNum}` : (meta.quality || 'HD');

    popover.innerHTML = `
      <div class="fg-quality-header">
        <div class="fg-quality-header-left">
          <span class="fg-quality-title">Choose Quality</span>
          <span class="fg-quality-ep-pill">${epPill}</span>
        </div>
        <button type="button" class="fg-quality-close-btn" aria-label="Close quality selector">✕</button>
      </div>
      <div class="fg-quality-list">
        ${itemsHtml}
      </div>
      <div class="fg-quality-footer">Estimated internet data required</div>
    `;

    const closeBtn = popover.querySelector('.fg-quality-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeQualityPopover(popover);
      });
    }

    const items = popover.querySelectorAll('.fg-quality-item');
    items.forEach((item) => {
      const q = item.getAttribute('data-quality');
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeQualityPopover(popover);
        if (isDownloading) {
          showHud('⏳', 'Download already in progress...', { isDownload: true, duration: 2000 });
          return;
        }
        downloadActiveVideo(q, null, targetVideo);
      });
    });
  }

  // Helper: Convert hex string to Uint8Array for AES-128 IV
  function hexToUint8Array(hex) {
    if (!hex) return new Uint8Array(16);
    let clean = String(hex).replace(/^0x/i, '').trim();
    if (clean.length % 2 !== 0) clean = '0' + clean;
    const arr = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      arr[i / 2] = parseInt(clean.substr(i, 2), 16);
    }
    return arr;
  }

  // Helper: Construct 16-byte big-endian IV from sequence number (RFC 8216)
  function makeSequenceIv(seq) {
    const iv = new Uint8Array(16);
    const view = new DataView(iv.buffer);
    view.setUint32(12, (seq || 0) >>> 0, false);
    return iv;
  }

  // Key cache for AES-128 HLS streams
  const hlsKeyCache = new Map();
  async function getCryptoKey(keyUrl, embedUrl) {
    if (hlsKeyCache.has(keyUrl)) {
      return hlsKeyCache.get(keyUrl);
    }
    const keyBuf = await fetchResourceSafe(keyUrl, embedUrl, true);
    if (!keyBuf || keyBuf.byteLength < 16) {
      throw new Error('Invalid encryption key length: ' + (keyBuf ? keyBuf.byteLength : 0));
    }
    const keyBytes = keyBuf.byteLength === 16 ? keyBuf : keyBuf.slice(0, 16);
    const subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
    if (!subtle) {
      throw new Error('Web Crypto API not available for AES-128 decryption');
    }
    const cryptoKey = await subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
    hlsKeyCache.set(keyUrl, cryptoKey);
    return cryptoKey;
  }

  // Helper: Decrypt AES-128 CBC segment
  async function decryptSegmentData(buffer, cryptoKey, iv) {
    const subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
    if (!subtle || !cryptoKey || !iv) return buffer;
    try {
      return await subtle.decrypt({ name: 'AES-CBC', iv: iv }, cryptoKey, buffer);
    } catch (err) {
      console.warn('[FocusGuard] Segment decryption error:', err);
      return buffer;
    }
  }

  // ============================================================================
  // FOCUSGUARD SMOOTH VLC PLAYBACK & MEDIA METADATA SUITE
  // Normalizes PTS/DTS timestamps, eliminates fragment gaps, embeds container tags,
  // remuxes MPEG-TS into standard ISO BMFF MP4, and exports companion metadata.
  // ============================================================================

  function detectStreamFormat(sampleOrBuffers) {
    if (!sampleOrBuffers) return 'unknown';
    let sample = sampleOrBuffers;
    if (Array.isArray(sampleOrBuffers)) {
      sample = sampleOrBuffers.find(b => b && (b.byteLength || b.length) > 0);
      if (!sample) return 'unknown';
    }
    const u8 = sample instanceof Uint8Array
      ? sample
      : (sample.buffer ? new Uint8Array(sample.buffer, sample.byteOffset || 0, sample.byteLength || sample.length) : new Uint8Array(sample));
    if (u8.length < 8) return 'unknown';

    // 1. MPEG-TS: 188-byte packets starting with 0x47 sync byte
    if (u8[0] === 0x47 && (u8.length < 376 || u8[188] === 0x47)) {
      return 'mpegts';
    }

    // 2. ISO BMFF (fMP4 / MP4): box type at offset 4 ('ftyp', 'moov', 'moof', 'styp', 'free', 'mdat')
    const boxType = String.fromCharCode(u8[4], u8[5], u8[6], u8[7]);
    if (['ftyp', 'moov', 'moof', 'styp', 'free', 'mdat', 'sidx'].includes(boxType)) {
      return 'isobmff';
    }

    return 'unknown';
  }

  // Exp-Golomb BitReader for SPS (Sequence Parameter Set) parsing
  class BitReader {
    constructor(u8) {
      this.u8 = u8;
      this.byteOffset = 0;
      this.bitOffset = 0;
    }
    readBit() {
      if (this.byteOffset >= this.u8.length) return 0;
      const bit = (this.u8[this.byteOffset] >> (7 - this.bitOffset)) & 1;
      this.bitOffset++;
      if (this.bitOffset === 8) {
        this.bitOffset = 0;
        this.byteOffset++;
      }
      return bit;
    }
    readBits(n) {
      let val = 0;
      for (let i = 0; i < n; i++) val = (val << 1) | this.readBit();
      return val;
    }
    readUE() {
      let leadingZeros = 0;
      while (this.readBit() === 0 && leadingZeros < 32) leadingZeros++;
      if (leadingZeros === 0) return 0;
      const rest = this.readBits(leadingZeros);
      return (1 << leadingZeros) - 1 + rest;
    }
    readSE() {
      const val = this.readUE();
      return (val & 1) ? ((val + 1) >> 1) : -(val >> 1);
    }
  }

  function parseSps(spsBytes) {
    if (!spsBytes || spsBytes.length < 4) return null;
    try {
      // Strip emulation prevention bytes 0x00 0x00 0x03 -> 0x00 0x00
      const clean = [];
      for (let i = 0; i < spsBytes.length; i++) {
        if (i + 2 < spsBytes.length && spsBytes[i] === 0 && spsBytes[i+1] === 0 && spsBytes[i+2] === 3) {
          clean.push(0, 0);
          i += 2;
        } else {
          clean.push(spsBytes[i]);
        }
      }
      const u8 = new Uint8Array(clean);
      const reader = new BitReader(u8);
      reader.readBits(8); // NAL header
      const profileIdc = reader.readBits(8);
      const constraintFlags = reader.readBits(8);
      const levelIdc = reader.readBits(8);
      reader.readUE(); // seq_parameter_set_id

      if ([100, 110, 122, 244, 44, 83, 86, 118, 128].includes(profileIdc)) {
        const chroma = reader.readUE();
        if (chroma === 3) reader.readBit();
        reader.readUE(); // bit_depth_luma
        reader.readUE(); // bit_depth_chroma
        reader.readBit();
        const seqScaling = reader.readBit();
        if (seqScaling) {
          const count = (chroma !== 3) ? 8 : 12;
          for (let i = 0; i < count; i++) {
            if (reader.readBit()) {
              const size = (i < 6) ? 16 : 64;
              let last = 8, next = 8;
              for (let j = 0; j < size; j++) {
                if (next !== 0) {
                  const delta = reader.readSE();
                  next = (last + delta + 256) % 256;
                }
                last = (next === 0) ? last : next;
              }
            }
          }
        }
      }

      reader.readUE(); // log2_max_frame_num_minus4
      const picOrderCntType = reader.readUE();
      if (picOrderCntType === 0) {
        reader.readUE();
      } else if (picOrderCntType === 1) {
        reader.readBit();
        reader.readSE();
        reader.readSE();
        const numRef = reader.readUE();
        for (let i = 0; i < numRef; i++) reader.readSE();
      }

      reader.readUE(); // max_num_ref_frames
      reader.readBit();
      const picWidthInMbsMinus1 = reader.readUE();
      const picHeightInMapUnitsMinus1 = reader.readUE();
      const frameMbsOnlyFlag = reader.readBit();
      if (!frameMbsOnlyFlag) reader.readBit();
      reader.readBit();

      let cropLeft = 0, cropRight = 0, cropTop = 0, cropBottom = 0;
      if (reader.readBit()) {
        cropLeft = reader.readUE();
        cropRight = reader.readUE();
        cropTop = reader.readUE();
        cropBottom = reader.readUE();
      }

      const width = ((picWidthInMbsMinus1 + 1) * 16) - (cropLeft + cropRight) * 2;
      const height = ((2 - frameMbsOnlyFlag) * (picHeightInMapUnitsMinus1 + 1) * 16) - (cropTop + cropBottom) * 2;
      return { profileIdc, constraintFlags, levelIdc, width, height };
    } catch (e) {
      return null;
    }
  }

  // ISO BMFF MP4 Box Utilities
  function createMp4Box(type, ...rawPayloads) {
    const payloads = [];
    function flatten(list) {
      for (const item of list) {
        if (!item) continue;
        if (Array.isArray(item)) flatten(item);
        else payloads.push(item);
      }
    }
    flatten(rawPayloads);

    let payloadLen = 0;
    for (const p of payloads) {
      if (!p) continue;
      if (p instanceof Uint8Array || p instanceof ArrayBuffer) {
        payloadLen += p.byteLength;
      } else if (typeof p === 'string') {
        payloadLen += p.length;
      }
    }
    const size = 8 + payloadLen;
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    view.setUint32(0, size, false);
    for (let i = 0; i < 4; i++) {
      out[4 + i] = type.charCodeAt(i);
    }
    let offset = 8;
    for (const p of payloads) {
      if (!p) continue;
      if (p instanceof Uint8Array) {
        out.set(p, offset);
        offset += p.byteLength;
      } else if (p instanceof ArrayBuffer) {
        out.set(new Uint8Array(p), offset);
        offset += p.byteLength;
      } else if (typeof p === 'string') {
        for (let i = 0; i < p.length; i++) {
          out[offset + i] = p.charCodeAt(i);
        }
        offset += p.length;
      }
    }
    return out;
  }

  function createDataAtom(content, isNumeric = false) {
    const enc = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : { encode: s => Buffer.from(s, 'utf8') };
    const bytes = isNumeric
      ? (content instanceof Uint8Array ? content : new Uint8Array([0, 0, (content >> 8) & 0xff, content & 0xff]))
      : enc.encode(String(content || ''));
    const header = new Uint8Array(8);
    const view = new DataView(header.buffer);
    view.setUint32(0, isNumeric ? 0 : 1, false); // 1 = UTF-8, 0 = numeric
    view.setUint32(4, 0, false);
    return createMp4Box('data', header, bytes);
  }

  function buildIlstMetadataBox(meta = {}) {
    const atoms = [];
    const title = (meta && (meta.title || meta.filename)) || '';
    if (title) atoms.push(createMp4Box('©nam', createDataAtom(title)));
    const artist = (meta && (meta.animeTitle || meta.showTitle || meta.artist)) || '';
    if (artist) {
      atoms.push(createMp4Box('©ART', createDataAtom(artist)));
      atoms.push(createMp4Box('©alb', createDataAtom(artist)));
    }
    const rawEp = meta && (meta.episodeNum || meta.episodeNumber || meta.episode);
    if (rawEp) {
      const epNum = parseInt(rawEp, 10) || 1;
      const trknBytes = new Uint8Array([0, 0, (epNum >> 8) & 0xff, epNum & 0xff, 0, 0, 0, 0]);
      atoms.push(createMp4Box('trkn', createDataAtom(trknBytes, true)));
    }
    atoms.push(createMp4Box('©cmt', createDataAtom('FocusGuard Downloader - Smooth VLC Playback')));
    if (meta && meta.quality) atoms.push(createMp4Box('desc', createDataAtom(`Quality: ${meta.quality}`)));
    const ilst = createMp4Box('ilst', ...atoms);
    const hdlr = createMp4Box('hdlr', new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0x6d, 0x64, 0x69, 0x72, 0x61, 0x70, 0x70, 0x6c, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    const metaBox = createMp4Box('meta', new Uint8Array([0, 0, 0, 0]), hdlr, ilst);
    return createMp4Box('udta', metaBox);
  }

  function createAvcC(sps, pps) {
    const profile = sps[1];
    const compat = sps[2];
    const level = sps[3];
    const totalLen = 11 + sps.byteLength + pps.byteLength;
    const out = new Uint8Array(totalLen);
    out[0] = 1; // configVersion
    out[1] = profile;
    out[2] = compat;
    out[3] = level;
    out[4] = 0xff; // 4-byte NALU length (3 | 0xfc)
    out[5] = 0xe1; // 1 SPS (1 | 0xe0)
    out[6] = (sps.byteLength >> 8) & 0xff;
    out[7] = sps.byteLength & 0xff;
    out.set(sps, 8);
    let off = 8 + sps.byteLength;
    out[off++] = 1; // 1 PPS
    out[off++] = (pps.byteLength >> 8) & 0xff;
    out[off++] = pps.byteLength & 0xff;
    out.set(pps, off);
    return out;
  }

  function createEsds(asc) {
    const totalLen = 4 + 3 + 2 + 1 + 3 + 13 + 3 + asc.byteLength + 3;
    const out = new Uint8Array(totalLen);
    let off = 0;
    out[off++] = 0; out[off++] = 0; out[off++] = 0; out[off++] = 0; // version 0, flags 0
    out[off++] = 0x03; // ES_Descriptor tag
    out[off++] = 20 + asc.byteLength + 3;
    out[off++] = 0; out[off++] = 1; // ES_ID = 1
    out[off++] = 0;
    out[off++] = 0x04; // DecoderConfigDescriptor tag
    out[off++] = 15 + asc.byteLength;
    out[off++] = 0x40; // Audio AAC
    out[off++] = 0x15; // Audio stream
    out[off++] = 0; out[off++] = 0; out[off++] = 0;
    out[off++] = 0; out[off++] = 2; out[off++] = 0; out[off++] = 0;
    out[off++] = 0; out[off++] = 2; out[off++] = 0; out[off++] = 0;
    out[off++] = 0x05; // DecSpecificInfo tag
    out[off++] = asc.byteLength;
    out.set(asc, off);
    off += asc.byteLength;
    out[off++] = 0x06; // SLConfigDescriptor tag
    out[off++] = 1;
    out[off++] = 0x02;
    return out;
  }

  function createMfhd(seq) {
    const p = new Uint8Array(8);
    new DataView(p.buffer).setUint32(4, seq, false);
    return createMp4Box('mfhd', p);
  }

  function createTfhd(trackId) {
    const p = new Uint8Array(8);
    const v = new DataView(p.buffer);
    v.setUint32(0, 0x00020000, false); // default-base-is-moof
    v.setUint32(4, trackId, false);
    return createMp4Box('tfhd', p);
  }

  function createTfdt(baseDecodeTime) {
    const p = new Uint8Array(12);
    const v = new DataView(p.buffer);
    v.setUint8(0, 1); // version 1 (64-bit)
    v.setUint32(4, Math.floor(baseDecodeTime / 0x100000000), false);
    v.setUint32(8, baseDecodeTime >>> 0, false);
    return createMp4Box('tfdt', p);
  }

  function createTrun(samples, hasCto = false, dataOffset = 0) {
    const flags = 0x000001 | 0x000100 | 0x000200 | 0x000400 | (hasCto ? 0x000800 : 0);
    const sampleEntrySize = 4 + 4 + 4 + (hasCto ? 4 : 0);
    const payloadSize = 4 + 4 + 4 + (samples.length * sampleEntrySize);
    const p = new Uint8Array(payloadSize);
    const v = new DataView(p.buffer);
    v.setUint32(0, flags, false);
    v.setUint32(4, samples.length, false);
    v.setInt32(8, dataOffset, false); // data_offset is at offset 8 in payload (offset 16 in box)
    let off = 12;
    for (const s of samples) {
      v.setUint32(off, s.duration, false); off += 4;
      v.setUint32(off, s.size, false); off += 4;
      v.setUint32(off, s.flags, false); off += 4;
      if (hasCto) {
        v.setInt32(off, s.cto || 0, false); off += 4;
      }
    }
    return createMp4Box('trun', p);
  }

  // Accurately patch trun data_offset fields inside an assembled moofBox without corrupting sample 0 duration
  function patchMoofTrunDataOffsets(moofBox, videoDataOffset, audioDataOffset = 0) {
    if (!moofBox || moofBox.byteLength < 16) return;
    const view = new DataView(moofBox.buffer, moofBox.byteOffset, moofBox.byteLength);
    let trafIndex = 0;
    let offset = 8;
    const moofEnd = moofBox.byteLength;

    while (offset + 8 <= moofEnd) {
      const bSize = view.getUint32(offset, false);
      if (bSize < 8 || offset + bSize > moofEnd) break;
      const bType = String.fromCharCode(moofBox[offset+4], moofBox[offset+5], moofBox[offset+6], moofBox[offset+7]);

      if (bType === 'traf') {
        let tSub = offset + 8;
        const trafEnd = offset + bSize;
        while (tSub + 8 <= trafEnd) {
          const trSize = view.getUint32(tSub, false);
          if (trSize < 8 || tSub + trSize > trafEnd) break;
          const trType = String.fromCharCode(moofBox[tSub+4], moofBox[tSub+5], moofBox[tSub+6], moofBox[tSub+7]);

          if (trType === 'trun') {
            if (tSub + 20 <= trafEnd) {
              const targetOffset = (trafIndex === 0) ? videoDataOffset : audioDataOffset;
              view.setInt32(tSub + 16, targetOffset, false);
            }
          }
          tSub += trSize;
        }
        trafIndex++;
      }
      offset += bSize;
    }
  }

  // MPEG-TS Timestamp and PCR codec helpers
  function encodePts(pts, flagsNibble = 0x20) {
    const p = new Uint8Array(5);
    p[0] = ((pts / 536870912) & 0x0e) | flagsNibble | 1;
    p[1] = (pts >> 22) & 0xff;
    p[2] = ((pts >> 14) & 0xfe) | 1;
    p[3] = (pts >> 7) & 0xff;
    p[4] = ((pts << 1) & 0xfe) | 1;
    return p;
  }

  function decodePts(p, off = 0) {
    return ((p[off] & 0x0e) * 536870912) +
           ((p[off+1] & 0xff) << 22) +
           ((p[off+2] & 0xfe) << 14) +
           ((p[off+3] & 0xff) << 7) +
           ((p[off+4] & 0xfe) >> 1);
  }

  function encodePcr(pcrBase, pcrExt = 0) {
    const p = new Uint8Array(6);
    p[0] = Math.floor(pcrBase / 33554432) & 0xff;
    p[1] = (pcrBase >> 17) & 0xff;
    p[2] = (pcrBase >> 9) & 0xff;
    p[3] = (pcrBase >> 1) & 0xff;
    p[4] = ((pcrBase & 1) << 7) | 0x7e | ((pcrExt >> 8) & 1);
    p[5] = pcrExt & 0xff;
    return p;
  }

  function decodePcr(p, off = 0) {
    const pcrBase = (p[off] * 33554432) +
                    (p[off+1] << 17) +
                    (p[off+2] << 9) +
                    (p[off+3] << 1) +
                    (p[off+4] >> 7);
    const pcrExt = ((p[off+4] & 1) << 8) | p[off+5];
    return { pcrBase, pcrExt };
  }

  // Fragmented MP4 (.m4s) Optimizer & Duration Patcher
  function optimizeFmp4ForSmoothPlayback(allBuffers, meta = {}) {
    if (!allBuffers || allBuffers.length === 0) {
      return { blob: new Blob([], { type: 'video/mp4' }), filename: meta.filename || 'video.mp4', format: 'fmp4', streamInfo: {} };
    }

    const initBuf = allBuffers[0] ? (allBuffers[0] instanceof Uint8Array ? allBuffers[0] : new Uint8Array(allBuffers[0])) : null;
    const fragmentBuffers = allBuffers.slice(1);

    let totalDurationMs = 0;
    let timescale = 1000;
    const videoTimescale = 90000;
    const sanitizedFragments = [];

    // Maintain decode times independently per track so video and audio tfdt never collide
    const trackCurrentDecodeTimes = new Map();

    for (let f = 0; f < fragmentBuffers.length; f++) {
      const raw = fragmentBuffers[f];
      const u8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

      // Strip disruptive styp box at start of fragment by turning 'styp' into 'free'
      if (u8.length >= 8) {
        const type = String.fromCharCode(u8[4], u8[5], u8[6], u8[7]);
        if (type === 'styp') {
          u8[4] = 0x66; u8[5] = 0x72; u8[6] = 0x65; u8[7] = 0x65; // 'free'
        }
      }

      let offset = 0;
      while (offset + 8 <= u8.length) {
        const bSize = view.getUint32(offset, false);
        if (bSize < 8 || offset + bSize > u8.length) break;
        const bType = String.fromCharCode(u8[offset+4], u8[offset+5], u8[offset+6], u8[offset+7]);

        if (bType === 'moof') {
          let sub = offset + 8;
          const moofEnd = offset + bSize;
          let trafIndexInMoof = 0;

          while (sub + 8 <= moofEnd) {
            const sSize = view.getUint32(sub, false);
            if (sSize < 8 || sub + sSize > moofEnd) break;
            const sType = String.fromCharCode(u8[sub+4], u8[sub+5], u8[sub+6], u8[sub+7]);

            if (sType === 'traf') {
              let tSub = sub + 8;
              const trafEnd = sub + sSize;
              let fragmentSampleDuration = 0;
              let trackId = (trafIndexInMoof === 0) ? 1 : 2;

              // Inspect tfhd to get actual track_id if present
              let scanSub = tSub;
              while (scanSub + 8 <= trafEnd) {
                const trSize = view.getUint32(scanSub, false);
                if (trSize < 8 || scanSub + trSize > trafEnd) break;
                const trType = String.fromCharCode(u8[scanSub+4], u8[scanSub+5], u8[scanSub+6], u8[scanSub+7]);
                if (trType === 'tfhd' && scanSub + 16 <= trafEnd) {
                  const idFromTfhd = view.getUint32(scanSub + 12, false);
                  if (idFromTfhd > 0) trackId = idFromTfhd;
                  break;
                }
                scanSub += trSize;
              }

              let currentDecodeTime = trackCurrentDecodeTimes.get(trackId) || 0;

              while (tSub + 8 <= trafEnd) {
                const trSize = view.getUint32(tSub, false);
                if (trSize < 8 || tSub + trSize > trafEnd) break;
                const trType = String.fromCharCode(u8[tSub+4], u8[tSub+5], u8[tSub+6], u8[tSub+7]);

                if (trType === 'tfdt') {
                  const v = u8[tSub + 8];
                  if (v === 0 && tSub + 16 <= trafEnd) {
                    view.setUint32(tSub + 12, currentDecodeTime >>> 0, false);
                  } else if (v === 1 && tSub + 20 <= trafEnd) {
                    view.setUint32(tSub + 12, Math.floor(currentDecodeTime / 0x100000000), false);
                    view.setUint32(tSub + 16, currentDecodeTime >>> 0, false);
                  }
                } else if (trType === 'trun') {
                  const trFlags = (u8[tSub + 9] << 16) | (u8[tSub + 10] << 8) | u8[tSub + 11];
                  const sampleCount = view.getUint32(tSub + 12, false);
                  const hasDuration = (trFlags & 0x000100) !== 0;
                  let sOff = tSub + 16;
                  if (trFlags & 0x000001) sOff += 4;
                  if (trFlags & 0x000004) sOff += 4;

                  const step = (hasDuration ? 4 : 0) + ((trFlags & 0x000200) ? 4 : 0) + ((trFlags & 0x000400) ? 4 : 0) + ((trFlags & 0x000800) ? 4 : 0);

                  if (hasDuration && step > 0) {
                    for (let s = 0; s < sampleCount && sOff + 4 <= trafEnd; s++) {
                      const d = view.getUint32(sOff, false);
                      fragmentSampleDuration += d;
                      sOff += step;
                    }
                  } else {
                    fragmentSampleDuration += sampleCount * (trackId === 2 ? 1024 : 3750);
                  }
                }
                tSub += trSize;
              }
              if (fragmentSampleDuration > 0) {
                currentDecodeTime += fragmentSampleDuration;
                trackCurrentDecodeTimes.set(trackId, currentDecodeTime);
                if (trackId === 1) {
                  totalDurationMs += (fragmentSampleDuration / videoTimescale) * 1000;
                }
              }
              trafIndexInMoof++;
            }
            sub += sSize;
          }
        }
        offset += bSize;
      }
      sanitizedFragments.push(u8);
    }

    if (totalDurationMs === 0 && trackCurrentDecodeTimes.has(2)) {
      totalDurationMs = (trackCurrentDecodeTimes.get(2) / 48000) * 1000;
    }

    const durationSeconds = totalDurationMs > 0 ? (totalDurationMs / 1000) : (sanitizedFragments.length * 2.0);

    let finalInitBuf = initBuf;
    if (initBuf && initBuf.byteLength >= 16) {
      const initView = new DataView(initBuf.buffer, initBuf.byteOffset, initBuf.byteLength);
      let off = 0;
      let moovOffset = -1;
      let moovSize = 0;
      while (off + 8 <= initBuf.byteLength) {
        const bSize = initView.getUint32(off, false);
        if (bSize < 8 || off + bSize > initBuf.byteLength) break;
        const bType = String.fromCharCode(initBuf[off+4], initBuf[off+5], initBuf[off+6], initBuf[off+7]);
        if (bType === 'moov') {
          moovOffset = off;
          moovSize = bSize;
          break;
        }
        off += bSize;
      }

      if (moovOffset !== -1) {
        let mSub = moovOffset + 8;
        const mEnd = moovOffset + moovSize;
        while (mSub + 8 <= mEnd) {
          const sSize = initView.getUint32(mSub, false);
          if (sSize < 8 || mSub + sSize > mEnd) break;
          const sType = String.fromCharCode(initBuf[mSub+4], initBuf[mSub+5], initBuf[mSub+6], initBuf[mSub+7]);
          if (sType === 'mvhd') {
            const v = initBuf[mSub + 8];
            const durOffset = mSub + 8 + (v === 0 ? 16 : 24);
            const tScaleOffset = mSub + 8 + (v === 0 ? 12 : 20);
            timescale = initView.getUint32(tScaleOffset, false) || 1000;
            const totalUnits = Math.round(durationSeconds * timescale);
            if (v === 0 && durOffset + 4 <= mEnd) {
              initView.setUint32(durOffset, totalUnits, false);
            }
          }
          mSub += sSize;
        }

        const udtaBox = buildIlstMetadataBox(meta);
        if (udtaBox && udtaBox.byteLength > 0) {
          const newInit = new Uint8Array(initBuf.byteLength + udtaBox.byteLength);
          newInit.set(initBuf.subarray(0, moovOffset + moovSize), 0);
          newInit.set(udtaBox, moovOffset + moovSize);
          if (moovOffset + moovSize < initBuf.byteLength) {
            newInit.set(initBuf.subarray(moovOffset + moovSize), moovOffset + moovSize + udtaBox.byteLength);
          }
          new DataView(newInit.buffer).setUint32(moovOffset, moovSize + udtaBox.byteLength, false);
          finalInitBuf = newInit;
        }
      }
    }

    const allSanitized = finalInitBuf ? [finalInitBuf, ...sanitizedFragments] : sanitizedFragments;
    const blob = new Blob(allSanitized, { type: 'video/mp4' });

    const streamInfo = {
      duration: durationSeconds,
      durationSeconds: Number(durationSeconds.toFixed(2)),
      resolution: meta.quality || '1080p',
      videoCodec: 'avc1 (H.264)',
      audioCodec: 'mp4a (AAC)',
      format: 'fmp4'
    };

    return { blob, filename: meta.filename, streamInfo, metadata: meta, format: 'isobmff' };
  }

  // Combines separate video fMP4 (.m4s) and audio fMP4 (.m4s) into a unified fMP4 stream
  function combineFmp4VideoAndAudio(videoInit, videoFragments, audioInit, audioFragments, meta = {}) {
    if (!videoFragments || videoFragments.length === 0) {
      if (audioFragments && audioFragments.length > 0) {
        return optimizeFmp4ForSmoothPlayback(audioInit ? [audioInit, ...audioFragments] : audioFragments, meta);
      }
      return { blob: new Blob([], { type: 'video/mp4' }), filename: meta.filename, format: 'empty', streamInfo: {} };
    }
    if (!audioFragments || audioFragments.length === 0) {
      return optimizeFmp4ForSmoothPlayback(videoInit ? [videoInit, ...videoFragments] : videoFragments, meta);
    }

    const vInitU8 = videoInit ? (videoInit instanceof Uint8Array ? videoInit : new Uint8Array(videoInit)) : null;
    const aInitU8 = audioInit ? (audioInit instanceof Uint8Array ? audioInit : new Uint8Array(audioInit)) : null;

    let combinedInit = vInitU8;

    if (vInitU8 && aInitU8) {
      // Find boxes in videoInit
      let vFtyp = null;
      let vMvhd = null;
      let vTrak = null;
      let vOff = 0;
      const vView = new DataView(vInitU8.buffer, vInitU8.byteOffset, vInitU8.byteLength);

      while (vOff + 8 <= vInitU8.byteLength) {
        const bSize = vView.getUint32(vOff, false);
        if (bSize < 8 || vOff + bSize > vInitU8.byteLength) break;
        const bType = String.fromCharCode(vInitU8[vOff+4], vInitU8[vOff+5], vInitU8[vOff+6], vInitU8[vOff+7]);
        if (bType === 'ftyp') {
          vFtyp = vInitU8.subarray(vOff, vOff + bSize);
        } else if (bType === 'moov') {
          let mOff = vOff + 8;
          const mEnd = vOff + bSize;
          while (mOff + 8 <= mEnd) {
            const sSize = vView.getUint32(mOff, false);
            if (sSize < 8 || mOff + sSize > mEnd) break;
            const sType = String.fromCharCode(vInitU8[mOff+4], vInitU8[mOff+5], vInitU8[mOff+6], vInitU8[mOff+7]);
            if (sType === 'mvhd') vMvhd = vInitU8.subarray(mOff, mOff + sSize);
            else if (sType === 'trak' && !vTrak) vTrak = vInitU8.subarray(mOff, mOff + sSize);
            mOff += sSize;
          }
        }
        vOff += bSize;
      }

      // Find audio trak in audioInit
      let aTrak = null;
      let aOff = 0;
      const aView = new DataView(aInitU8.buffer, aInitU8.byteOffset, aInitU8.byteLength);
      while (aOff + 8 <= aInitU8.byteLength) {
        const bSize = aView.getUint32(aOff, false);
        if (bSize < 8 || aOff + bSize > aInitU8.byteLength) break;
        const bType = String.fromCharCode(aInitU8[aOff+4], aInitU8[aOff+5], aInitU8[aOff+6], aInitU8[aOff+7]);
        if (bType === 'moov') {
          let mOff = aOff + 8;
          const mEnd = aOff + bSize;
          while (mOff + 8 <= mEnd) {
            const sSize = aView.getUint32(mOff, false);
            if (sSize < 8 || mOff + sSize > mEnd) break;
            const sType = String.fromCharCode(aInitU8[mOff+4], aInitU8[mOff+5], aInitU8[mOff+6], aInitU8[mOff+7]);
            if (sType === 'trak') {
              aTrak = aInitU8.subarray(mOff, mOff + sSize);
              break;
            }
            mOff += sSize;
          }
        }
        aOff += bSize;
      }

      if (vTrak && aTrak) {
        // Remap audio trak track_id to 2 in tkhd
        const patchedATrak = new Uint8Array(aTrak.byteLength);
        patchedATrak.set(aTrak);
        const aTrakView = new DataView(patchedATrak.buffer);
        let tkOff = 8;
        while (tkOff + 8 <= patchedATrak.byteLength) {
          const sSize = aTrakView.getUint32(tkOff, false);
          if (sSize < 8 || tkOff + sSize > patchedATrak.byteLength) break;
          const sType = String.fromCharCode(patchedATrak[tkOff+4], patchedATrak[tkOff+5], patchedATrak[tkOff+6], patchedATrak[tkOff+7]);
          if (sType === 'tkhd') {
            const v = patchedATrak[tkOff + 8];
            const trkIdOff = tkOff + 8 + (v === 0 ? 12 : 20);
            if (trkIdOff + 4 <= tkOff + sSize) {
              aTrakView.setUint32(trkIdOff, 2, false);
            }
            break;
          }
          tkOff += sSize;
        }

        // Build mvex containing trex for track 1 and track 2
        function createTrexBox(trId) {
          const tr = new Uint8Array(24);
          const v = new DataView(tr.buffer);
          v.setUint32(4, trId, false);
          v.setUint32(8, 1, false);
          return createMp4Box('trex', tr);
        }
        const mehdBox = createMp4Box('mehd', new Uint8Array(12));
        const combinedMvex = createMp4Box('mvex', mehdBox, createTrexBox(1), createTrexBox(2));
        const udtaBox = buildIlstMetadataBox(meta);

        const moovChildren = [vMvhd, vTrak, patchedATrak, combinedMvex];
        if (udtaBox) moovChildren.push(udtaBox);
        const combinedMoov = createMp4Box('moov', ...moovChildren.filter(Boolean));

        const ftyp = vFtyp || createMp4Box('ftyp', new Uint8Array([
          0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x61, 0x76, 0x63, 0x31
        ]));

        const newInit = new Uint8Array(ftyp.byteLength + combinedMoov.byteLength);
        newInit.set(ftyp, 0);
        newInit.set(combinedMoov, ftyp.byteLength);
        combinedInit = newInit;
      }
    }

    // Interleave video and audio fragments in playback sequence
    const interleaved = [];
    const maxFrags = Math.max(videoFragments.length, audioFragments.length);

    for (let i = 0; i < maxFrags; i++) {
      if (i < videoFragments.length) {
        const vf = videoFragments[i];
        interleaved.push(vf instanceof Uint8Array ? vf : new Uint8Array(vf));
      }
      if (i < audioFragments.length) {
        const af = audioFragments[i];
        const afU8 = new Uint8Array(af instanceof Uint8Array ? af.buffer.slice(af.byteOffset, af.byteOffset + af.byteLength) : af.slice(0));
        patchTfhdTrackId(afU8, 2);
        interleaved.push(afU8);
      }
    }

    return optimizeFmp4ForSmoothPlayback(combinedInit ? [combinedInit, ...interleaved] : interleaved, meta);
  }

  // Patches tfhd track_id inside all traf boxes in an fMP4 fragment
  function patchTfhdTrackId(fragU8, newTrackId = 2) {
    if (!fragU8 || fragU8.byteLength < 16) return;
    const view = new DataView(fragU8.buffer, fragU8.byteOffset, fragU8.byteLength);
    let offset = 0;
    while (offset + 8 <= fragU8.byteLength) {
      const bSize = view.getUint32(offset, false);
      if (bSize < 8 || offset + bSize > fragU8.byteLength) break;
      const bType = String.fromCharCode(fragU8[offset+4], fragU8[offset+5], fragU8[offset+6], fragU8[offset+7]);
      if (bType === 'moof') {
        let sub = offset + 8;
        const moofEnd = offset + bSize;
        while (sub + 8 <= moofEnd) {
          const sSize = view.getUint32(sub, false);
          if (sSize < 8 || sub + sSize > moofEnd) break;
          const sType = String.fromCharCode(fragU8[sub+4], fragU8[sub+5], fragU8[sub+6], fragU8[sub+7]);
          if (sType === 'traf') {
            let tSub = sub + 8;
            const trafEnd = sub + sSize;
            while (tSub + 8 <= trafEnd) {
              const trSize = view.getUint32(tSub, false);
              if (trSize < 8 || tSub + trSize > trafEnd) break;
              const trType = String.fromCharCode(fragU8[tSub+4], fragU8[tSub+5], fragU8[tSub+6], fragU8[tSub+7]);
              if (trType === 'tfhd' && tSub + 16 <= trafEnd) {
                view.setUint32(tSub + 12, newTrackId, false);
              }
              tSub += trSize;
            }
          }
          sub += sSize;
        }
      }
      offset += bSize;
    }
  }

  // Pure-JS MPEG-TS Timestamp Normalizer (Continuous PTS/PCR fallback)
  function smoothMpegTsTimestamps(tsBuffers, meta = {}) {
    if (!tsBuffers) {
      return { blob: new Blob([], { type: 'video/mp4' }), filename: meta.filename, format: 'empty', streamInfo: {} };
    }
    const buffers = Array.isArray(tsBuffers) ? tsBuffers : [tsBuffers];
    if (buffers.length === 0) {
      return { blob: new Blob([], { type: 'video/mp4' }), filename: meta.filename, format: 'empty', streamInfo: {} };
    }

    const TS_SIZE = 188;
    const TS_SYNC = 0x47;
    const smoothedBuffers = [];
    const pidContinuity = new Map();

    let globalBasePts = null;
    let prevSegEndPts = null;
    let runningDelta = 0;

    for (let s = 0; s < buffers.length; s++) {
      const raw = buffers[s];
      let u8;
      if (raw instanceof Uint8Array) {
        u8 = new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      } else if (raw && typeof raw.slice === 'function') {
        u8 = new Uint8Array(raw.slice(0));
      } else {
        u8 = new Uint8Array(raw);
      }

      let firstSegPts = null;
      let lastSegPts = null;

      for (let pos = 0; pos + TS_SIZE <= u8.length; pos += TS_SIZE) {
        if (u8[pos] !== TS_SYNC) continue;
        const b1 = u8[pos + 1];
        const pusi = (b1 & 0x40) !== 0;
        const afc = (u8[pos + 3] >> 4) & 0x03;
        let pStart = pos + 4;
        if (afc === 2 || afc === 3) pStart += 1 + u8[pStart];
        if (afc === 2 || pStart >= pos + TS_SIZE) continue;

        if (pusi && pStart + 9 <= pos + TS_SIZE && u8[pStart] === 0 && u8[pStart+1] === 0 && u8[pStart+2] === 1) {
          const flags2 = u8[pStart + 7];
          if ((flags2 & 0x80) && pStart + 14 <= pos + TS_SIZE) {
            const pts = decodePts(u8, pStart + 9);
            if (firstSegPts === null) firstSegPts = pts;
            lastSegPts = pts;
          }
        }
      }

      if (globalBasePts === null && firstSegPts !== null) {
        globalBasePts = firstSegPts;
      }

      if (prevSegEndPts !== null && firstSegPts !== null) {
        const expectedStart = prevSegEndPts + 3750;
        const rawDelta = expectedStart - firstSegPts;
        if (Math.abs(firstSegPts - expectedStart) > 45000) {
          runningDelta += rawDelta;
        }
      }

      for (let pos = 0; pos + TS_SIZE <= u8.length; pos += TS_SIZE) {
        if (u8[pos] !== TS_SYNC) continue;
        const b1 = u8[pos + 1];
        const b2 = u8[pos + 2];
        const pusi = (b1 & 0x40) !== 0;
        const pid = ((b1 & 0x1f) << 8) | b2;
        const afc = (u8[pos + 3] >> 4) & 0x03;

        const curCc = pidContinuity.has(pid) ? (pidContinuity.get(pid) + 1) & 0x0f : 0;
        pidContinuity.set(pid, curCc);
        u8[pos + 3] = (u8[pos + 3] & 0xf0) | curCc;

        let pStart = pos + 4;
        if ((afc === 2 || afc === 3) && u8[pStart] >= 7 && (u8[pStart + 1] & 0x10)) {
          const { pcrBase, pcrExt } = decodePcr(u8, pStart + 2);
          const newPcr = Math.max(0, pcrBase + runningDelta - (globalBasePts || 0));
          const encPcr = encodePcr(newPcr, pcrExt);
          u8.set(encPcr, pStart + 2);
        }

        if (afc === 2 || afc === 3) pStart += 1 + u8[pStart];
        if (afc === 2 || pStart >= pos + TS_SIZE) continue;

        if (pusi && pStart + 9 <= pos + TS_SIZE && u8[pStart] === 0 && u8[pStart+1] === 0 && u8[pStart+2] === 1) {
          const flags2 = u8[pStart + 7];
          const ptsDtsFlags = (flags2 >> 6) & 0x03;
          if ((ptsDtsFlags & 0x02) && pStart + 14 <= pos + TS_SIZE) {
            const rawPts = decodePts(u8, pStart + 9);
            const newPts = Math.max(0, rawPts + runningDelta - (globalBasePts || 0));
            const encPts = encodePts(newPts, 0x20);
            u8.set(encPts, pStart + 9);
          }
          if ((ptsDtsFlags & 0x01) && pStart + 19 <= pos + TS_SIZE) {
            const rawDts = decodePts(u8, pStart + 14);
            const newDts = Math.max(0, rawDts + runningDelta - (globalBasePts || 0));
            const encDts = encodePts(newDts, 0x10);
            u8.set(encDts, pStart + 14);
          }
        }
      }

      if (lastSegPts !== null) {
        prevSegEndPts = lastSegPts + runningDelta - (globalBasePts || 0);
      }
      smoothedBuffers.push(u8);
    }

    const durationSec = prevSegEndPts !== null ? (prevSegEndPts / 90000) : (buffers.length * 2.0);
    const blob = new Blob(smoothedBuffers, { type: 'video/mp4' });

    const streamInfo = {
      duration: durationSec,
      durationSeconds: Number(durationSec.toFixed(2)),
      resolution: meta.quality || '1080p',
      videoCodec: 'H.264 (AVC Transport Stream)',
      audioCodec: 'AAC',
      format: 'ts'
    };

    return { blob, filename: meta.filename, streamInfo, metadata: meta, format: 'mpegts' };
  }

  // Pure-JS MPEG-TS to Smooth MP4 Remuxer
  function transmuxTsToSmoothMp4(tsBuffers, meta = {}, audioBuffers = null) {
    if (!tsBuffers) {
      return { blob: new Blob([], { type: 'video/mp4' }), filename: meta.filename, format: 'empty', streamInfo: {} };
    }
    const buffers = Array.isArray(tsBuffers) ? tsBuffers : [tsBuffers];
    if (buffers.length === 0) {
      return { blob: new Blob([], { type: 'video/mp4' }), filename: meta.filename, format: 'empty', streamInfo: {} };
    }
    const aBuffers = audioBuffers ? (Array.isArray(audioBuffers) ? audioBuffers : [audioBuffers]) : null;

    const TS_SIZE = 188;
    const TS_SYNC = 0x47;

    let videoPid = null;
    let audioPid = null;

    // Detect Video and Audio PIDs from buffers
    for (let b = 0; b < buffers.length && (!videoPid || !audioPid); b++) {
      const raw = buffers[b];
      const u8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      for (let pos = 0; pos + TS_SIZE <= u8.length; pos += TS_SIZE) {
        if (u8[pos] !== TS_SYNC) continue;
        const b1 = u8[pos + 1];
        const b2 = u8[pos + 2];
        const pusi = (b1 & 0x40) !== 0;
        const pid = ((b1 & 0x1f) << 8) | b2;
        const afc = (u8[pos + 3] >> 4) & 0x03;

        let pStart = pos + 4;
        if (afc === 2 || afc === 3) pStart += 1 + u8[pStart];
        if (afc === 2 || pStart >= pos + TS_SIZE) continue;

        if (pusi && pStart + 4 <= pos + TS_SIZE) {
          if (u8[pStart] === 0x00 && u8[pStart + 1] === 0x00 && u8[pStart + 2] === 0x01) {
            const sid = u8[pStart + 3];
            if (sid >= 0xe0 && sid <= 0xef && !videoPid) videoPid = pid;
            if (((sid >= 0xc0 && sid <= 0xdf) || sid === 0xbd) && !audioPid) audioPid = pid;
          }
        }
      }
    }

    // If separate audioBuffers provided, also check for audioPid inside audioBuffers
    if (audioBuffers && audioBuffers.length > 0) {
      for (let b = 0; b < audioBuffers.length; b++) {
        const raw = audioBuffers[b];
        const u8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
        for (let pos = 0; pos + TS_SIZE <= u8.length; pos += TS_SIZE) {
          if (u8[pos] !== TS_SYNC) continue;
          const b1 = u8[pos + 1];
          const b2 = u8[pos + 2];
          const pusi = (b1 & 0x40) !== 0;
          const pid = ((b1 & 0x1f) << 8) | b2;
          const afc = (u8[pos + 3] >> 4) & 0x03;

          let pStart = pos + 4;
          if (afc === 2 || afc === 3) pStart += 1 + u8[pStart];
          if (afc === 2 || pStart >= pos + TS_SIZE) continue;

          if (pusi && pStart + 4 <= pos + TS_SIZE) {
            if (u8[pStart] === 0x00 && u8[pStart + 1] === 0x00 && u8[pStart + 2] === 0x01) {
              const sid = u8[pStart + 3];
              if ((sid >= 0xc0 && sid <= 0xdf) || sid === 0xbd) {
                audioPid = pid;
                break;
              }
            }
          }
        }
        if (audioPid) break;
      }
    }

    if (!videoPid) videoPid = 0x100;
    if (!audioPid) audioPid = 0x101;

    let sps = null, pps = null;
    let parsedSpsInfo = null;
    let audioConfig = null;
    let audioSampleRate = 48000;
    let audioChannels = 2;

    const videoFrames = [];
    const audioFrames = [];

    let curVideoPes = null;
    let curAudioPes = null;

    function flushPes(pes, isVideo) {
      if (!pes) return;
      let bytes;
      if (pes.chunks) {
        if (pes.totalLen < 9) return;
        bytes = new Uint8Array(pes.totalLen);
        let offset = 0;
        for (let i = 0; i < pes.chunks.length; i++) {
          const ch = pes.chunks[i];
          bytes.set(ch, offset);
          offset += ch.length;
        }
      } else if (pes.data && pes.data.length >= 9) {
        bytes = new Uint8Array(pes.data);
      } else {
        return;
      }
      const flags2 = bytes[7];
      const ptsDtsFlags = (flags2 >> 6) & 0x03;
      const hLen = bytes[8];

      let pts = null, dts = null;
      if ((ptsDtsFlags & 0x02) && bytes.length >= 14) {
        pts = ((bytes[9] & 0x0e) * 536870912) +
              ((bytes[10] & 0xff) << 22) +
              ((bytes[11] & 0xfe) << 14) +
              ((bytes[12] & 0xff) << 7) +
              ((bytes[13] & 0xfe) >> 1);
      }
      if ((ptsDtsFlags & 0x01) && bytes.length >= 19) {
        dts = ((bytes[14] & 0x0e) * 536870912) +
              ((bytes[15] & 0xff) << 22) +
              ((bytes[16] & 0xfe) << 14) +
              ((bytes[17] & 0xff) << 7) +
              ((bytes[18] & 0xfe) >> 1);
      } else {
        dts = pts;
      }

      const payload = bytes.subarray(9 + hLen);
      if (payload.length === 0) return;

      if (isVideo) {
        const nalUnits = [];
        let isKeyframe = false;
        let i = 0;
        while (i < payload.length) {
          if (payload[i] === 0 && payload[i+1] === 0 && (payload[i+2] === 1 || (payload[i+2] === 0 && payload[i+3] === 1))) {
            const startCodeLen = (payload[i+2] === 1) ? 3 : 4;
            const start = i + startCodeLen;
            let next = payload.length;
            for (let j = start; j + 2 < payload.length; j++) {
              if (payload[j] === 0 && payload[j+1] === 0 && (payload[j+2] === 1 || (payload[j+2] === 0 && payload[j+3] === 1))) {
                next = j;
                break;
              }
            }
            const nal = payload.subarray(start, next);
            if (nal.length > 0) {
              const type = nal[0] & 0x1f;
              if (type === 7 && !sps) {
                sps = nal;
                parsedSpsInfo = parseSps(nal);
              }
              if (type === 8 && !pps) pps = nal;
              if (type === 5) isKeyframe = true;
              nalUnits.push(nal);
            }
            i = next;
          } else {
            i++;
          }
        }

        if (nalUnits.length > 0) {
          let totalAvccLen = 0;
          for (const nu of nalUnits) totalAvccLen += 4 + nu.length;
          const avccPayload = new Uint8Array(totalAvccLen);
          const aView = new DataView(avccPayload.buffer);
          let aOff = 0;
          for (const nu of nalUnits) {
            aView.setUint32(aOff, nu.length, false);
            avccPayload.set(nu, aOff + 4);
            aOff += 4 + nu.length;
          }
          videoFrames.push({
            data: avccPayload,
            pts: pts || (videoFrames.length * 3750),
            dts: dts || pts || (videoFrames.length * 3750),
            isKeyframe
          });
        }
      } else {
        let aIdx = 0;
        let adtsFrameInPes = 0;
        while (aIdx + 7 <= payload.length) {
          if (payload[aIdx] === 0xff && (payload[aIdx+1] & 0xf0) === 0xf0) {
            const profile = ((payload[aIdx+2] >> 6) & 0x03) + 1;
            const sfIdx = (payload[aIdx+2] >> 2) & 0x0f;
            const chCfg = ((payload[aIdx+2] & 0x01) << 2) | ((payload[aIdx+3] >> 6) & 0x03);
            const fLen = ((payload[aIdx+3] & 0x03) << 11) | (payload[aIdx+4] << 3) | ((payload[aIdx+5] >> 5) & 0x07);
            const protAbsent = payload[aIdx+1] & 0x01;
            const hSize = protAbsent ? 7 : 9;

            if (fLen >= hSize && aIdx + fLen <= payload.length) {
              if (!audioConfig) {
                audioConfig = new Uint8Array([(profile << 3) | (sfIdx >> 1), ((sfIdx & 1) << 7) | (chCfg << 3)]);
                const sRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
                audioSampleRate = sRates[sfIdx] || 48000;
                audioChannels = chCfg || 2;
              }
              const rawFrame = payload.subarray(aIdx + hSize, aIdx + fLen);
              const framePts = (pts !== null)
                ? pts + Math.round(adtsFrameInPes * (1024 * 90000 / audioSampleRate))
                : (audioFrames.length * 1024);
              adtsFrameInPes++;
              audioFrames.push({
                data: rawFrame,
                pts: framePts
              });
              aIdx += fLen;
              continue;
            }
          }
          aIdx++;
        }
      }
    }

    // Demux video TS packets (and audio TS packets if multiplexed)
    for (let b = 0; b < buffers.length; b++) {
      const raw = buffers[b];
      const u8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      for (let pos = 0; pos + TS_SIZE <= u8.length; pos += TS_SIZE) {
        if (u8[pos] !== TS_SYNC) continue;
        const b1 = u8[pos + 1];
        const b2 = u8[pos + 2];
        const pusi = (b1 & 0x40) !== 0;
        const pid = ((b1 & 0x1f) << 8) | b2;
        const afc = (u8[pos + 3] >> 4) & 0x03;

        let pStart = pos + 4;
        if (afc === 2 || afc === 3) pStart += 1 + u8[pStart];
        if (afc === 2 || pStart >= pos + TS_SIZE) continue;

        const chunk = u8.subarray(pStart, pos + TS_SIZE);
        if (pid === videoPid) {
          if (pusi) {
            if (curVideoPes) flushPes(curVideoPes, true);
            curVideoPes = { chunks: [], totalLen: 0 };
          }
          if (curVideoPes) {
            curVideoPes.chunks.push(chunk);
            curVideoPes.totalLen += chunk.length;
          }
        } else if (pid === audioPid && (!aBuffers || aBuffers.length === 0)) {
          if (pusi) {
            if (curAudioPes) flushPes(curAudioPes, false);
            curAudioPes = { chunks: [], totalLen: 0 };
          }
          if (curAudioPes) {
            curAudioPes.chunks.push(chunk);
            curAudioPes.totalLen += chunk.length;
          }
        }
      }
    }

    // Demux separate audio buffers if provided
    if (aBuffers && aBuffers.length > 0) {
      for (let ab = 0; ab < aBuffers.length; ab++) {
        const raw = aBuffers[ab];
        const u8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
        if (u8.length === 0) continue;

        if (u8[0] === TS_SYNC) {
          // MPEG-TS audio stream
          for (let pos = 0; pos + TS_SIZE <= u8.length; pos += TS_SIZE) {
            if (u8[pos] !== TS_SYNC) continue;
            const b1 = u8[pos + 1];
            const b2 = u8[pos + 2];
            const pusi = (b1 & 0x40) !== 0;
            const pid = ((b1 & 0x1f) << 8) | b2;
            const afc = (u8[pos + 3] >> 4) & 0x03;

            let pStart = pos + 4;
            if (afc === 2 || afc === 3) pStart += 1 + u8[pStart];
            if (afc === 2 || pStart >= pos + TS_SIZE) continue;

            const chunk = u8.subarray(pStart, pos + TS_SIZE);
            if (pid === audioPid) {
              if (pusi) {
                if (curAudioPes) flushPes(curAudioPes, false);
                curAudioPes = { chunks: [], totalLen: 0 };
              }
              if (curAudioPes) {
                curAudioPes.chunks.push(chunk);
                curAudioPes.totalLen += chunk.length;
              }
            }
          }
        } else if (u8[0] === 0xff && (u8[1] & 0xf0) === 0xf0) {
          // Raw ADTS audio stream
          let aIdx = 0;
          while (aIdx + 7 <= u8.length) {
            if (u8[aIdx] === 0xff && (u8[aIdx+1] & 0xf0) === 0xf0) {
              const profile = ((u8[aIdx+2] >> 6) & 0x03) + 1;
              const sfIdx = (u8[aIdx+2] >> 2) & 0x0f;
              const chCfg = ((u8[aIdx+2] & 0x01) << 2) | ((u8[aIdx+3] >> 6) & 0x03);
              const fLen = ((u8[aIdx+3] & 0x03) << 11) | (u8[aIdx+4] << 3) | ((u8[aIdx+5] >> 5) & 0x07);
              const protAbsent = u8[aIdx+1] & 0x01;
              const hSize = protAbsent ? 7 : 9;

              if (fLen >= hSize && aIdx + fLen <= u8.length) {
                if (!audioConfig) {
                  audioConfig = new Uint8Array([(profile << 3) | (sfIdx >> 1), ((sfIdx & 1) << 7) | (chCfg << 3)]);
                  const sRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
                  audioSampleRate = sRates[sfIdx] || 48000;
                  audioChannels = chCfg || 2;
                }
                const rawFrame = u8.subarray(aIdx + hSize, aIdx + fLen);
                audioFrames.push({
                  data: rawFrame,
                  pts: audioFrames.length * Math.round(1024 * 90000 / audioSampleRate)
                });
                aIdx += fLen;
                continue;
              }
            }
            aIdx++;
          }
        }
      }
    }

    if (curVideoPes) flushPes(curVideoPes, true);
    if (curAudioPes) flushPes(curAudioPes, false);

    if (videoFrames.length === 0 || !sps) {
      return smoothMpegTsTimestamps(buffers, meta);
    }

    const basePts = videoFrames[0].pts;
    for (const vf of videoFrames) {
      vf.pts = Math.max(0, vf.pts - basePts);
      vf.dts = Math.max(0, vf.dts - basePts);
    }
    if (audioFrames.length > 0) {
      const audioBasePts = audioFrames[0].pts;
      for (const af of audioFrames) {
        af.pts = Math.max(0, af.pts - audioBasePts);
      }
    }

    const defaultVideoFrameDur = 3750;
    for (let i = 0; i < videoFrames.length; i++) {
      if (i + 1 < videoFrames.length) {
        const delta = videoFrames[i+1].dts - videoFrames[i].dts;
        videoFrames[i].duration = (delta > 0 && delta < 15000) ? delta : defaultVideoFrameDur;
      } else {
        videoFrames[i].duration = defaultVideoFrameDur;
      }
    }

    const totalVideoDuration90k = videoFrames.reduce((acc, f) => acc + f.duration, 0);
    const totalVideoDurationSec = totalVideoDuration90k / 90000;
    const totalDurationMs = Math.round(totalVideoDurationSec * 1000);

    const videoWidth = (parsedSpsInfo && parsedSpsInfo.width) || 1920;
    const videoHeight = (parsedSpsInfo && parsedSpsInfo.height) || 1080;

    // ftyp
    const ftypPayload = new Uint8Array(16);
    const fView = new DataView(ftypPayload.buffer);
    fView.setUint32(0, 0x69736f6d, false);
    fView.setUint32(4, 0x00000200, false);
    fView.setUint32(8, 0x69736f6d, false);
    fView.setUint32(12, 0x61766331, false);
    const ftypBox = createMp4Box('ftyp', ftypPayload);

    // mvhd
    const mvhdPayload = new Uint8Array(100);
    const mvView = new DataView(mvhdPayload.buffer);
    mvView.setUint8(0, 0);
    mvView.setUint32(12, 1000, false);
    mvView.setUint32(16, totalDurationMs, false);
    mvView.setUint32(20, 0x00010000, false);
    mvView.setUint16(24, 0x0100, false);
    mvView.setUint32(36, 0x00010000, false);
    mvView.setUint32(52, 0x00010000, false);
    mvView.setUint32(68, 0x40000000, false);
    mvView.setUint32(96, 3, false);
    const mvhdBox = createMp4Box('mvhd', mvhdPayload);

    // Video trak
    const tkhdPayload = new Uint8Array(84);
    const tkView = new DataView(tkhdPayload.buffer);
    tkView.setUint32(0, 0x00000003, false);
    tkView.setUint32(12, 1, false);
    tkView.setUint32(20, totalDurationMs, false);
    tkView.setUint32(40, 0x00010000, false);
    tkView.setUint32(56, 0x00010000, false);
    tkView.setUint32(72, 0x40000000, false);
    tkView.setUint32(76, videoWidth << 16, false);
    tkView.setUint32(80, videoHeight << 16, false);
    const tkhdBox = createMp4Box('tkhd', tkhdPayload);

    const mdhdPayload = new Uint8Array(24);
    const mdView = new DataView(mdhdPayload.buffer);
    mdView.setUint32(12, 90000, false);
    mdView.setUint32(16, totalVideoDuration90k, false);
    mdView.setUint16(20, 0x55c4, false);
    const mdhdBox = createMp4Box('mdhd', mdhdPayload);

    const hdlrPayload = new Uint8Array(25);
    new DataView(hdlrPayload.buffer).setUint32(8, 0x76696465, false);
    const hdlrBox = createMp4Box('hdlr', hdlrPayload);

    const vmhdPayload = new Uint8Array(12);
    vmhdPayload[3] = 1;
    const vmhdBox = createMp4Box('vmhd', vmhdPayload);

    const urlBox = createMp4Box('url ', new Uint8Array([0, 0, 0, 1]));
    const drefPayload = new Uint8Array(8);
    new DataView(drefPayload.buffer).setUint32(4, 1, false);
    const drefBox = createMp4Box('dref', drefPayload, urlBox);
    const dinfBox = createMp4Box('dinf', drefBox);

    const avcCBox = createMp4Box('avcC', createAvcC(sps, pps || new Uint8Array([0x68, 0xee, 0x3c, 0x80])));
    const avc1Payload = new Uint8Array(78);
    const avc1View = new DataView(avc1Payload.buffer);
    avc1View.setUint16(24, videoWidth, false);
    avc1View.setUint16(26, videoHeight, false);
    avc1View.setUint32(28, 0x00480000, false);
    avc1View.setUint32(32, 0x00480000, false);
    avc1View.setUint16(40, 1, false);
    avc1View.setUint16(74, 24, false);
    avc1View.setInt16(76, -1, false);
    const avc1Box = createMp4Box('avc1', avc1Payload, avcCBox);

    const stsdPayload = new Uint8Array(8);
    new DataView(stsdPayload.buffer).setUint32(4, 1, false);
    const stsdBox = createMp4Box('stsd', stsdPayload, avc1Box);
    const sttsBox = createMp4Box('stts', new Uint8Array(8));
    const stscBox = createMp4Box('stsc', new Uint8Array(8));
    const stszBox = createMp4Box('stsz', new Uint8Array(12));
    const stcoBox = createMp4Box('stco', new Uint8Array(8));
    const stblBox = createMp4Box('stbl', stsdBox, sttsBox, stscBox, stszBox, stcoBox);
    const minfBox = createMp4Box('minf', vmhdBox, dinfBox, stblBox);
    const mdiaBox = createMp4Box('mdia', mdhdBox, hdlrBox, minfBox);
    const videoTrakBox = createMp4Box('trak', tkhdBox, mdiaBox);

    // Audio trak
    let audioTrakBox = null;
    if (audioFrames.length > 0) {
      const totalAudioDurationSamples = audioFrames.length * 1024;
      const aTkhdPayload = new Uint8Array(84);
      const aTkView = new DataView(aTkhdPayload.buffer);
      aTkView.setUint32(0, 0x00000003, false);
      aTkView.setUint32(12, 2, false);
      aTkView.setUint32(20, totalDurationMs, false);
      aTkView.setUint16(36, 0x0100, false);
      aTkView.setUint32(40, 0x00010000, false);
      aTkView.setUint32(56, 0x00010000, false);
      aTkView.setUint32(72, 0x40000000, false);
      const aTkhd = createMp4Box('tkhd', aTkhdPayload);

      const aMdhdPayload = new Uint8Array(24);
      const aMdView = new DataView(aMdhdPayload.buffer);
      aMdView.setUint32(12, audioSampleRate, false);
      aMdView.setUint32(16, totalAudioDurationSamples, false);
      aMdView.setUint16(20, 0x55c4, false);
      const aMdhd = createMp4Box('mdhd', aMdhdPayload);

      const aHdlrPayload = new Uint8Array(25);
      new DataView(aHdlrPayload.buffer).setUint32(8, 0x736f756e, false);
      const aHdlr = createMp4Box('hdlr', aHdlrPayload);

      const smhdBox = createMp4Box('smhd', new Uint8Array(8));
      const esdsBox = createMp4Box('esds', createEsds(audioConfig || new Uint8Array([0x12, 0x10])));
      const mp4aPayload = new Uint8Array(28);
      const mp4aView = new DataView(mp4aPayload.buffer);
      mp4aView.setUint16(16, audioChannels, false);
      mp4aView.setUint16(18, 16, false);
      mp4aView.setUint32(24, audioSampleRate << 16, false);
      const mp4aBox = createMp4Box('mp4a', mp4aPayload, esdsBox);

      const aStsdPayload = new Uint8Array(8);
      new DataView(aStsdPayload.buffer).setUint32(4, 1, false);
      const aStsd = createMp4Box('stsd', aStsdPayload, mp4aBox);
      const aStbl = createMp4Box('stbl', aStsd, sttsBox, stscBox, stszBox, stcoBox);
      const aMdia = createMp4Box('mdia', aMdhd, aHdlr, createMp4Box('minf', smhdBox, dinfBox, aStbl));
      audioTrakBox = createMp4Box('trak', aTkhd, aMdia);
    }

    const mehdPayload = new Uint8Array(12);
    new DataView(mehdPayload.buffer).setUint32(8, totalDurationMs, false);
    const mehdBox = createMp4Box('mehd', mehdPayload);

    function createTrex(trId) {
      const tr = new Uint8Array(24);
      const v = new DataView(tr.buffer);
      v.setUint32(4, trId, false);
      v.setUint32(8, 1, false);
      return createMp4Box('trex', tr);
    }
    const videoTrex = createTrex(1);
    const audioTrex = audioTrakBox ? createTrex(2) : null;
    const mvexBox = audioTrex ? createMp4Box('mvex', mehdBox, videoTrex, audioTrex) : createMp4Box('mvex', mehdBox, videoTrex);
    const udtaBox = buildIlstMetadataBox(meta);

    const moovBoxes = [mvhdBox, videoTrakBox];
    if (audioTrakBox) moovBoxes.push(audioTrakBox);
    moovBoxes.push(mvexBox);
    if (udtaBox) moovBoxes.push(udtaBox);
    const moovBox = createMp4Box('moov', ...moovBoxes);

    // Group video frames into fragments starting cleanly on keyframe (IDR) boundaries to prevent seeking glitch/delay
    const videoChunks = [];
    let curChunk = [];
    const TARGET_FRAMES_PER_FRAG = 20;
    const MAX_FRAMES_PER_FRAG = 60;

    for (let i = 0; i < videoFrames.length; i++) {
      const frame = videoFrames[i];
      if (frame.isKeyframe && curChunk.length >= TARGET_FRAMES_PER_FRAG) {
        videoChunks.push(curChunk);
        curChunk = [];
      } else if (curChunk.length >= MAX_FRAMES_PER_FRAG) {
        videoChunks.push(curChunk);
        curChunk = [];
      }
      curChunk.push(frame);
    }
    if (curChunk.length > 0) {
      videoChunks.push(curChunk);
    }

    const fragments = [];
    let fragSeq = 1;
    let videoOffsetTime = 0;
    let audioIdx = 0;
    let audioOffsetTime = 0;

    for (let chunkIdx = 0; chunkIdx < videoChunks.length; chunkIdx++) {
      const chunkVf = videoChunks[chunkIdx];
      const chunkDuration90k = chunkVf.reduce((acc, f) => acc + f.duration, 0);
      const chunkSec = chunkDuration90k / 90000;
      const audioChunkCount = Math.round(chunkSec * (audioSampleRate / 1024));
      const isLastChunk = (chunkIdx === videoChunks.length - 1);
      const chunkAf = isLastChunk
        ? audioFrames.slice(audioIdx)
        : audioFrames.slice(audioIdx, audioIdx + audioChunkCount);
      audioIdx += chunkAf.length;

      const mfhd = createMfhd(fragSeq++);
      const tfhdVideo = createTfhd(1);
      const tfdtVideo = createTfdt(videoOffsetTime);
      videoOffsetTime += chunkDuration90k;

      const trunVideoSamples = chunkVf.map(f => ({
        duration: f.duration,
        size: f.data.byteLength,
        flags: f.isKeyframe ? 0x02000000 : 0x01010000,
        cto: Math.max(0, f.pts - f.dts)
      }));
      const trunVideo = createTrun(trunVideoSamples, true, 0);
      const trafVideo = createMp4Box('traf', tfhdVideo, tfdtVideo, trunVideo);

      let trafAudio = null;
      let trunAudio = null;
      if (chunkAf.length > 0) {
        const tfhdAudio = createTfhd(2);
        const tfdtAudio = createTfdt(audioOffsetTime);
        audioOffsetTime += chunkAf.length * 1024;
        const trunAudioSamples = chunkAf.map(f => ({
          duration: 1024,
          size: f.data.byteLength,
          flags: 0x02000000
        }));
        trunAudio = createTrun(trunAudioSamples, false, 0);
        trafAudio = createMp4Box('traf', tfhdAudio, tfdtAudio, trunAudio);
      }

      const moofBoxes = [mfhd, trafVideo];
      if (trafAudio) moofBoxes.push(trafAudio);
      const moofBox = createMp4Box('moof', ...moofBoxes);

      let mdatPayloadLen = 0;
      for (const f of chunkVf) mdatPayloadLen += f.data.byteLength;
      for (const f of chunkAf) mdatPayloadLen += f.data.byteLength;

      const videoDataOffset = moofBox.byteLength + 8;
      let audioDataOffset = videoDataOffset;
      for (const f of chunkVf) audioDataOffset += f.data.byteLength;

      // Accurately patch the trun data_offset fields inside moofBox!
      patchMoofTrunDataOffsets(moofBox, videoDataOffset, trunAudio ? audioDataOffset : 0);

      const mdatPayload = new Uint8Array(mdatPayloadLen);
      let mOff = 0;
      for (const f of chunkVf) {
        mdatPayload.set(f.data, mOff);
        mOff += f.data.byteLength;
      }
      for (const f of chunkAf) {
        mdatPayload.set(f.data, mOff);
        mOff += f.data.byteLength;
      }
      const mdatBox = createMp4Box('mdat', mdatPayload);
      fragments.push(moofBox, mdatBox);
    }

    const allParts = [ftypBox, moovBox, ...fragments];
    const blob = new Blob(allParts, { type: 'video/mp4' });

    const streamInfo = {
      duration: totalVideoDurationSec,
      durationSeconds: Number(totalVideoDurationSec.toFixed(2)),
      resolution: `${videoWidth}x${videoHeight}`,
      videoCodec: 'avc1 (H.264)',
      audioCodec: 'mp4a (AAC)',
      audioChannels,
      audioSampleRate,
      format: 'mp4'
    };

    return {
      blob,
      filename: meta.filename,
      streamInfo,
      metadata: meta,
      format: 'isobmff'
    };
  }

  // Master Orchestrator: Converts and remuxes streams for silky-smooth VLC playback
  async function convertAndRemuxStreamForSmoothPlayback(validBuffers, initSegmentBuffer, playlistContent, meta = {}, chosenQuality = '1080p', callerOptions = {}) {
    if (!validBuffers || validBuffers.length === 0) {
      const emptyBlob = new Blob([], { type: 'video/mp4' });
      return { blob: emptyBlob, filename: meta && meta.filename, streamInfo: {}, metadata: meta, metadataPayload: null, format: 'empty' };
    }

    // Flexible argument polymorphism: supports (buffers, meta, options) signature
    let effectiveInitBuf = initSegmentBuffer;
    let effectivePlaylist = playlistContent;
    let effectiveMeta = meta || {};
    let options = callerOptions || {};

    if (initSegmentBuffer && typeof initSegmentBuffer === 'object' && !(initSegmentBuffer instanceof Uint8Array) && !(initSegmentBuffer instanceof ArrayBuffer)) {
      effectiveMeta = initSegmentBuffer;
      options = playlistContent || {};
      effectiveInitBuf = null;
      effectivePlaylist = '';
    }

    const sample = (effectiveInitBuf && effectiveInitBuf.byteLength > 0) ? effectiveInitBuf : validBuffers[0];
    const format = detectStreamFormat(sample);

    let enableRemux = true;
    let enableMetadata = true;

    if (options.enableSmoothPlayback !== undefined) {
      enableRemux = Boolean(options.enableSmoothPlayback);
    } else if (effectiveMeta.enableSmoothPlayback !== undefined) {
      enableRemux = Boolean(effectiveMeta.enableSmoothPlayback);
    } else {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          const data = await new Promise(r => chrome.storage.local.get({ enableSmoothPlayback: true, enableDownloadMetadata: true }, r));
          if (data && data.enableSmoothPlayback !== undefined) enableRemux = data.enableSmoothPlayback;
          if (data && data.enableDownloadMetadata !== undefined) enableMetadata = data.enableDownloadMetadata;
        }
      } catch (e) {}
    }

    if (options.enableDownloadMetadata !== undefined) {
      enableMetadata = Boolean(options.enableDownloadMetadata);
    } else if (effectiveMeta.enableDownloadMetadata !== undefined) {
      enableMetadata = Boolean(effectiveMeta.enableDownloadMetadata);
    }

    if (!enableRemux) {
      const all = effectiveInitBuf ? [effectiveInitBuf, ...validBuffers] : validBuffers;
      const blob = new Blob(all, { type: 'video/mp4' });
      const payload = enableMetadata ? generateEpisodeMetadataPayload(effectiveMeta, { quality: chosenQuality, format: 'mp4' }) : null;
      return { blob, filename: effectiveMeta.filename, streamInfo: {}, metadata: effectiveMeta, metadataPayload: payload, format: 'mp4' };
    }

    let result;
    try {
      const audioBuffers = options.audioBuffers || effectiveMeta.audioBuffers || null;
      const audioInitBuf = options.audioInitBuf || effectiveMeta.audioInitBuf || null;

      // Branch A: ISO BMFF / fMP4 (has initSegmentBuffer or starts with ISO BMFF box)
      if (format === 'isobmff' || Boolean(effectiveInitBuf) || (effectivePlaylist && (effectivePlaylist.includes('.m4s') || /mp4/i.test(effectivePlaylist)))) {
        if (audioBuffers && audioBuffers.length > 0) {
          result = combineFmp4VideoAndAudio(effectiveInitBuf, validBuffers, audioInitBuf, audioBuffers, effectiveMeta);
        } else {
          const allBuffers = effectiveInitBuf ? [effectiveInitBuf, ...validBuffers] : validBuffers;
          result = optimizeFmp4ForSmoothPlayback(allBuffers, effectiveMeta);
        }
      } else if (format === 'mpegts' || (effectivePlaylist && effectivePlaylist.includes('.ts'))) {
        result = transmuxTsToSmoothMp4(validBuffers, effectiveMeta, audioBuffers);
      } else {
        const all = effectiveInitBuf ? [effectiveInitBuf, ...validBuffers] : validBuffers;
        const blob = new Blob(all, { type: 'video/mp4' });
        result = { blob, filename: effectiveMeta.filename, streamInfo: {}, metadata: effectiveMeta, format: 'mp4' };
      }
    } catch (err) {
      console.warn('[FocusGuard] Smooth playback conversion warning, using direct buffers:', err);
      const all = effectiveInitBuf ? [effectiveInitBuf, ...validBuffers] : validBuffers;
      const blob = new Blob(all, { type: 'video/mp4' });
      result = { blob, filename: effectiveMeta.filename, streamInfo: {}, metadata: effectiveMeta, format: 'fallback' };
    }

    result.format = 'mp4';
    result.metadataPayload = enableMetadata ? generateEpisodeMetadataPayload(effectiveMeta, result.streamInfo || {}) : null;
    return result;
  }

  // Companion Metadata File Generator & Exporter
  function generateEpisodeMetadataPayload(meta = {}, streamInfo = {}) {
    const safeTitle = (meta && (meta.title || meta.animeTitle || meta.showTitle)) || 'Episode Video';
    const showTitle = (meta && (meta.animeTitle || meta.showTitle)) || '';
    const rawEp = meta && (meta.episodeNum || meta.episodeNumber || meta.episode);
    const cleanEp = meta && meta.cleanEpisodeNumber !== undefined
      ? meta.cleanEpisodeNumber
      : (rawEp ? parseInt(rawEp, 10) || null : null);
    const durationSec = streamInfo.durationSeconds || streamInfo.duration || meta.durationSec || 0;
    const mins = Math.floor(durationSec / 60);
    const secs = Math.floor(durationSec % 60);
    const formattedDur = durationSec > 0 ? `${mins}:${secs < 10 ? '0' : ''}${secs}` : 'Unknown';

    return {
      title: safeTitle,
      showTitle: showTitle,
      animeTitle: showTitle,
      episode: rawEp ? String(rawEp) : '',
      episodeNumber: rawEp ? String(rawEp) : '',
      cleanEpisodeNumber: cleanEp,
      quality: (meta && meta.quality) || streamInfo.quality || '1080p',
      filename: (meta && meta.filename) || `${safeTitle}.mp4`,
      duration: formattedDur,
      formattedDuration: formattedDur,
      durationSec: Number(durationSec.toFixed(2)),
      durationSeconds: Number(durationSec.toFixed(2)),
      resolution: streamInfo.resolution || (meta && meta.quality) || '1080p',
      format: 'mp4',
      codec: 'h264',
      remuxEngine: 'FocusGuard Smooth VLC Engine v2.5',
      videoCodec: streamInfo.videoCodec || 'avc1 (H.264 High)',
      audioCodec: streamInfo.audioCodec || 'mp4a (AAC Stereo)',
      audioChannels: streamInfo.audioChannels || 2,
      audioSampleRate: streamInfo.audioSampleRate || 48000,
      sourceUrl: (meta && meta.sourceUrl) || (typeof window !== 'undefined' && window.location ? window.location.href : ''),
      createdAt: new Date().toISOString(),
      downloadedAt: new Date().toISOString(),
      downloader: 'FocusGuard Video Downloader & Redirect Shield (Smooth VLC Playback Edition)',
      playbackCompatibility: 'Optimized for VLC, MPV, Windows Media Player, QuickTime, iOS, and Android'
    };
  }

  function downloadEpisodeMetadataFile(metaOrFilename = {}, streamInfoOrPayload = {}) {
    try {
      let meta = {};
      let streamInfo = {};
      let explicitFilename = null;

      if (typeof metaOrFilename === 'string') {
        explicitFilename = metaOrFilename;
        meta = (typeof streamInfoOrPayload === 'object' && streamInfoOrPayload) ? streamInfoOrPayload : {};
        streamInfo = meta;
      } else if (metaOrFilename && typeof metaOrFilename === 'object') {
        meta = metaOrFilename;
        streamInfo = streamInfoOrPayload || {};
      }

      const payload = (meta && meta.downloader && meta.playbackCompatibility)
        ? meta
        : generateEpisodeMetadataPayload(meta, streamInfo);

      const jsonStr = JSON.stringify(payload, null, 2);
      const jsonBlob = new Blob([jsonStr], { type: 'application/json' });

      let baseName = 'episode';
      if (explicitFilename) {
        baseName = explicitFilename.replace(/\.(mp4|ts|m4s|json)$/i, '');
      } else if (meta && meta.baseName) {
        baseName = meta.baseName;
      } else if (meta && meta.filename) {
        baseName = meta.filename.replace(/\.(mp4|ts|m4s|json)$/i, '');
      } else if (payload && payload.filename) {
        baseName = payload.filename.replace(/\.(mp4|ts|m4s|json)$/i, '');
      }

      const jsonFilename = `${baseName}.info.json`;
      triggerFileSave(jsonBlob, jsonFilename);
      return { success: true, filename: jsonFilename, payload };
    } catch (err) {
      console.warn('[FocusGuard] downloadEpisodeMetadataFile warning:', err);
      return { success: false, error: err.message };
    }
  }

  // Helper to parse segments and initialization MAP from HLS media playlists
  function parseHlsSegments(content, baseUrl) {
    if (!content) return { segments: [], initSegmentUrl: null, initByteRange: null };
    let mediaSeq = 0;
    const mediaSeqMatch = content.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/i);
    if (mediaSeqMatch) {
      mediaSeq = parseInt(mediaSeqMatch[1], 10) || 0;
    }

    let initSegmentUrl = null;
    let initByteRange = null;
    const mapMatch = content.match(/#EXT-X-MAP:URI="([^"]+)"(?:,BYTERANGE="?([^"\s]+)"?)?/i);
    if (mapMatch) {
      try {
        initSegmentUrl = new URL(mapMatch[1], baseUrl).href;
      } catch (e) {
        initSegmentUrl = mapMatch[1];
      }
      if (mapMatch[2]) {
        initByteRange = parseHlsByteRange(mapMatch[2]);
      }
    }

    const lines = content.split('\n');
    const segments = [];
    let currentKeyInfo = null;
    let segIdxCounter = 0;
    let currentByteRange = null;
    let prevByteRangeEnd = 0;

    let currentDuration = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#EXTINF:')) {
        const infMatch = line.match(/#EXTINF:([\d.]+)/i);
        if (infMatch) {
          currentDuration = parseFloat(infMatch[1]) || 0;
        }
      } else if (line.startsWith('#EXT-X-KEY:')) {
        const methodMatch = line.match(/METHOD=([A-Z0-9-]+)/i);
        const method = methodMatch ? methodMatch[1].toUpperCase() : 'NONE';
        if (method === 'AES-128') {
          const uriMatch = line.match(/URI="([^"]+)"/i);
          const ivMatch = line.match(/IV=(0x[0-9a-fA-F]+)/i);
          const keyUri = uriMatch ? uriMatch[1] : null;
          let resolvedKeyUrl = null;
          if (keyUri) {
            try {
              resolvedKeyUrl = new URL(keyUri, baseUrl).href;
            } catch (e) {
              resolvedKeyUrl = keyUri;
            }
          }
          currentKeyInfo = {
            method: 'AES-128',
            keyUrl: resolvedKeyUrl,
            ivHex: ivMatch ? ivMatch[1] : null
          };
        } else {
          currentKeyInfo = null;
        }
      } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
        const brMatch = line.match(/#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?/i);
        if (brMatch) {
          const len = parseInt(brMatch[1], 10);
          const offset = brMatch[2] !== undefined ? parseInt(brMatch[2], 10) : prevByteRangeEnd;
          currentByteRange = `${offset}-${offset + len - 1}`;
          prevByteRangeEnd = offset + len;
        }
      } else if (!line.startsWith('#')) {
        let segUrl;
        try {
          segUrl = new URL(line, baseUrl).href;
        } catch (e) {
          segUrl = line;
        }
        segments.push({
          url: segUrl,
          duration: currentDuration,
          keyInfo: currentKeyInfo ? { ...currentKeyInfo } : null,
          seq: mediaSeq + segIdxCounter,
          byteRange: currentByteRange
        });
        currentDuration = 0;
        currentByteRange = null;
        segIdxCounter++;
      }
    }
    return {
      segments,
      initSegmentUrl,
      initUrl: initSegmentUrl,
      initByteRange,
      isFmp4: !!initSegmentUrl
    };
  }

  // Universal HLS stream downloader: fetches playlist, segments, decrypts AES-128, handles fMP4, and stitches into blob
  async function downloadHlsStream(m3u8Url, filename, onProgress, chosenQuality = '1080p', embedUrl = null, externalJobId = null) {
    const hlsJobId = externalJobId || ('fg_hls_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
    const hlsAbortController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    if (hlsAbortController) {
      activeHlsAbortControllers.set(hlsJobId, hlsAbortController);
    }
    // Proactively arm CDN header bypass in background service worker
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          action: 'arm_stream_bypass',
          url: m3u8Url,
          embedUrl: embedUrl || detectedEmbedUrl || (typeof window !== 'undefined' ? window.location.href : '')
        });
      }
    } catch (e) {}

    let mediaPlaylistUrl = m3u8Url;
    let playlistContent = (cachedPlaylistUrl === m3u8Url) ? cachedPlaylistText : null;

    if (!playlistContent) {
      playlistContent = await fetchResourceSafe(m3u8Url, embedUrl, false);
      if (playlistContent) {
        cachedPlaylistUrl = m3u8Url;
        cachedPlaylistText = playlistContent;
      }
    }

    let audioPlaylistUrl = null;
    let audioPlaylistContent = null;

    if (playlistContent && playlistContent.includes('#EXT-X-STREAM-INF')) {
      // Check for separate audio renditions in master playlist
      const audioRenditions = extractAudioRenditions(playlistContent, m3u8Url, playerSettings.preferDub);
      if (audioRenditions && audioRenditions.length > 0) {
        const chosenAudio = audioRenditions[0];
        if (chosenAudio && chosenAudio.url) {
          audioPlaylistUrl = chosenAudio.url;
        }
      }

      let available = [];
      try {
        const getQualitiesFn = (typeof getAvailableQualities === 'function')
          ? getAvailableQualities
          : ((typeof window !== 'undefined' && typeof window.__focusguard_get_available_qualities__ === 'function')
              ? window.__focusguard_get_available_qualities__
              : null);
        if (getQualitiesFn) {
          available = getQualitiesFn(null, playlistContent, m3u8Url);
        }
      } catch (e) {}
      const chosenTier = (available && available.length > 0)
        ? (chosenQuality === 'max' ? available[0] : (available.find(t => t.quality === chosenQuality) || available[0]))
        : (parseMasterPlaylist(playlistContent, m3u8Url).find(t => t.quality === chosenQuality) || parseMasterPlaylist(playlistContent, m3u8Url)[0]);
      if (chosenTier && chosenTier.url && chosenTier.url !== m3u8Url) {
        try {
          mediaPlaylistUrl = new URL(chosenTier.url, m3u8Url).href;
        } catch (e) {
          mediaPlaylistUrl = chosenTier.url;
        }
        playlistContent = await fetchResourceSafe(mediaPlaylistUrl, embedUrl, false);
      }
    }

    if (!playlistContent) {
      throw new Error('Failed to retrieve HLS playlist content.');
    }

    // Fetch separate audio playlist if declared
    if (audioPlaylistUrl) {
      try {
        audioPlaylistContent = await fetchResourceSafe(audioPlaylistUrl, embedUrl, false);
      } catch (err) {
        console.warn('[FocusGuard] Failed to fetch separate audio playlist:', err);
      }
    }

    // Parse video segments and video init segment
    const videoInfo = parseHlsSegments(playlistContent, mediaPlaylistUrl);
    const videoSegments = videoInfo.segments;

    if (videoSegments.length === 0) {
      throw new Error('No segments found in playlist.');
    }

    // Parse audio segments and audio init segment if separate audio playlist exists
    let audioSegments = [];
    let audioInfo = null;
    if (audioPlaylistContent) {
      audioInfo = parseHlsSegments(audioPlaylistContent, audioPlaylistUrl);
      audioSegments = audioInfo.segments;
    }

    // Fetch video init segment if fMP4 stream
    let videoInitSegmentBuffer = null;
    if (videoInfo.initSegmentUrl) {
      try {
        videoInitSegmentBuffer = await fetchResourceSafe(videoInfo.initSegmentUrl, embedUrl, true, videoInfo.initByteRange);
      } catch (err) {
        console.warn('[FocusGuard] Failed fetching video init segment:', err);
      }
    }
    if ((!videoInitSegmentBuffer || videoInitSegmentBuffer.byteLength === 0) && typeof window !== 'undefined' && window.__focusguard_mse_init_segment__) {
      videoInitSegmentBuffer = window.__focusguard_mse_init_segment__;
    }

    // Fetch audio init segment if fMP4 stream
    let audioInitSegmentBuffer = null;
    if (audioInfo && audioInfo.initSegmentUrl) {
      try {
        audioInitSegmentBuffer = await fetchResourceSafe(audioInfo.initSegmentUrl, embedUrl, true, audioInfo.initByteRange);
      } catch (err) {
        console.warn('[FocusGuard] Failed fetching audio init segment:', err);
      }
    }

    // Build unified download task queue
    const allTasks = [];
    for (let i = 0; i < videoSegments.length; i++) {
      allTasks.push({ type: 'video', idx: i, seg: videoSegments[i] });
    }
    for (let i = 0; i < audioSegments.length; i++) {
      allTasks.push({ type: 'audio', idx: i, seg: audioSegments[i] });
    }

    const total = allTasks.length;
    let completed = 0;
    const videoBuffers = new Array(videoSegments.length);
    const audioBuffers = audioSegments.length > 0 ? new Array(audioSegments.length) : null;
    let nextIdx = 0;
    const subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;

    // Detect if video playback is actively running in this or any connected frame
    function isPlaybackActive() {
      try {
        if (activeVideo && !activeVideo.paused && !activeVideo.ended && (activeVideo.readyState >= 2 || activeVideo.currentTime > 0)) {
          return true;
        }
        if (typeof document !== 'undefined') {
          const vids = document.querySelectorAll('video');
          for (let i = 0; i < vids.length; i++) {
            const v = vids[i];
            if (!v.paused && !v.ended && (v.readyState >= 2 || v.currentTime > 0)) {
              return true;
            }
          }
        }
      } catch (e) {}
      return false;
    }

    async function worker(workerId) {
      while (nextIdx < total) {
        if (hlsAbortController && hlsAbortController.signal && hlsAbortController.signal.aborted) {
          throw new Error('Download cancelled by user.');
        }

        // Adaptive Concurrency: If video playback is active, workers 2+ yield so player has dedicated sockets
        if (workerId >= 2 && isPlaybackActive()) {
          await new Promise(r => setTimeout(r, 60));
          if (isPlaybackActive()) continue;
        }

        const taskIdx = nextIdx++;
        if (taskIdx >= total) break;
        const task = allTasks[taskIdx];
        const seg = task.seg;
        let buffer = null;
        let attempts = 0;
        let lastErr = null;

        while (attempts < 3) {
          if (hlsAbortController && hlsAbortController.signal && hlsAbortController.signal.aborted) {
            throw new Error('Download cancelled by user.');
          }
          try {
            buffer = await fetchResourceSafe(seg.url, embedUrl, true, seg.byteRange);
            if (buffer && buffer.byteLength > 0) break;
          } catch (err) {
            attempts++;
            lastErr = err;
            if (attempts < 3) {
              await new Promise(r => setTimeout(r, attempts * 400));
            }
          }
        }

        if (!buffer || buffer.byteLength === 0) {
          if (lastErr) {
            console.warn(`[FocusGuard] ${task.type} segment ${task.idx + 1} warning:`, lastErr.message);
          }
          buffer = new ArrayBuffer(0);
        } else if (seg.keyInfo && seg.keyInfo.method === 'AES-128' && seg.keyInfo.keyUrl && subtle) {
          try {
            const cryptoKey = await getCryptoKey(seg.keyInfo.keyUrl, embedUrl);
            const ivBytes = seg.keyInfo.ivHex ? hexToUint8Array(seg.keyInfo.ivHex) : makeSequenceIv(seg.seq);
            buffer = await decryptSegmentData(buffer, cryptoKey, ivBytes);
          } catch (decErr) {
            console.warn(`[FocusGuard] Decryption failed for ${task.type} segment ${task.idx + 1}:`, decErr);
          }
        }

        if (task.type === 'video') {
          videoBuffers[task.idx] = buffer;
        } else if (audioBuffers) {
          audioBuffers[task.idx] = buffer;
        }

        completed++;
        if (onProgress) {
          const pct = Math.round((completed / total) * 100);
          onProgress(pct, completed, total);
        }

        // Cooperative socket pacing: When video is playing, yield 25ms to let player buffer & audio clock breathe
        if (isPlaybackActive()) {
          await new Promise(r => setTimeout(r, 25));
        }
      }
    }

    try {
      const workers = [];
      const workerCount = Math.min(4, total);
      for (let w = 0; w < workerCount; w++) {
        workers.push(worker(w));
      }
      await Promise.all(workers);

      const validVideoBuffers = videoBuffers.filter(b => b && b.byteLength > 0);
      const validAudioBuffers = audioBuffers ? audioBuffers.filter(b => b && b.byteLength > 0) : null;

      const conversionResult = await convertAndRemuxStreamForSmoothPlayback(
        validVideoBuffers,
        videoInitSegmentBuffer,
        playlistContent,
        { filename, quality: chosenQuality, audioBuffers: validAudioBuffers, audioInitBuf: audioInitSegmentBuffer },
        chosenQuality,
        { audioBuffers: validAudioBuffers, audioInitBuf: audioInitSegmentBuffer }
      );
      const blob = conversionResult.blob;
      try {
        blob.streamInfo = conversionResult.streamInfo;
        blob.metadata = conversionResult.metadata;
        blob.filename = conversionResult.filename || filename;
      } catch (e) {}
      // Clear segment buffers immediately to free up memory for continuous downloads
      videoBuffers.length = 0;
      if (audioBuffers) audioBuffers.length = 0;
      return blob;
    } finally {
      if (hlsAbortController) {
        activeHlsAbortControllers.delete(hlsJobId);
      }
    }
  }

  // MediaStream/Canvas stream recorder for simulated/live players
  async function downloadFromMediaStream(stream, filename, durationMs = 4000) {
    return new Promise((resolve, reject) => {
      try {
        const mime = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')) ? 'video/mp4' :
                     (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) ? 'video/webm;codecs=vp9' :
                     'video/webm';
        const recorder = new MediaRecorder(stream, { mimeType: mime });
        const chunks = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mime });
          try {
            blob.objectUrl = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(blob) : '';
          } catch (e) {}
          resolve(blob);
        };
        recorder.onerror = (e) => reject(e);
        recorder.start();
        setTimeout(() => {
          if (recorder.state === 'recording') recorder.stop();
        }, durationMs);
      } catch (err) {
        reject(err);
      }
    });
  }

  // Universal download trigger: detects streams from any website player, extracts metadata, selects quality, and downloads
  async function downloadActiveVideo(qualityOrMeta = null, maybeMeta = null, clickedVideo = null) {
    // Check if player is currently in an unplayable error state
    if (isPlayerInErrorState() && !detectedStreamUrl) {
      showHud('⚠️', 'Player has server error (232403). Auto-recovering server...', { duration: 3200 });
      handlePlayerErrorAutoRecovery();
      return;
    }

    let chosenQuality = '1080p';
    let isMaxRequested = false;
    let customMeta = null;

    if (typeof qualityOrMeta === 'string') {
      if (qualityOrMeta.toLowerCase() === 'max') {
        isMaxRequested = true;
      } else {
        chosenQuality = qualityOrMeta;
      }
      customMeta = maybeMeta;
    } else if (qualityOrMeta && typeof qualityOrMeta === 'object') {
      if (qualityOrMeta.quality) {
        if (String(qualityOrMeta.quality).toLowerCase() === 'max') {
          isMaxRequested = true;
        } else {
          chosenQuality = qualityOrMeta.quality;
        }
      }
      customMeta = qualityOrMeta;
    }

    // Determine target video element
    let video = clickedVideo;
    if (!video) {
      findVideos();
      video = activeVideo || (typeof document !== 'undefined' ? document.querySelector('video') : null);
    }
    if (!video && typeof document !== 'undefined') {
      const allVids = getAllVideos(document);
      if (allVids.length > 0) video = allVids[0];
    }

    if (isMaxRequested) {
      const streamHint = (typeof resolveActiveStreamUrl === 'function')
        ? resolveActiveStreamUrl(video)
        : ((typeof window !== 'undefined' && typeof window.__focusguard_resolve_active_stream__ === 'function')
            ? window.__focusguard_resolve_active_stream__(video)
            : null);
      let avail = [];
      try {
        const getQualitiesFn = (typeof getAvailableQualities === 'function')
          ? getAvailableQualities
          : ((typeof window !== 'undefined' && typeof window.__focusguard_get_available_qualities__ === 'function')
              ? window.__focusguard_get_available_qualities__
              : null);
        if (getQualitiesFn) {
          avail = getQualitiesFn(video, cachedPlaylistText, streamHint);
        }
      } catch (e) {}
      if (avail && avail.length > 0) {
        chosenQuality = avail[0].quality;
      } else if (video && video.videoHeight) {
        if (video.videoHeight >= 1000) chosenQuality = '1080p';
        else if (video.videoHeight >= 650) chosenQuality = '720p';
        else if (video.videoHeight >= 400) chosenQuality = '480p';
        else chosenQuality = '360p';
      } else {
        chosenQuality = '1080p';
      }
    } else if (!['4K', '1440p', '1080p', '720p', '480p', '360p', '240p'].includes(chosenQuality)) {
      chosenQuality = '1080p';
    }

    const meta = customMeta || getEpisodeMetadata(null, chosenQuality, video);
    let saveFilename = meta.filename || 'video.mp4';
    saveFilename = saveFilename.replace(/\.(m4s|ts|m3u8|mpd)$/i, '');
    if (!saveFilename.toLowerCase().endsWith('.mp4')) {
      saveFilename += '.mp4';
    }
    meta.filename = saveFilename;

    const displayTitle = meta.isEpisode ? `Episode ${meta.episodeNum}` : (meta.title || meta.animeTitle || 'Video');

    // If an active stream download is already running in this tab, queue subsequent requests
    if (isDownloading) {
      const reqEp = (meta && meta.episodeNum) || (customMeta && customMeta.episodeNum) || null;
      const isAlreadyQueued = tabPendingHlsQueue.some(item => {
        const iMeta = item.maybeMeta || (typeof item.qualityOrMeta === 'object' ? item.qualityOrMeta : null);
        return iMeta && (iMeta.filename === meta.filename || (reqEp && iMeta.episodeNum === reqEp));
      });
      if (!isAlreadyQueued) {
        tabPendingHlsQueue.push({ qualityOrMeta, maybeMeta, clickedVideo });
        showHud('⏳', `Queued ${displayTitle} [${chosenQuality}] for continuous download...`, { isDownload: true, duration: 2500 });
      } else {
        showHud('⏳', `${displayTitle} is already in the download queue...`, { isDownload: true, duration: 2000 });
      }
      return;
    }

    showHud('⬇️', `Preparing ${meta.filename}...`, { isDownload: true, duration: 2200 });

    const btn = (video && video.__fg_download_btn__) || document.querySelector('.fg-player-download-btn');
    if (btn) btn.classList.add('fg-downloading');

    isDownloading = true;
    const currentHlsJobId = 'fg_hls_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    try {
      let targetUrl = resolveActiveStreamUrl(video);

      // If stream not immediately known, request Main World on-demand scan and wait briefly
      if (!targetUrl && typeof window !== 'undefined') {
        try {
          window.dispatchEvent(new CustomEvent('__focusguard_request_stream_scan__'));
        } catch (e) {}
        await new Promise(r => setTimeout(r, 250));
        targetUrl = resolveActiveStreamUrl(video);
      }

      // Check if chosen quality has a specific direct URL (e.g. 720p MP4 or specific variant playlist)
      if (targetUrl) {
        try {
          const getQualitiesFn = (typeof getAvailableQualities === 'function') ? getAvailableQualities : null;
          if (getQualitiesFn) {
            const avail = getQualitiesFn(video, cachedPlaylistText, targetUrl);
            if (avail && avail.length > 0) {
              const matchedTier = (chosenQuality === 'max' ? avail[0] : (avail.find(t => t.quality === chosenQuality) || avail[0]));
              if (matchedTier && matchedTier.url && matchedTier.url !== targetUrl) {
                targetUrl = matchedTier.url;
              }
            }
          }
        } catch (e) {}
      }

      // Determine effective embed URL for CDN referer bypass
      let effectiveEmbedUrl = detectedEmbedUrl;
      if (!effectiveEmbedUrl) {
        if (typeof window !== 'undefined' && window !== window.top) {
          effectiveEmbedUrl = window.location.href;
        } else if (typeof document !== 'undefined') {
          const ifr = document.querySelector(
            '#iframe-embed, iframe#iframe-embed, iframe[src*="megacloud"], iframe[src*="rapid-cloud"], iframe[src*="embed"], iframe[src*="vidsrc"], iframe[src*="rabbitstream"], iframe[src*="stream"], iframe[src*="player"], iframe[src*="video"], .film-player iframe'
          );
          if (ifr) {
            effectiveEmbedUrl = ifr.src || ifr.getAttribute('data-src') || ifr.getAttribute('data-url');
          }
        }
      }
      if (!effectiveEmbedUrl && typeof window !== 'undefined') {
        effectiveEmbedUrl = window.location.href;
      }

      // STREAM TYPE DISPATCH:
      // 1. If running on top window and stream URL is not detected yet, delegate to embedded player iframes
      if (!targetUrl && typeof window !== 'undefined' && window === window.top) {
        const hasIframes = document.querySelector('iframe');
        if (hasIframes) {
          showHud('⬇️', `Contacting player for ${displayTitle}...`, { isDownload: true, duration: 2500 });
          broadcastCommand('download_video', meta);
          return;
        }
      }

      // 2. HLS stream (.m3u8 or contains /hls/ or manifest)
      if (targetUrl && (targetUrl.includes('.m3u8') || targetUrl.includes('/hls/') || /chunklist|manifest/i.test(targetUrl))) {
        showHud('⬇️', `Fetching ${displayTitle} [${chosenQuality}] playlist...`, { isDownload: true, duration: 2000 });
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'queue_download',
            job: {
              id: currentHlsJobId,
              url: targetUrl,
              filename: meta.filename,
              title: displayTitle,
              type: 'hls',
              status: 'downloading',
              progress: 0,
              quality: chosenQuality,
              episodeNum: meta.episodeNum || null,
              source: 'player_controller'
            }
          });
        }
        try {
          const blobResult = await downloadHlsStream(targetUrl, meta.filename, (pct, completed, total) => {
            const extraStr = total ? `(${completed}/${total})` : '';
            showHud('⬇️', `Downloading ${displayTitle} [${chosenQuality}]: ${pct}%`, {
              progress: pct,
              isDownload: true,
              extra: extraStr,
              duration: 2000
            });
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
              chrome.runtime.sendMessage({
                action: 'update_job_progress',
                jobId: currentHlsJobId,
                progress: pct,
                completed: completed,
                total: total,
                status: 'downloading'
              });
            }
            if (typeof window !== 'undefined' && window !== window.top) {
              try {
                window.top.postMessage({
                  type: 'FOCUSGUARD_DOWNLOAD_PROGRESS',
                  pct: pct,
                  completed: completed,
                  total: total,
                  episodeNum: meta.episodeNum,
                  quality: chosenQuality,
                  filename: meta.filename
                }, '*');
              } catch (e) {}
            }
          }, chosenQuality, effectiveEmbedUrl, currentHlsJobId);

          const finalSaveFilename = (blobResult && blobResult.filename) || meta.filename;
          triggerFileSave(blobResult, finalSaveFilename);

          // Only save companion metadata file (.info.json) if explicitly opted-in by user
          if (playerSettings && playerSettings.enableDownloadMetadata) {
            try {
              downloadEpisodeMetadataFile(meta, (blobResult && blobResult.streamInfo) || {});
            } catch (e) {}
          }

          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({
              action: 'update_job_progress',
              jobId: currentHlsJobId,
              progress: 100,
              status: 'completed'
            });
          }
          if (typeof window !== 'undefined' && window === window.top) {
            showHud('✅', `Downloaded: ${finalSaveFilename}`, { isSuccess: true, duration: 3500 });
          }
          return;
        } catch (hlsErr) {
          console.warn('[FocusGuard] HLS download error:', hlsErr);
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({
              action: 'update_job_progress',
              jobId: currentHlsJobId,
              status: 'failed',
              error: hlsErr.message
            });
          }
          if (typeof window !== 'undefined' && window === window.top) {
            broadcastCommand('download_video', meta);
            showHud('⬇️', `Delegating download for ${displayTitle}...`, { isDownload: true, duration: 2500 });
            return;
          }
          throw hlsErr;
        }
      }

      // 3. Direct video file (MP4, WebM, direct HTTP/HTTPS URL — NEVER isolated .m4s/.ts chunks or blob:)
      if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) && !targetUrl.includes('.m3u8')) {
        triggerFileSave(targetUrl, meta.filename);
        showHud('✅', `Downloading: ${meta.filename}`, { isSuccess: true, duration: 3000 });
        return;
      }

      // 4. Synthesized / Live MediaStream only (WebRTC or synthetic canvas stream with srcObject)
      // IMPORTANT: NEVER call video.captureStream() on regular video players, as it stalls/kills the hardware decoder and produces 4s chunks.
      if (video && video.srcObject && (typeof video.srcObject.getTracks === 'function' || video.srcObject.id)) {
        const stream = video.srcObject;
        showHud('⬇️', `Capturing live stream for ${displayTitle} [${chosenQuality}]...`, { isDownload: true, duration: 2500 });
        const blobUrl = await downloadFromMediaStream(stream, meta.filename, 4000);
        triggerFileSave(blobUrl, meta.filename);
        showHud('✅', `Downloaded: ${meta.filename}`, { isSuccess: true, duration: 3500 });
        return;
      }

      // 5. Cross-frame delegation fallback: ask iframes or parent window
      if (typeof window !== 'undefined') {
        if (window === window.top) {
          const hasIframes = document.querySelector('iframe');
          if (hasIframes) {
            broadcastCommand('download_video', meta);
            showHud('⬇️', `Requested stream for ${displayTitle}...`, { isDownload: true, duration: 2500 });
            return;
          }
        } else {
          window.top.postMessage({ type: 'FOCUSGUARD_PLAYER_CMD', cmd: 'download_video', value: meta }, '*');
          showHud('⬇️', `Delegating download for ${displayTitle}...`, { isDownload: true, duration: 2500 });
          return;
        }
      }

      showHud('⚠️', 'Please start video playback first to detect stream', { duration: 3500 });
      return;

    } catch (err) {
      console.error('[FocusGuard] Video download failed:', err);
      showHud('⚠️', `Download error: ${err.message}`, { duration: 3000 });
    } finally {
      isDownloading = false;
      if (btn) btn.classList.remove('fg-downloading');
      // Wipe episode caches after download completes so subsequent downloads fetch fresh streams & keys
      cachedPlaylistUrl = null;
      cachedPlaylistText = null;
      hlsKeyCache.clear();
      // Prune any duplicate jobs that match the current download before taking the next item
      while (tabPendingHlsQueue.length > 0) {
        const candidate = tabPendingHlsQueue[0];
        const candMeta = candidate.maybeMeta || (typeof candidate.qualityOrMeta === 'object' ? candidate.qualityOrMeta : null);
        if (candMeta && (candMeta.filename === meta.filename || (candMeta.episodeNum && candMeta.episodeNum === meta.episodeNum))) {
          tabPendingHlsQueue.shift();
        } else {
          break;
        }
      }
      if (tabPendingHlsQueue.length > 0) {
        const nextJob = tabPendingHlsQueue.shift();
        setTimeout(() => {
          downloadActiveVideo(nextJob.qualityOrMeta, nextJob.maybeMeta, nextJob.clickedVideo);
        }, 350);
      }
    }
  }

  // Helper: Save user server preference for continuous playback across all episodes
  function saveServerPreference(category, serverName, isUserManual = false) {
    if (!category && !serverName) return;
    let cleanCat = (category || 'dub').toLowerCase().trim();
    let cleanServer = (serverName || '').toLowerCase().trim();

    if (isUserManual) {
      userManuallySelectedCategory = cleanCat;
    } else if (playerSettings.enableAutoSelectEng && userManuallySelectedCategory !== 'sub') {
      // When auto-select ENG/DUB is enabled and user hasn't explicitly clicked SUB, default to 'dub'
      cleanCat = 'dub';
    }

    // Sanitize server name
    cleanServer = cleanServer.replace(/^(server|srv)\s*/i, '').trim();
    if (!cleanServer) cleanServer = playerSettings.preferredServerName || 'vidsrc';

    playerSettings.preferredServerCategory = cleanCat;
    playerSettings.preferredServerName = cleanServer;

    try {
      sessionStorage.setItem('fg_pref_server_cat', cleanCat);
      sessionStorage.setItem('fg_pref_server_name', cleanServer);
    } catch (e) {}

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        preferredServerCategory: cleanCat,
        preferredServerName: cleanServer
      });
    }

    console.log('[FocusGuard] Server preference saved for continuity:', cleanCat.toUpperCase(), cleanServer, isUserManual ? '(User Manual)' : '(Auto)');
  }

  let isProgrammaticClicking = false;

  // Helper to reliably trigger click events across differing anime site button structures (a, button, div)
  function clickServerButton(el) {
    if (!el) return;
    if (isProgrammaticClicking) return;
    isProgrammaticClicking = true;

    try {
      if (typeof el.focus === 'function') {
        try { el.focus(); } catch (e) {}
      }

      // Find interactive child (a, button, [role="button"], .server-item) or use el
      const inner = el.matches('a, button, [role="button"], .server-item') ? el : (el.querySelector('a, button, [role="button"]') || el);
      const target = inner || el;

      // Dispatch single clean click with user-like gesture
      target.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      }));

      // Native .click() if available
      if (typeof target.click === 'function') {
        try { target.click(); } catch (e) {}
      }
    } catch (e) {
      console.warn('[FocusGuard] Error in clickServerButton:', e);
    } finally {
      setTimeout(() => { isProgrammaticClicking = false; }, 400);
    }
  }

  // Dedicated helper to check if a server button (or any of its child/parent elements) is currently active
  function isDubServerActive(btn) {
    if (!btn) return false;
    const elementsToCheck = [
      btn,
      btn.parentElement,
      btn.closest('.server-item, .item, [class*="server"]'),
      ...Array.from(btn.querySelectorAll('a, button, span, .btn, .server-item'))
    ].filter(Boolean);

    for (const el of elementsToCheck) {
      if (el.classList.contains('active') ||
          el.classList.contains('selected') ||
          el.classList.contains('btn-active') ||
          el.classList.contains('current') ||
          el.classList.contains('highlight')) {
        return true;
      }
      if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-checked') === 'true') {
        return true;
      }
      try {
        const bg = window.getComputedStyle(el).backgroundColor;
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
          const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (m) {
            const r = parseInt(m[1], 10);
            const g = parseInt(m[2], 10);
            const b = parseInt(m[3], 10);
            // HiAnime selected server button has yellow/light background (#fed06d or #ffdd95)
            if (r > 200 && g > 160 && b < 160) return true;
          }
        }
      } catch (e) {}
    }
    return false;
  }

  // Scans the DOM and extracts all server buttons belonging to the DUB category
  function getAllDubServers() {
    const dubButtons = [];
    const seen = new Set();

    function addBtn(btn) {
      if (!btn || seen.has(btn)) return;
      seen.add(btn);
      dubButtons.push(btn);
    }

    // Strategy A: TreeWalker to find any text node containing "DUB:" or "DUB"
    // Handles icons (like microphone icon in HiAnime), tags, and arbitrary markup
    try {
      const walker = document.createTreeWalker(
        document.body || document.documentElement,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      let node;
      while ((node = walker.nextNode())) {
        const val = (node.nodeValue || '').trim().toUpperCase();
        if (val === 'DUB:' || val === 'DUB' || val.startsWith('DUB:') || val === 'ENGLISH DUB' || val === 'ENG DUB') {
          const labelEl = node.parentElement;
          if (!labelEl) continue;

          let container = labelEl;
          for (let depth = 0; depth < 5; depth++) {
            if (!container || container === document.body) break;
            const containerText = (container.textContent || '').toUpperCase();
            // Ensure this container is purely the DUB row and does not encapsulate SUB
            const hasSub = containerText.includes('SUB:') || containerText.includes('SUB :');
            if (!hasSub) {
              const btns = container.querySelectorAll('.server-item, .btn-server, .server-btn, [class*="server"], button, a, [data-server], [data-id]');
              btns.forEach(b => {
                if (!b.contains(labelEl) && !labelEl.contains(b)) {
                  const t = (b.textContent || '').trim().toUpperCase();
                  if (t !== 'DUB' && t !== 'DUB:' && t !== 'SUB' && t !== 'SUB:') {
                    addBtn(b);
                  }
                }
              });
              if (dubButtons.length > 0) break;
            }
            container = container.parentElement;
          }
        }
      }
    } catch (e) {}

    // Strategy B: Direct scoped search in containers with DUB classes or attributes
    const dubContainers = document.querySelectorAll(
      '.servers-dub, #servers-dub, [data-type="dub"], [data-server-type="dub"], .server-dub, ' +
      '.servers-list-dub, .server-group.dub, .ps-block.servers-dub, [class*="servers-dub"]'
    );
    for (const c of dubContainers) {
      if (c.matches('.server-item, .btn-server, .server-btn, [data-server], a, button')) {
        addBtn(c);
        continue;
      }
      const btns = c.querySelectorAll('.server-item, .btn-server, .server-btn, [class*="server"], button, a, [data-server]');
      btns.forEach(b => {
        const t = (b.textContent || '').trim().toUpperCase();
        if (t !== 'DUB' && t !== 'DUB:' && t !== 'SUB' && t !== 'SUB:') {
          addBtn(b);
        }
      });
    }

    // Strategy C: Search near microphone icons (HiAnime / Zoro standard)
    try {
      const micIcons = document.querySelectorAll('i[class*="microphone"], i[class*="mic"], svg[class*="mic"], [class*="fa-microphone"]');
      for (const mic of micIcons) {
        const row = mic.closest('tr, .row, .item, .server-row, .server-item-row, .ps-block, [class*="server"], div');
        if (row) {
          const rowText = (row.textContent || '').toUpperCase();
          if (!rowText.includes('SUB:') && !rowText.includes('SUB :')) {
            const btns = row.querySelectorAll('.server-item, .btn-server, .server-btn, [class*="server"], button, a, [data-server]');
            btns.forEach(b => {
              if (!b.contains(mic) && !mic.contains(b)) {
                addBtn(b);
              }
            });
          }
        }
      }
    } catch (e) {}

    return dubButtons;
  }

  // Helper: Check if a DOM element belongs to the DUB category (vs SUB)
  function isElementInDubContext(el) {
    if (!el) return false;
    const allDub = getAllDubServers();
    if (allDub.includes(el)) return true;
    for (const b of allDub) {
      if (b.contains(el) || el.contains(b)) return true;
    }
    if (el.closest('.servers-dub, #servers-dub, [data-type="dub"], [data-server-type="dub"], .server-dub, [class*="servers-dub"]')) {
      return true;
    }
    return false;
  }

  // Dedicated helper to locate the DUB server button (prioritizing preferred server, e.g. VidSrc)
  function findDubServerButton() {
    const dubButtons = getAllDubServers();
    if (dubButtons.length === 0) return null;

    const targetServer = (playerSettings.preferredServerName || 'vidsrc').toLowerCase().trim();

    // 1. Prioritize button matching user's preferred server (e.g. VidSrc) in DUB
    for (const btn of dubButtons) {
      const text = (btn.textContent || '').trim().toLowerCase();
      const sAttr = (btn.getAttribute('data-server') || '').toLowerCase();
      const idAttr = (btn.getAttribute('data-id') || '').toLowerCase();
      if (text.includes(targetServer) || sAttr.includes(targetServer) || idAttr.includes(targetServer)) {
        return btn;
      }
    }

    // 2. If preferred server name is not in DUB, return the first available DUB server
    // "all time select the dub one" ensures DUB is always picked over SUB
    return dubButtons[0];
  }

  // Checks if any DUB server button or player iframe is currently active
  function isAnyDubServerActive() {
    // 1. Check if the active player iframe is already loaded with a DUB stream URL
    try {
      const ifr = document.querySelector('iframe[src*="/dub"], #iframe-embed[src*="/dub"], .film-player iframe[src*="/dub"]');
      if (ifr) return true;
      if (typeof window !== 'undefined' && window.location && window.location.href.includes('/dub')) return true;
    } catch (e) {}

    // 2. Check DOM server buttons
    const dubButtons = getAllDubServers();
    for (const btn of dubButtons) {
      if (isDubServerActive(btn)) {
        return true;
      }
    }
    return false;
  }

  // Detects if player has encountered an unplayable error (e.g. Error Code 232403 / Protected Content / Media Load Failure)
  function isPlayerInErrorState() {
    try {
      // 1. Check JW Player instance if accessible
      if (typeof window.jwplayer === 'function') {
        const jw = window.jwplayer();
        if (jw && typeof jw.getState === 'function' && jw.getState() === 'error') {
          return true;
        }
      }

      // 2. Check DOM error elements in current frame
      const errorSelectors = [
        '.jw-error',
        '.jw-error-msg',
        '.jw-error-text',
        '.jw-state-error',
        '.vjs-error-display',
        '.art-error',
        '.dplayer-error',
        '[class*="jw-error"]',
        '[class*="player-error"]'
      ];
      for (const sel of errorSelectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) {
          const txt = (el.textContent || '').trim();
          if (txt.length > 0) return true;
        }
      }

      // 3. Check for specific error signatures in player container or document
      const playerWrapper = document.querySelector(
        '#player-wrapper, .player-container, #player-container, #player, .film-player, #iframe-embed'
      ) || document.body;

      if (playerWrapper) {
        const text = (playerWrapper.innerText || playerWrapper.textContent || '');
        if (
          /error code:\s*232\d{3}/i.test(text) ||
          /problem providing access to protected content/i.test(text) ||
          /cannot load (m3u8|source|media)/i.test(text) ||
          /error loading media: file could not be played/i.test(text) ||
          /this video file cannot be played/i.test(text)
        ) {
          return true;
        }
      }

      // 4. Check if HTML5 video tag has an active error
      if (activeVideo && activeVideo.error) return true;
      const vid = document.querySelector('video');
      if (vid && vid.error) return true;
    } catch (e) {}

    return false;
  }

  // Automatic recovery when player encounters Error 232403 or protected content error
  function handlePlayerErrorAutoRecovery() {
    if (!isEnabled()) return;
    const now = Date.now();
    if (now - lastPlayerErrorCheckTime < 2500) return;
    lastPlayerErrorCheckTime = now;

    if (!isPlayerInErrorState()) return;

    console.warn('[FocusGuard] Video playback error detected (Error 232403 / Protected Content). Initiating auto-recovery...');

    // Stop continuous DUB enforcer so it doesn't fight recovery
    dubEnforceAttempts = 999;

    if (playerErrorRecoveryCount >= 3) {
      console.warn('[FocusGuard] Max error recovery attempts reached for this episode.');
      return;
    }

    isAutoRecovering = true;
    playerErrorRecoveryCount++;

    showHud('⚠️', 'Server error 232403: Switching to alternative server...', { duration: 3000 });

    try {
      const currentActiveIsDub = isAnyDubServerActive();

      if (currentActiveIsDub) {
        // DUB server failed with error 232403. Try SUB server (VidSrc SUB or first SUB server)
        const subButtons = [];
        const allButtons = document.querySelectorAll(
          '.server-item, .btn-server, .server-btn, [data-server], [data-type="sub"], .servers-sub .server-item, #servers-sub .server-item, [class*="server"]'
        );
        for (const btn of allButtons) {
          if (!isElementInDubContext(btn) && btn.offsetParent !== null) {
            const txt = (btn.textContent || '').trim().toLowerCase();
            if (txt && txt !== 'dub' && !txt.includes('dub')) {
              subButtons.push(btn);
            }
          }
        }

        let targetBtn = null;
        const preferredName = (playerSettings.preferredServerName || 'vidsrc').toLowerCase();
        for (const btn of subButtons) {
          const txt = (btn.textContent || '').trim().toLowerCase();
          if (txt.includes(preferredName)) {
            targetBtn = btn;
            break;
          }
        }
        if (!targetBtn && subButtons.length > 0) {
          targetBtn = subButtons[0];
        }

        if (targetBtn) {
          console.log('[FocusGuard] Auto-recovering to SUB server:', targetBtn);
          clickServerButton(targetBtn);
          userManuallySelectedCategory = 'sub';
          showHud('🔄', `Recovered: Switched to SUB (${(targetBtn.textContent || '').trim()})`, { isSuccess: true, duration: 2500 });
          return;
        }
      } else {
        // If SUB failed, try switching to DUB
        const targetDub = findDubServerButton();
        if (targetDub) {
          clickServerButton(targetDub);
          showHud('🔄', 'Recovered: Switched to DUB server', { isSuccess: true, duration: 2500 });
          return;
        }
      }
    } catch (err) {
      console.warn('[FocusGuard] Error during auto-recovery:', err);
    } finally {
      setTimeout(() => { isAutoRecovering = false; }, 3000);
    }
  }

  // Continuous Enforcer: Guarantees DUB is selected at all times across all episodes
  let lastDubClickTime = 0;
  let dubEnforceAttempts = 0;
  function enforceDubSelection() {
    if (!isEnabled() || !playerSettings.enableAutoSelectEng) return;

    // If user explicitly chose SUB, respect their choice and do not force DUB
    if (userManuallySelectedCategory === 'sub') return;

    // If player is in error state (Error 232403), do not re-click DUB; initiate auto-recovery
    if (isAutoRecovering || isPlayerInErrorState()) {
      handlePlayerErrorAutoRecovery();
      return;
    }

    const cat = (playerSettings.preferredServerCategory || 'dub').toLowerCase();
    if (cat !== 'dub') return;

    // Cap enforcement attempts to 3 to prevent infinite clicking loops
    if (dubEnforceAttempts >= 3) return;

    // A. If tabbed interface, ensure DUB tab is active
    try {
      const dubTab = document.querySelector(
        '.nav-item[data-type="dub"]:not(.active), [data-type="dub"].server-tab:not(.active), ' +
        '.btn-dub:not(.active), .servers-dub .tab:not(.active), .server-tabs .tab[data-name="dub"]:not(.active)'
      );
      if (dubTab && dubTab.offsetParent !== null) {
        clickServerButton(dubTab);
      }
    } catch (e) {}

    // B. Check if DUB is ALREADY active
    if (isAnyDubServerActive()) {
      hasSelectedEngServer = true;
      dubEnforceAttempts = 0;
      return;
    }

    // C. DUB is NOT active (e.g. site defaulted to SUB). Find the DUB button!
    const dubBtn = findDubServerButton();
    if (!dubBtn) return; // Servers not rendered yet

    // D. Throttle clicks (min 2200ms between attempts to give player iframe time to switch)
    const now = Date.now();
    if (now - lastDubClickTime < 2200) return;
    lastDubClickTime = now;
    dubEnforceAttempts++;

    console.log(`[FocusGuard] All-Time DUB Enforcer (Attempt ${dubEnforceAttempts}): Activating DUB Server:`, dubBtn);
    clickServerButton(dubBtn);
    hasSelectedEngServer = true;

    const label = (dubBtn.textContent || playerSettings.preferredServerName || 'VidSrc').trim();
    showHud('🌐', `Auto-Selected DUB • ${label}`, { duration: 1500 });

    saveServerPreference('dub', label, false);
  }

  // 2.5 Auto-Select English ("ENG") Engine with Duplicate Server Name Disambiguation & Continuity
  function autoSelectEnglish(video) {
    if (!isEnabled() || !playerSettings.enableAutoSelectEng) return;

    const now = Date.now();
    if (now - lastEngSelectionCheck < 600) return;
    lastEngSelectionCheck = now;

    // A. Select English in HTML5 Video Text Tracks (Subtitles)
    const targetVideo = video || activeVideo;
    if (targetVideo) {
      try {
        if (targetVideo.textTracks && targetVideo.textTracks.length > 0) {
          for (let i = 0; i < targetVideo.textTracks.length; i++) {
            const track = targetVideo.textTracks[i];
            const lang = (track.language || '').toLowerCase();
            const label = (track.label || '').toLowerCase();
            if (lang.startsWith('en') || label.includes('eng') || label.includes('english')) {
              if (track.mode !== 'showing') {
                track.mode = 'showing';
                console.log('[FocusGuard] Auto-selected English subtitle text track:', label || lang);
              }
              break;
            }
          }
        }

        // B. Select English in HTML5 Video Audio Tracks
        if (targetVideo.audioTracks && targetVideo.audioTracks.length > 0) {
          for (let i = 0; i < targetVideo.audioTracks.length; i++) {
            const track = targetVideo.audioTracks[i];
            const lang = (track.language || '').toLowerCase();
            const label = (track.label || '').toLowerCase();
            if (lang.startsWith('en') || label.includes('eng') || label.includes('english')) {
              if (!track.enabled) {
                track.enabled = true;
                console.log('[FocusGuard] Auto-selected English audio track:', label || lang);
              }
            }
          }
        }
      } catch (e) {}
    }

    // C. Embedded Player API Selection (JWPlayer instance)
    try {
      if (typeof window.jwplayer === 'function') {
        const jw = window.jwplayer();
        if (jw && typeof jw.getAudioTracks === 'function') {
          const audioTracks = jw.getAudioTracks() || [];
          const engAudioIdx = audioTracks.findIndex(t => /eng|english/i.test((t.name || '') + ' ' + (t.language || '')));
          if (engAudioIdx >= 0 && typeof jw.setCurrentAudioTrack === 'function' && jw.getCurrentAudioTrack() !== engAudioIdx) {
            jw.setCurrentAudioTrack(engAudioIdx);
            console.log('[FocusGuard] Auto-selected JWPlayer English Audio Track');
          }
        }
        if (jw && typeof jw.getCaptionsList === 'function') {
          const captions = jw.getCaptionsList() || [];
          const engCapIdx = captions.findIndex(t => /eng|english/i.test((t.label || '') + ' ' + (t.id || '')));
          if (engCapIdx >= 0 && typeof jw.setCurrentCaptions === 'function' && jw.getCurrentCaptions() !== engCapIdx) {
            jw.setCurrentCaptions(engCapIdx);
            console.log('[FocusGuard] Auto-selected JWPlayer English Captions Track');
          }
        }
      }
    } catch (e) {}

    // D. All-Time English DUB Server Enforcer (Aniwatch / HiAnime / VidSrc)
    // Disambiguates duplicate server button names (e.g. 'vidsrc' in both SUB and DUB)
    // and guarantees DUB is selected at all times across all episodes.
    try {
      enforceDubSelection();
    } catch (e) {
      console.warn('[FocusGuard] Error in enforceDubSelection:', e);
    }

    // E. Anime Title / Page Language (EN vs JP)
    if (!hasSelectedEngTitle) {
      try {
        const titleLangSelectors = [
          '.btn-lang[data-lang="en"]:not(.active)',
          '[data-lang="en"]:not(.active)',
          '.select-lang-en:not(.active)',
          '#lang-en:not(.active)',
          '.an-name-language .btn[data-value="en"]:not(.active)'
        ];

        for (const sel of titleLangSelectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null && !el.classList.contains('active')) {
            el.click();
            hasSelectedEngTitle = true;
            console.log('[FocusGuard] Auto-selected English Title Language:', el);
            break;
          }
        }
      } catch (e) {}
    }
  }

  // 2.6 Server Continuity Memory Listener
  // Automatically captures user's manual server clicks so their chosen server continues across every episode
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target) return;
    if (isProgrammaticClicking || !e.isTrusted) return; // Only record genuine physical user clicks!

    // Check if user clicked a category button (SUB vs DUB)
    const catBtn = target.closest && target.closest(
      '[data-type="dub"], [data-type="sub"], [data-server-type="dub"], [data-server-type="sub"], .server-tab, .btn-type, [class*="dub"], [class*="sub"]'
    );
    if (catBtn) {
      const dt = (catBtn.getAttribute('data-type') || catBtn.getAttribute('data-server-type') || '').toLowerCase();
      const txt = (catBtn.textContent || '').trim().toLowerCase();
      let cat = '';
      if (dt === 'dub' || txt === 'dub' || txt.includes('dub')) cat = 'dub';
      else if (dt === 'sub' || txt === 'sub' || txt.includes('sub')) cat = 'sub';
      if (cat) {
        saveServerPreference(cat, playerSettings.preferredServerName || 'vidsrc', true);
      }
    }

    // Check if user clicked a server button
    const serverBtn = target.closest && target.closest(
      '.server-item, .btn-server, .server-btn, [class*="server-item"], [data-server], .servers-tab, .btn-group .btn'
    );
    if (serverBtn) {
      const sName = (serverBtn.getAttribute('data-server') || serverBtn.textContent || '').trim().toLowerCase();
      if (sName && sName !== 'sub' && sName !== 'dub' && sName.length < 35) {
        const isDub = isElementInDubContext(serverBtn);
        const cat = isDub ? 'dub' : 'sub';
        saveServerPreference(cat, sName, true);
      }
    }
  }, true);

  // 2.7 Episode Transition & Single-Page App (SPA) Navigation Watcher
  // Guarantees server continuity, stream cache invalidation, and auto-skip re-arming when navigating between episodes
  function onEpisodeChangeDetected() {
    hasSelectedEngServer = false;
    hasSelectedEngTitle = false;
    introSkippedForCurrentVideo = false;
    outroSkippedForCurrentVideo = false;
    activeVideo = null;
    detectedStreamUrl = null;
    detectedEmbedUrl = null;
    cachedPlaylistUrl = null;
    cachedPlaylistText = null;
    cachedEpisodeMeta = null;
    if (hlsKeyCache && typeof hlsKeyCache.clear === 'function') hlsKeyCache.clear();
    if (recentSavedBlobs && typeof recentSavedBlobs.clear === 'function') recentSavedBlobs.clear();
    if (recentAnchorDownloads && typeof recentAnchorDownloads.clear === 'function') recentAnchorDownloads.clear();
    dubEnforceAttempts = 0;
    playerErrorRecoveryCount = 0;
    userManuallySelectedCategory = null;
    isAutoRecovering = false;

    // Invalidate stale DOM bridge elements and sessionStorage so next episode fetches fresh stream
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('fg_detected_stream_url');
      }
      if (typeof document !== 'undefined') {
        const streamDataEl = document.getElementById('__fg_stream_data__');
        if (streamDataEl) streamDataEl.textContent = '{}';
        const playlistCacheEl = document.getElementById('__fg_playlist_cache__');
        if (playlistCacheEl) playlistCacheEl.textContent = '';
        if (document.documentElement) {
          document.documentElement.removeAttribute('data-focusguard-active-stream');
          document.documentElement.removeAttribute('data-focusguard-mp4-stream');
          document.documentElement.removeAttribute('data-focusguard-hls-stream');
          document.documentElement.removeAttribute('data-focusguard-embed-url');
        }
      }
      if (typeof window !== 'undefined') {
        window.__focusguard_active_stream__ = null;
        window.__focusguard_mse_init_segment__ = null;
        window.__focusguard_cached_playlist__ = null;
      }
    } catch (e) {}

    console.log('[FocusGuard] Episode change detected. Re-arming server continuity, wiping stale stream cache, and resetting recovery counters.');

    // Immediately update download badge with new episode number
    const btn = document.querySelector('#focusguard-download-btn');
    if (btn) updateDownloadButtonLabel(btn);

    // Staggered asynchronous checks to catch AJAX server list rendering
    [50, 150, 350, 700, 1200, 1800, 2500, 3500].forEach((delay) => {
      setTimeout(() => {
        findVideos();
        enforcePlayerNoScrollbars();
        if (isPlayerInErrorState()) {
          handlePlayerErrorAutoRecovery();
        } else {
          enforceDubSelection();
        }
        checkAndMountPlayerDownloadButton();
        updateDownloadButtonLabel(document.querySelector('#focusguard-download-btn'));
        if (activeVideo) {
          optimizeVideoBuffering(activeVideo);
        }
        autoSelectEnglish(activeVideo);
      }, delay);
    });
  }

  // Hook history state changes for SPA episode switches
  try {
    const rawPushState = history.pushState;
    if (rawPushState) {
      history.pushState = function () {
        const res = rawPushState.apply(this, arguments);
        onEpisodeChangeDetected();
        return res;
      };
    }
    const rawReplaceState = history.replaceState;
    if (rawReplaceState) {
      history.replaceState = function () {
        const res = rawReplaceState.apply(this, arguments);
        onEpisodeChangeDetected();
        return res;
      };
    }
  } catch (e) {}
  window.addEventListener('popstate', onEpisodeChangeDetected);
  window.addEventListener('hashchange', onEpisodeChangeDetected);

  // Listen for user clicks on episode navigation buttons
  document.addEventListener('click', (e) => {
    const epBtn = e.target.closest && e.target.closest(
      '.ep-item, .episode-item, [class*="ep-item"], [class*="episode-item"], .btn-next, #next-episode, [data-number], .ss-item'
    );
    if (epBtn) {
      onEpisodeChangeDetected();
    }
  }, true);

  // 2.8 Smooth Playback & Buffer Ahead Optimizer
  // Ensures video buffers ahead continuously and maximizes cache for stutter-free playback
  function optimizeVideoBuffering(video) {
    if (!video || !playerSettings.enableSmoothPlayback) return;
    try {
      if (video.preload !== 'auto') {
        video.preload = 'auto';
      }
      if (!video.hasAttribute('playsinline')) {
        video.playsInline = true;
        video.setAttribute('playsinline', '');
      }
    } catch (e) {}
  }

  // 2.9 Player Playback Stall Watchdog & Auto-Recovery Engine
  // Prevents the video player from crashing, freezing indefinitely, or dropping frames during heavy downloads
  let lastMonitoredVideoTime = -1;
  let stallDurationSeconds = 0;
  let stallRecoveryCount = 0;
  let lastStallRecoveryTimestamp = 0;

  function handlePlaybackStallRecovery(video) {
    const target = video || activeVideo;
    if (!target) return false;

    const now = Date.now();
    // Rate limit: max 3 recoveries within 30 seconds to prevent recovery flapping
    if (now - lastStallRecoveryTimestamp > 30000) {
      stallRecoveryCount = 0;
    }
    if (stallRecoveryCount >= 3) {
      console.warn('[FocusGuard] Max stall recovery attempts reached within rate limit window.');
      return false;
    }

    stallRecoveryCount++;
    lastStallRecoveryTimestamp = now;
    console.warn('[FocusGuard] Video playback stall detected! Initiating micro-nudge recovery (Attempt ' + stallRecoveryCount + ')...');

    try {
      // 1. Try to recover HLS.js if attached to window or video element
      const hls = target.__hls__ || (typeof window !== 'undefined' ? window.hls : null);
      if (hls && typeof hls.recoverMediaError === 'function') {
        try {
          hls.recoverMediaError();
        } catch (e) {}
      } else if (hls && typeof hls.startLoad === 'function') {
        try {
          hls.startLoad();
        } catch (e) {}
      }

      // 2. Nudge playback past any tiny discontinuity / timestamp boundary gap (typically 0.05s)
      if (!isNaN(target.currentTime) && target.duration && target.currentTime < target.duration - 1) {
        target.currentTime = Math.min(target.duration - 0.5, target.currentTime + 0.08);
      }

      // 3. Re-trigger play promise
      const playPromise = target.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }

      showHud('⚡', 'Smooth Playback: Nudged past buffer stall', { duration: 1800 });
      return true;
    } catch (err) {
      console.warn('[FocusGuard] Error during stall recovery:', err);
      return false;
    }
  }

  function checkPlayerPlaybackWatchdog() {
    if (!isEnabled() || !playerSettings.enableSmoothPlayback) return;
    if (!activeVideo || activeVideo.paused || activeVideo.ended) {
      stallDurationSeconds = 0;
      lastMonitoredVideoTime = activeVideo ? activeVideo.currentTime : -1;
      return;
    }

    const curTime = activeVideo.currentTime;
    if (lastMonitoredVideoTime >= 0 && Math.abs(curTime - lastMonitoredVideoTime) < 0.02) {
      // Video is unpaused, but currentTime is not advancing!
      stallDurationSeconds += 1.2; // Based on the 1200ms interval
      if (stallDurationSeconds >= 3.5) {
        stallDurationSeconds = 0;
        handlePlaybackStallRecovery(activeVideo);
      }
    } else {
      stallDurationSeconds = 0;
      lastMonitoredVideoTime = curTime;
    }
  }

  // 1.5 Universal Player Scrollbar Killer
  // Completely suppresses, removes, and disables scrollbars from the video player
  // across all viewing modes (normal, theater, fullscreen) on Aniwatch, HiAnime, etc.
  function enforcePlayerNoScrollbars() {
    // A. Inside embedded player iframes (megacloud, vidsrc, rapid-cloud)
    if (window !== window.top) {
      try {
        if (!document.getElementById('fg-iframe-scrollbar-killer')) {
          const s = document.createElement('style');
          s.id = 'fg-iframe-scrollbar-killer';
          s.textContent = `
            html, body, #player, .player, .jwplayer, .video-js, video, div {
              scrollbar-width: none !important;
              -ms-overflow-style: none !important;
              overflow: hidden !important;
              margin: 0 !important;
              padding: 0 !important;
            }
            *::-webkit-scrollbar,
            ::-webkit-scrollbar {
              display: none !important;
              width: 0 !important;
              height: 0 !important;
              background: transparent !important;
            }
          `;
          (document.head || document.documentElement).appendChild(s);
        }
        document.documentElement.style.setProperty('overflow', 'hidden', 'important');
        document.documentElement.style.setProperty('scrollbar-width', 'none', 'important');
        if (document.body) {
          document.body.style.setProperty('overflow', 'hidden', 'important');
          document.body.style.setProperty('scrollbar-width', 'none', 'important');
          document.body.style.setProperty('margin', '0px', 'important');
          document.body.style.setProperty('padding', '0px', 'important');
        }
      } catch (e) {}
    }

    // B. On the host window (top window)
    try {
      if (window === window.top && !document.getElementById('fg-host-player-scrollbar-killer')) {
        const hs = document.createElement('style');
        hs.id = 'fg-host-player-scrollbar-killer';
        hs.textContent = `
          #iframe-embed,
          iframe[src*="embed"],
          iframe[src*="megacloud"],
          iframe[src*="rapid-cloud"],
          iframe[src*="vidsrc"],
          iframe[src*="stream"],
          .player-container,
          #player,
          #watch-player,
          .watching-player,
          .film-player,
          .player-wrapper,
          #player-wrapper,
          [class*="player-container"],
          [class*="player-wrapper"] {
            overflow: hidden !important;
            scrollbar-width: none !important;
            -ms-overflow-style: none !important;
          }
          #iframe-embed::-webkit-scrollbar,
          iframe[src*="embed"]::-webkit-scrollbar,
          .player-container::-webkit-scrollbar,
          #player::-webkit-scrollbar,
          .watching-player::-webkit-scrollbar,
          .player-wrapper::-webkit-scrollbar {
            display: none !important;
            width: 0 !important;
            height: 0 !important;
            background: transparent !important;
          }
        `;
        (document.head || document.documentElement).appendChild(hs);
      }

      // Enforce scrolling="no" and overflow: hidden on iframe elements
      const iframes = document.querySelectorAll('iframe, #iframe-embed, iframe[src*="embed"], iframe[src*="megacloud"], iframe[src*="rapid-cloud"], iframe[src*="vidsrc"], iframe[src*="stream"]');
      iframes.forEach((ifr) => {
        try {
          ifr.setAttribute('scrolling', 'no');
          ifr.style.setProperty('overflow', 'hidden', 'important');
          ifr.style.setProperty('scrollbar-width', 'none', 'important');
        } catch (err) {}
      });

      // Enforce overflow: hidden on player container wrappers
      const wrappers = document.querySelectorAll('#player, .player-container, #iframe-embed, #watch-player, .watching-player, .film-player, .player-wrapper, #player-wrapper, [class*="player-container"], [class*="player-wrapper"]');
      wrappers.forEach((w) => {
        try {
          w.style.setProperty('overflow', 'hidden', 'important');
          w.style.setProperty('scrollbar-width', 'none', 'important');
        } catch (err) {}
      });
    } catch (e) {}
  }

  // Initial scrollbar suppression
  enforcePlayerNoScrollbars();

  // Continuous player controller loop: monitors buffer, scrollbars, and DUB state
  const controllerInterval = setInterval(() => {
    if (!isEnabled()) return;
    findVideos();
    if (activeVideo && playerSettings.enableSmoothPlayback) {
      optimizeVideoBuffering(activeVideo);
      checkPlayerPlaybackWatchdog();
    }
    enforcePlayerNoScrollbars();
    enforceDubSelection();
  }, 1200);
  if (controllerInterval && typeof controllerInterval.unref === 'function') {
    try { controllerInterval.unref(); } catch (e) {}
  }

  function getAllVideos(root = document) {
    const results = [];
    try {
      const vids = root.querySelectorAll('video');
      vids.forEach(v => results.push(v));
      const allEls = root.querySelectorAll('*');
      for (const el of allEls) {
        if (el.shadowRoot) {
          results.push(...getAllVideos(el.shadowRoot));
        }
      }
    } catch (e) {}
    return results;
  }

  function findVideos() {
    enforcePlayerNoScrollbars();
    enforceDubSelection();
    const videos = getAllVideos(document);
    videos.forEach(bindVideoEvents);
    if (videos.length > 0 && (!activeVideo || !activeVideo.isConnected)) {
      activeVideo = videos.find(v => !v.paused) || videos[0];
    }
    checkAndMountPlayerDownloadButton();
  }

  // Register pointerdown to detect when user interacts with player iframe
  document.addEventListener('pointerdown', () => {
    findVideos();
    if (activeVideo && window !== window.top) {
      try {
        window.top.postMessage({ type: 'FOCUSGUARD_VIDEO_ACTIVE' }, '*');
      } catch (e) {}
    }
  }, true);

  // Observe DOM for newly inserted videos, players, or server lists
  const domObserver = new MutationObserver(() => {
    findVideos();
    enforcePlayerNoScrollbars();
    enforceDubSelection();
    if (isEnabled()) {
      if (playerSettings.enableAutoSkipIntro || playerSettings.enableAutoSkipOutro) {
        scanForSkipButtons();
      }
      if (playerSettings.enableAutoSelectEng) {
        autoSelectEnglish(activeVideo);
      }
    }
  });

  const rootToObserve = document.documentElement || document.body;
  if (rootToObserve) {
    domObserver.observe(rootToObserve, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      domObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
      findVideos();
      enforcePlayerNoScrollbars();
      enforceDubSelection();
      autoSelectEnglish(activeVideo);
    });
  }

  findVideos();
  enforcePlayerNoScrollbars();
  enforceDubSelection();

  // 4. Auto-Play Implementation
  function checkAutoPlay(video) {
    if (!isEnabled() || !playerSettings.enableAutoPlay) return;
    if (!video || !video.paused) return;

    // Attempt video.play()
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          showHud('▶', 'Auto-Playing');
        })
        .catch((err) => {
          // If blocked by browser autoplay policy (NotAllowedError)
          if (err.name === 'NotAllowedError') {
            // Mute and play as smooth fallback
            video.muted = true;
            video.play()
              .then(() => {
                showHud('🔇', 'Autoplay (Muted - Press M to unmute)', { duration: 1500 });
              })
              .catch(() => {});

            // Also listen for first user click anywhere to unmute/play
            const onFirstTouch = () => {
              video.play().catch(() => {});
              window.removeEventListener('click', onFirstTouch, true);
              window.removeEventListener('keydown', onFirstTouch, true);
            };
            window.addEventListener('click', onFirstTouch, true);
            window.addEventListener('keydown', onFirstTouch, true);
          }
        });
    }

    // Also look for common custom player play buttons and trigger them
    triggerCustomPlayButtons();
  }

  function triggerCustomPlayButtons() {
    const playSelectors = [
      '.jw-display-icon-container',
      '.vjs-big-play-button',
      '.play-btn',
      '.btn-play',
      '#player-play-btn',
      'button[aria-label="Play"]',
      '[data-action="play"]'
    ];

    for (const sel of playSelectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        try {
          btn.click();
        } catch (e) {}
        break;
      }
    }
  }

  // 5. Auto-Skip Intro & Outro Engine
  function scanForSkipButtons() {
    if (!isEnabled()) return;
    const wasFs = isCurrentlyFullscreen();

    const introSelectors = [
      '#skip-intro',
      '.skip-intro',
      '[class*="skip-intro"]',
      '[class*="skipIntro"]',
      '.btn-skip-intro',
      '[data-action="skip-intro"]'
    ];

    const outroSelectors = [
      '#skip-outro',
      '.skip-outro',
      '[class*="skip-outro"]',
      '[class*="skipOutro"]',
      '.btn-skip-outro',
      '[data-action="skip-outro"]'
    ];

    // Check Intro Buttons
    if (playerSettings.enableAutoSkipIntro && !introSkippedForCurrentVideo) {
      for (const sel of introSelectors) {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) {
          console.log('[FocusGuard] Auto-clicking Skip Intro button:', btn);
          btn.click();
          introSkippedForCurrentVideo = true;
          showHud('⚡', 'Auto-Skipped Intro', { isSkip: true });
          ensureFullscreenMaintained(wasFs);
          return;
        }
      }

      // Check text content on buttons/divs
      const clickables = document.querySelectorAll('button, a, div[role="button"], span[role="button"]');
      for (const el of clickables) {
        if (el.offsetParent !== null) {
          const txt = (el.textContent || '').trim().toLowerCase();
          if (txt === 'skip intro' || txt === 'skip op' || txt === 'skip opening' || txt === "passer l'intro") {
            console.log('[FocusGuard] Auto-clicking Skip Intro by text:', el);
            el.click();
            introSkippedForCurrentVideo = true;
            showHud('⚡', 'Auto-Skipped Intro', { isSkip: true });
            ensureFullscreenMaintained(wasFs);
            return;
          }
        }
      }
    }

    // Check Outro Buttons
    if (playerSettings.enableAutoSkipOutro && !outroSkippedForCurrentVideo) {
      for (const sel of outroSelectors) {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) {
          console.log('[FocusGuard] Auto-clicking Skip Outro button:', btn);
          btn.click();
          outroSkippedForCurrentVideo = true;
          showHud('⚡', 'Auto-Skipped Outro', { isSkip: true });
          ensureFullscreenMaintained(wasFs);
          return;
        }
      }

      const clickables = document.querySelectorAll('button, a, div[role="button"], span[role="button"]');
      for (const el of clickables) {
        if (el.offsetParent !== null) {
          const txt = (el.textContent || '').trim().toLowerCase();
          if (txt === 'skip outro' || txt === 'skip ed' || txt === 'skip ending') {
            console.log('[FocusGuard] Auto-clicking Skip Outro by text:', el);
            el.click();
            outroSkippedForCurrentVideo = true;
            showHud('⚡', 'Auto-Skipped Outro', { isSkip: true });
            ensureFullscreenMaintained(wasFs);
            return;
          }
        }
      }
    }
  }

  // Periodic polling check during playback
  setInterval(scanForSkipButtons, 400);

  function handleTimeUpdate(video) {
    if (!video || !isEnabled()) return;
    const cur = video.currentTime;
    const dur = video.duration;

    // Scan for buttons during intro period (first 3.5 minutes)
    if (playerSettings.enableAutoSkipIntro && !introSkippedForCurrentVideo && cur < 210) {
      scanForSkipButtons();
    }

    // Auto Next trigger near the very end of video
    if (playerSettings.enableAutoNext && dur > 60 && cur >= dur - 1.5) {
      handleVideoEnded(video);
    }
  }

  // 6. Auto Next Episode Engine
  let lastEndedTimestamp = 0;

  function handleVideoEnded(video) {
    if (!isEnabled() || !playerSettings.enableAutoNext) return;

    // Debounce triggers
    const now = Date.now();
    if (now - lastEndedTimestamp < 5000) return;
    lastEndedTimestamp = now;

    // Look for Next Episode links or buttons on Aniwatch / HiAnime / general sites
    const nextSelectors = [
      '.btn-next',
      '.btn-next-ep',
      'a.next-episode',
      '.ep-item.active + .ep-item a',
      '.item.active + .item a',
      '[data-number].active + [data-number] a',
      '#next-ep',
      'button.btn-next',
      'a[title*="Next Episode"]',
      'a[aria-label*="Next Episode"]'
    ];

    let foundEl = null;
    let foundUrl = '';

    for (const sel of nextSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        foundEl = el;
        foundUrl = el.getAttribute('href') || el.href || '';
        break;
      }
    }

    if (foundEl || foundUrl) {
      console.log('[FocusGuard] Detected Next Episode element:', foundEl || foundUrl);
      showNextEpisodeCountdown(foundEl, foundUrl);
    } else {
      // If we are inside an iframe and didn't find next button here, notify top window!
      if (window !== window.top) {
        try {
          window.top.postMessage({ type: 'FOCUSGUARD_VIDEO_ENDED' }, '*');
        } catch (e) {}
      }
    }
  }

  // 7. Rock-Solid Fullscreen Engine with Scrollbar Disabler & State Retention
  function isCurrentlyFullscreen() {
    return !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement ||
      document.querySelector('.fg-theater-fullscreen') ||
      (document.body && document.body.classList && document.body.classList.contains('fg-theater-active')) ||
      (document.documentElement && document.documentElement.classList && document.documentElement.classList.contains('fg-theater-active'))
    );
  }

  function exitAllFullscreen() {
    try { sessionStorage.removeItem('fg_fullscreen_persisted'); } catch (e) {}

    const exitFs =
      document.exitFullscreen ||
      document.webkitExitFullscreen ||
      document.mozCancelFullScreen ||
      document.msExitFullscreen;

    if (exitFs && (document.fullscreenElement || document.webkitFullscreenElement)) {
      exitFs.call(document).catch(() => {});
    }

    if (document.body && document.body.classList) {
      document.body.classList.remove('fg-theater-active', 'fg-fullscreen-active');
    }
    if (document.documentElement && document.documentElement.classList) {
      document.documentElement.classList.remove('fg-theater-active', 'fg-fullscreen-active');
    }

    const theaterEls = document.querySelectorAll('.fg-theater-fullscreen');
    theaterEls.forEach((el) => el.classList.remove('fg-theater-fullscreen'));

    if (window !== window.top) {
      try {
        window.top.postMessage({ type: 'FOCUSGUARD_EXIT_FULLSCREEN' }, '*');
      } catch (e) {}
    }

    showHud('⛶', 'Exit Fullscreen');
  }

  function toggleTheaterFullscreen(el) {
    if (!el) return;
    if (el.classList.contains('fg-theater-fullscreen')) {
      exitAllFullscreen();
    } else {
      document.body.classList.add('fg-theater-active', 'fg-fullscreen-active');
      if (document.documentElement) document.documentElement.classList.add('fg-theater-active', 'fg-fullscreen-active');
      el.classList.add('fg-theater-fullscreen');
      try { sessionStorage.setItem('fg_fullscreen_persisted', 'true'); } catch (e) {}
      showHud('⛶', 'Fullscreen');
    }
  }

  function fallbackToTheaterOrBridge(target) {
    toggleTheaterFullscreen(target);
    if (window !== window.top) {
      try {
        window.top.postMessage({ type: 'FOCUSGUARD_REQUEST_PARENT_FULLSCREEN' }, '*');
      } catch (e) {}
    }
  }

  function toggleFullscreen(preferredTarget) {
    if (!isEnabled() || !playerSettings.enableFullscreenFix) return;

    if (isCurrentlyFullscreen()) {
      exitAllFullscreen();
      return;
    }

    try { sessionStorage.setItem('fg_fullscreen_persisted', 'true'); } catch (e) {}
    document.documentElement.classList.add('fg-fullscreen-active');
    document.body.classList.add('fg-fullscreen-active');

    // Target element: preferred video, active video, or parent container
    let target = preferredTarget || activeVideo;
    if (!target) {
      findVideos();
      target = activeVideo;
    }

    // If on top window without a local video, target the embedded iframe or player container
    if (window === window.top && !target) {
      target = document.querySelector('iframe[src*="embed"], iframe[src*="megacloud"], iframe[src*="rapid-cloud"], iframe, .player-container, #player, #iframe-embed');
    }

    // If player has a container element (e.g. jwplayer or player wrapper), prefer it
    if (target && target.tagName !== 'IFRAME') {
      const container = target.closest('.jwplayer, .video-js, [id*="player"], .player-container, #player');
      if (container) target = container;
    }

    if (!target) target = document.documentElement;

    // Check if the current document is allowed native fullscreen by Permissions Policy
    const isFsAllowed = (document.fullscreenEnabled !== false) && 
                        (document.webkitFullscreenEnabled !== false);

    if (isFsAllowed) {
      const requestFs =
        target.requestFullscreen ||
        target.webkitRequestFullscreen ||
        target.mozRequestFullScreen ||
        target.msRequestFullscreen;

      if (requestFs) {
        try {
          const p = requestFs.call(target);
          if (p && typeof p.then === 'function') {
            p.then(() => {
              showHud('⛶', 'Fullscreen');
            }).catch(() => {
              fallbackToTheaterOrBridge(target);
            });
            return;
          } else {
            showHud('⛶', 'Fullscreen');
            return;
          }
        } catch (err) {
          fallbackToTheaterOrBridge(target);
          return;
        }
      }
    }

    // Document is disallowed native fullscreen by Permissions Policy -> seamlessly fall back to Theater mode / bridge
    fallbackToTheaterOrBridge(target);
  }

  // Native fullscreenchange listener to toggle scrollbar killer class and persist state
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
      document.documentElement.classList.add('fg-fullscreen-active');
      document.body.classList.add('fg-fullscreen-active');
      try { sessionStorage.setItem('fg_fullscreen_persisted', 'true'); } catch (e) {}
    } else if (!document.querySelector('.fg-theater-fullscreen')) {
      document.documentElement.classList.remove('fg-fullscreen-active');
      document.body.classList.remove('fg-fullscreen-active');
    }
  });

  // Listen for Escape key to exit theater fullscreen
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isCurrentlyFullscreen()) {
      exitAllFullscreen();
    }
  }, true);

  // 7.5 Native Player Fullscreen Button Handler
  // Guarantees that clicking the site's existing player fullscreen button always works,
  // falling back to Theater / Bridge Fullscreen if the iframe or browser restricts native fullscreen.
  document.addEventListener('click', (e) => {
    if (!isEnabled() || !playerSettings.enableFullscreenFix) return;
    const target = e.target;
    if (!target) return;

    const fsBtn = target.closest && target.closest(
      '.jw-icon-fullscreen, .vjs-fullscreen-control, .art-control-fullscreen, .plyr__control[data-plyr="fullscreen"], [class*="fullscreen"], [id*="fullscreen"], [aria-label*="ullscreen" i], [title*="ullscreen" i], [data-action*="fullscreen" i]'
    );

    if (fsBtn) {
      console.log('[FocusGuard] Detected click on native player fullscreen button:', fsBtn);

      if (isCurrentlyFullscreen()) {
        exitAllFullscreen();
        return;
      }

      // Check if native fullscreen succeeds within 70ms; if not, activate FocusGuard engine
      setTimeout(() => {
        if (!isCurrentlyFullscreen()) {
          console.log('[FocusGuard] Native fullscreen did not activate. Activating fallback...');
          toggleFullscreen(activeVideo);
        }
      }, 70);
    }
  }, true);

  // 8. Cross-Frame Message Bus Listener
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    // Track which frame has the active video
    if (data.type === 'FOCUSGUARD_VIDEO_ACTIVE') {
      activePlayerSource = event.source;
      if (window === window.top) {
        const iframes = document.querySelectorAll('iframe');
        for (const ifr of iframes) {
          try {
            if (ifr.contentWindow === event.source) {
              activePlayerIframe = ifr;
              break;
            }
          } catch (e) {}
        }
      }
    }

    // Child iframe requested parent window to fullscreen its iframe element
    if (data.type === 'FOCUSGUARD_REQUEST_PARENT_FULLSCREEN') {
      if (window === window.top) {
        try { sessionStorage.setItem('fg_fullscreen_persisted', 'true'); } catch (e) {}
        // Find iframe matching sender
        const iframes = document.querySelectorAll('iframe');
        let matchedIframe = null;
        for (const ifr of iframes) {
          try {
            if (ifr.contentWindow === event.source) {
              matchedIframe = ifr;
              break;
            }
          } catch (e) {}
        }

        const target = matchedIframe || document.querySelector('iframe[src*="embed"], iframe[src*="megacloud"], iframe[src*="rapid-cloud"], iframe, .player-container, #player, #iframe-embed');
        if (target) {
          const req = target.requestFullscreen || target.webkitRequestFullscreen || target.mozRequestFullScreen;
          if (req) {
            req.call(target).then(() => {
              showHud('⛶', 'Fullscreen (Bridge)');
            }).catch(() => {
              toggleTheaterFullscreen(target);
            });
          } else {
            toggleTheaterFullscreen(target);
          }
        }
      }
    }

    // Child iframe requested exit fullscreen
    if (data.type === 'FOCUSGUARD_EXIT_FULLSCREEN') {
      if (window === window.top) {
        exitAllFullscreen();
      }
    }

    // Video ended message from child iframe to parent window
    if (data.type === 'FOCUSGUARD_VIDEO_ENDED') {
      if (window === window.top) {
        handleVideoEnded(null);
      }
    }

    // Keyboard command received from parent or another frame
    if (data.type === 'FOCUSGUARD_PLAYER_CMD') {
      if (data.msgId) {
        if (processedMessageIds.has(data.msgId)) return;
        processedMessageIds.add(data.msgId);
        if (processedMessageIds.size > 100) {
          const oldest = processedMessageIds.values().next().value;
          processedMessageIds.delete(oldest);
        }
      }

      findVideos();
      if (activeVideo) {
        executePlayerCommand(data.cmd, data.value);
        // Reply with current state so sender can show HUD
        const ackMsg = {
          type: 'FOCUSGUARD_PLAYER_CMD_ACK',
          cmd: data.cmd,
          paused: activeVideo.paused,
          currentTime: activeVideo.currentTime,
          duration: activeVideo.duration,
          volume: activeVideo.volume,
          muted: activeVideo.muted,
          playbackRate: activeVideo.playbackRate
        };
        try {
          if (event.source && event.source !== window) {
            event.source.postMessage(ackMsg, '*');
          }
        } catch (e) {}
        if (window !== window.top) {
          try {
            window.top.postMessage(ackMsg, '*');
          } catch (e) {}
        }
      } else {
        // Broadcast down to child iframes
        broadcastCommand(data.cmd, data.value, data.msgId);
      }
    }

    // Stream detected in child frame
    if (data.type === 'FOCUSGUARD_STREAM_DETECTED' && data.streamUrl && !isSegmentChunkUrl(data.streamUrl)) {
      detectedStreamUrl = data.streamUrl;
      if (data.embedUrl) detectedEmbedUrl = data.embedUrl;
      if (data.playlistText) cachedPlaylistText = data.playlistText;

      if (!cachedPlaylistText && (detectedStreamUrl.includes('.m3u8') || detectedStreamUrl.includes('/hls/') || /manifest|playlist/i.test(detectedStreamUrl))) {
        fetchResourceSafe(detectedStreamUrl, detectedEmbedUrl, false).then(text => {
          if (text && text.includes('#EXTM3U')) cachedPlaylistText = text;
        }).catch(() => {});
      }
    }

    // Save blob delegated from child iframe to top-level window
    if (data.type === 'FOCUSGUARD_SAVE_BLOB' && data.blob) {
      let finalFilename = data.filename || 'Episode_Video.mp4';
      if (window === window.top) {
        try {
          const topMeta = getEpisodeMetadata(document, data.quality);
          if (topMeta && topMeta.animeTitle && !finalFilename.toLowerCase().endsWith('.json')) {
            if (/^(?:Episode\s*\d+|Video)/i.test(finalFilename) || !finalFilename.includes(topMeta.animeTitle)) {
              finalFilename = topMeta.filename;
            }
          }
        } catch (e) {}
      }
      saveBlobDirectlyOrDelegate(data.blob, finalFilename);
      showHud('✅', `Downloaded: ${finalFilename}`, { isSuccess: true, duration: 3500 });
    }

    // Progress notification from child iframe during HLS download
    if (data.type === 'FOCUSGUARD_DOWNLOAD_PROGRESS') {
      const extraStr = data.total ? `(${data.completed}/${data.total})` : '';
      showHud('⬇️', `Downloading Ep. ${data.episodeNum || ''} [${data.quality || ''}]: ${data.pct}%`, {
        progress: data.pct,
        isDownload: true,
        extra: extraStr,
        duration: 2000
      });
    }

    // Player error reported by child frame (e.g. Error 232403)
    if (data.type === 'FOCUSGUARD_PLAYER_ERROR') {
      console.warn('[FocusGuard] Received player error notification from frame:', data);
      handlePlayerErrorAutoRecovery();
    }

    // Response from child frame acknowledging keyboard command
    if (data.type === 'FOCUSGUARD_PLAYER_CMD_ACK') {
      renderAckHud(data);
    }
  });

  function renderAckHud(data) {
    if (data.cmd === 'toggle_play') {
      showHud(data.paused ? '⏸' : '▶', data.paused ? 'Paused' : 'Playing');
    } else if (data.cmd === 'seek_forward' || data.cmd === 'seek_backward') {
      const icon = data.cmd === 'seek_forward' ? '⏩' : '⏪';
      showHud(icon, formatTime(data.currentTime), { extra: `/ ${formatTime(data.duration)}` });
    } else if (data.cmd === 'volume_up' || data.cmd === 'volume_down') {
      const pct = Math.round(data.volume * 100);
      showHud(data.muted ? '🔇' : '🔊', `${pct}%`, { progress: pct });
    } else if (data.cmd === 'toggle_mute') {
      showHud(data.muted ? '🔇' : '🔊', data.muted ? 'Muted' : 'Unmuted');
    } else if (data.cmd === 'speed_up' || data.cmd === 'speed_down') {
      showHud('⚡', `Speed: ${data.playbackRate.toFixed(2)}x`);
    } else if (data.cmd === 'skip_intro') {
      showHud('⚡', 'Skipped Intro (+85s)', { isSkip: true });
    } else if (data.cmd === 'skip_outro') {
      showHud('⚡', 'Skipped Outro (+85s)', { isSkip: true });
    }
  }

  // 9. Execute Video Action Locally
  function executePlayerCommand(cmd, value) {
    if (!activeVideo) return;

    switch (cmd) {
      case 'toggle_play':
        if (activeVideo.paused) {
          activeVideo.play().then(() => {
            showHud('▶', 'Playing');
          }).catch(() => {});
        } else {
          activeVideo.pause();
          showHud('⏸', 'Paused');
        }
        break;

      case 'seek_forward': {
        const step = Number(value) || playerSettings.seekSeconds || 5;
        activeVideo.currentTime = Math.min(activeVideo.duration || Infinity, activeVideo.currentTime + step);
        showHud('⏩', formatTime(activeVideo.currentTime), { extra: `/ ${formatTime(activeVideo.duration)}` });
        break;
      }

      case 'seek_backward': {
        const step = Number(value) || playerSettings.seekSeconds || 5;
        activeVideo.currentTime = Math.max(0, activeVideo.currentTime - step);
        showHud('⏪', formatTime(activeVideo.currentTime), { extra: `/ ${formatTime(activeVideo.duration)}` });
        break;
      }

      case 'volume_up': {
        const step = Number(value) || 0.05;
        activeVideo.muted = false;
        activeVideo.volume = Math.min(1, activeVideo.volume + step);
        const pct = Math.round(activeVideo.volume * 100);
        showHud('🔊', `${pct}%`, { progress: pct });
        break;
      }

      case 'volume_down': {
        const step = Number(value) || 0.05;
        activeVideo.volume = Math.max(0, activeVideo.volume - step);
        const pct = Math.round(activeVideo.volume * 100);
        showHud(activeVideo.volume === 0 ? '🔇' : '🔊', `${pct}%`, { progress: pct });
        break;
      }

      case 'toggle_mute':
        activeVideo.muted = !activeVideo.muted;
        showHud(activeVideo.muted ? '🔇' : '🔊', activeVideo.muted ? 'Muted' : 'Unmuted');
        break;

      case 'toggle_fullscreen':
        toggleFullscreen(activeVideo);
        break;

      case 'skip_intro': {
        const wasFs = isCurrentlyFullscreen();
        scanForSkipButtons();
        const jump = Number(value) || playerSettings.skipIntroSeconds || 85;
        activeVideo.currentTime = Math.min(activeVideo.duration || Infinity, activeVideo.currentTime + jump);
        showHud('⚡', `Skipped Intro (+${jump}s)`, { isSkip: true });
        ensureFullscreenMaintained(wasFs);
        break;
      }

      case 'skip_outro': {
        const wasFs = isCurrentlyFullscreen();
        scanForSkipButtons();
        const jump = Number(value) || playerSettings.skipIntroSeconds || 85;
        activeVideo.currentTime = Math.min(activeVideo.duration || Infinity, activeVideo.currentTime + jump);
        showHud('⚡', `Skipped Outro (+${jump}s)`, { isSkip: true });
        ensureFullscreenMaintained(wasFs);
        break;
      }

      case 'speed_up': {
        const rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
        const next = rates.find(r => r > activeVideo.playbackRate + 0.01) || 3;
        activeVideo.playbackRate = next;
        showHud('⚡', `Speed: ${next}x`);
        break;
      }

      case 'speed_down': {
        const rates = [3, 2.5, 2, 1.75, 1.5, 1.25, 1, 0.75, 0.5, 0.25];
        const prev = rates.find(r => r < activeVideo.playbackRate - 0.01) || 0.25;
        activeVideo.playbackRate = prev;
        showHud('⚡', `Speed: ${prev}x`);
        break;
      }

      case 'toggle_speed': {
        const rates = [1, 1.25, 1.5, 1.75, 2, 0.75];
        const next = rates.find(r => r > activeVideo.playbackRate + 0.05) || 1;
        activeVideo.playbackRate = next;
        showHud('⚡', `Speed: ${next}x`);
        break;
      }

      case 'seek_percent': {
        const pct = Math.max(0, Math.min(1, Number(value)));
        if (!isNaN(activeVideo.duration) && activeVideo.duration > 0) {
          activeVideo.currentTime = activeVideo.duration * pct;
          showHud('📍', formatTime(activeVideo.currentTime), { extra: `(${Math.round(pct * 100)}%)` });
        }
        break;
      }

      case 'next_episode':
        handleVideoEnded(activeVideo);
        break;

      case 'download_video':
        downloadActiveVideo(value);
        break;
    }
  }

  // Helper to check if user is typing in form/comment fields
  function isTypingContext(target) {
    if (!target) return false;
    const tag = target.tagName ? target.tagName.toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') return true;
    if (target.closest && target.closest('[contenteditable="true"], input, textarea, select')) return true;
    return false;
  }

  // Broadcast command to all child iframes and to top window
  function broadcastCommand(cmd, value, sourceMsgId) {
    const msgId = sourceMsgId || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const msg = { type: 'FOCUSGUARD_PLAYER_CMD', cmd: cmd, value: value, msgId: msgId };

    // 1. Direct message to known active player source frame
    if (activePlayerSource) {
      try {
        activePlayerSource.postMessage(msg, '*');
      } catch (e) {}
    }

    // 2. Broadcast down to all child iframes (including shadow roots)
    function sendToIframes(root = document) {
      try {
        const ifrs = root.querySelectorAll('iframe');
        ifrs.forEach((ifr) => {
          try {
            if (ifr.contentWindow) {
              ifr.contentWindow.postMessage(msg, '*');
            }
          } catch (e) {}
        });
        const allEls = root.querySelectorAll('*');
        for (const el of allEls) {
          if (el.shadowRoot) sendToIframes(el.shadowRoot);
        }
      } catch (e) {}
    }

    sendToIframes(document);

    // 3. If we're inside an iframe, also post to parent/top
    if (window !== window.top) {
      try {
        window.top.postMessage(msg, '*');
      } catch (e) {}
    }
  }

  // 10. Global Keyboard Handler (Capture Phase)
  function handleKeyDown(e) {
    if (!isEnabled() || !playerSettings.enableKeyboardControls) return;

    // Do not intercept if user is typing a comment, searching, or inside input/textarea
    if (isTypingContext(e.target)) return;

    // Do not intercept Ctrl / Alt / Meta system combos (e.g. Ctrl+R, Alt+Tab)
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const key = e.key;
    const lowerKey = key.toLowerCase();
    let handled = false;
    let cmd = null;
    let val = null;

    findVideos();
    const hasLocalVideo = !!activeVideo;

    // --- Media Controls Key Matrix ---
    // 1. Play / Pause
    if (key === ' ' || lowerKey === 'k') {
      cmd = 'toggle_play';
      handled = true;
    }
    // 2. Seek Backward (5s or 15s)
    else if (key === 'ArrowLeft' || lowerKey === 'j') {
      cmd = 'seek_backward';
      val = e.shiftKey ? 15 : playerSettings.seekSeconds;
      handled = true;
    }
    // 3. Seek Forward (5s or 15s)
    else if (key === 'ArrowRight' || lowerKey === 'l') {
      cmd = 'seek_forward';
      val = e.shiftKey ? 15 : playerSettings.seekSeconds;
      handled = true;
    }
    // 4. Volume Up
    else if (key === 'ArrowUp') {
      cmd = 'volume_up';
      val = 0.05;
      handled = true;
    }
    // 5. Volume Down
    else if (key === 'ArrowDown') {
      cmd = 'volume_down';
      val = 0.05;
      handled = true;
    }
    // 6. Mute Toggle
    else if (lowerKey === 'm') {
      cmd = 'toggle_mute';
      handled = true;
    }
    // 7. Fullscreen Toggle
    else if (lowerKey === 'f') {
      cmd = 'toggle_fullscreen';
      handled = true;
    }
    // 8. Skip Intro (S or I)
    else if (lowerKey === 's' || lowerKey === 'i') {
      cmd = 'skip_intro';
      val = playerSettings.skipIntroSeconds;
      handled = true;
    }
    // 9. Skip Outro (O)
    else if (lowerKey === 'o') {
      cmd = 'skip_outro';
      val = playerSettings.skipIntroSeconds;
      handled = true;
    }
    // 10. Speed Control ([ / ] or < / >)
    else if (key === ']' || key === '>') {
      cmd = 'speed_up';
      handled = true;
    } else if (key === '[' || key === '<') {
      cmd = 'speed_down';
      handled = true;
    }
    // 11. Percentage Seek (0 - 9)
    else if (/^[0-9]$/.test(key)) {
      cmd = 'seek_percent';
      val = parseInt(key, 10) / 10;
      handled = true;
    }
    // 12. Next Episode (N or P)
    else if (lowerKey === 'n' || lowerKey === 'p') {
      cmd = 'next_episode';
      handled = true;
    }
    // 13. Download Episode (D)
    else if (lowerKey === 'd') {
      cmd = 'download_video';
      handled = true;
    }

    if (handled && cmd) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (cmd === 'toggle_fullscreen') {
        toggleFullscreen();
        broadcastCommand(cmd, val);
      } else if (hasLocalVideo) {
        executePlayerCommand(cmd, val);
      } else {
        // Broadcast across frames to find the active player
        broadcastCommand(cmd, val);
        if (activePlayerIframe && typeof activePlayerIframe.focus === 'function') {
          try { activePlayerIframe.focus(); } catch (err) {}
        }
      }
    }
  }

  // Register keyboard handler on window capture phase
  window.addEventListener('keydown', handleKeyDown, true);

  // 11. Extension Popup Communication Bridge
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg) return;

      if (msg.action === 'execute_player_cmd') {
        findVideos();
        if (activeVideo) {
          executePlayerCommand(msg.cmd, msg.value);
          sendResponse({ success: true, target: 'local' });
        } else {
          broadcastCommand(msg.cmd, msg.value);
          sendResponse({ success: true, target: 'broadcast' });
        }
        return true;
      }

      if (msg.action === 'cancel_tab_download' && msg.jobId) {
        if (activeHlsAbortControllers.has(msg.jobId)) {
          const ctrl = activeHlsAbortControllers.get(msg.jobId);
          try { ctrl.abort(); } catch (e) {}
          activeHlsAbortControllers.delete(msg.jobId);
          sendResponse({ success: true, aborted: true });
          return true;
        }
      }

    });
  }

  console.log('[FocusGuard] Video Player Suite initialized in frame:', window.location.href);

  // Expose helpers for automated testing and extension inspection
  try {
    window.__focusguard_get_episode_metadata__ = getEpisodeMetadata;
    window.__focusguard_download_video__ = downloadActiveVideo;
    window.__focusguard_mount_download_btn__ = mountDownloadButton;
    window.__focusguard_parse_playlist__ = parseMasterPlaylist;
    window.__focusguard_get_available_qualities__ = getAvailableQualities;
    window.__focusguard_parse_byterange__ = parseHlsByteRange;
    window.__focusguard_format_size__ = formatDataSize;
    window.__focusguard_toggle_quality_popover__ = toggleQualityPopover;
    window.__focusguard_resolve_active_stream__ = resolveActiveStreamUrl;
    window.__focusguard_detect_stream_format__ = detectStreamFormat;
    window.__focusguard_convert_remux_stream__ = convertAndRemuxStreamForSmoothPlayback;
    window.__focusguard_download_metadata_file__ = downloadEpisodeMetadataFile;
    window.__focusguard_decode_base64__ = decodeBase64ToArrayBuffer;
    window.__focusguard_playback_stall_recovery__ = handlePlaybackStallRecovery;
    window.__focusguard_check_playback_watchdog__ = checkPlayerPlaybackWatchdog;
    window.__focusguard_extract_audio_renditions__ = extractAudioRenditions;
    window.__focusguard_combine_fmp4_video_audio__ = combineFmp4VideoAndAudio;
    window.__focusguard_patch_moof_trun_offsets__ = patchMoofTrunDataOffsets;
    window.__focusguard_parse_hls_segments__ = parseHlsSegments;
    window.__focusguard_download_hls_stream__ = downloadHlsStream;
  } catch (e) {}

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      getEpisodeMetadata,
      mountDownloadButton,
      updateDownloadButtonLabel,
      downloadActiveVideo,
      formatTime,
      parseMasterPlaylist,
      getAvailableQualities,
      parseHlsByteRange,
      formatDataSize,
      toggleQualityPopover,
      resolveActiveStreamUrl,
      saveBlobDirectlyOrDelegate,
      fallbackAnchorDownload,
      isRecentlySaved,
      isRecentlyAnchorDownloaded,
      recentSavedBlobs,
      recentAnchorDownloads,
      detectStreamFormat,
      parseSps,
      createMp4Box,
      buildIlstMetadataBox,
      optimizeFmp4ForSmoothPlayback,
      smoothMpegTsTimestamps,
      transmuxTsToSmoothMp4,
      convertAndRemuxStreamForSmoothPlayback,
      generateEpisodeMetadataPayload,
      downloadEpisodeMetadataFile,
      decodeBase64ToArrayBuffer,
      handlePlaybackStallRecovery,
      checkPlayerPlaybackWatchdog,
      extractAudioRenditions,
      combineFmp4VideoAndAudio,
      patchMoofTrunDataOffsets,
      parseHlsSegments,
      downloadHlsStream
    };
  }
})();

