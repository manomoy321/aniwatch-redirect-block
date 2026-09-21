# 🛡️ Aniwatch Redirect Blocker & FocusGuard

A powerful Manifest V3 browser extension engineered to neutralize aggressive click redirects, invisible clickjack overlays, rogue `window.open` popups, and tab focus-stealing on media streaming websites like [Aniwatch (aniwatch.co.at)](https://aniwatch.co.at/).

---

## 🎯 Target Website

* **Optimized for:** [Aniwatch](https://aniwatch.co.at/) & compatible anime/video streaming platforms.
* **Problem Solved:** Streaming and video player sites embed third-party advertising scripts that hijack the entire page. Clicking the video player, pause/play button, episode list, or server selector normally opens unwanted pop-under tabs (e.g. gambling, malware, or scam redirects) and steals browser focus away from your stream.
* **The Solution:** Aniwatch Redirect Blocker intercepts click hijacking at the browser level, destroys transparent ad layers before they can trigger, prevents synthetic clicks, and automatically terminates any rogue redirect tabs before they can load.

---

## ✨ Features

### 🎬 Video Player Suite (Aniwatch & Streaming Media)
* 🎛️ **Native Player Controls Priority**:
  * Unobstructed playback: No floating overlay dock covers or interferes with the site's existing player controls (scrubber, volume slider, settings, play button, and skip buttons).
  * Existing player controls are protected from clickjacking filters so clicking native buttons is always immediate and redirect-free.
* 🖱️ **Interactive Popup Shortcuts Matrix**:
  * Every shortcut listed inside the extension popup is an interactive button. Clicking any row in the popup immediately controls playback on the active video tab.
* ⌨️ **Universal Keyboard Controls**: Cross-frame keyboard shortcuts that work even when focus is on the host page or outer iframe:
  * <kbd>Space</kbd> or <kbd>K</kbd>: Play / Pause toggle
  * <kbd>←</kbd> / <kbd>→</kbd> or <kbd>J</kbd> / <kbd>L</kbd>: Seek ±5 seconds (<kbd>Shift</kbd> + <kbd>←</kbd>/<kbd>→</kbd> for ±15s)
  * <kbd>↑</kbd> / <kbd>↓</kbd>: Volume up / down (±5%)
  * <kbd>M</kbd>: Mute / Unmute audio
  * <kbd>F</kbd>: Fullscreen toggle (or double-click video)
  * <kbd>S</kbd> or <kbd>I</kbd>: Skip Intro (auto-clicks button or jumps forward 85s)
  * <kbd>O</kbd>: Skip Outro (auto-clicks button or jumps forward 85s)
  * <kbd>[</kbd> / <kbd>]</kbd> or <kbd>&lt;</kbd> / <kbd>&gt;</kbd>: Playback speed down / up (0.25x – 3.0x)
  * <kbd>0</kbd> – <kbd>9</kbd>: Jump to 0% – 90% of duration
  * <kbd>N</kbd> or <kbd>P</kbd>: Advance to Next Episode
* ⛶ **Rock-Solid Fullscreen & Seamless Retention**:
  * **Maintains Fullscreen Mode**: Fullscreen is preserved across auto-skip intro, auto-skip outro, and next episode transitions. If the site player drops fullscreen, FocusGuard instantly re-engages it.
  * **Scrollbar Disabler**: Completely disables and hides all scrollbars (`overflow: hidden`, `scrollbar-width: none`, `::-webkit-scrollbar: none`) in fullscreen mode so no scrollbars appear.
  * Automatically injects `allowfullscreen`, `webkitallowfullscreen`, and Permissions Policy `allow="fullscreen; autoplay; ..."` onto all player `<iframe>`s (MegaCloud, RapidCloud, StreamTape, etc.).
  * Cross-frame fallback bridge: If an iframe's internal fullscreen request is blocked by browser sandboxing, FocusGuard bridges the request to the parent window to fullscreen the player container cleanly.
  * Double-click on video to toggle fullscreen.
* ▶️ **Intelligent Auto-Play**:
  * Automatically starts playback on player load.
  * If browser autoplay policy rejects unmuted audio, it smoothly falls back to playing muted with an on-screen prompt and immediately unmutes on the first user interaction.
* ⚡ **Auto Skip Intro & Outro**:
  * Auto-detects and clicks Skip Intro / Skip OP buttons across Aniwatch, MegaCloud, RapidCloud, and custom HTML5 players within 350ms of appearance without dropping fullscreen.
  * Auto-detects and clicks Skip Outro / Skip ED buttons when ending credits play without dropping fullscreen.
  * Instant manual hotkey fallback (<kbd>S</kbd> / <kbd>O</kbd>) jumps 85 seconds forward.
* 🌐 **English DUB & Server Continuity Engine**:
  * **Duplicate Button Disambiguation (`vidsrc`)**: Streaming sites often have identical server button names under both SUB and DUB (such as `vidsrc`). FocusGuard scopes strictly to the DUB category first, disambiguates the duplicate buttons, and always selects the English DUB server instead of defaulting to SUB.
  * **Persistent Server Continuity Across Episodes**: When you select a server button (or switch to DUB), FocusGuard saves your preference. On every next episode and video load, your chosen server is automatically re-applied without resetting to defaults.
  * Automatically enables English subtitle text tracks (`video.textTracks`) and English audio tracks (`video.audioTracks`) in HTML5 and embedded players (JWPlayer, MegaCloud).
  * Automatically sets anime title language to English (`EN` / `ENG`) when available.
* 🚀 **Smooth Playback & Aggressive Video Buffer Engine**:
  * **Continuous Cache Ahead**: Maximizes HTML5 video preload (`preload = 'auto'`) and tunes HLS streaming buffers to cache 3 to 10 minutes ahead, eliminating playback stutter and buffering freezes.
  * **GPU Hardware Acceleration**: Forces GPU compositor layer rendering (`transform: translateZ(0)`, `will-change: transform`) to prevent dropped frames when HUD overlays or controls render.
* ⏭️ **Instant Auto Play Next Episode (0s Delay)**:
  * Watches video end events and immediately advances to the next episode with **0 seconds delay**, maintaining fullscreen mode.
  * Delay is fully configurable in the extension popup (0s Instant, 1s, 3s, 5s).
* 🖥️ **Cyber-Sleek Player HUD**:
  * Visual glassmorphic pill notifications floating on screen providing instantaneous feedback for play, pause, seek, volume bar, speed, language, and auto-skip.
* 💬 **Typing Safety Exclusion**:
  * Automatically disables media keys when typing in search bars, comment boxes, or forms.

### 🛡️ Redirect & Pop-under Shield
* 🔒 **Immediate Main Tab Focus Locking**:
  * When a rogue ad tab is spawned, FocusGuard **immediately locks browser focus to your main video tab**. The popup tab opens silently in the background and is terminated without ever flashing in front of you or pulling you out of fullscreen.
* 🚫 **Rogue `window.open()` Interception**: Overrides `window.open` at `document_start` before ad scripts execute. In **Block & Close** mode, it safely returns a mock window object so video players never crash or detect blockers. Also hooks `HTMLIFrameElement.prototype.contentWindow` to stop ad scripts from bypassing filters via hidden iframes.
* 👻 **Invisible Overlay Killer**: Scans for and destroys transparent full-screen or player overlays (`<div>`, `<a>`) that attempt to capture your first click.
* 🎯 **Safe Tab Opening & Accurate Redirect Shield**:
  * Opens new tabs normally without forcefully closing them: You can freely open new tabs via Ctrl+T, '+' button, right-click "Open link in new tab", middle-click, or standard link clicks.
  * **Only Closes Redirects**: Accurately detects and terminates rogue ad redirects, popunders, and spam ad networks (Adsterra, PopAds, PropellerAds, ClickAdu, gambling/betting/adult redirects, and tracking parameters).
* 🔕 **100% Silent Background Operation**: Works silently in the background with zero intrusive on-screen blocked toast popups interrupting your view.
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
* **`inject.js`**: Page-level script hooking `window.open`, iframe creation, HLS buffer tuning, and synthetic click prototypes.
* **`content.js`**: Content script intercepting click capture events, user gestures, and managing overlays.
* **`content.css`**: Isolated styles for universal player scrollbar suppression.
* **`player_controller.js`**: Universal video controller delivering keyboard shortcuts, fullscreen retention, auto-skip intro/outro, instant auto-next episode, and all-time DUB selection enforcer.
* **`player_hud.css`**: Floating glassmorphic HUD notifications, GPU acceleration, and fullscreen scrollbar disabler styles.
* **`background.js`**: Service worker enforcing focus locking, single-use user intent tracking, and background ad tab termination.
* **`popup/`**: Cyber-glassmorphic settings dashboard with live stats, controls, and interactive shortcuts matrix.
* **`tests/`**: Automated unit verification suites for DUB selection, continuity, focus locking, buffer tuning, and scrollbar removal.
* **`icons/`**: High-resolution extension shield icons.

---

## 📄 License & Disclaimer

This extension is open-source and intended for user agency, privacy, and defensive protection against deceptive popups, malware redirects, and clickjacking ad networks when browsing the web. All product names and websites mentioned are trademarks of their respective owners.
