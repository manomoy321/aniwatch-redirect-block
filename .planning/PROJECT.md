# Aniwatch Episode Downloader & Redirect Blocker - FocusGuard

## What This Is

FocusGuard is a high-performance Chromium Manifest V3 browser extension built specifically for anime streaming sites (Aniwatch, HiAnime, Kaido, and MegaCloud/StreamWish video embeds). It provides on-player video downloading in 1080p, 720p, and 480p, aggressively blocks aggressive ad redirects and popups, auto-selects English DUB audio with cross-episode continuity, skips intros, and remuxes fragmented streams into pure ISO BMFF MP4 containers with companion metadata for smooth playback in external media players like VLC.

## Core Value

Effortless, high-speed, stutter-free anime downloads with automatic DUB audio retention, zero popup interruptions, and resilient background queue management.

## Business Context

- **Customer**: Anime viewers streaming on HiAnime and Aniwatch who want high quality offline episodes without malicious redirects or ads.
- **Distribution**: Packaged Chrome/Chromium extension (ZIP/CRX) and open-source GitHub repository.
- **Success Metric**: 100% download completion rate, zero audio track desynchronization or seek crashes in VLC/MPC-HC, and 0 unwanted ad redirect tabs.

## Requirements

### Validated

- [x] **ADBLOCK-01**: Aggressive redirect blocker intercepting `window.open`, malicious event dispatchers, and ad URLs.
- [x] **DUB-01**: Automatic English DUB server detection, single-click activation, and cross-episode audio continuity.
- [x] **SKIP-01**: Automatic intro and recap skipping with configurable intervals.
- [x] **DOWNLOAD-01**: Multi-resolution stream sniffer and downloader (1080p, 720p, 480p) with on-player HUD progress bar.
- [x] **QUEUE-01**: Authoritative background download queue in service worker with FIFO concurrency, pause/resume, and retry backoff.
- [x] **PLAYBACK-01**: Pure-JS MPEG-TS and fMP4 remuxing engine with timestamp normalization and iTunes `ilst` metadata tagging.
- [x] **RECOVERY-01**: Player crash prevention with adaptive concurrency throttling during active video playback and stall watchdog.
- [x] **AUDIO-01**: Separate HLS audio track extraction (`#EXT-X-MEDIA:TYPE=AUDIO`), multi-track fMP4 interleaving, and accurate ISO BMFF `trun.data_offset` patching for smooth seeking.

### Active

- [ ] **INTEG-01**: Subtitle extraction and companion `.srt` / `.vtt` download generation for multi-language softsubs.
- [ ] **INTEG-02**: Batch/binge whole-season download orchestrator with automated episode list traversal.
- [ ] **UI-01**: Popup download manager search and filter by anime title or download status.

### Out of Scope

- **External Backend Transcoding Server** — FocusGuard operates 100% client-side in the user's browser without requiring remote servers or user registration.
- **Non-Chromium WebExtensions Manifest V2** — Built strictly for standard Manifest V3 Chromium runtimes.

## Context

- Target streaming hosts employ dynamic tokenization, anti-hotlinking referer verification (HTTP 403), and partitioned audio/video fMP4 streams.
- Chrome MV3 declarativeNetRequest dynamic rules are used to rewrite `Referer` and `Origin` headers on stream endpoints to match the embed frame.
- Off-thread / chunked binary parsing prevents freezing the browser main event loop or crashing player buffers during heavy segment downloads.

## Constraints

- Zero external node module runtime dependencies in production bundle.
- Must execute safely within isolated and main worlds without breaking player DRM or site scripts.
- Memory usage must remain bounded via Uint8Array chunks.
