/**
 * FocusGuard - Background Service Worker (background.js)
 * Manages tab creation events, focus locking, auto-closing rogue tabs, and statistics.
 */

// Track deliberate user-initiated tab openings: openerTabId -> timestamp
const deliberateUserTabs = new Map();

// Track tabs created from an opener: tabId -> { openerTabId, createdAt, openerHost }
const trackedChildTabs = new Map();

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([
    'enabled', 'mode', 'blockOverlays', 'whitelist', 'totalBlocked', 'siteStats',
    'enableKeyboardControls', 'enableFullscreenFix', 'enableAutoPlay', 'enableAutoNext',
    'enableAutoSkipIntro', 'enableAutoSkipOutro', 'skipIntroSeconds', 'seekSeconds',
    'enableAutoSelectEng', 'nextEpisodeDelay'
  ], (res) => {
    const defaults = {
      enabled: res.enabled !== undefined ? res.enabled : true,
      mode: res.mode || 'block_and_close', // 'block_and_close' | 'keep_focus'
      blockOverlays: res.blockOverlays !== undefined ? res.blockOverlays : true,
      whitelist: res.whitelist || [],
      totalBlocked: res.totalBlocked || 0,
      siteStats: res.siteStats || {},
      // Video Player Suite Defaults
      enableKeyboardControls: res.enableKeyboardControls !== undefined ? res.enableKeyboardControls : true,
      enableFullscreenFix: res.enableFullscreenFix !== undefined ? res.enableFullscreenFix : true,
      enableAutoPlay: res.enableAutoPlay !== undefined ? res.enableAutoPlay : true,
      enableAutoNext: res.enableAutoNext !== undefined ? res.enableAutoNext : true,
      enableAutoSkipIntro: res.enableAutoSkipIntro !== undefined ? res.enableAutoSkipIntro : true,
      enableAutoSkipOutro: res.enableAutoSkipOutro !== undefined ? res.enableAutoSkipOutro : true,
      enableAutoSelectEng: res.enableAutoSelectEng !== undefined ? res.enableAutoSelectEng : true,
      preferredServerCategory: res.preferredServerCategory || 'dub',
      preferredServerName: res.preferredServerName || 'vidsrc',
      skipIntroSeconds: res.skipIntroSeconds !== undefined ? res.skipIntroSeconds : 85,
      seekSeconds: res.seekSeconds !== undefined ? res.seekSeconds : 5,
      nextEpisodeDelay: res.nextEpisodeDelay !== undefined ? res.nextEpisodeDelay : 0,
      downloadQueue: Array.isArray(res.downloadQueue) ? res.downloadQueue : [],
      downloadSettings: res.downloadSettings || { maxConcurrent: 2 }
    };
    chrome.storage.local.set(defaults);
  });
});

// Initialize download queue upon service worker startup
initDownloadQueue();

// Update badge display for a specific tab
function updateTabBadge(tabId, count) {
  if (!tabId || tabId < 0) return;
  const text = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#10B981' });
}

// Record a blocked redirect silently in storage and update badge (no intrusive on-screen popups)
function recordBlockedEvent(domain, openerTabId, reason) {
  chrome.storage.local.get(['totalBlocked', 'siteStats'], (data) => {
    const total = (data.totalBlocked || 0) + 1;
    const stats = data.siteStats || {};
    const domainCount = (stats[domain] || 0) + 1;
    stats[domain] = domainCount;

    chrome.storage.local.set({ totalBlocked: total, siteStats: stats });

    if (openerTabId) {
      updateTabBadge(openerTabId, domainCount);
    }
  });
}

// Check if a destination URL is a rogue ad or redirect
function isAdOrRedirectUrl(urlStr, openerHost = '') {
  if (!urlStr || urlStr === 'about:blank') return false;

  // Safe browser internal schemes
  if (urlStr.startsWith('chrome://') || urlStr.startsWith('edge://') || urlStr.startsWith('chrome-extension://') || urlStr.startsWith('about:')) {
    return false;
  }

  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    const href = parsed.href.toLowerCase();

    // 1. Same host or subdomain as opener is safe
    if (openerHost) {
      const cleanOpener = openerHost.toLowerCase().replace(/^www\./, '');
      if (host === cleanOpener || host.endsWith('.' + cleanOpener)) {
        return false;
      }
    }

    // 2. Known ad networks, pop-under networks, and spam redirect patterns
    const adKeywords = [
      'adsterra', 'popads', 'syndication', 'propeller', 'clickadu', 'adcash', 'exoclick',
      'trafficjunky', 'bet365', '1xbet', 'melbet', 'parimatch', 'stake.com', 'vidoomy',
      'monetag', 'hilltopads', 'richads', 'popcash', 'doubleclick', 'googleadservices',
      'adnxs', 'rubiconproject', 'pubmatic', 'criteo', 'outbrain', 'taboola', 'adroll',
      'smartadserver', 'bidvertiser', 'admaven', 'cpagrip', 'leadbolt', 'appnext',
      'revenuehits', 'yllix', 'a-ads', 'adtrue', 'fastclick', 'mgid',
      'linkvertise', 'shrinkme', 'directrev', 'forthesakeof', 'deloton', 'highcpmgate',
      'trafficgate', 'topcreativeformat', 'effectivecpmcontent', 'profitablecpmrate',
      'alwingulla', 'wpadmngr', 'onclick', 'adguard', 'shortx'
    ];

    for (const kw of adKeywords) {
      if (host.includes(kw)) return true;
    }

    // 3. Ad query parameters and redirect fingerprints
    const adQueryRegex = /(?:[?&])(?:zoneid|traffic_source|click_id|aff_id|offer_id|pub_id|ad_id|ad_url|landing_id|camp_id|popunder)=/i;
    if (adQueryRegex.test(parsed.search)) return true;

    // 4. Typical ad/gambling/redirect host patterns
    if (/(?:^|\.)(?:ads?|pop|popunder|track|tracker|affiliate|casino|betting|adult|redirect)\./i.test(host)) {
      return true;
    }

    // 5. Scripted redirect URLs
    if (/\/redirect\.(?:php|html|js)|(?:\/go|\/click|\/out|\/hop|\/link)\.php\?/i.test(href)) {
      return true;
    }
  } catch (e) {}

  return false;
}

