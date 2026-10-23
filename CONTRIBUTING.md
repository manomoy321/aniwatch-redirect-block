# Contributing to FocusGuard

Thank you for your interest in improving **FocusGuard — Aniwatch & HiAnime Episode Downloader**! We welcome bug reports, feature suggestions, documentation enhancements, and pull requests.

---

## 🛠️ Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/manomoy321/aniwatch-redirect-block.git
   cd aniwatch-redirect-block
   ```

2. **Load the Unpacked Extension in Your Browser**:
   - **Chrome / Brave / Edge**:
     1. Navigate to `chrome://extensions` or `edge://extensions`.
     2. Enable **Developer mode** (toggle in the top-right).
     3. Click **Load unpacked** and select the repository root folder.
   - **iPhone / iPad (Orion Browser)**:
     1. Transfer the repository folder to your device (via AirDrop or iCloud Files).
     2. Open **Orion Browser** Settings (`•••`) -> **Extensions**.
     3. Tap **Install an Extension from Disk** and choose the folder containing `manifest.json`.

---

## 🧪 Running the Verification Suite

Run the full automated test suite with Node.js:

```bash
# Run all tests
npm test

# Run individual test suites
npm run test:download    # Episode downloader & top progress bar tests (17/17)
npm run test:orion       # iOS Orion WebKit compatibility tests (6/6)
```

You can also open [`test_page.html`](test_page.html) directly in any browser to interactively test the HUD, download quality popover, and top progress bar.

---

## 📦 Building Distributables

To package a clean, production-ready `.zip` archive for distribution:

```bash
# Using npm / Node.js
npm run package

# Or using PowerShell on Windows
npm run build:zip
```

The resulting zip will be placed in the `dist/` directory (e.g. `dist/focusguard-aniwatch-downloader-v1.2.0.zip`).

---

## 🏗️ Architecture Overview

The extension operates across three coordinated execution layers:

```
┌────────────────────────────────────────────────────────┐
│  Page DOM (MAIN World) - inject.js                     │
│  - Hooks window.fetch, XMLHttpRequest, and jwplayer    │
│  - Intercepts .m3u8 playlist URLs & streaming tokens   │
└──────────────────────────┬─────────────────────────────┘
                           │ CustomEvent ('__focusguard_stream_detected__')
┌──────────────────────────▼─────────────────────────────┐
│  Content Script (ISOLATED World) - player_controller.js│
│  - Detects anime title and episode numbers             │
│  - Renders top-of-player glowing progress bar & HUD    │
│  - Chunks HLS segments with exponential backoff retry  │
│  - Assembles MP4/TS blobs with fallback for Orion iOS  │
└──────────────────────────┬─────────────────────────────┘
                           │ chrome.runtime.sendMessage
┌──────────────────────────▼─────────────────────────────┐
│  Background Service Worker - background.js             │
│  - DeclarativeNetRequest CDN referer proxying (403 fix)│
│  - chrome.downloads dispatch with customized filenames │
└────────────────────────────────────────────────────────┘
```

---

## 🚀 Pull Request Guidelines

1. Create a feature branch: `git checkout -b feature/my-new-feature`.
2. Follow clean JavaScript standards (ES6+, clear naming, informative comments).
3. Ensure all automated tests pass (`npm test`).
4. Commit with descriptive messages.
5. Push to your fork and submit a Pull Request using the provided template.
