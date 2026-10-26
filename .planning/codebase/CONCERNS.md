---
last_mapped_commit: 553fb73d7c5ab013cf4980bb984affe822621868
last_mapped_at: 2026-10-26
---
# Codebase Concerns & Technical Debt

**Analysis Date:** 2026-10-26

## Architectural & Platform Concerns

**1. Service Worker Inactivity & Storage Synchronization:**
- Chrome MV3 terminates background service workers after ~30 seconds of inactivity.
- While the background download queue persists state via `chrome.storage.local`, in-flight JavaScript downloads executing inside an active video player tab depend on that tab remaining open until all segments are combined and saved to disk.
- *Mitigation:* The popup UI and HUD provide clear download progress notifications, and background downloads utilize browser-native `chrome.downloads` when direct or remuxed streams are ready.

**2. Anti-Hotlinking CDN Headers & Cross-Origin Restrictions:**
- Streaming hosts frequently rotate token parameters, cookie validations, and referer checks.
- Direct `fetch()` requests from content scripts can fail with HTTP 403 Forbidden without dynamic DNR header rewrite rules.
- *Mitigation:* `setStreamBypassHeaders` dynamically injects embed-matching `Referer` headers via `chrome.declarativeNetRequest`.

**3. Complex Media Remuxing in Pure JavaScript:**
- Parsing transport streams and fragmented MP4 files entirely in JavaScript requires careful memory management to prevent memory bloat on low-RAM devices or mobile browsers.
- *Mitigation:* Uint8Array chunk processing is used instead of number arrays; base64 decoding operates with bounded chunk sizes (8KB); and adaptive concurrency limits active network sockets during video playback.

**4. External Player Seeking & Timecode Gaps:**
- Certain media players (older VLC versions, MPC-HC, or QuickTime) can produce audio/video desynchronization or scrub errors if `trun` box byte offsets or PTS/DTS timestamps are discontinuous.
- *Mitigation:* `patchMoofTrunDataOffsets` recalculates byte offsets directly into the assembled `moofBox`, and `optimizeFmp4ForSmoothPlayback` enforces monotonic per-track decode times.

---

*Concerns analysis: 2026-10-26*
*Update as new technical debt or edge cases are uncovered*