/* ==========================================================================
   FocusGuard - Resilient API Client (Timeouts, Retries, 429 Backoff & Deduplication)
   ========================================================================== */
const inFlightRequests = new Map();

function isTransientHttpStatus(status) {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

function parseRetryAfterHeader(headerVal) {
  if (!headerVal) return null;
  const seconds = parseInt(headerVal, 10);
  if (!isNaN(seconds)) {
    return Math.max(0, Math.min(seconds * 1000, 15000));
  }
  const dateMs = Date.parse(headerVal);
  if (!isNaN(dateMs)) {
    const diff = dateMs - Date.now();
    return Math.max(0, Math.min(diff, 15000));
  }
  return null;
}

async function fetchWithRetry(url, options = {}) {
  const {
    timeoutMs = 20000,
    maxRetries = 3,
    baseDelayMs = 400,
    maxDelayMs = 6000,
    parentSignal = null,
    deduplicate = (options.method || 'GET').toUpperCase() === 'GET',
    ...fetchInit
  } = options;

  const method = (fetchInit.method || 'GET').toUpperCase();
  const rangeHeader = fetchInit.headers && (fetchInit.headers['Range'] || fetchInit.headers['range']);
  const dedupeKey = deduplicate ? `${method}::${url}::${rangeHeader || ''}` : null;

  if (dedupeKey && inFlightRequests.has(dedupeKey)) {
    return inFlightRequests.get(dedupeKey);
  }

  const execute = async () => {
    let attempt = 0;
    while (true) {
      attempt++;
      const controller = new AbortController();
      let timeoutId = null;

      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      const onParentAbort = () => controller.abort(parentSignal && parentSignal.reason);
      if (parentSignal) {
        if (parentSignal.aborted) {
          if (timeoutId) clearTimeout(timeoutId);
          throw (parentSignal.reason || new Error('Request aborted'));
        }
        parentSignal.addEventListener('abort', onParentAbort, { once: true });
      }

      try {
        const response = await fetch(url, {
          ...fetchInit,
          signal: controller.signal
        });

        if (timeoutId) clearTimeout(timeoutId);
        if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);

        // Handle HTTP 429 Too Many Requests
        if (response.status === 429 && attempt <= maxRetries) {
          const retryAfterMs = parseRetryAfterHeader(response.headers && response.headers.get('retry-after'));
          const delay = retryAfterMs !== null ? retryAfterMs : Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)) + Math.random() * 200);
          console.warn(`[FocusGuard API] HTTP 429 received. Backing off ${delay}ms (Attempt ${attempt}/${maxRetries}).`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        // Handle 5xx and 408 Transient Server Errors
        if (isTransientHttpStatus(response.status) && attempt <= maxRetries) {
          const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)) + Math.random() * 200);
          console.warn(`[FocusGuard API] Transient HTTP ${response.status}. Retrying in ${delay}ms (Attempt ${attempt}/${maxRetries}).`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        return response;
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);

        if (parentSignal && parentSignal.aborted) {
          throw err;
        }

        if (attempt <= maxRetries) {
          const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)) + Math.random() * 200);
          console.warn(`[FocusGuard API] Network failure: ${err.message}. Retrying in ${delay}ms (Attempt ${attempt}/${maxRetries}).`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        throw err;
      }
    }
  };

  const promise = execute().finally(() => {
    if (dedupeKey) inFlightRequests.delete(dedupeKey);
  });

  if (dedupeKey) inFlightRequests.set(dedupeKey, promise);
  return promise;
}

/* ==========================================================================
   FocusGuard - Background Download Queue & Lifecycle Manager
   ========================================================================== */
let downloadQueue = [];
let queueSettings = { maxConcurrent: 2 };
const activeJobAbortControllers = new Map();
let queuePersistTimer = null;
const lastBytesMap = new Map();

// Load queue from persistent storage
async function initDownloadQueue() {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    const res = await new Promise((resolve) => {
      chrome.storage.local.get(['downloadQueue', 'downloadSettings'], (data) => {
        resolve(data || {});
      });
    });

    if (Array.isArray(res.downloadQueue)) {
      downloadQueue = res.downloadQueue;
    }
    if (res.downloadSettings && typeof res.downloadSettings.maxConcurrent === 'number') {
      queueSettings.maxConcurrent = res.downloadSettings.maxConcurrent;
    }
    await reconcileQueueWithBrowser();
  } catch (e) {
    console.warn('[FocusGuard Queue] Init error:', e);
  }
}

