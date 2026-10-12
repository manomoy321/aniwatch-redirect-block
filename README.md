# 📥 Aniwatch Episode Downloader & Redirect Blocker — FocusGuard

[![Aniwatch Episode Downloader](https://img.shields.io/badge/Aniwatch-Episode%20Downloader-ff4757?style=for-the-badge&logo=crunchyroll&logoColor=white)](https://github.com/manomoy321/aniwatch-redirect-block)
[![Quality](https://img.shields.io/badge/Quality-1080p%20|%20720p%20|%20480p-2ed573?style=for-the-badge)](https://github.com/manomoy321/aniwatch-redirect-block)
[![Version](https://img.shields.io/badge/Version-1.1.0-1e90ff?style=for-the-badge)](https://github.com/manomoy321/aniwatch-redirect-block)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-ffa502?style=for-the-badge&logo=googlechrome&logoColor=white)](https://github.com/manomoy321/aniwatch-redirect-block)
[![Auto DUB](https://img.shields.io/badge/Auto%20DUB-Enabled-9b59b6?style=for-the-badge)](https://github.com/manomoy321/aniwatch-redirect-block)

> **Aniwatch Episode Downloader & Redirect Blocker (FocusGuard)** is the ultimate Chrome and Chromium browser extension designed for [Aniwatch (aniwatch.co.at)](https://aniwatch.co.at/) and [HiAnime (hianime.to)](https://hianime.to/). Download full anime episodes in **1080p Full HD**, **720p HD**, or **480p SD** directly from the video player with accurate anime title & episode numbering, real-time internet data calculation, automatic English DUB stream selection, and zero intrusive ad redirects or popups.

---

## 📑 Table of Contents

- [🎯 Why FocusGuard?](#-why-focusguard)
- [📥 Aniwatch Episode Downloader](#-aniwatch-episode-downloader)
- [⚡ Quick Start: How to Download Aniwatch Episodes](#-quick-start-how-to-download-aniwatch-episodes)
- [🌐 English DUB & Server Continuity Engine](#-english-dub--server-continuity-engine)
- [🛡️ Redirect & Pop-under Shield](#-redirect--pop-under-shield)
- [🎬 Video Player Suite & Keyboard Controls](#-video-player-suite--keyboard-controls)
- [📦 Installation Guide (Chrome, Brave, Edge, Opera)](#-installation-guide-chrome-brave-edge-opera)
- [⚙️ Multi-Layer Technical Architecture](#-multi-layer-technical-architecture)
- [🧪 Local Testing & Verification Laboratory](#-local-testing--verification-laboratory)
- [🔍 Search & Indexing Keywords](#-search--indexing-keywords)
- [📄 License & Disclaimer](#-license--disclaimer)

---

## 🎯 Why FocusGuard?

When streaming anime on Aniwatch or HiAnime, viewers face two major frustrations:
1. **No direct way to download episodes**: Built-in players use encrypted or fragmented HLS streams (`blob:https://megaplay.buzz/...`) and video blobs that standard download managers cannot capture.
2. **Aggressive click redirects & pop-unders**: Clicking play, changing servers, or selecting episodes triggers spam ad redirects, gambling links, and steals focus away from your browser tab.

**FocusGuard solves both permanently.** It equips your browser with a **high-speed HLS video stream downloader** directly inside the video player HUD and completely neutralizes ad redirect hijacking before it can trigger.

---

## 📥 Aniwatch Episode Downloader

FocusGuard embeds a native **Aniwatch Episode Downloader** directly into the Aniwatch and HiAnime web players:

### 🌟 Key Downloader Capabilities:
* 🎬 **3 Quality Tiers with Live Data Calculation**:
  * **1080p Full HD** (`~832 MB` estimated internet data) — Crystal clear high-definition stream.
  * **720p HD** (`~416 MB` estimated internet data) — Balanced fast high-definition download.
  * **480p SD** (`~191 MB` estimated internet data) — Data-saving mode optimized for limited bandwidth or mobile storage.
* 🏷️ **Intelligent Filename Scraper**:
  * Automatically parses the anime title and episode number directly from the page layout and active episode list.
  * Produces clean, organized filenames ready for your media library (e.g. `Jujutsu Kaisen - Episode 01 [1080p].mp4`, `Boruto Naruto Next Generations - Episode 133 [720p].mp4`, `One Piece - Episode 1089 [1080p].mp4`).
* ⚡ **High-Speed HLS Stream Reconstruction**:
  * Inspects `m3u8` playlists, fetches video segments in parallel with asynchronous concurrency, and packages them into a clean, seekable `.mp4` file.
  * Resolves obfuscated `blob:https://megaplay.buzz/...` MediaSource buffers seamlessly.
* 🔄 **Resilient Segment Recovery (Exponential Backoff)**:
  * Downloads each video segment with 3-attempt exponential backoff retry. Even on unstable network connections, downloads recover automatically without failing or corrupting.
* 📊 **Steady, Non-Blinking HUD Progress Bar**:
  * In-place DOM updates display real-time download percentage (`0%` to `100%`) and downloaded megabytes without flickering or interrupting video playback.
* 🛡️ **DeclarativeNetRequest CDN Proxy**:
  * Rewrites referer and security headers on video segment requests behind the scenes, preventing `HTTP 403 Forbidden` errors from strict streaming CDNs.
* ⌨️ **One-Key Download Shortcut**:
  * Press <kbd>D</kbd> at any time to instantly trigger episode download, or click the download icon on the video player HUD.

---

## ⚡ Quick Start: How to Download Aniwatch Episodes

1. Open any anime episode on [Aniwatch (aniwatch.co.at)](https://aniwatch.co.at/) or [HiAnime (hianime.to)](https://hianime.to/).
2. Hover over the video player — the sleek cyber HUD appears with the **Download Episode** button (`EP ##`).
3. Click the download button (or press <kbd>D</kbd> on your keyboard).
4. Select your desired resolution (**1080p**, **720p**, or **480p**) from the quick popover.
5. The steady HUD progress bar will track segment downloads. Once complete, your browser's download manager will save the cleanly tagged `.mp4` video file directly to your Downloads folder!

---

## 🌐 English DUB & Server Continuity Engine

* 🎙️ **All-Time DUB Priority**:
  * Automatically selects English DUB on Aniwatch and HiAnime upon page load.
* 🎛️ **Duplicate Button Disambiguation (`vidsrc`)**:
  * Streaming sites frequently feature duplicate server buttons under both SUB and DUB (such as `vidsrc`). FocusGuard uses a DOM TreeWalker to cleanly isolate the DUB category first, disambiguates duplicates, and always activates the English DUB server.
* 💾 **Persistent Server Memory**:
  * Remembers your preferred server across episodes. Advancing to the next episode automatically keeps your chosen server without reverting to defaults.
* 🎧 **Auto Audio & Subtitle Activation**:
  * Automatically sets HTML5 `video.textTracks` and `video.audioTracks` to English (`EN` / `ENG`) when available.
* 🛡️ **Error 232403 Auto-Recovery**:
  * If a streaming server throws playback error 232403, FocusGuard detects it within 1 second and automatically falls back to an alternate healthy server without user intervention.

---

## 🛡️ Redirect & Pop-under Shield

* 🔒 **Immediate Tab Focus Locking**:
  * When a rogue ad tab is spawned, FocusGuard locks browser focus to your main video tab. The popup tab opens silently in the background and is terminated immediately without pulling you out of fullscreen.
* 🚫 **Rogue `window.open()` Interception**:
  * Overrides `window.open` at `document_start` in the MAIN world before ad scripts execute. In **Block & Close** mode, it returns a safe mock Window object so video players never crash or detect ad blockers.
* 👻 **Invisible Overlay Killer**:
  * Scans for and destroys transparent full-screen or player overlays (`<div>`, `<a>`) that attempt to capture your first click.
* 🎯 **Accurate Filtering (Safe Normal Browsing)**:
  * Allows normal user-initiated tabs (<kbd>Ctrl</kbd>+<kbd>T</kbd>, middle-click, right-click "Open in new tab", or legitimate links) while blocking spam ad networks (Adsterra, PopAds, PropellerAds, ClickAdu, gambling/betting/adult redirects).
* 🔕 **100% Silent Background Operation**:
  * Works silently in the background with zero intrusive on-screen blocked toast popups interrupting your view.

---

## 🎬 Video Player Suite & Keyboard Controls

FocusGuard enhances the media player with modern streaming features:

* ⛶ **Fullscreen Retention**:
  * Maintains fullscreen across auto-skip intro, auto-skip outro, and next episode transitions.
  * Completely removes distracting scrollbars (`overflow: hidden`) in fullscreen.
* ⚡ **Auto Skip Intro & Outro**:
  * Auto-clicks Skip Intro / Skip OP buttons within 350ms of appearance.
  * Auto-clicks Skip Outro / Skip ED buttons when ending credits roll.
* ⏭️ **Instant Auto Play Next Episode (0s Delay)**:
  * Immediately advances to the next episode when the current one ends, with zero buffering delay.
* ⌨️ **Universal Keyboard Shortcuts Matrix**:

| Key Shortcut | Action | Description |
| :--- | :--- | :--- |
| <kbd>D</kbd> | **Download Episode** | **Triggers Aniwatch Episode Downloader (1080p / 720p / 480p)** |
| <kbd>Space</kbd> / <kbd>K</kbd> | Play / Pause | Toggle video playback |
| <kbd>←</kbd> / <kbd>→</kbd> or <kbd>J</kbd> / <kbd>L</kbd> | Seek ±5s | Quick seek (Hold <kbd>Shift</kbd> for ±15s) |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Volume ±5% | Smooth volume adjustment |
| <kbd>M</kbd> | Mute / Unmute | Audio mute toggle |
| <kbd>F</kbd> | Fullscreen | Toggle fullscreen mode |
| <kbd>S</kbd> / <kbd>I</kbd> | Skip Intro | Auto-clicks skip button or jumps +85s |
| <kbd>O</kbd> | Skip Outro | Auto-clicks outro button or jumps +85s |
| <kbd>[</kbd> / <kbd>]</kbd> | Speed ±0.25x | Playback speed control (0.25x – 3.0x) |
| <kbd>N</kbd> / <kbd>P</kbd> | Next Episode | Advance to the next episode |
| <kbd>0</kbd> – <kbd>9</kbd> | Jump % | Jump to 0% – 90% of episode timeline |

---

## 📦 Installation Guide (Chrome, Brave, Edge, Opera)

This extension is built on **Manifest V3** and runs on any modern Chromium-based browser:

### Step-by-Step Instructions:

1. **Clone or Download this Repository**:
   ```bash
   git clone https://github.com/manomoy321/aniwatch-redirect-block.git
   ```
   *(Or click **Code** → **Download ZIP** on GitHub and unzip the archive to a folder).*

2. **Open your Browser's Extension Manager**:
   * **Google Chrome**: Go to `chrome://extensions`
   * **Brave Browser**: Go to `brave://extensions`
   * **Microsoft Edge**: Go to `edge://extensions`
   * **Opera**: Go to `opera://extensions`

3. **Enable Developer Mode**:
   * Turn the **Developer mode** toggle in the top-right corner **ON**.

4. **Load the Extension**:
   * Click **Load unpacked**.
   * Select the repository folder containing `manifest.json`.

5. **Pin & Browse**:
   * Pin **Aniwatch Episode Downloader & Redirect Blocker (FocusGuard)** to your toolbar.
   * Visit [https://aniwatch.co.at/](https://aniwatch.co.at/) or [https://hianime.to/](https://hianime.to/) and enjoy clean, instant episode downloads and redirect-free anime streaming!

---

## ⚙️ Multi-Layer Technical Architecture

```
                       [ USER ON ANIWATCH / HIANIME ]
                                     │
      ┌──────────────────────────────┼──────────────────────────────┐
      ▼                              ▼                              ▼
[ Layer 1: Downloader Engine ] [ Layer 2: Main World Hook ] [ Layer 3: Background Worker ]
• Scrapes Title & Episode #    • Overrides window.open()    • Tab focus locking engine
• Analyzes m3u8 playlists      • Intercepts synthetic clicks • Terminates rogue ad tabs
• Parallel chunk fetcher       • Injects HLS buffer cache   • declarativeNetRequest proxy
• 3-attempt backoff retry      • Resolves blob: streams     • Saves video file via downloads
• Steady non-blinking HUD bar  • TreeWalker DUB isolation   • Tracks blocked analytics
```

---

## 🧪 Local Testing & Verification Laboratory

FocusGuard includes comprehensive automated unit tests and an interactive local sandbox:

* **Automated Unit Tests**:
  ```bash
  node tests/test_download_episode.js  # 16/16 tests passing (Downloader, Quality, HLS, Blob, DUB)
  node tests/test_dub_continuity.js    # 5/5 tests passing (Focus lock, Server continuity, Buffer)
  node tests/test_dub_all_time.js      # 4/4 tests passing (HiAnime DOM TreeWalker, DUB lock)
  ```
* **Interactive Simulator**:
  * Open `test_page.html` in your browser to test download popovers, overlay destruction, rogue `window.open` traps, and keyboard shortcuts in real time.

---

## 🔍 Search & Indexing Keywords

To ensure this tool is easily discovered on Google, Bing, DuckDuckGo, and GitHub search, relevant indexing keywords include:

* `aniwatch episode downloader`
* `aniwatch video downloader`
* `aniwatch downloader chrome extension`
* `download aniwatch episodes 1080p`
* `aniwatch episode download 720p 480p`
* `how to download from aniwatch`
* `aniwatch mp4 downloader`
* `hianime episode downloader`
* `hianime video download`
* `aniwatch redirect blocker`
* `aniwatch ad blocker popup remover`
* `aniwatch english dub auto stream`
* `aniwatch auto skip intro outro`
* `focusguard aniwatch extension`

---

## 📄 License & Disclaimer

This extension is open-source under the MIT License. Developed for user agency, privacy, defensive ad protection, and educational purposes. All product names, logos, and brands mentioned (Aniwatch, HiAnime) are property of their respective owners.
