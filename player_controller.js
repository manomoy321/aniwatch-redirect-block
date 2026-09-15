/**
 * FocusGuard - Video Player Controller (player_controller.js)
 * Delivers comprehensive keyboard shortcuts, cross-frame media synchronization,
 * rock-solid fullscreen fixes, auto-play, auto-skip intro/outro, and next episode automation.
 */
(function () {
  'use strict';

  // Default configuration
  let playerSettings = {
    enabled: true,
    enableKeyboardControls: true,
    enableFullscreenFix: true,
    enableAutoPlay: true,
    enableAutoNext: true,
    enableAutoSkipIntro: true,
    enableAutoSkipOutro: true,
    enableShortcutDock: true,
    skipIntroSeconds: 85,
    seekSeconds: 5,
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
  let activeDock = null;
  let dockHideTimeout = null;
  let isDockCollapsed = false;

  // 1. Sync settings from chrome.storage
  function updatePlayerSettings() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      if (activeVideo) createOrUpdatePlayerDock(activeVideo);
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
        'enableShortcutDock',
        'skipIntroSeconds',
        'seekSeconds',
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
        if (res.enableShortcutDock !== undefined) playerSettings.enableShortcutDock = res.enableShortcutDock;
        if (res.skipIntroSeconds !== undefined) playerSettings.skipIntroSeconds = Number(res.skipIntroSeconds) || 85;
        if (res.seekSeconds !== undefined) playerSettings.seekSeconds = Number(res.seekSeconds) || 5;
        if (Array.isArray(res.whitelist)) playerSettings.whitelist = res.whitelist;

        if (activeVideo) {
          createOrUpdatePlayerDock(activeVideo);
        }
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

  function showNextEpisodeCountdown(targetEl, targetUrl) {
    const host = getHudHost();
    if (!host) return;

    if (nextEpCountdownTimer) clearInterval(nextEpCountdownTimer);

    // Remove existing countdown
    const existing = host.querySelector('.fg-hud-next-countdown');
    if (existing) existing.remove();

    let timeLeft = 3;
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
      }
    }, 1000);
  }

  // 2.5 On-Screen Floating Shortcut UI Dock
  function createOrUpdatePlayerDock(video) {
    if (!isEnabled() || !playerSettings.enableShortcutDock) {
      if (activeDock && activeDock.parentNode) {
        activeDock.parentNode.removeChild(activeDock);
        activeDock = null;
      }
      return;
    }

    if (!video || !video.isConnected) return;

    // Determine appropriate container element
    let container = video.closest('.player-container, .jwplayer, .video-js, [id*="player"], .player, #player');
    if (!container) {
      container = video.parentElement || document.body;
    }

    const style = window.getComputedStyle(container);
    if (style.position === 'static' && container !== document.body) {
      container.style.position = 'relative';
    }

    let dock = container.querySelector('.fg-player-dock');
    if (!dock) {
      dock = document.createElement('div');
      dock.className = 'fg-player-dock' + (isDockCollapsed ? ' fg-dock-collapsed' : '');
      dock.id = 'fg-player-shortcut-dock';

      dock.innerHTML = `
        <div class="fg-dock-brand" title="Click to minimize or expand shortcut dock">
          <span class="fg-dock-brand-icon">🛡️</span>
          <span>FG Controls</span>
        </div>
        <div class="fg-dock-divider"></div>
        <button type="button" class="fg-dock-btn" data-cmd="toggle_play" title="Play / Pause (Space or K)">
          <span class="fg-dock-btn-icon">⏯</span>
          <span class="fg-dock-btn-label">Play</span>
          <span class="fg-key-chip">Space</span>
        </button>
        <button type="button" class="fg-dock-btn" data-cmd="seek_backward" title="Rewind 5s (← or J)">
          <span class="fg-dock-btn-icon">⏪</span>
          <span class="fg-dock-btn-label">-5s</span>
          <span class="fg-key-chip">←</span>
        </button>
        <button type="button" class="fg-dock-btn" data-cmd="seek_forward" title="Forward 5s (→ or L)">
          <span class="fg-dock-btn-icon">⏩</span>
          <span class="fg-dock-btn-label">+5s</span>
          <span class="fg-key-chip">→</span>
        </button>
        <button type="button" class="fg-dock-btn fg-dock-btn-special" data-cmd="skip_intro" title="Skip Intro +85s (S or I)">
          <span class="fg-dock-btn-icon">⚡</span>
          <span class="fg-dock-btn-label">Skip OP</span>
          <span class="fg-key-chip">S</span>
        </button>
        <button type="button" class="fg-dock-btn fg-dock-btn-special" data-cmd="skip_outro" title="Skip Outro +85s (O)">
          <span class="fg-dock-btn-icon">⚡</span>
          <span class="fg-dock-btn-label">Skip ED</span>
          <span class="fg-key-chip">O</span>
        </button>
        <button type="button" class="fg-dock-btn" data-cmd="volume_down" title="Volume Down 5% (↓)">
          <span class="fg-dock-btn-icon">🔉</span>
          <span class="fg-key-chip">↓</span>
        </button>
        <button type="button" class="fg-dock-btn" data-cmd="volume_up" title="Volume Up 5% (↑)">
          <span class="fg-dock-btn-icon">🔊</span>
          <span class="fg-key-chip">↑</span>
        </button>
        <button type="button" class="fg-dock-btn" data-cmd="toggle_speed" title="Playback Speed ([ / ])">
          <span class="fg-dock-btn-icon">⚡</span>
          <span class="fg-dock-speed-text">1.0x</span>
          <span class="fg-key-chip">[ ]</span>
        </button>
        <button type="button" class="fg-dock-btn" data-cmd="toggle_fullscreen" title="Toggle Fullscreen (F)">
          <span class="fg-dock-btn-icon">⛶</span>
          <span class="fg-key-chip">F</span>
        </button>
        <button type="button" class="fg-dock-btn" data-cmd="next_episode" title="Next Episode (N or P)">
          <span class="fg-dock-btn-icon">⏭</span>
          <span class="fg-key-chip">N</span>
        </button>
        <button type="button" class="fg-dock-toggle-btn" title="Minimize / Expand Dock">
          <span class="fg-dock-toggle-icon">${isDockCollapsed ? '+' : '─'}</span>
        </button>
      `;

      // Block propagation so clicks on dock don't trigger player pause or ad redirects
      ['click', 'mousedown', 'mouseup', 'dblclick', 'keydown'].forEach((evName) => {
        dock.addEventListener(evName, (e) => {
          e.stopPropagation();
        }, true);
      });

      // Toggle collapse/minimize
      const toggleCollapse = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        isDockCollapsed = !isDockCollapsed;
        dock.classList.toggle('fg-dock-collapsed', isDockCollapsed);
        const icon = dock.querySelector('.fg-dock-toggle-icon');
        if (icon) icon.textContent = isDockCollapsed ? '+' : '─';
      };

      const brand = dock.querySelector('.fg-dock-brand');
      if (brand) brand.addEventListener('click', toggleCollapse);

      const collapseBtn = dock.querySelector('.fg-dock-toggle-btn');
      if (collapseBtn) collapseBtn.addEventListener('click', toggleCollapse);

      // Button click handlers
      const buttons = dock.querySelectorAll('.fg-dock-btn');
      buttons.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const cmd = btn.getAttribute('data-cmd');
          if (cmd) {
            executePlayerCommand(cmd);
            syncDockUI();
          }
        });
      });

      container.appendChild(dock);
      activeDock = dock;

      // Auto-hide behavior during playback
      const resetAutoHide = () => {
        dock.classList.remove('fg-dock-hidden');
        if (dockHideTimeout) clearTimeout(dockHideTimeout);
        if (activeVideo && !activeVideo.paused) {
          dockHideTimeout = setTimeout(() => {
            if (activeVideo && !activeVideo.paused && !dock.matches(':hover')) {
              dock.classList.add('fg-dock-hidden');
            }
          }, 3200);
        }
      };

      container.addEventListener('mousemove', resetAutoHide, { passive: true });
      container.addEventListener('mouseenter', resetAutoHide, { passive: true });
      dock.addEventListener('mouseenter', () => {
        if (dockHideTimeout) clearTimeout(dockHideTimeout);
        dock.classList.remove('fg-dock-hidden');
      });
    }

    syncDockUI();
  }

  function syncDockUI() {
    if (!activeDock) return;
    const playBtnLabel = activeDock.querySelector('[data-cmd="toggle_play"] .fg-dock-btn-label');
    const playBtnIcon = activeDock.querySelector('[data-cmd="toggle_play"] .fg-dock-btn-icon');
    if (activeVideo) {
      if (playBtnLabel) playBtnLabel.textContent = activeVideo.paused ? 'Play' : 'Pause';
      if (playBtnIcon) playBtnIcon.textContent = activeVideo.paused ? '▶' : '⏸';

      const speedText = activeDock.querySelector('.fg-dock-speed-text');
      if (speedText) {
        speedText.textContent = `${activeVideo.playbackRate.toFixed(1)}x`;
      }
    }
  }

  // 3. Finding and Binding Video Elements
  function bindVideoEvents(video) {
    if (!video || knownVideos.has(video)) return;
    knownVideos.add(video);

    if (!activeVideo || activeVideo.paused) {
      activeVideo = video;
    }

    video.addEventListener('play', () => {
      activeVideo = video;
      syncDockUI();
    });

    video.addEventListener('pause', () => {
      syncDockUI();
      if (activeDock) activeDock.classList.remove('fg-dock-hidden');
    });

    video.addEventListener('playing', () => {
      activeVideo = video;
      syncDockUI();
    });

    video.addEventListener('ratechange', () => {
      syncDockUI();
    });

    video.addEventListener('volumechange', () => {
      syncDockUI();
    });

    video.addEventListener('click', () => {
      activeVideo = video;
      syncDockUI();
    });

    // Double-click to toggle fullscreen
    video.addEventListener('dblclick', (e) => {
      if (!isEnabled() || !playerSettings.enableFullscreenFix) return;
      e.preventDefault();
      e.stopPropagation();
      toggleFullscreen(video);
    });

    // Reset skip flags on new media
    video.addEventListener('loadedmetadata', () => {
      introSkippedForCurrentVideo = false;
      outroSkippedForCurrentVideo = false;
      checkAutoPlay(video);
      syncDockUI();
    });

    // Watch playback progress for auto-skip and auto-next
    video.addEventListener('timeupdate', () => {
      handleTimeUpdate(video);
    });

    video.addEventListener('ended', () => {
      handleVideoEnded(video);
      syncDockUI();
    });

    // Create on-screen Shortcut Dock
    createOrUpdatePlayerDock(video);

    // Trigger initial autoplay check if video is already ready
    if (video.readyState >= 1) {
      checkAutoPlay(video);
    }
  }

  function findVideos() {
    const videos = document.querySelectorAll('video');
    videos.forEach(bindVideoEvents);
    if (videos.length > 0 && !activeVideo) {
      activeVideo = videos[0];
    }
  }

  // Observe DOM for newly inserted videos or players
  const domObserver = new MutationObserver(() => {
    findVideos();
    if (isEnabled()) {
      if (playerSettings.enableAutoSkipIntro || playerSettings.enableAutoSkipOutro) {
        scanForSkipButtons();
      }
    }
  });

  if (document.body) {
    domObserver.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      domObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
      findVideos();
    });
  }

  findVideos();

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

  // 7. Rock-Solid Fullscreen Engine
  function isCurrentlyFullscreen() {
    return !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    );
  }

  function toggleFullscreen(preferredTarget) {
    if (!isEnabled() || !playerSettings.enableFullscreenFix) return;

    if (isCurrentlyFullscreen()) {
      const exitFs =
        document.exitFullscreen ||
        document.webkitExitFullscreen ||
        document.mozCancelFullScreen ||
        document.msExitFullscreen;

      if (exitFs) {
        exitFs.call(document).catch(() => {});
        showHud('⛶', 'Exit Fullscreen');
      }
    } else {
      // Target element: preferred video, active video, or parent container
      let target = preferredTarget || activeVideo;
      if (!target) {
        findVideos();
        target = activeVideo;
      }

      // If player has a container element (e.g. jwplayer or player wrapper), prefer it
      if (target) {
        const container = target.closest('.jwplayer, .video-js, [id*="player"], .player-container, #player');
        if (container) target = container;
      } else {
        target = document.documentElement;
      }

      const requestFs =
        target.requestFullscreen ||
        target.webkitRequestFullscreen ||
        target.mozRequestFullScreen ||
        target.msRequestFullscreen;

      if (requestFs) {
        const p = requestFs.call(target);
        if (p && typeof p.then === 'function') {
          p.then(() => {
            showHud('⛶', 'Fullscreen');
          }).catch((err) => {
            console.warn('[FocusGuard] Fullscreen failed locally, trying bridge:', err);
            // If rejected inside an iframe, bridge to parent window
            if (window !== window.top) {
              window.top.postMessage({ type: 'FOCUSGUARD_REQUEST_PARENT_FULLSCREEN' }, '*');
            }
          });
        } else {
          showHud('⛶', 'Fullscreen');
        }
      } else if (window !== window.top) {
        window.top.postMessage({ type: 'FOCUSGUARD_REQUEST_PARENT_FULLSCREEN' }, '*');
      }
    }
  }

  // 8. Cross-Frame Message Bus Listener
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    // Child iframe requested parent window to fullscreen its iframe element
    if (data.type === 'FOCUSGUARD_REQUEST_PARENT_FULLSCREEN') {
      if (window === window.top) {
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

        const target = matchedIframe || document.querySelector('iframe') || document.documentElement;
        if (target) {
          const req = target.requestFullscreen || target.webkitRequestFullscreen || target.mozRequestFullScreen;
          if (req) {
            req.call(target).then(() => {
              showHud('⛶', 'Fullscreen (Bridge)');
            }).catch(() => {});
          }
        }
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
      findVideos();
      if (activeVideo) {
        executePlayerCommand(data.cmd, data.value);
        // Reply with current state so sender can show HUD
        try {
          if (event.source) {
            event.source.postMessage({
              type: 'FOCUSGUARD_PLAYER_CMD_ACK',
              cmd: data.cmd,
              paused: activeVideo.paused,
              currentTime: activeVideo.currentTime,
              duration: activeVideo.duration,
              volume: activeVideo.volume,
              muted: activeVideo.muted,
              playbackRate: activeVideo.playbackRate
            }, '*');
          }
        } catch (e) {}
      } else if (window === window.top) {
        // Broadcast down to all child iframes if active video is inside an embed
        broadcastCommand(data.cmd, data.value);
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
        // First try to click skip intro button
        scanForSkipButtons();
        // Fallback: Seek forward skipIntroSeconds
        const jump = Number(value) || playerSettings.skipIntroSeconds || 85;
        activeVideo.currentTime = Math.min(activeVideo.duration || Infinity, activeVideo.currentTime + jump);
        showHud('⚡', `Skipped Intro (+${jump}s)`, { isSkip: true });
        break;
      }

      case 'skip_outro': {
        scanForSkipButtons();
        const jump = Number(value) || playerSettings.skipIntroSeconds || 85;
        activeVideo.currentTime = Math.min(activeVideo.duration || Infinity, activeVideo.currentTime + jump);
        showHud('⚡', `Skipped Outro (+${jump}s)`, { isSkip: true });
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

    syncDockUI();
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
  function broadcastCommand(cmd, value) {
    const msg = { type: 'FOCUSGUARD_PLAYER_CMD', cmd: cmd, value: value };

    // Post to all child iframes
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach((ifr) => {
      try {
        if (ifr.contentWindow) {
          ifr.contentWindow.postMessage(msg, '*');
        }
      } catch (e) {}
    });

    // If we're inside an iframe, also post to parent/top
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

      if (hasLocalVideo) {
        executePlayerCommand(cmd, val);
      } else {
        // Broadcast across frames to find the active player
        broadcastCommand(cmd, val);
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

      if (msg.action === 'toggle_shortcut_dock') {
        playerSettings.enableShortcutDock = !!msg.enabled;
        if (activeVideo) {
          createOrUpdatePlayerDock(activeVideo);
        }
        sendResponse({ success: true });
        return true;
      }
    });
  }

  console.log('[FocusGuard] Video Player Suite initialized in frame:', window.location.href);
})();