// Persist queue to chrome.storage.local with debouncing
function persistQueue(immediate = false) {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
  if (queuePersistTimer) {
    clearTimeout(queuePersistTimer);
    queuePersistTimer = null;
  }

  const doSave = () => {
    const sanitized = downloadQueue.map(job => ({
      id: job.id,
      url: job.url,
      embedUrl: job.embedUrl || '',
      filename: job.filename,
      quality: job.quality || '1080p',
      type: job.type || 'direct',
      status: job.status,
      progress: typeof job.progress === 'number' ? job.progress : 0,
      downloadedBytes: job.downloadedBytes || 0,
      bytesReceived: job.bytesReceived || job.downloadedBytes || 0,
      totalBytes: job.totalBytes || 0,
      speed: job.speed || 0,
      downloadId: job.downloadId || null,
      error: job.error || null,
      createdAt: job.createdAt,
      updatedAt: Date.now(),
      retryCount: job.retryCount || 0
    }));

    chrome.storage.local.set({ downloadQueue: sanitized }, () => {});
  };

  if (immediate) {
    doSave();
  } else {
    queuePersistTimer = setTimeout(doSave, 350);
  }
}

// Reconcile queue with browser download manager upon service-worker wake-up
async function reconcileQueueWithBrowser() {
  if (typeof chrome === 'undefined' || !chrome.downloads || typeof chrome.downloads.search !== 'function') return;

  try {
    const browserDownloads = await new Promise((resolve) => {
      chrome.downloads.search({}, (items) => {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) resolve([]);
        else resolve(items || []);
      });
    });

    const browserMap = new Map();
    browserDownloads.forEach(d => browserMap.set(d.id, d));

    let modified = false;
    for (const job of downloadQueue) {
      if (job.downloadId && browserMap.has(job.downloadId)) {
        const b = browserMap.get(job.downloadId);
        if (b.state === 'complete' && job.status !== 'completed') {
          job.status = 'completed';
          job.progress = 100;
          job.speed = 0;
          modified = true;
        } else if (b.state === 'interrupted' && job.status !== 'failed' && job.status !== 'cancelled') {
          if (b.paused) {
            job.status = 'paused';
          } else {
            job.status = 'failed';
            job.error = b.error || 'Download interrupted';
          }
          job.speed = 0;
          modified = true;
        } else if (b.state === 'in_progress') {
          if (b.paused) {
            job.status = 'paused';
          } else {
            job.status = 'downloading';
          }
          job.downloadedBytes = b.bytesReceived || job.downloadedBytes;
          job.totalBytes = b.totalBytes > 0 ? b.totalBytes : job.totalBytes;
          if (job.totalBytes > 0) {
            job.progress = Math.round((job.downloadedBytes / job.totalBytes) * 100);
          }
          modified = true;
        }
      } else if (job.downloadId && !browserMap.has(job.downloadId)) {
        const ageMs = Date.now() - (job.updatedAt || job.createdAt || 0);
        if ((job.status === 'downloading' || job.status === 'preparing') && ageMs > 3000) {
          job.status = 'failed';
          job.error = 'Download lost or interrupted during browser restart';
          job.speed = 0;
          modified = true;
        }
      } else if (job.status === 'downloading' && !job.downloadId && job.type === 'direct') {
        job.status = 'queued';
        modified = true;
      }
    }

    if (modified) {
      persistQueue(true);
    }
  } catch (err) {
    console.warn('[FocusGuard Queue] Reconcile error:', err);
  }
}

// Add download to queue (with deduplication)
function queueDownload(item) {
  const url = item.url;
  const filename = item.filename || 'video.mp4';
  const quality = item.quality || '1080p';
  const type = item.type || (url && url.includes('.m3u8') ? 'hls' : 'direct');

  // Deduplication: prevent adding exact duplicate if already queued or downloading
  const existing = downloadQueue.find(j => 
    j.url === url && 
    j.filename === filename && 
    ['queued', 'preparing', 'downloading'].includes(j.status)
  );
  if (existing) {
    return { success: true, job: existing, isDuplicate: true };
  }

  const newJob = {
    id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    url: url,
    embedUrl: item.embedUrl || '',
    filename: filename,
    quality: quality,
    type: type,
    status: 'queued',
    progress: 0,
    downloadedBytes: 0,
    bytesReceived: 0,
    totalBytes: item.totalBytes || 0,
    speed: 0,
    downloadId: null,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    retryCount: 0
  };

  downloadQueue.push(newJob);
  persistQueue(true);
  processQueue();

  return { success: true, job: newJob };
}

// Process queue and launch jobs up to maxConcurrent limit
function processQueue() {
  const activeCount = downloadQueue.filter(j => j.status === 'downloading' || j.status === 'preparing').length;
  const availableSlots = queueSettings.maxConcurrent - activeCount;

  if (availableSlots <= 0) return;

  const pending = downloadQueue.filter(j => j.status === 'queued');
  for (let i = 0; i < Math.min(availableSlots, pending.length); i++) {
    startJob(pending[i]);
  }
}

