/**
 * FocusGuard - Video Player Controller & Episode Downloader (player_controller.js)
 * Dedicated anime episode downloader with quality selection (1080p, 720p, 480p),
 * live top-of-player download progress bar, resilient HLS segment recovery, and iPhone Orion support.
 */
(function () {
  'use strict';

  let activeVideo = null;
  const knownVideos = new Set();
  let hudHost = null;
  let hudTimer = null;
  let topProgressBarEl = null;
  let topProgressHideTimer = null;
  let isDownloading = false;
  let detectedStreamUrl = null;
  let detectedEmbedUrl = null;
  let cachedPlaylistText = null;
  let cachedEpisodeMeta = null;

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

  // Format seconds to mm:ss or hh:mm:ss
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    const h = Math.floor(m / 60);
    const min = m % 60;
    const pad = (n) => String(n).padStart(2, '0');
    if (h > 0) return `${h}:${pad(min)}:${pad(sec)}`;
    return `${min}:${pad(sec)}`;
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

  // Scrapes the anime title, episode number, and sanitizes filenames
  function getEpisodeMetadata(customDoc = null, customQuality = null) {
    const doc = customDoc || (typeof document !== 'undefined' ? document : null);
    if (!doc) {
      return {
        episodeNum: '01',
        animeTitle: 'Episode',
        quality: customQuality || '1080p',
        filename: customQuality ? `Episode 01 [${customQuality}].mp4` : 'Episode 01.mp4'
      };
    }

    let episodeNum = '';
    let animeTitle = '';

    // 1. Episode Number Scraping
    const activeEpSelectors = [
      '.ssl-item.ep-item.active',
      '.ep-item.active',
      '.item.active',
      '[data-number].active',
      '.episodes-ul .active',
      '#episodes-content .active',
      '.active[data-number]'
    ];

    for (const sel of activeEpSelectors) {
      try {
        const el = doc.querySelector(sel);
        if (el) {
          const numAttr = el.getAttribute('data-number');
          if (numAttr && !isNaN(parseInt(numAttr, 10))) {
            episodeNum = String(parseInt(numAttr, 10)).padStart(2, '0');
            break;
          }
          const text = (el.textContent || '').trim();
          const match = text.match(/\b(\d+)\b/);
          if (match) {
            episodeNum = String(parseInt(match[1], 10)).padStart(2, '0');
            break;
          }
        }
      } catch (e) {}
    }

    // 2. Document Title / Heading Parsing
    if (!episodeNum && doc && doc.title) {
      const match = doc.title.match(/(?:Episode|Ep\.?|EP)\s*(\d+)/i);
      if (match) {
        episodeNum = String(parseInt(match[1], 10)).padStart(2, '0');
      }
    }

    // 3. URL parsing fallback for episode
    if (!episodeNum && !customDoc && typeof window !== 'undefined' && window.location) {
      try {
        const href = window.location.href;
        const epMatch = href.match(/[?&]ep=(\d+)/i) || href.match(/episode-(\d+)/i) || href.match(/ep-(\d+)/i);
        if (epMatch) {
          episodeNum = String(parseInt(epMatch[1], 10)).padStart(2, '0');
        }
      } catch (e) {}
    }

    if (!episodeNum) episodeNum = '01';

    // 4. Anime Title Scraping
    const titleSelectors = [
      '#detail-page .heading-name',
      '.film-name',
      'h2.film-name',
      '.player-title',
      '.anime-title',
      'h1.title',
      '.watch-info h2'
    ];

    for (const sel of titleSelectors) {
      try {
        const el = doc.querySelector(sel);
        if (el && el.textContent) {
          const raw = el.textContent.trim();
          if (raw && !raw.toLowerCase().includes('server') && raw.length > 1) {
            let cleaned = raw
              .replace(/^(?:Episode|Ep\.?|EP)\s*\d+\s*[-:–—•|]?\s*/i, '')
              .replace(/[-:–—•|]?\s*(?:Episode|Ep\.?|EP)\s*\d+.*$/i, '')
              .replace(/\(simulated[^)]*\)/i, '')
              .replace(/\[[^\]]*\]/g, '')
              .trim();
            if (cleaned) {
              animeTitle = cleaned;
              break;
            }
          }
        }
      } catch (e) {}
    }

    if (!animeTitle && doc.title) {
      animeTitle = doc.title
        .replace(/Watch/i, '')
        .replace(/(?:Episode|Ep\.?|EP)\s*\d+.*$/i, '')
        .replace(/English Sub.*$/i, '')
        .replace(/online free on.*$/i, '')
        .replace(/Aniwatch.*$/i, '')
        .replace(/HiAnime.*$/i, '')
        .replace(/[-|•].*$/, '')
        .trim();
    }

    if (!animeTitle || animeTitle === 'Anime') animeTitle = 'Episode';

    // Sanitize illegal filename characters
    animeTitle = animeTitle
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();

    const qualityTag = customQuality ? ` [${customQuality}]` : '';
    const filename = (animeTitle === 'Episode' || !animeTitle)
      ? `Episode ${episodeNum}${qualityTag}.mp4`
      : `${animeTitle} - Episode ${episodeNum}${qualityTag}.mp4`;

    cachedEpisodeMeta = { episodeNum, animeTitle, quality: customQuality || '1080p', filename };
    return cachedEpisodeMeta;
  }

  // Parses master playlist for 1080p, 720p, 480p streams and calculates estimated data required
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

  // ==========================================================================
  // TOP OF PLAYER DOWNLOAD PROGRESS BAR ENGINE
  // Mounts full-width progress bar directly across the top of the video player
  // ==========================================================================

  function mountTopProgressBar(targetContainer) {
    if (typeof document === 'undefined') return null;
    let container = targetContainer;

    if (!container) {
      container = document.querySelector(
        '#player-wrapper, .player-container, #player-container, #player, .film-player, .jwplayer, .video-js, [class*="player-container"], [class*="player-wrapper"]'
      ) || (activeVideo ? activeVideo.parentElement : null) || document.body;
    }

    if (!container) return null;

    let existing = container.querySelector('#focusguard-player-progress') || document.querySelector('#focusguard-player-progress');
    if (existing) {
      topProgressBarEl = existing;
      return existing;
    }

    try {
      const comp = window.getComputedStyle(container);
      if (comp.position === 'static') {
        container.style.position = 'relative';
      }
    } catch (e) {}

    const bar = document.createElement('div');
    bar.id = 'focusguard-player-progress';
    bar.className = 'fg-player-top-progress fg-progress-hidden';

    bar.innerHTML = `
      <div class="fg-top-progress-info">
        <div class="fg-top-progress-left">
          <span class="fg-top-progress-icon">⬇</span>
          <span class="fg-top-progress-title" id="fg-top-progress-title">Preparing Episode Download...</span>
        </div>
        <div class="fg-top-progress-right">
          <span class="fg-top-progress-segments" id="fg-top-progress-segments">0/0</span>
          <span class="fg-top-progress-pct" id="fg-top-progress-pct">0%</span>
        </div>
      </div>
      <div class="fg-top-progress-track">
        <div class="fg-top-progress-fill" id="fg-top-progress-fill" style="width: 0%;"></div>
      </div>
    `;

    if (typeof container.insertBefore === 'function') {
      container.insertBefore(bar, container.firstChild || null);
    } else if (typeof container.prepend === 'function') {
      container.prepend(bar);
    } else if (typeof container.appendChild === 'function') {
      container.appendChild(bar);
    }
    topProgressBarEl = bar;
    return bar;
  }

  function updateTopProgressBar(pct, completed, total, quality = '1080p', episodeNum = '01', isComplete = false) {
    if (typeof document === 'undefined') return;
    const bar = topProgressBarEl || mountTopProgressBar();
    if (!bar) return;

    if (topProgressHideTimer) {
      clearTimeout(topProgressHideTimer);
      topProgressHideTimer = null;
    }

    bar.classList.remove('fg-progress-hidden');
    bar.classList.add('fg-progress-visible');

    const titleEl = bar.querySelector('#fg-top-progress-title');
    const segsEl = bar.querySelector('#fg-top-progress-segments');
    const pctEl = bar.querySelector('#fg-top-progress-pct');
    const fillEl = bar.querySelector('#fg-top-progress-fill');

    const cleanPct = Math.max(0, Math.min(100, Math.round(pct || 0)));

    if (fillEl) fillEl.style.width = `${cleanPct}%`;
    if (pctEl) pctEl.textContent = `${cleanPct}%`;

    if (isComplete || cleanPct >= 100) {
      bar.classList.add('fg-progress-success');
      if (titleEl) titleEl.textContent = `✓ Episode ${episodeNum} [${quality}] Download Complete!`;
      if (pctEl) pctEl.textContent = '100%';
      if (segsEl) segsEl.textContent = total ? `${total}/${total}` : 'Saved';

      topProgressHideTimer = setTimeout(() => {
        bar.classList.remove('fg-progress-visible');
        bar.classList.add('fg-progress-hidden');
        bar.classList.remove('fg-progress-success');
      }, 4000);
      return;
    }

    bar.classList.remove('fg-progress-success');
    if (titleEl) titleEl.textContent = `Downloading Ep. ${episodeNum} [${quality}]...`;
    if (segsEl) segsEl.textContent = total ? `${completed}/${total}` : `${cleanPct}%`;
  }

  function hideTopProgressBar() {
    if (!topProgressBarEl) return;
    topProgressBarEl.classList.remove('fg-progress-visible');
    topProgressBarEl.classList.add('fg-progress-hidden');
  }

  // Heads-Up Display Toast (Minimal Feedback)
  function showHud(icon, text, options = {}) {
    if (typeof document === 'undefined') return;

    if (!hudHost) {
      hudHost = document.createElement('div');
      hudHost.id = 'focusguard-hud-host';
      (document.body || document.documentElement).appendChild(hudHost);
    }

    let badge = hudHost.querySelector('.fg-hud-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'fg-hud-badge';
      hudHost.appendChild(badge);
    }

    badge.className = 'fg-hud-badge';
    if (options.isDownload) badge.classList.add('fg-hud-download');
    if (options.isSuccess) badge.classList.add('fg-hud-success');

    let extraHtml = options.extra ? `<span class="fg-hud-extra">${options.extra}</span>` : '';
    badge.innerHTML = `
      <span class="fg-hud-icon">${icon}</span>
      <span class="fg-hud-text">${text}</span>
      ${extraHtml}
    `;

    badge.classList.remove('fg-hud-hiding');
    badge.classList.add('fg-hud-visible');

    if (hudTimer) clearTimeout(hudTimer);
    const duration = options.duration || 2200;
    hudTimer = setTimeout(() => {
      badge.classList.remove('fg-hud-visible');
      badge.classList.add('fg-hud-hiding');
    }, duration);
  }

  // ==========================================================================
  // PLAYER DOWNLOAD BUTTON & QUALITY POPOVER
  // Cyber-sleek button mounted on video player with mobile touch support
  // ==========================================================================

  function mountDownloadButton(targetOrVideo) {
    if (typeof document === 'undefined' || !targetOrVideo) return;

    let container = null;
    let videoEl = null;

    if (targetOrVideo.tagName === 'VIDEO') {
      videoEl = targetOrVideo;
      container = videoEl.closest(
        '#player-wrapper, .player-container, #player-container, #player, .jwplayer, .video-js, [class*="player-container"], [class*="player-wrapper"]'
      ) || videoEl.parentElement;
    } else {
      container = targetOrVideo;
      videoEl = container.querySelector('video') || activeVideo;
    }

    if (!container) return;

    // Also mount the top-of-player progress bar on this container
    mountTopProgressBar(container);

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
    container.appendChild(host);

    // Auto-hide when player is playing and interaction is idle (optimized for touchscreens / iPhone)
    let idleTimer = null;
    const isMobileTouch = (typeof navigator !== 'undefined' && (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '') || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0)));

    function resetActivity() {
      host.classList.remove('fg-btn-autohide');
      host.classList.add('fg-btn-visible');
      if (idleTimer) clearTimeout(idleTimer);
      if (videoEl && !videoEl.paused) {
        const delay = isMobileTouch ? 5000 : 3000;
        idleTimer = setTimeout(() => {
          const hasOpenPopover = host.querySelector('.fg-popover-open');
          if (videoEl && !videoEl.paused && !hasOpenPopover && !host.matches(':hover')) {
            host.classList.add('fg-btn-autohide');
            host.classList.remove('fg-btn-visible');
          }
        }, delay);
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
        <div class="fg-quality-header-left">
          <span class="fg-quality-title">Choose Quality</span>
          <span class="fg-quality-ep-pill">EP ${meta.episodeNum}</span>
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
      const triggerSelect = (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeQualityPopover(popover);
        downloadActiveVideo(q);
      };
      item.addEventListener('click', triggerSelect);
      item.addEventListener('touchend', triggerSelect, { passive: false });
    });
  }

  // ==========================================================================
  // EPISODE DOWNLOAD ENGINE & HLS CHUNK RECOVERY
  // Parallel segments with backoff retry, proxying, and Orion iOS saving
  // ==========================================================================

  // Trigger file download via chrome.downloads or synthetic anchor fallback
  function triggerFileSave(target, filename) {
    if (!target) return;

    if (target instanceof Blob || (typeof Blob !== 'undefined' && target instanceof Blob)) {
      saveBlobDirectlyOrDelegate(target, filename);
      return;
    }

    if (typeof target === 'string') {
      if (target.startsWith('blob:') && (target.includes('megaplay.buzz') || target.includes('vidsrc') || target.includes('rapid-cloud') || target.includes('megacloud'))) {
        console.warn('[FocusGuard] Ignoring raw MediaSource blob URL in triggerFileSave:', target);
        return;
      }

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

  function saveBlobDirectlyOrDelegate(blob, filename) {
    if (!blob) return;

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
    if (!url) return;
    try {
      const a = document.createElement('a');
      a.href = url;
      const cleanName = filename || 'Episode_Video.mp4';
      a.setAttribute('download', cleanName);
      a.download = cleanName;
      a.setAttribute('data-focusguard-download', 'true');
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
      // For iOS Safari / Orion WebKit: display:none suppresses click execution on iOS
      a.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1;';
      const root = document.body || document.documentElement;
      root.appendChild(a);

      try {
        const evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        a.dispatchEvent(evt);
      } catch (e) {}

      try {
        a.click();
      } catch (e) {}

      const isIos = (typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/i.test(navigator.userAgent || '') || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1)));
      if (isIos && url.startsWith('blob:') && window === window.top) {
        setTimeout(() => {
          try { window.open(url, '_blank'); } catch (err) {}
        }, 300);
      }

      setTimeout(() => {
        try { a.remove(); } catch (e) {}
      }, 2500);
    } catch (e) {
      console.warn('[FocusGuard] fallbackAnchorDownload error, using window.open fallback:', e);
      try { window.open(url, '_blank'); } catch (err) {}
    }
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

  // HLS stream downloader: fetches playlist and segments in parallel, updates progress bar
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
          buffer = new ArrayBuffer(0);
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

  // MediaStream recorder fallback
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

    // Mount and show top-of-player progress bar immediately
    updateTopProgressBar(5, 0, 100, chosenQuality, meta.episodeNum, false);
    showHud('⬇️', `Preparing ${meta.filename}...`, { isDownload: true, duration: 2000 });

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

      // 3. Check video element src if direct HTTP/HTTPS
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
            '#iframe-embed, iframe#iframe-embed, iframe[src*="megacloud"], iframe[src*="rapid-cloud"], iframe[src*="embed"], iframe[src*="vidsrc"], iframe[src*="stream"], .film-player iframe'
          );
          if (ifr) {
            effectiveEmbedUrl = ifr.src || ifr.getAttribute('data-src') || ifr.getAttribute('data-url');
          }
        }
      }
      if (!effectiveEmbedUrl && typeof window !== 'undefined') {
        effectiveEmbedUrl = window.location.href;
      }

      // Case 1: Synthesized / Canvas / MediaStream player
      if (!targetUrl && video && (video.srcObject || video.captureStream || video.mozCaptureStream || (video.src && video.src.startsWith('blob:')))) {
        const stream = video.srcObject || (video.captureStream ? video.captureStream() : (video.mozCaptureStream ? video.mozCaptureStream() : null));
        if (stream) {
          updateTopProgressBar(35, 1, 2, chosenQuality, meta.episodeNum, false);
          showHud('⬇️', `Capturing Episode ${meta.episodeNum} [${chosenQuality}]...`, { isDownload: true, duration: 2500 });
          const blobUrl = await downloadFromMediaStream(stream, meta.filename, 4000);
          updateTopProgressBar(100, 2, 2, chosenQuality, meta.episodeNum, true);
          triggerFileSave(blobUrl, meta.filename);
          showHud('✅', `Downloaded: ${meta.filename}`, { isSuccess: true, duration: 3500 });
          return;
        }
      }

      // Case 2: HLS stream (.m3u8)
      if (targetUrl && targetUrl.includes('.m3u8')) {
        updateTopProgressBar(10, 0, 100, chosenQuality, meta.episodeNum, false);
        try {
          const blobResult = await downloadHlsStream(targetUrl, meta.filename, (pct, completed, total) => {
            // Update top of player progress bar with live percentage!
            updateTopProgressBar(pct, completed, total, chosenQuality, meta.episodeNum, false);

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

          updateTopProgressBar(100, 100, 100, chosenQuality, meta.episodeNum, true);
          triggerFileSave(blobResult, meta.filename);
          if (typeof window !== 'undefined' && window === window.top) {
            showHud('✅', `Downloaded: ${meta.filename}`, { isSuccess: true, duration: 3500 });
          }
          return;
        } catch (hlsErr) {
          console.warn('[FocusGuard] HLS download error, trying stream capture fallback:', hlsErr);
          if (video && (video.captureStream || video.mozCaptureStream)) {
            const stream = (video.captureStream ? video.captureStream() : video.mozCaptureStream());
            const blobUrl = await downloadFromMediaStream(stream, meta.filename, 4000);
            updateTopProgressBar(100, 100, 100, chosenQuality, meta.episodeNum, true);
            triggerFileSave(blobUrl, meta.filename);
            showHud('✅', `Downloaded: ${meta.filename}`, { isSuccess: true, duration: 3500 });
            return;
          }
          hideTopProgressBar();
          throw hlsErr;
        }
      }

      // Case 3: Direct video file (.mp4, .webm, HTTP/HTTPS URL)
      if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) && !targetUrl.includes('.m3u8')) {
        updateTopProgressBar(100, 1, 1, chosenQuality, meta.episodeNum, true);
        triggerFileSave(targetUrl, meta.filename);
        showHud('✅', `Downloading: ${meta.filename}`, { isSuccess: true, duration: 3000 });
        return;
      }

      // Case 4: Capture directly from video element
      if (video && (video.captureStream || video.mozCaptureStream)) {
        const stream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
        if (stream) {
          updateTopProgressBar(40, 1, 2, chosenQuality, meta.episodeNum, false);
          const blobUrl = await downloadFromMediaStream(stream, meta.filename, 4000);
          updateTopProgressBar(100, 2, 2, chosenQuality, meta.episodeNum, true);
          triggerFileSave(blobUrl, meta.filename);
          showHud('✅', `Downloaded: ${meta.filename}`, { isSuccess: true, duration: 3500 });
          return;
        }
      }

      hideTopProgressBar();
      showHud('⚠️', 'Stream not found yet. Please press play to start stream.', { duration: 3000 });

    } catch (err) {
      console.error('[FocusGuard] Video download failed:', err);
      hideTopProgressBar();
      showHud('⚠️', `Download error: ${err.message}`, { duration: 3000 });
    } finally {
      isDownloading = false;
      if (btn) btn.classList.remove('fg-downloading');
    }
  }

  // ==========================================================================
  // VIDEO BINDING & INLINE PLAYBACK SETUP
  // ==========================================================================

  function bindVideoEvents(video) {
    if (!video || knownVideos.has(video)) return;
    knownVideos.add(video);

    if (!activeVideo || activeVideo.paused) {
      activeVideo = video;
    }

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

    // playsinline is critical for iOS Safari / Orion WebKit to prevent native player takeover
    try {
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
    } catch (e) {}
  }

  function getAllVideos(root = document) {
    if (!root) return [];
    const videos = [];
    try {
      const v = root.querySelectorAll('video');
      v.forEach((el) => videos.push(el));
      const all = root.querySelectorAll('*');
      for (const el of all) {
        if (el.shadowRoot) {
          const sv = el.shadowRoot.querySelectorAll('video');
          sv.forEach((el) => videos.push(el));
        }
      }
    } catch (e) {}
    return videos;
  }

  function findVideos() {
    const videos = getAllVideos(document);
    videos.forEach(bindVideoEvents);
    if (videos.length > 0 && (!activeVideo || !activeVideo.isConnected)) {
      activeVideo = videos.find(v => !v.paused) || videos[0];
    }
    checkAndMountPlayerDownloadButton();
  }

  document.addEventListener('pointerdown', () => {
    findVideos();
    if (activeVideo && window !== window.top) {
      try {
        window.top.postMessage({ type: 'FOCUSGUARD_VIDEO_ACTIVE' }, '*');
      } catch (e) {}
    }
  }, true);

  const domObserver = new MutationObserver(() => {
    findVideos();
  });

  const rootToObserve = document.documentElement || document.body;
  if (rootToObserve) {
    domObserver.observe(rootToObserve, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body) domObserver.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Cross-frame message bus listener
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'FOCUSGUARD_VIDEO_ACTIVE') {
      // Track active frame
    }

    if (data.type === 'FOCUSGUARD_STREAM_DETECTED' && data.streamUrl && !data.streamUrl.startsWith('blob:')) {
      detectedStreamUrl = data.streamUrl;
      if (data.embedUrl) detectedEmbedUrl = data.embedUrl;
      if (data.playlistText) cachedPlaylistText = data.playlistText;
    }

    if (data.type === 'FOCUSGUARD_SAVE_BLOB' && data.blob) {
      saveBlobDirectlyOrDelegate(data.blob, data.filename);
      updateTopProgressBar(100, 100, 100, '1080p', getEpisodeMetadata().episodeNum, true);
      showHud('✅', `Downloaded: ${data.filename || 'Episode Video'}`, { isSuccess: true, duration: 3500 });
    }

    // Top progress bar sync across child and parent frames
    if (data.type === 'FOCUSGUARD_DOWNLOAD_PROGRESS') {
      updateTopProgressBar(data.pct, data.completed, data.total, data.quality, data.episodeNum, data.pct >= 100);
    }
  });

  // Keyboard shortcut: Press D to quickly trigger episode download
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      downloadActiveVideo('1080p');
    }
  }, true);

  // Extension Popup Communication Bridge
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg) return;

      if (msg.action === 'execute_player_cmd' && msg.cmd === 'download_video') {
        downloadActiveVideo(msg.value || '1080p');
        sendResponse({ success: true, target: 'download' });
        return true;
      }

      if (msg.action === 'get_episode_info') {
        findVideos();
        const meta = getEpisodeMetadata();
        sendResponse({
          success: true,
          metadata: meta,
          isDownloading: isDownloading,
          hasStream: !!detectedStreamUrl,
          streamUrl: detectedStreamUrl
        });
        return true;
      }
    });
  }

  // Initial scan
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      findVideos();
    });
  } else {
    findVideos();
  }

  console.log('[FocusGuard] Video Episode Downloader Suite initialized in frame:', window.location.href);

  // Expose helpers for testing and extension inspection
  try {
    window.__focusguard_get_episode_metadata__ = getEpisodeMetadata;
    window.__focusguard_download_video__ = downloadActiveVideo;
    window.__focusguard_mount_download_btn__ = mountDownloadButton;
    window.__focusguard_parse_playlist__ = parseMasterPlaylist;
    window.__focusguard_format_size__ = formatDataSize;
    window.__focusguard_toggle_quality_popover__ = toggleQualityPopover;
    window.__focusguard_mount_top_progress__ = mountTopProgressBar;
    window.__focusguard_update_top_progress__ = updateTopProgressBar;
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
      toggleQualityPopover,
      mountTopProgressBar,
      updateTopProgressBar
    };
  }
})();
