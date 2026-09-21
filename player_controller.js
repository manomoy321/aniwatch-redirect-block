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

  const currentHost = window.location.hostname;
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

    if (hudTimer) {
      clearTimeout(hudTimer);
      hudTimer = null;
    }

    // Remove existing normal badges
    const oldBadges = host.querySelectorAll('.fg-hud-badge:not(.fg-hud-next-countdown)');
    oldBadges.forEach(b => b.remove());

    const badge = document.createElement('div');
    badge.className = 'fg-hud-badge' + (options.isSkip ? ' fg-hud-skip' : '');

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
  }

  // Helper: Save user server preference for continuous playback across all episodes
  function saveServerPreference(category, serverName) {
    if (!category && !serverName) return;
    let cleanCat = (category || 'dub').toLowerCase().trim();
    let cleanServer = (serverName || '').toLowerCase().trim();

    // When auto-select ENG/DUB is enabled, lock category to 'dub' ("all time select the dub one")
    if (playerSettings.enableAutoSelectEng) {
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

    console.log('[FocusGuard] Server preference saved for continuity:', cleanCat.toUpperCase(), cleanServer);
  }

  // Helper to reliably trigger click events across differing anime site button structures (a, button, div)
  function clickServerButton(el) {
    if (!el) return;
    try {
      if (typeof el.focus === 'function') el.focus();
    } catch (e) {}

    // Find interactive child (a, button, [role="button"]) or use el
    const inner = el.matches('a, button, [role="button"]') ? el : el.querySelector('a, button, [role="button"]');
    const target = inner || el;

    try {
      if (typeof target.click === 'function') target.click();
    } catch (e) {}

    // Dispatch full synthetic mouse events
    ['mousedown', 'mouseup', 'click'].forEach(evtType => {
      try {
        target.dispatchEvent(new MouseEvent(evtType, {
          bubbles: true,
          cancelable: true,
          view: window,
          buttons: 1
        }));
      } catch (e) {}
    });

    if (el !== target) {
      try {
        if (typeof el.click === 'function') el.click();
      } catch (e) {}
    }

    // Also trigger parent .server-item in case site delegates on wrapper
    try {
      const parentItem = target.closest('.server-item, .item');
      if (parentItem && parentItem !== target && parentItem !== el) {
        if (typeof parentItem.click === 'function') parentItem.click();
      }
    } catch (e) {}
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

  // Checks if any DUB server button is currently active
  function isAnyDubServerActive() {
    const dubButtons = getAllDubServers();
    for (const btn of dubButtons) {
      if (isDubServerActive(btn)) {
        return true;
      }
    }
    return false;
  }

  // Continuous Enforcer: Guarantees DUB is selected at all times across all episodes
  let lastDubClickTime = 0;
  let dubEnforceAttempts = 0;
  function enforceDubSelection() {
    if (!isEnabled() || !playerSettings.enableAutoSelectEng) return;
    const cat = (playerSettings.preferredServerCategory || 'dub').toLowerCase();
    if (cat !== 'dub') return;

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

    // D. Throttle clicks (min 700ms between attempts to give player iframe time to switch)
    const now = Date.now();
    if (now - lastDubClickTime < 700) return;
    lastDubClickTime = now;
    dubEnforceAttempts++;

    console.log(`[FocusGuard] All-Time DUB Enforcer (Attempt ${dubEnforceAttempts}): Activating DUB Server:`, dubBtn);
    clickServerButton(dubBtn);
    hasSelectedEngServer = true;

    const label = (dubBtn.textContent || playerSettings.preferredServerName || 'VidSrc').trim();
    showHud('🌐', `Auto-Selected DUB • ${label}`, { duration: 1200 });

    saveServerPreference('dub', label);
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
        saveServerPreference(cat, playerSettings.preferredServerName || 'vidsrc');
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
        saveServerPreference(cat, sName);
      }
    }
  }, true);

  // 2.7 Episode Transition & Single-Page App (SPA) Navigation Watcher
  // Guarantees server continuity and auto-skip re-arming when navigating between episodes
  function onEpisodeChangeDetected() {
    hasSelectedEngServer = false;
    hasSelectedEngTitle = false;
    introSkippedForCurrentVideo = false;
    outroSkippedForCurrentVideo = false;
    activeVideo = null;
    console.log('[FocusGuard] Episode change detected. Re-arming server continuity and all-time DUB enforcer.');
    // Staggered asynchronous checks to catch AJAX server list rendering
    [50, 150, 350, 700, 1200, 1800, 2500, 3500].forEach((delay) => {
      setTimeout(() => {
        findVideos();
        enforcePlayerNoScrollbars();
        enforceDubSelection();
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
      document.body.classList.contains('fg-theater-active') ||
      document.documentElement.classList.contains('fg-theater-active')
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

    document.body.classList.remove('fg-theater-active', 'fg-fullscreen-active');
    if (document.documentElement) document.documentElement.classList.remove('fg-theater-active', 'fg-fullscreen-active');

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
})();

