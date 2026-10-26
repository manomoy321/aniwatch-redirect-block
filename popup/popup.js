/**
 * FocusGuard - Popup Controller (popup.js)
 * Manages extension state, mode selection, domain whitelisting, and live statistics.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const masterToggle = document.getElementById('master-toggle');
  const statusPill = document.getElementById('status-pill');
  const statusText = document.getElementById('status-text');
  const heroStatusDesc = document.getElementById('hero-status-desc');
  const domainText = document.getElementById('domain-text');
  const siteBlockedCount = document.getElementById('site-blocked-count');
  const totalBlockedCount = document.getElementById('total-blocked-count');
  const btnModeBlock = document.getElementById('btn-mode-block');
  const btnModeFocus = document.getElementById('btn-mode-focus');
  const toggleOverlays = document.getElementById('toggle-overlays');
  const btnToggleWhitelist = document.getElementById('btn-toggle-whitelist');
  const whitelistBtnText = document.getElementById('whitelist-btn-text');
  const btnResetStats = document.getElementById('btn-reset-stats');

  // Video Player Suite DOM Elements
  const toggleKeyboard = document.getElementById('toggle-keyboard');
  const toggleFullscreen = document.getElementById('toggle-fullscreen');
  const toggleAutoplay = document.getElementById('toggle-autoplay');
  const toggleSkipIntro = document.getElementById('toggle-skip-intro');
  const toggleSkipOutro = document.getElementById('toggle-skip-outro');
  const toggleAutoNext = document.getElementById('toggle-autonext');
  const toggleEng = document.getElementById('toggle-eng');
  const selectNextDelay = document.getElementById('select-next-delay');
  const toggleSmoothPlayback = document.getElementById('toggle-smooth-playback');
  const toggleDownloadMetadata = document.getElementById('toggle-download-metadata');
  const btnToggleShortcuts = document.getElementById('btn-toggle-shortcuts');
  const shortcutsPanel = document.getElementById('shortcuts-panel');

  let currentHost = '';
  let appState = {
    enabled: true,
    mode: 'block_and_close',
    blockOverlays: true,
    whitelist: [],
    totalBlocked: 0,
    siteStats: {},
    // Video Player Suite State
    enableKeyboardControls: true,
    enableFullscreenFix: true,
    enableAutoPlay: true,
    enableAutoNext: true,
    enableAutoSkipIntro: true,
    enableAutoSkipOutro: true,
    enableAutoSelectEng: true,
    nextEpisodeDelay: 0,
    enableSmoothPlayback: true,
    enableDownloadMetadata: false
  };

  // 1. Identify active tab domain
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0] && tabs[0].url) {
      const url = tabs[0].url;
      if (url.startsWith('http://') || url.startsWith('https://')) {
        currentHost = new URL(url).hostname;
        domainText.textContent = currentHost;
      } else if (url.startsWith('file://')) {
        currentHost = 'local_file';
        domainText.textContent = 'Local File';
      } else {
        currentHost = 'browser_internal';
        domainText.textContent = 'System Page';
      }
    } else {
      domainText.textContent = 'No active page';
    }
  } catch (err) {
    domainText.textContent = 'Standard Web';
  }

  // 2. Load stored settings and stats
  chrome.storage.local.get(
    [
      'enabled', 'mode', 'blockOverlays', 'whitelist', 'totalBlocked', 'siteStats',
      'enableKeyboardControls', 'enableFullscreenFix', 'enableAutoPlay', 'enableAutoNext',
      'enableAutoSkipIntro', 'enableAutoSkipOutro', 'enableAutoSelectEng', 'nextEpisodeDelay',
      'enableSmoothPlayback', 'enableDownloadMetadata'
    ],
    (data) => {
      if (data.enabled !== undefined) appState.enabled = data.enabled;
      if (data.mode !== undefined) appState.mode = data.mode;
      if (data.blockOverlays !== undefined) appState.blockOverlays = data.blockOverlays;
      if (Array.isArray(data.whitelist)) appState.whitelist = data.whitelist;
      if (data.totalBlocked !== undefined) appState.totalBlocked = data.totalBlocked;
      if (data.siteStats !== undefined) appState.siteStats = data.siteStats;

      // Player suite states
      if (data.enableKeyboardControls !== undefined) appState.enableKeyboardControls = data.enableKeyboardControls;
      if (data.enableFullscreenFix !== undefined) appState.enableFullscreenFix = data.enableFullscreenFix;
      if (data.enableAutoPlay !== undefined) appState.enableAutoPlay = data.enableAutoPlay;
      if (data.enableAutoNext !== undefined) appState.enableAutoNext = data.enableAutoNext;
      if (data.enableAutoSkipIntro !== undefined) appState.enableAutoSkipIntro = data.enableAutoSkipIntro;
      if (data.enableAutoSkipOutro !== undefined) appState.enableAutoSkipOutro = data.enableAutoSkipOutro;
      if (data.enableAutoSelectEng !== undefined) appState.enableAutoSelectEng = data.enableAutoSelectEng;
      if (data.nextEpisodeDelay !== undefined) appState.nextEpisodeDelay = Number(data.nextEpisodeDelay) || 0;
      if (data.enableSmoothPlayback !== undefined) appState.enableSmoothPlayback = data.enableSmoothPlayback;
      if (data.enableDownloadMetadata !== undefined) appState.enableDownloadMetadata = data.enableDownloadMetadata;

      renderUI();
    }
  );

  // 3. Render complete UI state
  function renderUI() {
    const isWhitelisted = currentHost && appState.whitelist.includes(currentHost);
    const isProtected = appState.enabled && !isWhitelisted;

    // Master switch & Status Pill
    masterToggle.checked = appState.enabled;
    if (isProtected) {
      statusPill.classList.remove('disabled');
      statusText.textContent = 'ACTIVE';
      heroStatusDesc.textContent = 'Neutralizing click redirects & pop-unders';
    } else if (isWhitelisted) {
      statusPill.classList.add('disabled');
      statusText.textContent = 'PAUSED';
      heroStatusDesc.textContent = 'Site is added to your whitelist';
    } else {
      statusPill.classList.add('disabled');
      statusText.textContent = 'DISABLED';
      heroStatusDesc.textContent = 'Protection is paused globally';
    }

    // Counters
    const siteCount = (currentHost && appState.siteStats && appState.siteStats[currentHost]) || 0;
    siteBlockedCount.textContent = siteCount;
    totalBlockedCount.textContent = appState.totalBlocked || 0;

    // Mode segmented buttons
    if (appState.mode === 'keep_focus') {
      btnModeFocus.classList.add('active');
      btnModeBlock.classList.remove('active');
    } else {
      btnModeBlock.classList.add('active');
      btnModeFocus.classList.remove('active');
    }

    // Feature toggles
    toggleOverlays.checked = appState.blockOverlays;

    // Video Player Suite Toggles
    if (toggleKeyboard) toggleKeyboard.checked = appState.enableKeyboardControls;
    if (toggleFullscreen) toggleFullscreen.checked = appState.enableFullscreenFix;
    if (toggleAutoplay) toggleAutoplay.checked = appState.enableAutoPlay;
    if (toggleSkipIntro) toggleSkipIntro.checked = appState.enableAutoSkipIntro;
    if (toggleSkipOutro) toggleSkipOutro.checked = appState.enableAutoSkipOutro;
    if (toggleAutoNext) toggleAutoNext.checked = appState.enableAutoNext;
    if (toggleEng) toggleEng.checked = appState.enableAutoSelectEng;
    if (selectNextDelay) selectNextDelay.value = String(appState.nextEpisodeDelay);
    if (toggleSmoothPlayback) toggleSmoothPlayback.checked = appState.enableSmoothPlayback;
    if (toggleDownloadMetadata) toggleDownloadMetadata.checked = appState.enableDownloadMetadata;

    // Whitelist button state
    if (!currentHost || currentHost === 'browser_internal') {
      btnToggleWhitelist.style.display = 'none';
    } else {
      btnToggleWhitelist.style.display = 'flex';
      if (isWhitelisted) {
        btnToggleWhitelist.classList.add('is-whitelisted');
        whitelistBtnText.textContent = `Resume Protection on ${currentHost}`;
      } else {
        btnToggleWhitelist.classList.remove('is-whitelisted');
        whitelistBtnText.textContent = `Pause Protection on this Site`;
      }
    }
  }

  // 4. Event Listeners

  // Master switch
  masterToggle.addEventListener('change', () => {
    appState.enabled = masterToggle.checked;
    chrome.storage.local.set({ enabled: appState.enabled }, () => {
      renderUI();
    });
  });

  // Mode Selection: Block & Close
  btnModeBlock.addEventListener('click', () => {
    appState.mode = 'block_and_close';
    chrome.storage.local.set({ mode: 'block_and_close' }, () => {
      renderUI();
    });
  });

  // Mode Selection: Lock Main Tab Focus
  btnModeFocus.addEventListener('click', () => {
    appState.mode = 'keep_focus';
    chrome.storage.local.set({ mode: 'keep_focus' }, () => {
      renderUI();
    });
  });

  // Overlay Interception toggle
  toggleOverlays.addEventListener('change', () => {
    appState.blockOverlays = toggleOverlays.checked;
    chrome.storage.local.set({ blockOverlays: appState.blockOverlays });
  });

  // Video Player Suite Event Listeners
  if (toggleKeyboard) {
    toggleKeyboard.addEventListener('change', () => {
      appState.enableKeyboardControls = toggleKeyboard.checked;
      chrome.storage.local.set({ enableKeyboardControls: appState.enableKeyboardControls });
    });
  }

  if (toggleFullscreen) {
    toggleFullscreen.addEventListener('change', () => {
      appState.enableFullscreenFix = toggleFullscreen.checked;
      chrome.storage.local.set({ enableFullscreenFix: appState.enableFullscreenFix });
    });
  }

  if (toggleAutoplay) {
    toggleAutoplay.addEventListener('change', () => {
      appState.enableAutoPlay = toggleAutoplay.checked;
      chrome.storage.local.set({ enableAutoPlay: appState.enableAutoPlay });
    });
  }

  if (toggleSkipIntro) {
    toggleSkipIntro.addEventListener('change', () => {
      appState.enableAutoSkipIntro = toggleSkipIntro.checked;
      chrome.storage.local.set({ enableAutoSkipIntro: appState.enableAutoSkipIntro });
    });
  }

  if (toggleSkipOutro) {
    toggleSkipOutro.addEventListener('change', () => {
      appState.enableAutoSkipOutro = toggleSkipOutro.checked;
      chrome.storage.local.set({ enableAutoSkipOutro: appState.enableAutoSkipOutro });
    });
  }

  if (toggleAutoNext) {
    toggleAutoNext.addEventListener('change', () => {
      appState.enableAutoNext = toggleAutoNext.checked;
      chrome.storage.local.set({ enableAutoNext: appState.enableAutoNext });
    });
  }

  if (toggleEng) {
    toggleEng.addEventListener('change', () => {
      appState.enableAutoSelectEng = toggleEng.checked;
      chrome.storage.local.set({ enableAutoSelectEng: appState.enableAutoSelectEng });
    });
  }

  if (selectNextDelay) {
    selectNextDelay.addEventListener('change', () => {
      appState.nextEpisodeDelay = Number(selectNextDelay.value) || 0;
      chrome.storage.local.set({ nextEpisodeDelay: appState.nextEpisodeDelay });
    });
  }

  if (toggleSmoothPlayback) {
    toggleSmoothPlayback.addEventListener('change', () => {
      appState.enableSmoothPlayback = toggleSmoothPlayback.checked;
      chrome.storage.local.set({ enableSmoothPlayback: appState.enableSmoothPlayback });
    });
  }

  if (toggleDownloadMetadata) {
    toggleDownloadMetadata.addEventListener('change', () => {
      appState.enableDownloadMetadata = toggleDownloadMetadata.checked;
      chrome.storage.local.set({ enableDownloadMetadata: appState.enableDownloadMetadata });
    });
  }


  // Handle interactive shortcut row clicks in popup UI
  const shortcutRows = document.querySelectorAll('.shortcut-row.interactive');
  shortcutRows.forEach((row) => {
    row.addEventListener('click', () => {
      const cmd = row.getAttribute('data-cmd');
      if (!cmd) return;

      // Provide instant tactile visual feedback on the clicked row
      const tag = row.querySelector('.shortcut-run-tag');
      const originalText = tag ? tag.textContent : '';
      if (tag) {
        tag.textContent = 'Triggered! ✓';
        tag.style.background = 'rgba(16, 185, 129, 0.5)';
        tag.style.color = '#ffffff';
        setTimeout(() => {
          tag.textContent = originalText;
          tag.style.background = '';
          tag.style.color = '';
        }, 700);
      }

      // Send command to active tab's video player
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'execute_player_cmd',
            cmd: cmd
          }).catch(() => {});
        }
      });
    });
  });

  // Toggle Shortcuts Matrix Panel
  if (btnToggleShortcuts && shortcutsPanel) {
    btnToggleShortcuts.addEventListener('click', () => {
      const isHidden = shortcutsPanel.style.display === 'none' || !shortcutsPanel.style.display;
      shortcutsPanel.style.display = isHidden ? 'flex' : 'none';
      btnToggleShortcuts.style.background = isHidden ? 'rgba(16, 185, 129, 0.3)' : '';
    });
  }

  // Whitelist toggle for current domain
  btnToggleWhitelist.addEventListener('click', () => {
    if (!currentHost) return;

    let list = [...appState.whitelist];
    if (list.includes(currentHost)) {
      list = list.filter((h) => h !== currentHost);
    } else {
      list.push(currentHost);
    }

    appState.whitelist = list;
    chrome.storage.local.set({ whitelist: list }, () => {
      renderUI();
    });
  });

  // Reset Counters
  btnResetStats.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'reset_stats' }, () => {
      appState.totalBlocked = 0;
      appState.siteStats = {};
      renderUI();
    });
  });

  // ==========================================================================
  // Download Queue Manager (Reactive, Real-Time & Persistent)
  // ==========================================================================
  const queueCountBadge = document.getElementById('queue-count-badge');
  const btnClearQueue = document.getElementById('btn-clear-queue');
  const queueEmptyState = document.getElementById('queue-empty-state');
  const queueItemsList = document.getElementById('queue-items-list');

  let currentQueue = [];

  function formatBytes(bytes) {
    if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let idx = 0;
    let b = Number(bytes);
    while (b >= 1024 && idx < units.length - 1) {
      b /= 1024;
      idx++;
    }
    return `${b.toFixed(idx > 1 ? 1 : 0)} ${units[idx]}`;
  }

  function formatSpeed(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec <= 0) return '';
    return `${formatBytes(bytesPerSec)}/s`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderDownloadQueue(queue = []) {
    currentQueue = Array.isArray(queue) ? queue : [];
    if (!queueItemsList || !queueCountBadge) return;

    const activeJobs = currentQueue.filter(j => j.status === 'downloading' || j.status === 'queued' || j.status === 'preparing');
    queueCountBadge.textContent = `${activeJobs.length} active`;
    if (activeJobs.length > 0) {
      queueCountBadge.classList.add('has-active');
    } else {
      queueCountBadge.classList.remove('has-active');
    }

    if (currentQueue.length === 0) {
      if (queueEmptyState) queueEmptyState.style.display = 'flex';
      queueItemsList.innerHTML = '';
      return;
    }

    if (queueEmptyState) queueEmptyState.style.display = 'none';

    queueItemsList.innerHTML = currentQueue.map(job => {
      const pct = Math.max(0, Math.min(100, Math.round(job.progress || 0)));
      const isComplete = job.status === 'completed';
      const isFailed = job.status === 'failed';
      const isPaused = job.status === 'paused';
      const isDownloading = job.status === 'downloading';
      const isQueued = job.status === 'queued';
      const isCancelled = job.status === 'cancelled';

      let statusClass = `status-${job.status || 'queued'}`;
      let statusLabel = (job.status || 'queued').toUpperCase();

      let metaText = '';
      if (isDownloading) {
        if (job.total > 0 && job.completed !== undefined) {
          const spd = job.speed > 0 ? ` • ${formatSpeed(job.speed)}` : '';
          const bytesPart = job.bytesReceived > 0 ? `${formatBytes(job.bytesReceived)} • ` : '';
          metaText = `${bytesPart}Segments: ${job.completed}/${job.total}${spd}`;
        } else {
          const dlBytes = formatBytes(job.bytesReceived);
          const total = job.totalBytes > 0 ? ` / ${formatBytes(job.totalBytes)}` : '';
          const spd = job.speed > 0 ? ` • ${formatSpeed(job.speed)}` : '';
          metaText = `${dlBytes}${total}${spd}`;
        }
      } else if (isComplete) {
        metaText = job.totalBytes > 0 ? formatBytes(job.totalBytes) : 'Complete';
      } else if (isFailed) {
        metaText = job.error ? String(job.error).substring(0, 48) : 'Download error';
      } else if (isPaused) {
        metaText = 'Paused';
      } else if (isQueued) {
        metaText = 'Waiting in queue...';
      }

      let actionsHtml = '';
      if (isDownloading) {
        actionsHtml = `
          <button type="button" class="btn-job-action" data-action="pause" data-id="${job.id}">Pause</button>
          <button type="button" class="btn-job-action danger" data-action="cancel" data-id="${job.id}">Cancel</button>
        `;
      } else if (isPaused) {
        actionsHtml = `
          <button type="button" class="btn-job-action" data-action="resume" data-id="${job.id}">Resume</button>
          <button type="button" class="btn-job-action danger" data-action="cancel" data-id="${job.id}">Cancel</button>
        `;
      } else if (isQueued) {
        actionsHtml = `
          <button type="button" class="btn-job-action danger" data-action="cancel" data-id="${job.id}">Cancel</button>
        `;
      } else if (isFailed || isCancelled) {
        actionsHtml = `
          <button type="button" class="btn-job-action" data-action="retry" data-id="${job.id}">Retry</button>
          <button type="button" class="btn-job-action danger" data-action="remove" data-id="${job.id}">✕</button>
        `;
      } else if (isComplete) {
        actionsHtml = `
          <button type="button" class="btn-job-action" data-action="remove" data-id="${job.id}">✕</button>
        `;
      }

      const qualityPill = job.quality ? `<span class="queue-quality-pill">${escapeHtml(job.quality)}</span>` : '';
      const safeTitle = escapeHtml(job.filename || job.title || 'Video');

      return `
        <div class="queue-card" data-job-id="${job.id}">
          <div class="queue-card-top">
            <div class="queue-card-title-group">
              ${qualityPill}
              <span class="queue-card-title" title="${safeTitle}">${safeTitle}</span>
            </div>
            <span class="queue-status-tag ${statusClass}">${statusLabel}</span>
          </div>
          <div class="queue-progress-track">
            <div class="queue-progress-bar" style="width: ${pct}%"></div>
          </div>
          <div class="queue-card-meta">
            <div class="queue-meta-text">
              <span>${pct}%</span>
              <span>${escapeHtml(metaText)}</span>
            </div>
            <div class="queue-card-actions">
              ${actionsHtml}
            </div>
          </div>
        </div>
      `;
    }).join('');

    const actionBtns = queueItemsList.querySelectorAll('.btn-job-action');
    actionBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.getAttribute('data-action');
        const jobId = btn.getAttribute('data-id');
        if (!jobId || !action) return;

        let msgAction = '';
        if (action === 'pause') msgAction = 'pause_download';
        else if (action === 'resume') msgAction = 'resume_download';
        else if (action === 'cancel') msgAction = 'cancel_download';
        else if (action === 'retry') msgAction = 'retry_download';
        else if (action === 'remove') msgAction = 'remove_download';

        if (msgAction) {
          chrome.runtime.sendMessage({ action: msgAction, jobId: jobId }, (res) => {
            if (res && res.queue) {
              renderDownloadQueue(res.queue);
            }
          });
        }
      });
    });
  }

  // Clear completed downloads
  if (btnClearQueue) {
    btnClearQueue.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'clear_completed_downloads' }, (res) => {
        if (res && res.queue) {
          renderDownloadQueue(res.queue);
        }
      });
    });
  }

  // Load initial download queue
  chrome.storage.local.get(['downloadQueue'], (data) => {
    if (Array.isArray(data.downloadQueue)) {
      renderDownloadQueue(data.downloadQueue);
    } else {
      chrome.runtime.sendMessage({ action: 'get_download_queue' }, (res) => {
        if (res && Array.isArray(res.queue)) {
          renderDownloadQueue(res.queue);
        }
      });
    }
  });

  // Listen to live changes to downloadQueue in storage
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.downloadQueue) {
      renderDownloadQueue(changes.downloadQueue.newValue || []);
    }
  });
});