// Launch an individual job
async function startJob(job) {
  if (!job || job.status !== 'queued') return;

  job.status = 'preparing';
  persistQueue(true);

  if (job.type === 'direct') {
    job.status = 'downloading';
    persistQueue(true);

    try {
      const downloadOptions = {
        url: job.url,
        filename: job.filename,
        saveAs: false,
        conflictAction: 'uniquify'
      };

      if (job.embedUrl && (job.url.startsWith('http://') || job.url.startsWith('https://'))) {
        downloadOptions.headers = [{ name: 'Referer', value: job.embedUrl }];
      }

      if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
        chrome.downloads.download(downloadOptions, (downloadId) => {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
            job.status = 'failed';
            job.error = chrome.runtime.lastError.message;
            persistQueue(true);
            processQueue();
          } else {
            job.downloadId = downloadId;
            persistQueue(true);
          }
        });
      } else {
        job.status = 'failed';
        job.error = 'chrome.downloads API not available';
        persistQueue(true);
        processQueue();
      }
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
      persistQueue(true);
      processQueue();
    }
  } else if (job.type === 'hls') {
    // HLS downloads run via segment runner and report progress
    job.status = 'downloading';
    persistQueue(true);
  }
}

// Pause a download job
function pauseJob(jobId) {
  const job = downloadQueue.find(j => j.id === jobId);
  if (!job) return { success: false, error: 'Job not found' };

  if (job.downloadId && typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.pause) {
    chrome.downloads.pause(job.downloadId, () => {
      job.status = 'paused';
      job.speed = 0;
      persistQueue(true);
      processQueue();
    });
  } else {
    job.status = 'paused';
    job.speed = 0;
    persistQueue(true);
    processQueue();
  }
  return { success: true };
}

// Resume a paused download job
function resumeJob(jobId) {
  const job = downloadQueue.find(j => j.id === jobId);
  if (!job) return { success: false, error: 'Job not found' };

  if (job.downloadId && typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.resume) {
    chrome.downloads.resume(job.downloadId, () => {
      job.status = 'downloading';
      persistQueue(true);
    });
  } else {
    job.status = 'queued';
    persistQueue(true);
    processQueue();
  }
  return { success: true };
}

// Cancel a download job
function cancelJob(jobId) {
  const job = downloadQueue.find(j => j.id === jobId);
  if (!job) return { success: false, error: 'Job not found' };

  if (activeJobAbortControllers.has(jobId)) {
    activeJobAbortControllers.get(jobId).abort();
    activeJobAbortControllers.delete(jobId);
  }

  if (job.downloadId && typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.cancel) {
    chrome.downloads.cancel(job.downloadId, () => {});
  }

  job.status = 'cancelled';
  job.speed = 0;
  persistQueue(true);
  processQueue();
  return { success: true };
}

// Retry a failed or cancelled download job
function retryJob(jobId) {
  const job = downloadQueue.find(j => j.id === jobId);
  if (!job) return { success: false, error: 'Job not found' };

  job.status = 'queued';
  job.error = null;
  job.progress = 0;
  job.downloadedBytes = 0;
  job.speed = 0;
  job.downloadId = null;
  job.retryCount = (job.retryCount || 0) + 1;
  persistQueue(true);
  processQueue();
  return { success: true };
}

// Remove a download job from queue
function removeJob(jobId) {
  const index = downloadQueue.findIndex(j => j.id === jobId);
  if (index === -1) return { success: false, error: 'Job not found' };

  const job = downloadQueue[index];
  if (job.status === 'downloading' || job.status === 'preparing') {
    cancelJob(jobId);
  }

  downloadQueue.splice(index, 1);
  persistQueue(true);
  processQueue();
  return { success: true };
}

// Clear all completed, failed, or cancelled jobs
function clearCompletedJobs() {
  const countBefore = downloadQueue.length;
  downloadQueue = downloadQueue.filter(j => ['queued', 'preparing', 'downloading', 'paused'].includes(j.status));
  persistQueue(true);
  return { success: true, cleared: countBefore - downloadQueue.length };
}

// Update job progress reported from runner (e.g. HLS or direct stream chunk)
function updateJobProgress(data) {
  const jobId = data.jobId;
  const job = downloadQueue.find(j => j.id === jobId || (data.downloadId && j.downloadId === data.downloadId));
  if (!job) return { success: false, error: 'Job not found' };

  if (typeof data.progress === 'number') job.progress = Math.max(0, Math.min(100, data.progress));
  const dlBytes = (typeof data.downloadedBytes === 'number') ? data.downloadedBytes : ((typeof data.bytesReceived === 'number') ? data.bytesReceived : null);
  if (dlBytes !== null) {
    job.downloadedBytes = dlBytes;
    job.bytesReceived = dlBytes;
  }
  if (typeof data.totalBytes === 'number' && data.totalBytes > 0) job.totalBytes = data.totalBytes;
  if (typeof data.speed === 'number') job.speed = data.speed;
  if (data.status) job.status = data.status;
  if (data.downloadId) job.downloadId = data.downloadId;
  if (data.error) job.error = data.error;

  job.updatedAt = Date.now();

  if (['completed', 'failed', 'cancelled'].includes(job.status)) {
    persistQueue(true);
    processQueue();
  } else {
    persistQueue(false);
  }

  return { success: true };
}

