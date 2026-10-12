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
  let detectedStreamUrl = null;
  let detectedEmbedUrl = null;
  let cachedPlaylistText = null;
  let cachedEpisodeMeta = null;
  let userManuallySelectedCategory = null;
  let isAutoRecovering = false;
  let playerErrorRecoveryCount = 0;
  let lastPlayerErrorCheckTime = 0;

  // Listen for video stream sniffer events from inject.js
  window.addEventListener('__focusguard_stream_detected__', (e) => {
    if (e.detail && e.detail.url && !e.detail.url.startsWith('blob:')) {
      detectedStreamUrl = e.detail.url;
      if (e.detail.embedUrl) detectedEmbedUrl = e.detail.embedUrl;
      if (e.detail.playlistText) cachedPlaylistText = e.detail.playlistText;
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

    requestAnimationFrame(() => {
      badge.classList.add('fg-hud-visible');
    });

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

  // 3.5 Video Downloader & Episode Filename Resolver
  function getEpisodeMetadata(targetDoc, quality = null) {
    const doc = targetDoc || (typeof document !== 'undefined' ? document : null);
    const qSuffix = quality ? ` [${quality}]` : '';
    if (!doc) return { episodeNum: '01', animeTitle: '', baseName: `Episode 01${qSuffix}`, filename: `Episode 01${qSuffix}.mp4`, quality: quality || null };

    if (!targetDoc && !quality && cachedEpisodeMeta && cachedEpisodeMeta.timestamp && (Date.now() - cachedEpisodeMeta.timestamp < 1000)) {
      return cachedEpisodeMeta;
    }
    const targetDocToUse = doc;

    let episodeNum = null;
    let animeTitle = null;

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
            break;
          }
          const text = (el.textContent || '').trim();
          const m = text.match(/(?:Episode|Ep\.?|EP)?\s*(\d+)/i);
          if (m) {
            episodeNum = m[1];
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
              break;
            }
          }
        } catch (e) {}
      }
    }

    // C. Priority 3: Page title and URL
    if (!episodeNum && targetDocToUse.title) {
      const titleMatch = targetDocToUse.title.match(/(?:Episode|Ep\.?|EP)\s*(\d+)/i);
      if (titleMatch) episodeNum = titleMatch[1];
    }

    if (!episodeNum) {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const epParam = urlParams.get('ep') || urlParams.get('episode') || urlParams.get('ep_number');
        if (epParam) {
          const m = epParam.match(/(\d+)/);
          if (m) episodeNum = m[1];
        }
      } catch (e) {}
    }

    if (!episodeNum) {
      try {
        const pathMatch = window.location.pathname.match(/ep(?:isode)?[-_/](\d+)/i);
        if (pathMatch) episodeNum = pathMatch[1];
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

    // Extract Anime Title
    const titleSelectors = [
      '.film-name',
      'h2.film-name',
      '#detail-page .heading-name',
      '.anime-title',
      '.player-title'
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

    if (!animeTitle && targetDocToUse.title) {
      let cleanDocTitle = targetDocToUse.title
        .replace(/^Watch\s+/i, '')
        .replace(/\s+Episode\s+\d+.*$/i, '')
        .replace(/\s+English Sub\/Dub.*$/i, '')
        .replace(/\s+online free.*$/i, '')
        .replace(/\s*[-–—|]\s*(?:HiAnime|Aniwatch|Zoro|Kaido|Gogoanime|Watch Anime).*$/i, '')
        .trim();
      if (cleanDocTitle.length > 1) {
        animeTitle = cleanDocTitle;
      }
    }

    let baseName = '';
    if (animeTitle) {
      baseName = `${animeTitle} - Episode ${formattedEp}${qSuffix}`;
    } else {
      baseName = `Episode ${formattedEp}${qSuffix}`;
    }

    const safeBase = baseName.replace(/[\/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
    const filename = `${safeBase}.mp4`;

    const meta = {
      episodeNum: formattedEp,
      animeTitle: animeTitle || '',
      baseName: safeBase,
      filename: filename,
      quality: quality || null,
      timestamp: Date.now()
    };

    if (!targetDoc && !quality) {
      cachedEpisodeMeta = meta;
    }

    return meta;
  }

  // Mount cyber-sleek download button directly onto player container
  function mountDownloadButton(targetOrVideo) {
    if (!isEnabled() || !targetOrVideo) return;

    let container = null;
    let videoEl = null;

    if (targetOrVideo.tagName === 'VIDEO') {
      videoEl = targetOrVideo;
      container = videoEl.closest(
        '#player-wrapper, .player-container, #player-container, #player, .jwplayer, .video-js, .art-video-player, .dplayer, [class*="player-container"], [class*="player-wrapper"]'
      ) || videoEl.parentElement;
    } else {
      container = targetOrVideo;
      videoEl = container.querySelector('video') || activeVideo;
    }

    if (!container) return;

    if (container.querySelector('#focusguard-download-btn')) {
      updateDownloadButtonLabel(container.querySelector('#focusguard-download-btn'));
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

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'focusguard-download-btn';
    btn.className = 'fg-player-download-btn';
    btn.setAttribute('aria-label', 'Download Episode Video');

    const meta = getEpisodeMetadata();
    btn.title = `Download Episode ${meta.episodeNum} (${meta.filename})`;

    btn.innerHTML = `
      <span class="fg-player-download-icon">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </span>
      <span class="fg-player-download-label">Download</span>
      <span class="fg-player-download-badge" id="fg-download-ep-badge">EP ${meta.episodeNum}</span>
    `;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleQualityPopover(host, btn);
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
    if (videoEl) {
      videoEl.addEventListener('play', resetActivity);
      videoEl.addEventListener('pause', () => {
        host.classList.remove('fg-btn-autohide');
        host.classList.add('fg-btn-visible');
      });
    }
  }

  function updateDownloadButtonLabel(btn) {
    if (!btn) return;
    const meta = getEpisodeMetadata();
    const badge = btn.querySelector('#fg-download-ep-badge');
    if (badge && badge.textContent !== `EP ${meta.episodeNum}`) {
      badge.textContent = `EP ${meta.episodeNum}`;
      btn.title = `Download Episode ${meta.episodeNum} (${meta.filename})`;
    }
  }

  function checkAndMountPlayerDownloadButton() {
    if (!isEnabled()) return;
    if (activeVideo) {
      mountDownloadButton(activeVideo);
      return;
    }
    const ifr = document.querySelector(
      'iframe[src*="embed"], iframe[src*="megacloud"], iframe[src*="rapid-cloud"], iframe[src*="vidsrc"], iframe[src*="stream"], #iframe-embed'
    );
    if (ifr) {
      const playerWrapper = ifr.closest('#player-wrapper, .player-container, #player, .film-player') || ifr.parentElement;
      if (playerWrapper) {
        mountDownloadButton(playerWrapper);
      }
    }
  }

  // Trigger file download via chrome.downloads or synthetic anchor fallback
  function triggerFileSave(target, filename) {
    if (!target) return;

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

  // Delegates blob saving to top-level window if inside iframe, or downloads directly
  function saveBlobDirectlyOrDelegate(blob, filename) {
    if (!blob) return;

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
        }, 45000);
      }
    } catch (err) {
      console.error('[FocusGuard] saveBlobDirectlyOrDelegate error:', err);
    }
  }

  function fallbackAnchorDownload(url, filename) {
    try {
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

  // Fetch stream resource safely using background proxy to eliminate CDN HTTP 403 Forbidden
  async function fetchResourceSafe(url, embedUrl = null, asBinary = false) {
    let effectiveEmbed = embedUrl || detectedEmbedUrl;
    if (!effectiveEmbed) {
      if (window !== window.top) {
        effectiveEmbed = window.location.href;
      } else {
        const ifr = document.querySelector('iframe[src*="megacloud"], iframe[src*="rapid-cloud"], iframe[src*="embed"], iframe[src*="vidsrc"], iframe[src*="rabbitstream"]');
        if (ifr && ifr.src) effectiveEmbed = ifr.src;
      }
    }
    if (!effectiveEmbed) effectiveEmbed = window.location.href;

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        const res = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            action: 'fetch_stream_data',
            url: url,
            embedUrl: effectiveEmbed,
            asBinary: asBinary
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
            const binaryString = atob(res.base64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes.buffer;
          }
          if (!asBinary && res.text) {
            return res.text;
          }
        }
      } catch (err) {}
    }

    // Direct fetch fallback
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Playlist HTTP ${res.status}`);
    return asBinary ? await res.arrayBuffer() : await res.text();
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
    const meta = getEpisodeMetadata();
    const duration = (activeVideo && !isNaN(activeVideo.duration) && activeVideo.duration > 30) ? activeVideo.duration : 1440;
    const streamTarget = detectedStreamUrl || (activeVideo ? (activeVideo.currentSrc || activeVideo.src) : null) || (typeof window !== 'undefined' ? window.location.href : '');
    const tiers = parseMasterPlaylist(cachedPlaylistText, streamTarget, duration);

    let itemsHtml = '';
    tiers.forEach((tier) => {
      const tierClass = tier.quality === '1080p' ? 'fg-tier-1080' :
                        tier.quality === '720p' ? 'fg-tier-720' : 'fg-tier-480';
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

    popover.innerHTML = `
      <div class="fg-quality-header">
        <span class="fg-quality-title">Choose Quality</span>
        <span class="fg-quality-ep-pill">EP ${meta.episodeNum}</span>
      </div>
      <div class="fg-quality-list">
        ${itemsHtml}
      </div>
      <div class="fg-quality-footer">Estimated internet data required</div>
    `;

    const items = popover.querySelectorAll('.fg-quality-item');
    items.forEach((item) => {
      const q = item.getAttribute('data-quality');
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeQualityPopover(popover);
        downloadActiveVideo(q);
      });
    });
  }

  // HLS stream downloader: fetches playlist and segments, stitches into video blob
  async function downloadHlsStream(m3u8Url, filename, onProgress, chosenQuality = '1080p', embedUrl = null) {
    let mediaPlaylistUrl = m3u8Url;
    let playlistContent = cachedPlaylistText;

    if (!playlistContent) {
      playlistContent = await fetchResourceSafe(m3u8Url, embedUrl, false);
    }

    if (playlistContent && playlistContent.includes('#EXT-X-STREAM-INF')) {
      const tiers = parseMasterPlaylist(playlistContent, m3u8Url);
      const chosenTier = tiers.find(t => t.quality === chosenQuality) || tiers[0];
      if (chosenTier && chosenTier.url && chosenTier.url !== m3u8Url) {
        mediaPlaylistUrl = chosenTier.url;
        playlistContent = await fetchResourceSafe(mediaPlaylistUrl, embedUrl, false);
      }
    }

    const lines = playlistContent.split('\n');
    const segmentUrls = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.startsWith('#')) {
        try {
          segmentUrls.push(new URL(line, mediaPlaylistUrl).href);
        } catch (e) {
          segmentUrls.push(line);
        }
      }
    }

    if (segmentUrls.length === 0) {
      throw new Error('No segments found in playlist.');
    }

    const total = segmentUrls.length;
    let completed = 0;
    const buffers = new Array(total);
    const concurrency = 4;
    let nextIdx = 0;

    async function worker() {
      while (nextIdx < total) {
        const idx = nextIdx++;
        const segUrl = segmentUrls[idx];
        let buffer = null;
        let attempts = 0;
        let lastErr = null;

        while (attempts < 3) {
          try {
            buffer = await fetchResourceSafe(segUrl, embedUrl, true);
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
            console.warn(`[FocusGuard] Segment ${idx + 1}/${total} warning:`, lastErr.message);
          }
          buffer = new ArrayBuffer(0); // Gracefully keep stream intact
        }

        buffers[idx] = buffer;
        completed++;
        if (onProgress) {
          const pct = Math.round((completed / total) * 100);
          onProgress(pct, completed, total);
        }
      }
    }

    const workers = [];
    for (let w = 0; w < Math.min(concurrency, total); w++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    const blob = new Blob(buffers, { type: 'video/mp2t' });
    try {
      blob.objectUrl = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(blob) : '';
    } catch (e) {}
    return blob;
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

  // Main download trigger: orchestrates metadata, stream detection, quality selection, and download
  async function downloadActiveVideo(qualityOrMeta = null, maybeMeta = null) {
    if (isDownloading) {
      showHud('⏳', 'Download already in progress...', { duration: 1500 });
      return;
    }

    // Check if player is currently in an unplayable error state
    if (isPlayerInErrorState() && !detectedStreamUrl) {
      showHud('⚠️', 'Player has server error (232403). Auto-recovering server...', { duration: 3200 });
      handlePlayerErrorAutoRecovery();
      return;
    }

    let chosenQuality = '1080p';
    let customMeta = null;

    if (typeof qualityOrMeta === 'string') {
      chosenQuality = qualityOrMeta;
      customMeta = maybeMeta;
    } else if (qualityOrMeta && typeof qualityOrMeta === 'object') {
      if (qualityOrMeta.quality) chosenQuality = qualityOrMeta.quality;
      customMeta = qualityOrMeta;
    }

    if (!['1080p', '720p', '480p'].includes(chosenQuality)) {
      chosenQuality = '1080p';
    }

    const meta = customMeta || getEpisodeMetadata(null, chosenQuality);
    showHud('⬇️', `Preparing ${meta.filename}...`, { isDownload: true, duration: 2200 });

    const btn = document.querySelector('.fg-player-download-btn');
    if (btn) btn.classList.add('fg-downloading');

    isDownloading = true;

    try {
      findVideos();
      const video = activeVideo || (typeof document !== 'undefined' ? document.querySelector('video') : null);
      let targetUrl = null;

      // 1. Inspect JWPlayer JS API for genuine stream file URL
      if (typeof window.jwplayer === 'function') {
        try {
          const jw = window.jwplayer();
          if (jw) {
            const item = (typeof jw.getPlaylistItem === 'function') ? jw.getPlaylistItem() : null;
            if (item && item.file && typeof item.file === 'string' && !item.file.startsWith('blob:')) {
              targetUrl = item.file;
            } else if (typeof jw.getPlaylist === 'function') {
              const list = jw.getPlaylist() || [];
              if (list[0] && list[0].file && typeof list[0].file === 'string' && !list[0].file.startsWith('blob:')) {
                targetUrl = list[0].file;
              }
            }
          }
        } catch (e) {}
      }

      // 2. Prioritize sniffed stream URL (from inject.js or window active stream)
      if (!targetUrl || targetUrl.startsWith('blob:')) {
        if (detectedStreamUrl && !detectedStreamUrl.startsWith('blob:')) {
          targetUrl = detectedStreamUrl;
        } else if (window.__focusguard_active_stream__ && !window.__focusguard_active_stream__.startsWith('blob:')) {
          targetUrl = window.__focusguard_active_stream__;
        } else if (video && video.__hls__ && video.__hls__.url && !video.__hls__.url.startsWith('blob:')) {
          targetUrl = video.__hls__.url;
        } else if (typeof window.hls !== 'undefined' && window.hls && window.hls.url && !window.hls.url.startsWith('blob:')) {
          targetUrl = window.hls.url;
        }
      }

      // 3. Only use video.currentSrc / video.src if it is a real HTTP/HTTPS file URL (NEVER blob:)
      if (!targetUrl || targetUrl.startsWith('blob:')) {
        if (video) {
          const rawSrc = video.currentSrc || video.src || '';
          if (rawSrc && !rawSrc.startsWith('blob:')) {
            targetUrl = rawSrc;
          }
        }
      }

      let effectiveEmbedUrl = detectedEmbedUrl;
      if (!effectiveEmbedUrl) {
        if (typeof window !== 'undefined' && window !== window.top) {
          effectiveEmbedUrl = window.location.href;
        } else if (typeof document !== 'undefined') {
          const ifr = document.querySelector(
            '#iframe-embed, iframe#iframe-embed, iframe[src*="megacloud"], iframe[src*="rapid-cloud"], iframe[src*="embed"], iframe[src*="vidsrc"], iframe[src*="rabbitstream"], iframe[src*="stream"], iframe[src*="megaplay"], .film-player iframe'
          );
          if (ifr) {
            effectiveEmbedUrl = ifr.src || ifr.getAttribute('data-src') || ifr.getAttribute('data-url');
          }
        }
      }
      if (!effectiveEmbedUrl && typeof window !== 'undefined') {
        effectiveEmbedUrl = window.location.href;
      }

      // 1. Synthesized / MediaStream player (test_page.html canvas stream or active video with blob URL)
      if (!targetUrl && video && (video.srcObject || video.captureStream || video.mozCaptureStream || (video.src && video.src.startsWith('blob:')))) {
        const stream = video.srcObject || (video.captureStream ? video.captureStream() : (video.mozCaptureStream ? video.mozCaptureStream() : null));
        if (stream) {
          showHud('⬇️', `Capturing Episode ${meta.episodeNum} [${chosenQuality}]...`, { isDownload: true, duration: 2500 });
          const blobUrl = await downloadFromMediaStream(stream, meta.filename, 4000);
          triggerFileSave(blobUrl, meta.filename);
          showHud('✅', `Downloaded: ${meta.filename}`, { isSuccess: true, duration: 3500 });
          return;
        }
      }

      // 2. HLS stream (.m3u8)
      if (targetUrl && targetUrl.includes('.m3u8')) {
        showHud('⬇️', `Fetching Ep. ${meta.episodeNum} [${chosenQuality}] playlist...`, { isDownload: true, duration: 2000 });
        try {
          const blobResult = await downloadHlsStream(targetUrl, meta.filename, (pct, completed, total) => {
            const extraStr = total ? `(${completed}/${total})` : '';
            showHud('⬇️', `Downloading Ep. ${meta.episodeNum} [${chosenQuality}]: ${pct}%`, {
              progress: pct,
              isDownload: true,
              extra: extraStr,
              duration: 2000
            });
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
          }, chosenQuality, effectiveEmbedUrl);
          triggerFileSave(blobResult, meta.filename);
          if (typeof window !== 'undefined' && window === window.top) {
            showHud('✅', `Downloaded: ${meta.filename}`, { isSuccess: true, duration: 3500 });
          }
          return;
        } catch (hlsErr) {
          console.warn('[FocusGuard] HLS download error, trying player stream capture fallback:', hlsErr);
          if (video && (video.captureStream || video.mozCaptureStream)) {
            showHud('⬇️', `Capturing Episode ${meta.episodeNum}...`, { isDownload: true, duration: 2500 });
            const stream = (video.captureStream ? video.captureStream() : video.mozCaptureStream());
            const blobUrl = await downloadFromMediaStream(stream, meta.filename, 4000);
            triggerFileSave(blobUrl, meta.filename);
            showHud('✅', `Downloaded: ${meta.filename}`, { isSuccess: true, duration: 3500 });
            return;
          }
          if (typeof window !== 'undefined' && window === window.top) {
            broadcastCommand('download_video', meta);
            showHud('⬇️', `Requested stream capture for Episode ${meta.episodeNum}...`, { isDownload: true, duration: 2500 });
            return;
          }
          throw hlsErr;
        }
      }

      // 3. Direct video file (MP4, WebM, direct HTTP/HTTPS URL — NEVER blob:)
      if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) && !targetUrl.includes('.m3u8')) {
        triggerFileSave(targetUrl, meta.filename);
        showHud('✅', `Downloading: ${meta.filename}`, { isSuccess: true, duration: 3000 });
        return;
      }

      // 4. Capture directly from video element if available (e.g. MediaSource blob:https://megaplay.buzz/...)
      if (video && (video.captureStream || video.mozCaptureStream)) {
        const stream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
        if (stream) {
          showHud('⬇️', `Capturing Episode ${meta.episodeNum} [${chosenQuality}]...`, { isDownload: true, duration: 2500 });
          const blobUrl = await downloadFromMediaStream(stream, meta.filename, 4000);
          triggerFileSave(blobUrl, meta.filename);
          showHud('✅', `Downloaded: ${meta.filename}`, { isSuccess: true, duration: 3500 });
          return;
        }
      }

      // 5. Cross-frame delegation: ask iframes or parent window
      if (typeof window !== 'undefined') {
        if (window === window.top) {
          broadcastCommand('download_video', meta);
          showHud('⬇️', `Requested stream for Episode ${meta.episodeNum}...`, { isDownload: true, duration: 2500 });
        } else {
          window.top.postMessage({ type: 'FOCUSGUARD_PLAYER_CMD', cmd: 'download_video', value: meta }, '*');
        }
      }

    } catch (err) {
      console.error('[FocusGuard] Video download failed:', err);
      showHud('⚠️', `Download error: ${err.message}`, { duration: 3000 });
    } finally {
      isDownloading = false;
      if (btn) btn.classList.remove('fg-downloading');
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
    cachedPlaylistText = null;
    cachedEpisodeMeta = null;
    dubEnforceAttempts = 0;
    playerErrorRecoveryCount = 0;
    userManuallySelectedCategory = null;
    isAutoRecovering = false;
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
  setInterval(() => {
    if (!isEnabled()) return;
    findVideos();
    if (activeVideo && playerSettings.enableSmoothPlayback) {
      optimizeVideoBuffering(activeVideo);
    }
    enforcePlayerNoScrollbars();
    enforceDubSelection();
  }, 1200);

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
    if (data.type === 'FOCUSGUARD_STREAM_DETECTED' && data.streamUrl && !data.streamUrl.startsWith('blob:')) {
      detectedStreamUrl = data.streamUrl;
      if (data.embedUrl) detectedEmbedUrl = data.embedUrl;
      if (data.playlistText) cachedPlaylistText = data.playlistText;
    }

    // Save blob delegated from child iframe to top-level window
    if (data.type === 'FOCUSGUARD_SAVE_BLOB' && data.blob) {
      saveBlobDirectlyOrDelegate(data.blob, data.filename);
      showHud('✅', `Downloaded: ${data.filename || 'Episode Video'}`, { isSuccess: true, duration: 3500 });
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

    });
  }

  console.log('[FocusGuard] Video Player Suite initialized in frame:', window.location.href);

  // Expose helpers for automated testing and extension inspection
  try {
    window.__focusguard_get_episode_metadata__ = getEpisodeMetadata;
    window.__focusguard_download_video__ = downloadActiveVideo;
    window.__focusguard_mount_download_btn__ = mountDownloadButton;
    window.__focusguard_parse_playlist__ = parseMasterPlaylist;
    window.__focusguard_format_size__ = formatDataSize;
    window.__focusguard_toggle_quality_popover__ = toggleQualityPopover;
  } catch (e) {}

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      getEpisodeMetadata,
      mountDownloadButton,
      updateDownloadButtonLabel,
      downloadActiveVideo,
      formatTime,
      parseMasterPlaylist,
      formatDataSize,
      toggleQualityPopover
    };
  }
})();

