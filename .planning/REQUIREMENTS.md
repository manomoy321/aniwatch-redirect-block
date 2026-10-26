# Requirements: Aniwatch Episode Downloader & Redirect Blocker - FocusGuard

**Defined:** 2026-10-26
**Core Value:** Effortless, high-speed, stutter-free anime downloads with automatic DUB audio retention, zero popup interruptions, and resilient background queue management.

## v1 Requirements (Delivered & Verified)

### Core Protection & Automation
- [x] **PROT-01**: Block popup redirects and unwanted new tabs from streaming players.
- [x] **PROT-02**: Enforce tab focus lock to prevent malicious background redirects.
- [x] **AUTO-01**: Auto-select English DUB server on episode load when available.
- [x] **AUTO-02**: Preserve DUB preference across automatic episode transitions.
- [x] **AUTO-03**: Skip anime intros and opening themes based on configured time offsets.

### Download & Stream Sniffing
- [x] **DL-01**: Sniff video streams from nested player iframes (MegaCloud, StreamWish, Vidstreaming).
- [x] **DL-02**: Support 1080p, 720p, and 480p resolution selection with internet consumption estimates.
- [x] **DL-03**: Display in-place on-player HUD download button and live progress bar without visual blinking.
- [x] **DL-04**: Extract clean anime title, episode number, and quality tags for downloaded filenames.
- [x] **DL-05**: Deduplicate rapid download requests via cooldown window.

### Background Queue & Network Resilience
- [x] **QUEUE-01**: Service-worker-backed multi-video download queue.
- [x] **QUEUE-02**: FIFO concurrency limiter (max 2 concurrent downloads).
- [x] **QUEUE-03**: Dynamic DNR header bypass (`Referer` & `Origin`) defeating CDN HTTP 403 anti-hotlinking.
- [x] **QUEUE-04**: Exponential backoff with jitter on HTTP 429 and 5xx transient network errors.
- [x] **QUEUE-05**: User pause, resume, cancel, and retry controls from popup UI.

### Video Transmuxing, Audio Retention & Playback Smoothness
- [x] **REMUX-01**: Normalize discontinuous MPEG-TS PTS/DTS timestamps starting monotonically from 0.
- [x] **REMUX-02**: Extract separate HLS audio tracks (`#EXT-X-MEDIA:TYPE=AUDIO`) and prioritize English DUB.
- [x] **REMUX-03**: Interleave and combine separate video and audio fMP4 streams into a unified container with track ID remapping.
- [x] **REMUX-04**: Calculate and patch exact `trun.data_offset` values inside `moof` boxes without corrupting sample durations.
- [x] **REMUX-05**: Inject embedded iTunes/MP4 `udta/ilst` metadata (title, series, episode).
- [x] **REMUX-06**: Generate companion `.info.json` metadata files alongside video files.
- [x] **STALL-01**: Adaptive concurrency throttling and micro-nudge playback watchdog preventing player crashes during downloads.

## v2 Requirements (Roadmap & Enhancements)

### Subtitles & Multi-Track Audio
- [ ] **SUBS-01**: Extract WebVTT and SRT subtitle renditions from HLS multivariant playlists.
- [ ] **SUBS-02**: Export downloadable companion `.srt` files matching the video filename.
- [ ] **SUBS-03**: Embed softsub subtitle tracks (`tx3g` / `mov_text`) directly into the ISO BMFF MP4 container.

### Batch & Binge Downloads
- [ ] **BATCH-01**: Episode list scraper to queue entire anime seasons or range of episodes (e.g., Ep 1–12).
- [ ] **BATCH-02**: Batch pause, resume, and clear operations in popup UI.

### Advanced Player & UI Controls
- [ ] **UI-01**: Queue search bar to filter downloads by anime title or quality.
- [ ] **UI-02**: Export download history and queue state as JSON.
- [ ] **AUDIO-02**: Manual audio track dropdown selector on player HUD when multiple audio languages are present.

## Out of Scope

| Feature | Reason |
|---|---|
| Server-side video transcoding | FocusGuard runs 100% client-side inside Chromium without requiring external servers. |
| DRM-cracking / Widevine bypass | Target sites use standard HLS AES-128 or unencrypted streams; Widevine/DRM bypassing is out of scope. |
| Firefox Manifest V2 legacy builds | Target platform is strictly modern Manifest V3 Chromium extensions. |
