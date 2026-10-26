---
last_mapped_commit: 553fb73d7c5ab013cf4980bb984affe822621868
last_mapped_at: 2026-10-26
---
# Testing Strategy & Test Suites

**Analysis Date:** 2026-10-26

## Framework & Execution

**Testing Engine:**
- Native Node.js `assert` module.
- Zero external test runner dependencies (no Jest, Mocha, or Vitest needed).
- Execution Command: `npm test` runs all test suites sequentially.
- Individual Suite Commands:
  - `npm run test:download` (`tests/test_download_episode.js`)
  - `npm run test:universal` (`tests/test_universal_download.js`)
  - `npm run test:m4s` (`tests/test_m4s_and_quality_control.js`)
  - `npm run test:smooth` (`tests/test_smooth_vlc_playback_and_metadata.js`)
  - `npm run test:crash-prevention` (`tests/test_player_playback_crash_prevention.js`)
  - `npm run test:queue` (`tests/test_background_download_queue_and_api.js`)
  - `npm run test:audio-seek` (`tests/test_audio_and_seek_smoothness.js`)

## Test Suites & Coverage

| Test File | Focus Area | Assertions & Scenarios |
|---|---|---|
| `test_download_episode.js` | Core In-Page Downloader | 19 tests: Title scraping, quality tiers (1080p, 720p, 480p), UI buttons, deduplication, CDN 403 bypass, cross-frame blob delegation. |
| `test_universal_download.js` | Direct & Stream Extraction | Sniffer heuristics, video URL resolution, and direct stream downloads. |
| `test_m4s_and_quality_control.js` | fMP4 Segment Handling | `.m4s` init segment parsing, multi-quality playlist resolution. |
| `test_complete_video_smooth_playback.js` | End-to-End Remuxing | Whole-episode segment combination and metadata integration. |
| `test_dub_all_time.js` | Audio Track Selection | Auto-selection of English DUB servers and audio switching. |
| `test_dub_continuity.js` | Cross-Episode State | Preserving DUB preferences across automatic episode transitions. |
| `test_background_download_queue_and_api.js` | Queue & API Resilience | 16 tests: FIFO concurrency, service worker recovery, 429 backoff, network drops, pause/resume, deduplication. |
| `test_smooth_vlc_playback_and_metadata.js` | Container & VLC Compatibility | 8 tests: MPEG-TS timestamp rebase, continuity counters, H.264 SPS parsing, iTunes `ilst` metadata. |
| `test_player_playback_crash_prevention.js` | Playback Crash Protection | 6 tests: Off-thread base64 decoding, memory allocation limits, stall watchdog, adaptive concurrency. |
| `test_audio_and_seek_smoothness.js` | Multi-Track & Seek Smoothness | 7 tests: Audio track extraction, HLS media playlist parser, `trun` offset patching, monotonic PTS, fMP4 track remapping. |

## Mocking & Environment Emulation

**Headless Browser Emulation:**
- `MockElement` and `MockClassList` emulate browser DOM trees and query selectors (`querySelector`, `querySelectorAll`, `addEventListener`, `click`).
- `MockVideoElement` simulates HTML5 video events (`waiting`, `stalled`, `play`, `pause`, `timeupdate`, `currentTime` setters).

**Chrome API Emulation:**
- `chrome.storage.local`: In-memory key-value store with async `get` and `set`.
- `chrome.downloads`: Emulates download state machine (`download`, `cancel`, `pause`, `resume`, `onChanged`).
- `chrome.declarativeNetRequest`: Emulates rule registration (`updateDynamicRules`, `getDynamicRules`).
- `chrome.tabs`: Emulates tab querying and message passing.

---

*Testing analysis: 2026-10-26*
*Update after test suite additions or harness updates*
