# 📥 Aniwatch & HiAnime Episode Downloader — FocusGuard

[![Aniwatch Episode Downloader](https://img.shields.io/badge/Aniwatch-Episode%20Downloader-ff4757?style=for-the-badge&logo=crunchyroll&logoColor=white)](https://github.com/manomoy321/aniwatch-redirect-block)
[![Quality](https://img.shields.io/badge/Quality-1080p%20|%20720p%20|%20480p-2ed573?style=for-the-badge)](https://github.com/manomoy321/aniwatch-redirect-block)
[![Version](https://img.shields.io/badge/Version-1.2.0-1e90ff?style=for-the-badge)](https://github.com/manomoy321/aniwatch-redirect-block)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-ffa502?style=for-the-badge&logo=googlechrome&logoColor=white)](https://github.com/manomoy321/aniwatch-redirect-block)
[![iOS Orion](https://img.shields.io/badge/iOS%20Orion-Supported-9b59b6?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/manomoy321/aniwatch-redirect-block)

> **Aniwatch & HiAnime Episode Downloader (FocusGuard)** is a dedicated browser extension built for [Aniwatch (aniwatch.co.at)](https://aniwatch.co.at/) and [HiAnime (hianime.to)](https://hianime.to/). Download full anime episodes in **1080p Full HD**, **720p HD**, or **480p SD** directly from the video player with an animated **on-player top download progress bar**, accurate anime title and episode numbering, real-time internet data calculations, and full support for both Desktop Chromium browsers and **iPhone Orion Browser (iOS)**.

---

## 📑 Table of Contents

- [🎯 Core Focus](#-core-focus)
- [📥 Key Downloader Features](#-key-downloader-features)
- [📊 Top-of-Player Download Progress Bar](#-top-of-player-download-progress-bar)
- [📱 iPhone Orion Browser & Mobile Optimization](#-iphone-orion-browser--mobile-optimization)
- [⚡ How to Download Episodes](#-how-to-download-episodes)
- [📦 Installation Guide (Desktop & iPhone Orion)](#-installation-guide-desktop--iphone-orion)
- [🧪 Automated Verification Suite](#-automated-verification-suite)
- [📄 License & Disclaimer](#-license--disclaimer)

---

## 🎯 Core Focus

FocusGuard is dedicated entirely to **fast, seamless, and reliable anime episode downloading**. All unnecessary features have been completely removed, leaving a lightweight, high-performance extension focused purely on capturing and downloading your anime streams.

---

## 📥 Key Downloader Features

* 🎬 **3 Resolution Tiers with Internet Data Estimates**:
  * **1080p Full HD** (`~832 MB` estimated internet data) — Highest quality, crisp detail.
  * **720p HD** (`~416 MB` estimated internet data) — Balanced high-definition download.
  * **480p SD** (`~191 MB` estimated internet data) — Data-saving mode optimized for mobile and low bandwidth.
* 🏷️ **Intelligent Filename Scraper**:
  * Scrapes the anime title and episode number directly from the page layout and active episode list.
  * Formats clean filenames: `Jujutsu Kaisen Season 2 - Episode 01 [1080p].mp4`, `One Piece - Episode 1089 [720p].mp4`, etc.
* ⚡ **Parallel HLS Segment Fetcher**:
  * Inspects `m3u8` playlists, fetches video segments in parallel with asynchronous concurrency, and packages them into clean, seekable `.mp4` video files.
* 🔄 **Exponential Backoff Segment Retry**:
  * 3-attempt exponential backoff retry on every chunk ensures zero corruption even on fluctuating networks.
* 🛡️ **DeclarativeNetRequest CDN Proxy**:
  * Rewrites referer and security headers on stream requests, eliminating `HTTP 403 Forbidden` errors from strict streaming CDNs.
* ⌨️ **One-Key Download Shortcut**:
  * Press <kbd>D</kbd> at any time to instantly trigger episode download.

---

## 📊 Top-of-Player Download Progress Bar

FocusGuard features a dedicated **top-of-player progress bar** pinned directly across the top of the video player:

* 📈 **Live Percentage Indication**: Prominent badge displaying the exact download percentage (`0%` to `100%`) in real time.
* 🌊 **Glowing Neon Progress Track**: Animated emerald/cyan gradient bar that fills smoothly as segments complete.
* 🔢 **Segment Counter**: Shows live chunk progress (e.g. `124/250 segments`).
* ✨ **Dynamic Completion State**: Transitions to a vibrant success state (`✓ Episode 01 [1080p] Download Complete!`) before smoothly auto-hiding.
* 🔄 **Cross-Frame Synchronization**: Progress messages sync seamlessly across iframes and the extension popup.

---

## 📱 iPhone Orion Browser & Mobile Optimization

FocusGuard is engineered from the ground up for mobile touchscreens and **Orion Browser on iOS (iPhone / iPad)**:

* 📥 **WebKit Download Fallback**: Orion on iOS does not support the Chromium `chrome.downloads` API. FocusGuard detects this automatically and delegates to an offscreen anchor download / `window.open` blob fallback.
* 📱 **`playsinline` Enforcement**: Guarantees `<video playsinline>` attributes to prevent iOS WebKit from hijacking the stream with the native AVPlayer.
* 👆 **Touch-To-Reveal Controls**: Since mobile touchscreens lack mouse hover (`:hover`), tapping or touching the player container reveals the download button.
* 📏 **Safe-Area Insets**: Uses CSS `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` to avoid being cut off by the iPhone notch, Dynamic Island, or home indicator bar.

---

## ⚡ How to Download Episodes

1. Open any anime episode on [Aniwatch (aniwatch.co.at)](https://aniwatch.co.at/) or [HiAnime (hianime.to)](https://hianime.to/).
2. Hover over (or tap on mobile) the video player — the **Download** button appears in the top-right corner.
3. Click/tap **Download** (or press <kbd>D</kbd> on desktop keyboard, or click the resolution in the extension popup).
4. Choose **1080p**, **720p**, or **480p**.
5. Watch the glowing progress bar at the top of the video player indicate real-time percentage until the download completes and saves directly to your device!

---

## 📦 Installation Guide (Desktop & iPhone Orion)

### Desktop (Chrome, Brave, Edge, Opera):
1. Download or clone this repository:
   ```bash
   git clone https://github.com/manomoy321/aniwatch-redirect-block.git
   ```
2. Open your browser's extension manager:
   * Chrome / Brave: `chrome://extensions`
   * Edge: `edge://extensions`
3. Enable **Developer Mode** (toggle in top-right corner).
4. Click **Load unpacked** and select the extension folder containing `manifest.json`.

### iPhone / iPad (Orion Browser):
1. Transfer or download the repository folder to your iOS device (Files app).
2. Open **Orion Browser** on iOS.
3. Tap **Settings** (•••) → **Extensions**.
4. Tap **+** or **Install an Extension from Disk** and select the folder containing `manifest.json`.

---

## 🧪 Automated Verification Suite

FocusGuard includes comprehensive automated tests:

```bash
# Run episode downloader & top-of-player progress bar tests (17/17 tests passing)
node tests/test_download_episode.js

# Run iPhone Orion Browser & iOS WebKit compatibility tests (6/6 tests passing)
node tests/test_iphone_orion_compatibility.js
```

You can also open `test_page.html` in any browser to interactively test the top progress bar and quality popovers.

---

## 📄 License & Disclaimer

MIT License. Developed for educational purposes and user agency. All anime brands and logos are property of their respective owners.