// Listen for browser download events to sync direct downloads
if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.onChanged) {
  chrome.downloads.onChanged.addListener((delta) => {
    const job = downloadQueue.find(j => j.downloadId === delta.id);
    if (!job) return;

    const now = Date.now();

    if (delta.state) {
      if (delta.state.current === 'complete') {
        job.status = 'completed';
        job.progress = 100;
        job.speed = 0;
        persistQueue(true);
        processQueue();
      } else if (delta.state.current === 'interrupted') {
        if (delta.error && delta.error.current === 'USER_CANCELED') {
          job.status = 'cancelled';
        } else {
          job.status = 'failed';
          job.error = (delta.error && delta.error.current) || 'Download interrupted';
        }
        job.speed = 0;
        persistQueue(true);
        processQueue();
      }
    }

    if (delta.paused) {
      job.status = delta.paused.current ? 'paused' : 'downloading';
      persistQueue(true);
    }

    if (delta.totalBytes && delta.totalBytes.current > 0) {
      job.totalBytes = delta.totalBytes.current;
    }

    if (delta.bytesReceived) {
      const currentBytes = delta.bytesReceived.current;
      const prev = lastBytesMap.get(job.id);
      if (prev && now > prev.timestamp) {
        const timeDiffSec = (now - prev.timestamp) / 1000;
        if (timeDiffSec >= 0.5) {
          job.speed = Math.round((currentBytes - prev.bytes) / timeDiffSec);
          lastBytesMap.set(job.id, { bytes: currentBytes, timestamp: now });
        }
      } else {
        lastBytesMap.set(job.id, { bytes: currentBytes, timestamp: now });
      }

      job.downloadedBytes = currentBytes;
      job.bytesReceived = currentBytes;
      if (job.totalBytes > 0) {
        job.progress = Math.round((job.downloadedBytes / job.totalBytes) * 100);
      }
      persistQueue(false);
    }
  });
}

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return;

  const tabId = sender.tab ? sender.tab.id : null;

  // Content script reports user interaction (click, auxclick, contextmenu)
  if (message.action === 'allow_user_tab') {
    if (tabId) {
      deliberateUserTabs.set(tabId, {
        timestamp: Date.now(),
        targetUrl: message.targetUrl || '',
        targetHost: message.targetHost || '',
        isUserGesture: true
      });
    }
    sendResponse({ success: true });
    return true;
  }

  // Content script reports an intercepted redirect/overlay
  if (message.action === 'record_blocked') {
    const domain = message.domain || (sender.tab && sender.tab.url ? new URL(sender.tab.url).hostname : 'unknown');
    recordBlockedEvent(domain, tabId, message.reason);
    sendResponse({ success: true });
    return true;
  }

  // Popup requests reset
  if (message.action === 'reset_stats') {
    chrome.storage.local.set({ totalBlocked: 0, siteStats: {} }, () => {
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((t) => {
          if (t.id) updateTabBadge(t.id, 0);
        });
      });
      sendResponse({ success: true });
    });
    return true;
  }

  // Download Queue Manager Handlers
  if (message.action === 'queue_download') {
    const res = queueDownload(message);
    sendResponse(res);
    return true;
  }

  if (message.action === 'get_download_queue') {
    sendResponse({ success: true, queue: downloadQueue, settings: queueSettings });
    return true;
  }

  if (message.action === 'pause_download') {
    const res = pauseJob(message.jobId);
    sendResponse(res);
    return true;
  }

  if (message.action === 'resume_download') {
    const res = resumeJob(message.jobId);
    sendResponse(res);
    return true;
  }

  if (message.action === 'cancel_download') {
    const res = cancelJob(message.jobId);
    sendResponse(res);
    return true;
  }

  if (message.action === 'retry_download') {
    const res = retryJob(message.jobId);
    sendResponse(res);
    return true;
  }

  if (message.action === 'remove_download') {
    const res = removeJob(message.jobId);
    sendResponse(res);
    return true;
  }

  if (message.action === 'clear_completed_downloads') {
    const res = clearCompletedJobs();
    sendResponse(res);
    return true;
  }

  if (message.action === 'update_job_progress') {
    const res = updateJobProgress(message);
    sendResponse(res);
    return true;
  }

  // Video Player Suite: Download video with custom episode filename
  if (message.action === 'download_video') {
    const downloadUrl = message.url;
    const downloadFilename = message.filename || 'Episode_Video.mp4';

    if (!downloadUrl) {
      sendResponse({ success: false, error: 'No download URL specified.' });
      return false;
    }

    try {
      const qRes = queueDownload({
        url: downloadUrl,
        filename: downloadFilename,
        embedUrl: message.embedUrl || '',
        quality: message.quality || '1080p',
        type: (downloadUrl.includes('.m3u8') || downloadUrl.includes('/hls/')) ? 'hls' : 'direct',
        totalBytes: message.totalBytes || 0
      });

      const downloadOptions = {
        url: downloadUrl,
        filename: downloadFilename,
        saveAs: false,
        conflictAction: 'uniquify'
      };

      if (message.embedUrl && (downloadUrl.startsWith('http://') || downloadUrl.startsWith('https://'))) {
        downloadOptions.headers = [
          { name: 'Referer', value: message.embedUrl }
        ];
      }

      if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
        chrome.downloads.download(downloadOptions, (downloadId) => {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
            console.warn('[FocusGuard Background] Video download error:', chrome.runtime.lastError.message);
            if (qRes && qRes.job) {
              updateJobProgress({ jobId: qRes.job.id, status: 'failed', error: chrome.runtime.lastError.message });
            }
            sendResponse({ success: false, error: chrome.runtime.lastError.message, jobId: qRes && qRes.job ? qRes.job.id : null });
          } else {
            console.log('[FocusGuard Background] Download initiated successfully. ID:', downloadId, 'File:', downloadFilename);
            if (qRes && qRes.job) {
              updateJobProgress({ jobId: qRes.job.id, downloadId: downloadId, status: 'downloading' });
            }
            sendResponse({ success: true, downloadId: downloadId, jobId: qRes && qRes.job ? qRes.job.id : null });
          }
        });
      } else {
        sendResponse({ success: false, error: 'chrome.downloads not supported on this platform', useFallback: true });
      }
    } catch (e) {
      console.error('[FocusGuard Background] Download exception:', e);
      sendResponse({ success: false, error: e.message, useFallback: true });
    }
    return true;
  }

  // Pre-arm stream CDN Referer / Origin bypass headers
  if (message.action === 'arm_stream_bypass') {
    const targetUrl = message.url || '';
    const embedUrl = message.embedUrl || '';
    (async () => {
      try {
        await setStreamBypassHeaders(embedUrl, targetUrl);
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // Stream Resource Proxy: Bypasses CDN Referer / Origin 403 checks with resilient retry & deduplication
  if (message.action === 'fetch_stream_data') {
    const targetUrl = message.url;
    const embedUrl = message.embedUrl || '';
    const asBinary = !!message.asBinary;
    const byteRange = message.byteRange || null;

    if (!targetUrl) {
      sendResponse({ success: false, error: 'No stream target URL specified.' });
      return false;
    }

    (async () => {
      let ruleSet = false;
      try {
        if (embedUrl) {
          await setStreamBypassHeaders(embedUrl, targetUrl);
          ruleSet = true;
        }

        const fetchOptions = {
          method: 'GET',
          cache: 'no-cache',
          timeoutMs: 20000,
          maxRetries: 3,
          baseDelayMs: 350
        };
        if (byteRange) {
          fetchOptions.headers = { 'Range': `bytes=${byteRange}` };
        }

        const res = await fetchWithRetry(targetUrl, fetchOptions);
        if (!res.ok) {
          sendResponse({ success: false, status: res.status, error: `Stream HTTP ${res.status}` });
          return;
        }

        if (asBinary) {
          const buffer = await res.arrayBuffer();
          const base64 = arrayBufferToBase64(buffer);
          sendResponse({ success: true, base64: base64, status: res.status });
        } else {
          const text = await res.text();
          sendResponse({ success: true, text: text, status: res.status });
        }
      } catch (err) {
        console.warn('[FocusGuard Background] fetch_stream_data error:', err);
        sendResponse({ success: false, error: err.message });
      } finally {
        if (ruleSet) {
          await clearStreamBypassHeaders();
        }
      }
    })();

    return true;
  }
});

// Stream Bypass Engine (Eliminates HTTP 403 Forbidden on CDNs like MegaCloud/RapidCloud/Quavex)
const STREAM_BYPASS_RULE_ID = 9001;
const STREAM_BYPASS_MAX_RULES = 25;
let activeStreamBypassCount = 0;
let streamBypassClearTimer = null;
let currentBypassKey = '';

// Clean up any lingering stream bypass DNR rules on startup so they never interfere with regular playback
if (typeof chrome !== 'undefined' && chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateDynamicRules) {
  try {
    const startupRuleIds = Array.from({ length: STREAM_BYPASS_MAX_RULES }, (_, i) => STREAM_BYPASS_RULE_ID + i);
    chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: startupRuleIds
    }).catch(() => {});
  } catch (e) {}
}

