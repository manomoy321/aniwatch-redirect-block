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
      nextEpisodeDelay: res.nextEpisodeDelay !== undefined ? res.nextEpisodeDelay : 0
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
});

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
