# Roadmap: Aniwatch Episode Downloader & Redirect Blocker - FocusGuard

## Overview

FocusGuard began as an ad and redirect blocker for Aniwatch/HiAnime and has evolved into a full-featured video downloading and remuxing suite with background queue management, automated audio language selection, and VLC-grade ISO BMFF MP4 streaming. The roadmap outlines completed milestones (Milestone 1) and future expansion phases (Milestone 2).

## Milestones

- **Milestone 1: Core Downloader, Anti-Redirect & Smooth Playback** (Completed v1.1.0)
- **Milestone 2: Subtitle Extraction & Batch Season Downloads** (Completed v1.2.0)
- **Milestone 3: Continuous Download Resilience & High-Load Hardening** (Completed v1.3.0)

## Phases

### Milestone 1: Delivered & Verified (v1.1.0)

- [x] **Phase 1: Foundation & Protection** - Manifest V3 setup, redirect blocker (`inject.js`), and tab focus lock.
- [x] **Phase 2: Universal Video Downloader & HUD** - Stream sniffing, on-player HUD, and quality tier selector (1080p, 720p, 480p).
- [x] **Phase 3: Background Multi-Video Download Queue & API Hardening** - Service worker FIFO queue, DNR referer bypass, exponential backoff, and popup UI.
- [x] **Phase 4: Smooth VLC Playback, Timestamp Normalizer & Companion Metadata** - MPEG-TS to fMP4 transmuxer, PTS rebase, iTunes `ilst` metadata box, and `.info.json` companion generator.
- [x] **Phase 5: Player Playback Crash Prevention & Adaptive Concurrency** - Adaptive worker throttling during playback, socket yielding, off-thread base64 decoding, and stall recovery watchdog.
- [x] **Phase 6: Audio Retention, Multi-Track fMP4 Remuxing & Seek Smoothness** - Separate `#EXT-X-MEDIA:TYPE=AUDIO` parsing, DUB prioritization, fMP4 audio+video combining, and exact `trun.data_offset` calculation for glitch-free scrubbing.

### Milestone 2: Subtitles & Batch Downloading (Delivered & Verified v1.2.0)

- [x] **Phase 7: Subtitle Extraction & Companion Export** - Parse `#EXT-X-MEDIA:TYPE=SUBTITLES`, fetch WebVTT/SRT chunks, convert to `.srt`, and export alongside video.
- [x] **Phase 8: Batch & Whole-Season Download Engine** - Episode drawer scraping, bulk queueing, range filtering, FIFO concurrency, and popup batch controls.
- [x] **Phase 9: Enhanced Popup Dashboard & Audio Track Switcher** - Search and filter downloads, manual audio rendition selector, and queue history export.

### Milestone 3: Continuous Download Resilience & Stress Hardening (Delivered & Verified v1.3.0)

- [x] **Phase 10: Continuous Download Resilience, Memory Leak Immunity & High-Load Stress Hardening** - Zero-drop sequential downloading, background HLS job auto-dispatching, aggressive buffer and Object URL zeroing, 5-stage backoff with circuit breaker, and 8-point high-load stress testing suite.

## Phase Details

### Phase 6: Audio Retention, Multi-Track fMP4 Remuxing & Seek Smoothness
**Goal**: Deliver glitch-free audio and video playback with smooth seeking across all external players (VLC, Windows Media Player, QuickTime).
**Status**: Completed and Verified with 7 passing tests (`tests/test_audio_and_seek_smoothness.js`).
**Requirements**: REMUX-02, REMUX-03, REMUX-04
**Success Criteria**:
  1. Multi-audio renditions are automatically parsed and English DUB is prioritized.
  2. Separate video and audio fMP4 streams are interleaved into a single container with track IDs 1 and 2.
  3. `trun.data_offset` is accurately patched into `moof` boxes, enabling smooth scrubbing in VLC.
  4. In-tab download jobs preserve caller-provided job IDs and report live segment counts to the background queue.

### Phase 7: Subtitle Extraction & Companion Export
**Goal**: Allow users to download softsub subtitles (`.srt` / `.vtt`) matching the downloaded episode audio and video.
**Depends on**: Phase 6
**Requirements**: SUBS-01, SUBS-02, SUBS-03
**Success Criteria**:
  1. Detect `#EXT-X-MEDIA:TYPE=SUBTITLES` entries in master playlists.
  2. Parse WebVTT subtitle segments and assemble them into a valid `.srt` file.
  3. Trigger automated subtitle file download matching the episode video naming convention.

### Phase 8: Batch & Whole-Season Download Engine
**Goal**: Enable one-click downloading of entire anime seasons or ranges of episodes.
**Depends on**: Phase 7
**Requirements**: BATCH-01, BATCH-02
**Success Criteria**:
  1. Scrape episode list DOM from HiAnime and Aniwatch episode drawers.
  2. Queue multiple episodes to the background service worker in FIFO order.
  3. Respect concurrency limits and provide batch pause/cancel in popup.

### Phase 10: Continuous Download Resilience, Memory Leak Immunity & High-Load Stress Hardening
**Goal**: Make continuous multi-episode downloading flawless without dropped jobs, stalls, or memory exhaustion under sustained load.
**Depends on**: Phase 8, Phase 9
**Requirements**: CONT-01, CONT-02, CONT-03, CONT-04, CONT-05, CONT-06, CONT-07
**Success Criteria**:
  1. Continuous sequential downloads process all queued episodes in order without false duplicate suppression.
  2. Each queued job preserves its dedicated target URL, embed URL, filename, and job ID.
  3. Background queue dispatches HLS jobs to active player tabs and frees concurrency slots upon completion.
  4. Segment buffers and Object URLs are aggressively freed, preventing multi-gigabyte memory bloat.
  5. Network errors and CDN 429/503 rate-limits recover automatically with exponential backoff and circuit breaker.
  6. High-load stress suite passes all tests with zero memory leaks and valid ISO BMFF MP4 outputs.

### Phase 11: Unlimited Concurrent Downloads, "Do Nothing" Normal Browser Mode & Modernized UI CSS
**Goal**: Remove artificial 2-file concurrency limits to enable unlimited parallel downloads, introduce a 3rd "Do Nothing" mode allowing standard browser behavior, and modernize UI styles without breaking functionality.
**Depends on**: Phase 10
**Requirements**: MULTI-01, MULTI-02, MODE-01, MODE-02, MODE-03, UI-01, UI-02
**Success Criteria**:
  1. Default concurrency setting upgraded to 0 (Unlimited), enabling multiple files to download simultaneously without queuing delays.
  2. Dynamic concurrency dropdown (Unlimited, 5, 3, 2, 1) in popup settings and synced to background queue manager.
  3. 3rd popup mode "Do Nothing" added to segmented control, allowing normal browser behavior without link interception or tab destruction.
  4. Content script and inject.js pass-through hooks for "Do Nothing" mode.
  5. Refined and modernized glassmorphic CSS styling across segmented controls, cards, toggles, and download queue while preserving 100% of selectors and IDs.