async function setStreamBypassHeaders(embedUrl, targetUrl) {
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateDynamicRules) return;
  if (!embedUrl && !targetUrl) return;

  if (streamBypassClearTimer) {
    clearTimeout(streamBypassClearTimer);
    streamBypassClearTimer = null;
  }
  activeStreamBypassCount++;

  try {
    let cleanOrigin = '';
    let cleanReferer = '';

    const targetUrlStr = (targetUrl || '').toLowerCase();
    const embedUrlStr = (embedUrl || '').toLowerCase();

    // Known streaming CDN overrides
    if (targetUrlStr.includes('quavex') || targetUrlStr.includes('nexabloom') || targetUrlStr.includes('megaplay') || embedUrlStr.includes('megaplay') || embedUrlStr.includes('1anime')) {
      cleanOrigin = 'https://megaplay.buzz';
      cleanReferer = 'https://megaplay.buzz/';
    } else if (targetUrlStr.includes('megacloud') || embedUrlStr.includes('megacloud')) {
      cleanOrigin = 'https://megacloud.tv';
      cleanReferer = 'https://megacloud.tv/';
    } else if (targetUrlStr.includes('rapid-cloud') || embedUrlStr.includes('rapid-cloud')) {
      cleanOrigin = 'https://rapid-cloud.co';
      cleanReferer = 'https://rapid-cloud.co/';
    } else if (embedUrl) {
      try {
        const u = new URL(embedUrl);
        cleanOrigin = u.origin;
        cleanReferer = u.origin + '/';
      } catch (e) {}
    }

    if (!cleanOrigin && targetUrl) {
      try {
        const u = new URL(targetUrl);
        cleanOrigin = u.origin;
        cleanReferer = u.origin + '/';
      } catch (e) {}
    }

    if (!cleanOrigin) {
      cleanOrigin = 'https://megaplay.buzz';
      cleanReferer = 'https://megaplay.buzz/';
    }

    // Dynamic list of streaming domains to bypass: target host first, then embed host, then defaults
    const domainsToBypass = [];
    if (targetUrl) {
      try {
        const tHost = new URL(targetUrl).hostname;
        if (tHost && !domainsToBypass.includes(tHost)) {
          domainsToBypass.push(tHost);
        }
      } catch (e) {}
    }
    if (embedUrl) {
      try {
        const eHost = new URL(embedUrl).hostname;
        if (eHost && !domainsToBypass.includes(eHost)) {
          domainsToBypass.push(eHost);
        }
      } catch (e) {}
    }
    const defaultDomains = ['quavex.top', 'nexabloom.top', 'megaplay.buzz', '1anime.site', 'megacloud.tv', 'rapid-cloud.co'];
    for (const d of defaultDomains) {
      if (!domainsToBypass.includes(d)) domainsToBypass.push(d);
    }

    const bypassKey = `${cleanReferer}::${domainsToBypass.sort().join(',')}`;
    if (currentBypassKey === bypassKey) {
      return; // Already configured, avoid expensive DNR churn
    }
    currentBypassKey = bypassKey;

    const rules = domainsToBypass.slice(0, STREAM_BYPASS_MAX_RULES).map((domain, index) => ({
      id: STREAM_BYPASS_RULE_ID + index,
      priority: 100,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Referer', operation: 'set', value: cleanReferer },
          { header: 'Origin', operation: 'set', value: cleanOrigin },
          { header: 'User-Agent', operation: 'set', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        ]
      },
      condition: {
        urlFilter: `||${domain}`,
        resourceTypes: ['xmlhttprequest', 'media', 'other']
      }
    }));

    const ruleIdsToRemove = Array.from({ length: STREAM_BYPASS_MAX_RULES }, (_, i) => STREAM_BYPASS_RULE_ID + i);

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ruleIdsToRemove,
      addRules: rules
    });
  } catch (err) {
    console.warn('[FocusGuard Background] DNR rule error:', err);
  }
}

