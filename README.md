# 🛡️ Aniwatch Redirect Blocker & FocusGuard

A powerful Manifest V3 browser extension engineered to neutralize aggressive click redirects, invisible clickjack overlays, rogue `window.open` popups, and tab focus-stealing on media streaming websites like [Aniwatch (aniwatch.co.at)](https://aniwatch.co.at/).

---

## 🎯 Target Website

* **Optimized for:** [Aniwatch](https://aniwatch.co.at/) & compatible anime/video streaming platforms.
* **Problem Solved:** Streaming and video player sites embed third-party advertising scripts that hijack the entire page. Clicking the video player, pause/play button, episode list, or server selector normally opens unwanted pop-under tabs (e.g. gambling, malware, or scam redirects) and steals browser focus away from your stream.
* **The Solution:** Aniwatch Redirect Blocker intercepts click hijacking at the browser level, destroys transparent ad layers before they can trigger, prevents synthetic clicks, and automatically terminates any rogue redirect tabs before they can load.

---

## ✨ Features

* 🚫 **Rogue `window.open()` Interception**: Overrides `window.open` at `document_start` before ad scripts execute. In **Block & Close** mode, it safely returns a mock window object so video players never crash or detect blockers.
* 👻 **Invisible Overlay Killer**: Scans for and destroys transparent full-screen or player overlays (`<div>`, `<a>`) that attempt to capture your first click.
* 🎯 **Full-Page Link Click Interceptor**: Stops unauthorized external `target="_blank"` link clicks anywhere on the page while preserving your legitimate internal navigation.
* ⚡ **Instant Tab Destroyer (Block & Close Mode)**: If a streaming player or cross-origin iframe spawns a new popup tab, the background service worker destroys it instantly via `chrome.tabs.remove()` and keeps your viewing tab active.
* 🔒 **Focus Retention (Lock Main Tab Mode)**: If you prefer background tabs to load quietly without interrupting your stream, this mode forces focus to remain locked on your video player.
* 🖱️ **Preserves Legitimate User Intent**: Intentionally opening links using **Middle-Click** (wheel click) or **Ctrl+Click / Cmd+Click** is recognized as user intent and never blocked.
* 🔔 **Non-Intrusive HUD Alerts**: Shows a sleek glassmorphic toast notification in the corner whenever a redirect attempt is successfully stopped.
* 📊 **Live Stats & Whitelisting**: Click the extension icon to view live blocked counts, switch modes, or pause protection on trusted sites.

---

## 📦 How to Install in Your Browser (Chrome, Brave, Edge)

This extension is built with **Manifest V3** and runs natively on Google Chrome, Brave, Microsoft Edge, and any Chromium-based browser.

### Step-by-step Installation:

1. **Clone or Download this Repository**:
   ```bash
   git clone https://github.com/manomoy321/aniwatch-redirect-block.git
   ```
   *(Or download as a ZIP file from GitHub and extract it to a folder).*

2. **Open your Browser's Extension Management Page**:
   * **Chrome**: Visit `chrome://extensions`
   * **Brave**: Visit `brave://extensions`
   * **Microsoft Edge**: Visit `edge://extensions`

3. **Enable Developer Mode**:
   * Look for the **Developer mode** toggle in the top-right corner (or left sidebar in Edge) and turn it **ON**.

4. **Load the Extension**:
   * Click the **"Load unpacked"** button in the top-left.
   * Select the folder containing `manifest.json` (the repository folder).

5. **Pin the Extension**:
   * Click the puzzle icon in your browser toolbar and click the pin icon next to **Aniwatch Redirect Blocker / FocusGuard** for quick access.

6. **Browse Freely**:
   * Navigate to [https://aniwatch.co.at/](https://aniwatch.co.at/) or your favorite streaming site.
   * Click anywhere on the player or page — redirects will be blocked and closed automatically!

---

## ⚙️ How It Works (Multi-Layer Architecture)

```
                       [ USER CLICKS ON PAGE ]
                                  │
      ┌───────────────────────────┴───────────────────────────┐
      ▼                                                       ▼
[ Layer 1: Content Script ]                       [ Layer 2: Main World Hook ]
• Detects transparent overlays                    • Overrides window.open()
• Prevents external target="_blank" clicks        • Blocks synthetic a.click()
• Drops rogue click event propagation             • Blocks dispatchEvent(MouseEvent)
• Renders in-page HUD toast alert                 • Returns safe mock Window object
      │                                                       │
      └───────────────────────────┬───────────────────────────┘
                                  ▼
                     [ Layer 3: Background Worker ]
            • Watches chrome.tabs.onCreated & onUpdated
            • Instantly closes rogue popup tabs (Block & Close)
            • Refocuses main tab (Lock Main Tab)
            • Tracks blocked statistics & badge counters
```

---

## 🧪 Local Testing Laboratory

The repository includes an interactive simulator: `test_page.html`.

1. In `chrome://extensions`, click **Details** on FocusGuard and toggle on **"Allow access to file URLs"**.
2. Open `test_page.html` in your browser.
3. Test all attack vectors:
   * **Overlay Test**: Click the mock video player to verify that the transparent ad layer is eliminated without triggering a redirect.
   * **Rogue `window.open()`**: Click **Trigger window.open()** to verify script interception.
   * **Synthetic Anchor Hijack**: Click **Trigger a.click() Hijack** to verify background programmatic link blocks.
   * **Direct Link Click**: Click **Click External Ad Link** to verify client-side click neutralization.

---

## 🛠️ Tech Stack & File Structure

* **`manifest.json`**: Chrome Extension Manifest V3 specification.
* **`inject.js`**: Page-level script hooking `window.open` and synthetic click prototypes.
* **`content.js`**: Content script intercepting click capture events and managing overlays.
* **`content.css`**: Isolated glassmorphic styles for HUD toast alerts.
* **`background.js`**: Service worker enforcing tab auto-close and focus lock.
* **`popup/`**: Dark glassmorphic settings dashboard with live counters and toggle controls.
* **`icons/`**: High-resolution extension shield icons.

---

## 📄 License & Disclaimer

This extension is open-source and intended for user agency, privacy, and defensive protection against deceptive popups, malware redirects, and clickjacking ad networks when browsing the web. All product names and websites mentioned are trademarks of their respective owners.
