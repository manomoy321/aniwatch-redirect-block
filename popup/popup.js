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
    nextEpisodeDelay: 0
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
      'enableAutoSkipIntro', 'enableAutoSkipOutro'
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
});
