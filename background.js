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
    'enableAutoSkipIntro', 'enableAutoSkipOutro', 'enableShortcutDock', 'skipIntroSeconds', 'seekSeconds'
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
      enableShortcutDock: res.enableShortcutDock !== undefined ? res.enableShortcutDock : true,
      skipIntroSeconds: res.skipIntroSeconds !== undefined ? res.skipIntroSeconds : 85,
      seekSeconds: res.seekSeconds !== undefined ? res.seekSeconds : 5
    };
    chrome.storage.local.set(defaults);
  });
});

// Update badge display for a specific tab
function updateTabBadge(tabId, count) {
  if (!tabId || tabId < 0) return;
  const text = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#10B981' });
}

// Record a blocked redirect in storage and update badge
function recordBlockedEvent(domain, openerTabId, reason) {
  chrome.storage.local.get(['totalBlocked', 'siteStats'], (data) => {
    const total = (data.totalBlocked || 0) + 1;
    const stats = data.siteStats || {};
    const domainCount = (stats[domain] || 0) + 1;
    stats[domain] = domainCount;

    chrome.storage.local.set({ totalBlocked: total, siteStats: stats });

    if (openerTabId) {
      updateTabBadge(openerTabId, domainCount);
      // Send message to content script to display the HUD toast
      chrome.tabs.sendMessage(openerTabId, {
        action: 'show_toast',
        title: 'FocusGuard Protected',
        message: reason || 'Blocked and closed unwanted redirect tab.'
      }).catch(() => {});
    }
  });
}

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return;

  const tabId = sender.tab ? sender.tab.id : null;

  // Content script reports that user deliberately middle-clicked or Ctrl-clicked a link
  if (message.action === 'allow_user_tab') {
    if (tabId) {
      deliberateUserTabs.set(tabId, Date.now());
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
});

// CORE PROTECTION: Handle new tab creation
chrome.tabs.onCreated.addListener(async (newTab) => {
  try {
    const openerTabId = newTab.openerTabId;
    // Only inspect tabs spawned by an existing webpage/tab
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

    // Check if user recently middle-clicked or Ctrl-clicked intentionally (within last 1.5 seconds)
    const userIntentTime = deliberateUserTabs.get(openerTabId) || 0;
    if (Date.now() - userIntentTime < 1500) {
      // Consume user intent and allow tab
      deliberateUserTabs.delete(openerTabId);
      return;
    }

    // Check destination URL if already known on creation
    const destUrl = newTab.pendingUrl || newTab.url || '';
    if (destUrl && destUrl !== 'about:blank') {
      try {
        const destHost = new URL(destUrl).hostname;
        // If it's an internal/same-origin navigation and user wasn't in player, allow
        if (destHost === openerHost) {
          return;
        }
      } catch (e) {}
    }

    const mode = data.mode || 'block_and_close';

    // Track this child tab in case it navigates to an ad shortly after creation
    trackedChildTabs.set(newTab.id, {
      openerTabId,
      openerHost,
      createdAt: Date.now()
    });

    if (mode === 'block_and_close') {
      console.log('[FocusGuard] Block & Close: Destroying rogue popup tab', newTab.id, 'spawned by', openerHost);

      // 1. Immediately close the rogue popup tab
      chrome.tabs.remove(newTab.id).catch(() => {});

      // 2. Lock focus to the opener tab
      chrome.tabs.update(openerTabId, { active: true }).catch(() => {});

      // 3. Record event and trigger HUD toast
      recordBlockedEvent(openerHost, openerTabId, 'Blocked and closed rogue popup tab.');
    } else if (mode === 'keep_focus') {
      console.log('[FocusGuard] Lock Main Tab: Keeping focus on', openerTabId);

      // Ensure focus stays locked to the main tab
      chrome.tabs.update(openerTabId, { active: true }).catch(() => {});

      recordBlockedEvent(openerHost, openerTabId, 'Redirect opened in background; focus kept on main tab.');
    }
  } catch (err) {
    console.error('[FocusGuard Background] Error in onCreated handler:', err);
  }
});

// SECONDARY DEFENSE: Catch delayed navigations in child tabs (e.g. about:blank -> ad URL)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;

  const childInfo = trackedChildTabs.get(tabId);
  if (!childInfo) return;

  // Clean up stale tracking after 10 seconds
  if (Date.now() - childInfo.createdAt > 10000) {
    trackedChildTabs.delete(tabId);
    return;
  }

  try {
    const data = await chrome.storage.local.get(['enabled', 'mode', 'whitelist']);
    if (!data.enabled) return;

    if (Array.isArray(data.whitelist) && data.whitelist.includes(childInfo.openerHost)) {
      return;
    }

    const destHost = new URL(changeInfo.url).hostname;
    // If child tab navigates to a different host (ad domain)
    if (destHost && destHost !== childInfo.openerHost) {
      const mode = data.mode || 'block_and_close';

      if (mode === 'block_and_close') {
        console.log('[FocusGuard] Block & Close onUpdated: Closing delayed ad navigation in tab', tabId, changeInfo.url);
        chrome.tabs.remove(tabId).catch(() => {});
        chrome.tabs.update(childInfo.openerTabId, { active: true }).catch(() => {});
        recordBlockedEvent(childInfo.openerHost, childInfo.openerTabId, 'Closed delayed ad redirect tab.');
        trackedChildTabs.delete(tabId);
      } else if (mode === 'keep_focus') {
        chrome.tabs.update(childInfo.openerTabId, { active: true }).catch(() => {});
      }
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
