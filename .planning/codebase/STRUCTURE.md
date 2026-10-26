---
last_mapped_commit: 553fb73d7c5ab013cf4980bb984affe822621868
last_mapped_at: 2026-10-26
---
# Directory Structure & File Layout

**Analysis Date:** 2026-10-26

## Repository Layout

```
aniwatch-redirect-block/
├── .github/                                # GitHub community & CI templates
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml                 # Structured YAML bug report form
│   │   └── feature_request.yml            # Structured YAML feature proposal form
│   └── PULL_REQUEST_TEMPLATE.md           # PR checklist and guidelines
├── icons/                                  # Extension icons in standard resolutions
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── popup/                                  # Extension Action Popup Interface
│   ├── popup.html                         # Popup UI markup (Cyber-dark dashboard)
│   ├── popup.css                          # Modern glassmorphic styles
│   └── popup.js                           # Dashboard logic, toggles & queue UI
├── scripts/                                # Maintenance & build automation
│   ├── package_extension.js               # Cross-platform Node.js zip builder
│   └── package_extension.ps1              # Windows PowerShell zip builder
├── tests/                                  # Automated verification suites
│   ├── test_download_episode.js           # Core downloader & deduplication tests (19 tests)
│   ├── test_universal_download.js         # Direct & universal downloader tests
│   ├── test_m4s_and_quality_control.js    # fMP4 detection & quality switching tests
│   ├── test_complete_video_smooth_playback.js # End-to-end remuxer tests
│   ├── test_dub_all_time.js               # Audio language selector tests
│   ├── test_dub_continuity.js            # Cross-episode audio continuity tests
│   ├── test_background_download_queue_and_api.js # Queue resilience & retry tests (16 tests)
│   ├── test_smooth_vlc_playback_and_metadata.js # ISO BMFF & VLC tests (8 tests)
│   ├── test_player_playback_crash_prevention.js # Adaptive concurrency & stall tests (6 tests)
│   └── test_audio_and_seek_smoothness.js  # Audio retention, trun patch & seek tests (7 tests)
├── .gitattributes                          # Git line-ending normalization
├── .gitignore                              # Git exclusion rules
├── background.js                           # MV3 Service worker (DNR, downloads, queue)
├── content.js                              # Isolated-world content script entry point
├── content.css                             # Content script overlay styles
├── CONTRIBUTING.md                         # Contribution guide
├── inject.js                               # Main-world script (prototype traps & blocker)
├── LICENSE                                 # MIT License
├── manifest.json                           # Chrome Extension Manifest V3 configuration
├── package.json                            # Scripts, metadata, and dev tooling
├── player_controller.js                    # In-page player controller & binary transmuxer
├── player_hud.css                          # On-player download button and HUD styles
└── SECURITY.md                             # Security reporting policy
```

## Component Responsibilities

| File | Context | Primary Responsibility |
|---|---|---|
| `manifest.json` | Extension Root | Defines permissions, content scripts, background worker, and popup. |
| `background.js` | Service Worker | Handles background queue, DNR header bypass, browser downloads, and persistence. |
| `inject.js` | Main World (`MAIN`) | Intercepts `window.open`, redirects, and HTML5 video buffer operations. |
| `content.js` | Isolated World (`ISOLATED`) | Listens for DOM events, mounts controllers, and passes messages to background. |
| `player_controller.js` | Isolated / Main | Extracts playlists, downloads/decrypts segments, remuxes fMP4/TS, monitors stalls. |
| `popup/popup.js` | Action Popup | Manages user toggles, displays real-time queue status, and provides control buttons. |
| `scripts/package_extension.js` | Build Tooling | Validates manifest and bundles production ZIP archive. |

---

*Structure analysis: 2026-10-26*
*Update after directory reorganizations or file additions*
