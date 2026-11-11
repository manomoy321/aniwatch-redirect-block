# Implementation Plan - Phase 10: Continuous Download Resilience, Memory Leak Immunity & High-Load Stress Hardening

## Overview
Eliminate all application glitches, stalls, memory leaks, and dropped jobs during continuous and batch downloading. Harden network segment retrieval with adaptive exponential backoff and circuit-breaker CDN bypass re-arming. Ensure background queue auto-dispatches HLS jobs to active tabs with perfect job ID tracking, and add a rigorous high-load stress testing suite.

## Requirements Covered
- **CONT-01**: Continuous sequential downloading without dropped jobs or false duplicate suppression.
- **CONT-02**: Target URL, embed URL, filename, and job ID metadata preservation across queued continuous downloads.
- **CONT-03**: Background service worker queue auto-dispatching HLS jobs to active tabs and freeing concurrency slots upon completion.
- **CONT-04**: Memory leak immunity: immediate ArrayBuffer zeroing, early Object URL revocation, and lean heap usage during continuous downloads.
- **CONT-05**: Network stress resilience: 5-stage exponential backoff with jitter, 429/503 mitigation, and circuit breaker DNR stream bypass re-arming.
- **CONT-06**: Continuous Auto-Download Mode: optionally queue and download consecutive episodes automatically as they become available.
- **CONT-07**: High-load stress verification suite testing 10+ sequential episodes, rapid queueing, fault injection, and VLC-grade MP4 output.

## Tasks Breakdown

### Task 1: Fix Target URL, Metadata, and Job ID Tracking in Player Controller
- File: `player_controller.js`
- Actions:
  - In `downloadActiveVideo`:
    - Check and prioritize explicit stream target URL from incoming parameter: `(customMeta && customMeta.url) || (qualityOrMeta && typeof qualityOrMeta === 'object' && qualityOrMeta.url) || resolveActiveStreamUrl(video)`.
    - Check and prioritize explicit `embedUrl`: `(customMeta && customMeta.embedUrl) || detectedEmbedUrl || ...`.
    - Bind caller-provided job ID: `const currentHlsJobId = (customMeta && (customMeta.id || customMeta.jobId)) || ...`.
    - Store abort controller under both `currentHlsJobId` and `customMeta.id` for reliable cancellation.
  - In `tabPendingHlsQueue` draining:
    - Pass exact job metadata (`url`, `embedUrl`, `filename`, `jobId`, `episodeNum`) to `downloadActiveVideo` for sequential processing.
  - In `FOCUSGUARD_SAVE_BLOB`:
    - Preserve delegated episode filename and never overwrite it with active page episode title if episode numbers differ.
  - In `isRecentlySaved` and `isRecentlyAnchorDownloaded`:
    - Scope deduplication strictly to prevent double-clicks (< 1000ms on exact same job/URL/filename), but NEVER drop sequential downloads of consecutive episodes or items with distinct job IDs.

### Task 2: Background Service Worker HLS Job Auto-Dispatch & Rule Balance
- File: `background.js`
- Actions:
  - In `startJob`:
    - When an HLS job starts (`job.type === 'hls'`), actively dispatch the download command (`execute_player_cmd: 'download_video'`) with `job.id`, `job.url`, `job.filename`, `job.quality`, `job.embedUrl` to active tabs / player frames.
    - If no tab is currently open, keep job in preparing/queued and dispatch when tab is ready.
  - In `arm_stream_bypass`:
    - Ensure `activeStreamBypassCount` is balanced or auto-expiring so DNR bypass rules do not leak or permanently block cleanup.
  - In `updateJobProgress`:
    - Match jobs reliably by `jobId`, `downloadId`, or `filename`.
    - When status is `completed`, `failed`, or `cancelled`, immediately trigger `processQueue()` to start next queued job in FIFO sequence.

### Task 3: Memory Zeroing & Object URL Revocation Registry
- File: `player_controller.js`
- Actions:
  - Implement active Object URL registry (`activeObjectUrls`):
    - Revoke previous object URLs immediately when the user's browser begins downloading or before creating a new object URL.
    - Shorten safety revocation timer from 12s to 4s.
  - In `downloadHlsStream`:
    - Explicitly empty `videoBuffers`, `validVideoBuffers`, `audioBuffers`, `validAudioBuffers` immediately after `convertAndRemuxStreamForSmoothPlayback` finishes.
  - In `optimizeFmp4ForSmoothPlayback` & `combineFmp4VideoAndAudio`:
    - Empty `sanitizedFragments`, `fragmentBuffers`, `allBuffers`, `interleaved` immediately once `new Blob(...)` is instantiated.
  - In `transmuxTsToSmoothMp4`:
    - Empty `fragments`, `mdatPayload`, `chunks`, `buffers` immediately once `new Blob(...)` is instantiated.

### Task 4: Network Stress Resilience & Circuit Breaker Backoff
- File: `player_controller.js`
- Actions:
  - In `downloadHlsStream` worker:
    - Increase retries from 3 to 5 attempts per segment.
    - Exponential backoff with jitter: `Math.min(3000, 300 * (2 ** attempts) + Math.random() * 200)`.
    - Circuit breaker: track consecutive segment failures. If 3 consecutive segments fail, pause for 1200ms, re-send `arm_stream_bypass` to background, and retry fetching.
    - Ensure zero-byte segments are avoided unless all 5 retries fail.

### Task 5: Continuous Auto-Download Mode & Popup Setting
- Files: `player_controller.js`, `popup/popup.html`, `popup/popup.js`
- Actions:
  - Add `enableContinuousDownload` toggle in `playerSettings` (persisted in `chrome.storage.local`).
  - When enabled, upon completion of an episode download (or video ended), automatically scrape the next episode from drawer and queue it for seamless continuous downloading.
  - Add "Continuous Episode Downloader" toggle in popup UI under Video Downloader section.

### Task 6: High-Load Stress Test Suite
- File: `tests/test_continuous_download_stress_and_resilience.js`
- Actions:
  - Test 1: Continuous sequential queueing (10+ episodes queued and processed with zero drops).
  - Test 2: Target URL & metadata fidelity (each episode retains its distinct URL, filename, and job ID).
  - Test 3: Background queue auto-dispatching HLS jobs to tab and slot freeing upon completion.
  - Test 4: Memory leak prevention (verifying buffer zeroing, early Object URL revocation, and absence of memory bloat).
  - Test 5: Rapid duplicate suppression precision (blocks accidental double-clicks within 1s, allows sequential downloads).
  - Test 6: Network stress & fault injection (recovers from 429/503 errors and socket timeouts with backoff).
  - Test 7: Continuous auto-download mode (automatically queues next episode from drawer).
  - Test 8: Full pipeline stress test generating valid ISO BMFF MP4 blobs for multiple consecutive episodes.
  - Wire test into `package.json` `npm test`.