async function clearStreamBypassHeaders() {
  activeStreamBypassCount = Math.max(0, activeStreamBypassCount - 1);
  if (activeStreamBypassCount > 0) {
    return; // Other segment fetches are still active!
  }

  if (streamBypassClearTimer) clearTimeout(streamBypassClearTimer);
  streamBypassClearTimer = setTimeout(async () => {
    if (activeStreamBypassCount > 0) return;
    if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateDynamicRules) return;
    try {
      const ruleIdsToRemove = Array.from({ length: STREAM_BYPASS_MAX_RULES }, (_, i) => STREAM_BYPASS_RULE_ID + i);
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ruleIdsToRemove
      });
      currentBypassKey = '';
    } catch (e) {}
    streamBypassClearTimer = null;
  }, 25000);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const len = bytes.length;
  let binary = '';
  const chunkSize = 32768;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

// CORE PROTECTION: Handle new tab creation
// Allows user to open legitimate new tabs freely without closing them forcefully;
// ONLY targets and terminates rogue ad redirects and popups.
chrome.tabs.onCreated.addListener(async (newTab) => {
  try {
    const openerTabId = newTab.openerTabId;
    // Tabs created independently without an opener (Ctrl+T, '+' button, address bar, bookmarks) are NEVER touched!
    if (!openerTabId) return;

    const data = await chrome.storage.local.get(['enabled', 'mode', 'whitelist']);
    if (!data.enabled) return;

    // Check opener tab info
    const openerTab = await chrome.tabs.get(openerTabId).catch(() => null);
    if (!openerTab || !openerTab.url) return;

    let openerHost = '';
    try {
      openerHost = new URL(openerTab.url).hostname;
    } catch (e) {
      return;
    }

    // Skip whitelisted domains
    if (Array.isArray(data.whitelist) && data.whitelist.includes(openerHost)) {
      return;
    }

    // Check user intent (8-second window to accommodate context menu "Open link in new tab", etc.)
    const userIntent = deliberateUserTabs.get(openerTabId);
    const hasRecentUserGesture = !!(userIntent && (Date.now() - userIntent.timestamp < 8000));

    // CRITICAL: If tab was spawned without an explicit, verified user link gesture,
    // IMMEDIATELY lock focus back to the main opener tab so the user's view is never stolen!
    const mode = data.mode || 'block_and_close';
    if (!hasRecentUserGesture && (mode === 'block_and_close' || mode === 'keep_focus')) {
      chrome.tabs.update(openerTabId, { active: true }).catch(() => {});
    }

    // Register tab for tracking so onUpdated can inspect once final URL is loaded
    trackedChildTabs.set(newTab.id, {
      openerTabId,
      openerHost,
      createdAt: Date.now(),
      hasUserGesture: hasRecentUserGesture,
      userIntent: userIntent ? { ...userIntent } : null
    });

    // If this tab was created for a verified user gesture, consume the gesture so rogue scripts cannot piggyback
    if (hasRecentUserGesture) {
      deliberateUserTabs.delete(openerTabId);
    }

    // Check destination URL if already available at creation
    const destUrl = newTab.pendingUrl || newTab.url || '';
    if (destUrl && destUrl !== 'about:blank') {
      try {
        const destHost = new URL(destUrl).hostname;

        // Same-origin / subdomains: always allowed!
        const cleanOpener = openerHost.replace(/^www\./, '');
        if (destHost === openerHost || destHost.endsWith('.' + cleanOpener)) {
          return;
        }

        // Browser internal URLs: always allowed!
        if (destUrl.startsWith('chrome://') || destUrl.startsWith('edge://') || destUrl.startsWith('chrome-extension://')) {
          return;
        }

        // Deliberate user action targeting this host/URL: allowed!
        if (hasRecentUserGesture && userIntent && (userIntent.targetHost === destHost || (userIntent.targetUrl && destUrl.startsWith(userIntent.targetUrl)))) {
          return;
        }

        // Inspect if destination is an ad redirect or unsolicited external popup
        const isAd = isAdOrRedirectUrl(destUrl, openerHost);
        const isUnsolicitedExternal = !hasRecentUserGesture && (destHost !== openerHost);

        if (isAd || isUnsolicitedExternal) {
          if (mode === 'block_and_close') {
            console.log('[FocusGuard] Block & Close: Destroying rogue ad redirect tab immediately', newTab.id, destUrl);
            chrome.tabs.remove(newTab.id).catch(() => {});
            chrome.tabs.update(openerTabId, { active: true }).catch(() => {});
            recordBlockedEvent(openerHost, openerTabId, 'Blocked and closed rogue redirect tab.');
            trackedChildTabs.delete(newTab.id);
          } else if (mode === 'keep_focus') {
            chrome.tabs.update(openerTabId, { active: true }).catch(() => {});
            recordBlockedEvent(openerHost, openerTabId, 'Redirect opened in background; focus kept on main tab.');
          }
        }
      } catch (e) {}
    }
    // Note: If destUrl is pending or about:blank, openerTabId focus is already locked above!
    // We terminate the rogue tab in onUpdated below as soon as the ad URL loads.
  } catch (err) {
    console.error('[FocusGuard Background] Error in onCreated handler:', err);
  }
});

