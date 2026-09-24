/**
 * FocusGuard - Dedicated Aniwatch Episode Downloader Popup (popup.js)
 * Manages episode stream query, resolution selection (1080p, 720p, 480p),
 * and live download progress indication.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const domainText = document.getElementById('domain-text');
  const statusPill = document.getElementById('status-pill');
  const statusText = document.getElementById('status-text');
  const popupEpBadge = document.getElementById('popup-ep-badge');
  const popupShowTitle = document.getElementById('popup-show-title');
  const popupShowFilename = document.getElementById('popup-show-filename');
  const popupDlStatus = document.getElementById('popup-download-status');
  const popupDlStatusTitle = document.getElementById('popup-dl-status-title');
  const popupDlStatusPct = document.getElementById('popup-dl-status-pct');
  const popupDlProgressBar = document.getElementById('popup-dl-progress-bar');
  const popupDlStatusText = document.getElementById('popup-dl-status-text');
  const qualityBtns = document.querySelectorAll('.btn-quality-dl');

  const browserApi = (typeof chrome !== 'undefined' && chrome.tabs) ? chrome : (typeof browser !== 'undefined' ? browser : null);

  let activeTabId = null;

  // 1. Identify active tab domain
  try {
    if (browserApi && browserApi.tabs) {
      const tabs = await browserApi.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs[0]) {
        activeTabId = tabs[0].id;
        if (tabs[0].url) {
          const url = tabs[0].url;
          if (url.startsWith('http://') || url.startsWith('https://')) {
            const host = new URL(url).hostname;
            if (domainText) domainText.textContent = host;
          } else if (url.startsWith('file://')) {
            if (domainText) domainText.textContent = 'Local File';
          } else {
            if (domainText) domainText.textContent = 'System Page';
          }
        }
      }
    }
  } catch (err) {
    if (domainText) domainText.textContent = 'Anime Stream';
  }

  // 2. Query active episode metadata from active tab's player controller
  function queryEpisodeMetadata() {
    if (!activeTabId || !browserApi || !browserApi.tabs) return;

    try {
      browserApi.tabs.sendMessage(activeTabId, { action: 'get_episode_info' }, (res) => {
        if (browserApi.runtime && browserApi.runtime.lastError) {
          // Tab might not have content script loaded or player not yet found
          if (statusText) statusText.textContent = 'READY';
          return;
        }

        if (res && res.success && res.metadata) {
          if (statusText) statusText.textContent = 'READY';
          if (popupEpBadge && res.metadata.episodeNum) {
            popupEpBadge.textContent = `EP ${res.metadata.episodeNum}`;
          }
          if (popupShowTitle && res.metadata.animeTitle) {
            popupShowTitle.textContent = res.metadata.animeTitle;
          }
          if (popupShowFilename && res.metadata.filename) {
            popupShowFilename.textContent = res.metadata.filename;
          }

          if (res.isDownloading && popupDlStatus) {
            popupDlStatus.style.display = 'flex';
            if (statusPill) statusPill.classList.remove('disabled');
            if (statusText) statusText.textContent = 'DOWNLOADING';
            if (popupDlStatusText) popupDlStatusText.textContent = 'Download in progress...';
          }
        }
      });
    } catch (e) {
      // Ignore query errors
    }
  }

  queryEpisodeMetadata();

  // 3. Quality tier button listeners (1080p, 720p, 480p)
  qualityBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const q = btn.getAttribute('data-quality') || '1080p';

      // Visual feedback in popup
      if (popupDlStatus) popupDlStatus.style.display = 'flex';
      if (popupDlProgressBar) popupDlProgressBar.style.width = '10%';
      if (popupDlStatusPct) popupDlStatusPct.textContent = '10%';
      if (popupDlStatusTitle) popupDlStatusTitle.textContent = `Downloading ${q}...`;
      if (popupDlStatusText) popupDlStatusText.textContent = `Connecting to stream and initiating ${q} download...`;
      if (statusText) statusText.textContent = 'STARTING';

      if (browserApi && browserApi.tabs && activeTabId) {
        browserApi.tabs.sendMessage(activeTabId, {
          action: 'execute_player_cmd',
          cmd: 'download_video',
          value: q
        }, (res) => {
          if (popupDlProgressBar) popupDlProgressBar.style.width = '25%';
          if (popupDlStatusPct) popupDlStatusPct.textContent = '25%';
          if (popupDlStatusText) popupDlStatusText.textContent = `Fetching segment index for ${q}...`;
        });
      }
    });
  });

  // 4. Real-time progress updates dispatched from player_controller.js
  if (browserApi && browserApi.runtime && browserApi.runtime.onMessage) {
    browserApi.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'FOCUSGUARD_DOWNLOAD_PROGRESS') {
        if (popupDlStatus) popupDlStatus.style.display = 'flex';
        const pct = Math.min(100, Math.max(0, Math.round(msg.pct || 0)));

        if (popupDlProgressBar) popupDlProgressBar.style.width = `${pct}%`;
        if (popupDlStatusPct) popupDlStatusPct.textContent = `${pct}%`;

        if (msg.isComplete) {
          if (statusText) statusText.textContent = 'COMPLETE';
          if (popupDlStatusTitle) popupDlStatusTitle.textContent = 'Download Complete! ✓';
          if (popupDlStatusText) popupDlStatusText.textContent = `✓ ${msg.quality || 'Video'} saved to your downloads`;
          if (popupDlProgressBar) popupDlProgressBar.style.width = '100%';
          if (popupDlStatusPct) popupDlStatusPct.textContent = '100%';
        } else {
          if (statusText) statusText.textContent = `${pct}%`;
          if (popupDlStatusTitle) popupDlStatusTitle.textContent = `Downloading ${msg.quality || 'Stream'} (${pct}%)`;
          const segText = msg.total ? `Segment ${msg.completed} of ${msg.total}` : 'Downloading segments...';
          if (popupDlStatusText) popupDlStatusText.textContent = segText;
        }
      }
    });
  }
});
