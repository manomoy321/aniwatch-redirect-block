/**
 * FocusGuard - Background Service Worker (background.js)
 * Dedicated Episode Downloader Engine & CDN Bypass Stream Proxy.
 */

// Initialize default downloader settings on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['preferredQuality'], (res) => {
    chrome.storage.local.set({
      preferredQuality: res.preferredQuality || '1080p'
    });
  });
});

// Stream Bypass Engine (Eliminates HTTP 403 Forbidden on CDNs like MegaCloud/RapidCloud/Quavex)
const STREAM_BYPASS_RULE_ID = 9001;
const STREAM_BYPASS_MAX_RULES = 15;
let activeStreamBypassCount = 0;
let streamBypassClearTimer = null;

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
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

    if (!cleanOrigin) {
      cleanOrigin = 'https://megaplay.buzz';
      cleanReferer = 'https://megaplay.buzz/';
    }

    const currentRuleId = STREAM_BYPASS_RULE_ID + (activeStreamBypassCount % STREAM_BYPASS_MAX_RULES);
    const rule = {
      id: currentRuleId,
      priority: 999,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Referer', operation: 'set', value: cleanReferer },
          { header: 'Origin', operation: 'set', value: cleanOrigin }
        ]
      },
      condition: {
        urlFilter: '*://*/*',
        resourceTypes: ['xmlhttprequest', 'media', 'other']
      }
    };

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [currentRuleId],
      addRules: [rule]
    });
  } catch (err) {
    console.warn('[FocusGuard Background] DNR rule set error:', err);
  }
}

async function clearStreamBypassHeaders() {
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateDynamicRules) return;
  if (streamBypassClearTimer) clearTimeout(streamBypassClearTimer);

  streamBypassClearTimer = setTimeout(async () => {
    try {
      const ruleIds = Array.from({ length: STREAM_BYPASS_MAX_RULES }, (_, i) => STREAM_BYPASS_RULE_ID + i);
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ruleIds
      });
    } catch (e) {}
  }, 12000);
}

// Listen for messages from content script, player controller, and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return;

  // Video Download: Trigger download with custom episode filename and Orion iOS fallback
  if (message.action === 'download_video') {
    const downloadUrl = message.url;
    const downloadFilename = message.filename || 'Episode_Video.mp4';

    if (!downloadUrl) {
      sendResponse({ success: false, error: 'No download URL specified.' });
      return false;
    }

    try {
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

      // Check if chrome.downloads is available (e.g. Orion on iOS does not support chrome.downloads)
      if (typeof chrome !== 'undefined' && chrome.downloads && typeof chrome.downloads.download === 'function') {
        chrome.downloads.download(downloadOptions, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.warn('[FocusGuard Background] Video download error:', chrome.runtime.lastError.message);
            sendResponse({ success: false, error: chrome.runtime.lastError.message, useFallback: true });
          } else {
            console.log('[FocusGuard Background] Download initiated successfully. ID:', downloadId, 'File:', downloadFilename);
            sendResponse({ success: true, downloadId: downloadId });
          }
        });
      } else {
        // Fallback for Orion iOS / WebKit environments without chrome.downloads
        console.warn('[FocusGuard Background] chrome.downloads not supported in this browser (e.g. Orion on iOS). Instructing client to use anchor/blob fallback.');
        sendResponse({ success: false, error: 'chrome.downloads not supported on this platform', useFallback: true });
      }
    } catch (e) {
      console.error('[FocusGuard Background] Download exception:', e);
      sendResponse({ success: false, error: e.message, useFallback: true });
    }
    return true;
  }

  // Stream Resource Proxy: Bypasses CDN Referer / Origin 403 checks
  if (message.action === 'fetch_stream_data') {
    const targetUrl = message.url;
    const embedUrl = message.embedUrl || '';
    const asBinary = !!message.asBinary;

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

        const res = await fetch(targetUrl, { method: 'GET', cache: 'no-cache' });
        if (!res.ok) {
          sendResponse({ success: false, status: res.status, error: `Playlist HTTP ${res.status}` });
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