// SECONDARY DEFENSE: Catch delayed navigations in child tabs (e.g. about:blank -> ad URL)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;

  const childInfo = trackedChildTabs.get(tabId);
  if (!childInfo) return;

  // Clean up stale tracking after 15 seconds
  if (Date.now() - childInfo.createdAt > 15000) {
    trackedChildTabs.delete(tabId);
    return;
  }

  try {
    const data = await chrome.storage.local.get(['enabled', 'mode', 'whitelist']);
    if (!data.enabled) return;

    if (Array.isArray(data.whitelist) && data.whitelist.includes(childInfo.openerHost)) {
      return;
    }

    const currentUrl = changeInfo.url;
    // Internal browser URLs or about:blank: allow
    if (currentUrl === 'about:blank' || currentUrl.startsWith('chrome://') || currentUrl.startsWith('edge://')) {
      return;
    }

    let destHost = '';
    try {
      destHost = new URL(currentUrl).hostname;
    } catch (e) {
      return;
    }

    // 1. Same host or subdomain as opener: legitimate page, always allowed!
    const cleanOpener = childInfo.openerHost.replace(/^www\./, '');
    if (destHost === childInfo.openerHost || destHost.endsWith('.' + cleanOpener)) {
      trackedChildTabs.delete(tabId);
      return;
    }

    // 2. Deliberate user action (clicked link or opened via context menu): allow!
    if (childInfo.hasUserGesture && childInfo.userIntent) {
      if (childInfo.userIntent.targetHost === destHost || 
          (childInfo.userIntent.targetUrl && currentUrl.startsWith(childInfo.userIntent.targetUrl))) {
        trackedChildTabs.delete(tabId);
        return;
      }
    }

    // 3. Inspect if it matches an ad/redirect fingerprint or was spawned unsolicited without user gesture
    const isAd = isAdOrRedirectUrl(currentUrl, childInfo.openerHost);
    const isUnsolicitedExternal = !childInfo.hasUserGesture;

    if (isAd || isUnsolicitedExternal) {
      const mode = data.mode || 'block_and_close';

      if (mode === 'block_and_close') {
        console.log('[FocusGuard] Block & Close onUpdated: Closing delayed ad navigation in tab', tabId, currentUrl);
        chrome.tabs.remove(tabId).catch(() => {});
        chrome.tabs.update(childInfo.openerTabId, { active: true }).catch(() => {});
        recordBlockedEvent(childInfo.openerHost, childInfo.openerTabId, 'Closed delayed ad redirect tab.');
        trackedChildTabs.delete(tabId);
      } else if (mode === 'keep_focus') {
        chrome.tabs.update(childInfo.openerTabId, { active: true }).catch(() => {});
      }
    } else {
      // Legitimate external navigation opened by user: allow and finish tracking
      trackedChildTabs.delete(tabId);
    }
  } catch (e) {}
});

// Clean up closed tabs from tracking
chrome.tabs.onRemoved.addListener((tabId) => {
  trackedChildTabs.delete(tabId);
});

// Sync badge when switching tabs
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab || !tab.url) return;
    const host = new URL(tab.url).hostname;

    const data = await chrome.storage.local.get(['siteStats']);
    const stats = data.siteStats || {};
    const count = stats[host] || 0;
    updateTabBadge(activeInfo.tabId, count);
  } catch (e) {}
});

// Unit test / Node.js export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fetchWithRetry,
    parseRetryAfterHeader,
    isTransientHttpStatus,
    inFlightRequests,
    initDownloadQueue,
    persistQueue,
    reconcileQueueWithBrowser,
    queueDownload,
    processQueue,
    startJob,
    pauseJob,
    resumeJob,
    cancelJob,
    retryJob,
    removeJob,
    clearCompletedJobs,
    updateJobProgress,
    getDownloadQueue: () => downloadQueue,
    getQueueSettings: () => queueSettings,
    setDownloadQueue: (q) => { downloadQueue = q; },
    isAdOrRedirectUrl
  };
}

