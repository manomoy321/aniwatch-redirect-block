---
last_mapped_commit: 553fb73d7c5ab013cf4980bb984affe822621868
last_mapped_at: 2026-10-26
---
# Technology Stack

**Analysis Date:** 2026-10-26

## Languages

**Primary:**
- JavaScript (Vanilla ECMAScript 2020+) - All extension runtime logic, background worker, player controller, UI injection, and test suites.

**Secondary:**
- CSS3 (Custom Properties, Flexbox, Grid, Glassmorphism) - Extension popup UI (`popup/popup.css`), content overlay styles (`content.css`), and on-player HUD (`player_hud.css`).
- HTML5 - Extension action popup view (`popup/popup.html`).
- PowerShell - Windows packaging script (`scripts/package_extension.ps1`).

## Runtime

**Environment:**
- Chromium Manifest V3 (MV3) Extension Engine (Google Chrome, Microsoft Edge, Brave, Opera, Vivaldi).
- Node.js (v18.x - v22.x) - Development, test execution, and extension bundling.

**Package Manager:**
- npm (Node Package Manager)
- Configuration: `package.json`

## Frameworks & Architecture

**Core Architecture:**
- Pure Vanilla JavaScript without heavy runtime frameworks (zero external runtime dependencies in production bundle for maximum speed, security, and low memory overhead).
- Chrome Extension Manifest V3 Service Worker architecture (`background.js`).
- Dual-World Content Script Execution:
  - Main World (`world: MAIN`): `inject.js` (DOM/Window prototype interception, HTML5 Video events, `window.open` blocking).
  - Isolated World (`world: ISOLATED`): `content.js` and `player_controller.js` (DOM HUD injection, stream sniffing, background messaging).

**Testing:**
- Native Node.js `assert` module - Zero-dependency assertion engine.
- Headless mock browser DOM & Chrome Extension API harnesses.

**Build & Packaging:**
- `scripts/package_extension.js` - Cross-platform Node.js zip archive generator.
- `scripts/package_extension.ps1` - PowerShell archive packaging script for Windows.

## Key Dependencies & APIs

**Browser APIs:**
- Web Crypto API (`crypto.subtle`) - In-browser AES-128-CBC segment decryption.
- Typed Arrays (`Uint8Array`, `DataView`, `ArrayBuffer`) - Binary demuxing, MPEG-TS parsing, ISO BMFF box manipulation, and MP4 remuxing.
- URL API (`URL.createObjectURL`, `URL.revokeObjectURL`) - Local stream blob management.
- HTML5 Media Elements (`HTMLVideoElement`, `MediaSource`, `SourceBuffer`) - Player control and stall monitoring.

**Chrome Extension Manifest V3 APIs:**
- `chrome.declarativeNetRequest` - Dynamic rulesets for Referer/Origin header rewrites bypassing CDN HTTP 403 anti-hotlinking.
- `chrome.storage.local` - Persistent state management for download queues, user preferences, and statistics.
- `chrome.downloads` - Browser download manager integration with unique file naming and conflict resolution.
- `chrome.tabs` & `chrome.runtime` - Inter-context messaging between popup, service worker, and video frames.

## Configuration

**Extension Manifest:**
- `manifest.json` - Declares MV3 configuration, host permissions (`<all_urls>`), storage, downloads, and declarativeNetRequest permissions.

**Git & Deployment:**
- `.gitignore` - Excludes build outputs (`*.zip`, `dist/`), OS files, editor metadata, and temporary artifacts.
- `.gitattributes` - Enforces normalized line endings across Windows and Unix.

## Platform Requirements

**Development:**
- Node.js 18.0.0 or higher.
- Modern Chromium browser for extension loading in developer mode.

**Production:**
- Any Chromium-compatible browser supporting Manifest V3.

---

*Stack analysis: 2026-10-26*
*Update after major dependency changes*
