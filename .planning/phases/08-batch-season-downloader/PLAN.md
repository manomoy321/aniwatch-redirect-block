# Implementation Plan - Phase 8: Batch & Whole-Season Download Engine

## Overview
Enable seamless one-click downloading of entire anime seasons or custom episode ranges (e.g., Ep 1–12) directly from Aniwatch and HiAnime episode drawers, with batch queue controls in the background service worker and popup UI.

## Requirements Covered
- **BATCH-01**: Episode drawer scraper to queue entire anime seasons or range of episodes.
- **BATCH-02**: Batch pause, resume, and cancel operations in background service worker and popup UI.
- **DL-COMPLIANCE**: Ensure all batch downloads strictly download video files (`.mp4`) only, without triggering separate companion `.info.json` files.

## Tasks Breakdown

### Task 1: Background Service Worker Batch Operations
- File: `background.js`
- Actions:
  - Add `queue_batch_downloads` handler in `chrome.runtime.onMessage`: validates payload items, enqueues each job into `downloadQueue`, persists queue with history cap, and invokes `processDownloadQueue()`.
  - Add `pause_all_downloads` handler: pauses all active/queued jobs.
  - Add `resume_all_downloads` handler: resumes all paused jobs and kicks the queue runner.
  - Add `cancel_all_downloads` handler: cancels all non-completed jobs.
  - Export batch helpers for testability.

### Task 2: Episode Drawer Scraper & Range Filter in Player Controller
- File: `player_controller.js`
- Actions:
  - Implement `scrapeEpisodeDrawer(targetDoc)`: identifies all episode anchor elements across Aniwatch / HiAnime DOM patterns (`.ep-item`, `.ssl-item`, `[data-number]`, `.episodes-ul li a`, `.ss-list a`), returns structured array `[{ episodeNum, title, href, active }]` sorted numerically.
  - Implement `filterEpisodeRange(episodesList, startEp, endEp)`: extracts range boundaries safely with clamping.
  - Implement `queueBatchEpisodes(episodes, quality)`: converts scraped episodes into background queue jobs and dispatches to background service worker or sequential tab queue.

### Task 3: In-Page Batch Download Button & Modal
- Files: `player_controller.js`, `player_hud.css`
- Actions:
  - Mount a subtle, beautiful "⚡ Batch Download" button near the episode drawer header (`.block_area-header`, `#episodes-title`, `.head-title`) or on the player controls bar.
  - Implement modal / drawer popover with:
    - Anime title and detected episode count.
    - Quick selection: "All Episodes (1-N)" or "From Ep A to Ep B".
    - Quality dropdown (1080p, 720p, 480p).
    - "Start Batch Download" and "Cancel" buttons.
    - Live toast / HUD notification confirming queued episodes.

### Task 4: Popup Batch Queue Controls
- Files: `popup/popup.html`, `popup/popup.js`
- Actions:
  - Add batch buttons ("Pause All", "Resume All", "Clear Completed") to the Downloads panel in popup.
  - Wire click handlers in `popup.js` sending messages to `background.js`.
  - Update queue stats counter dynamically.

### Task 5: Automated Verification Suite
- File: `tests/test_batch_season_downloader.js`
- Actions:
  - Test 1: Episode drawer scraping across multiple DOM formats (Aniwatch `.ssl-item`, HiAnime `.ep-item`, custom attributes).
  - Test 2: Episode range filtering and edge-case boundary clamping.
  - Test 3: Background `queue_batch_downloads` enqueuing and FIFO ordering.
  - Test 4: Concurrency control under batch load (max 2 active downloads, remaining queued).
  - Test 5: Batch control actions (`pause_all_downloads`, `resume_all_downloads`, `cancel_all_downloads`).
  - Test 6: Single-file video download enforcement (no `.info.json` generated in batch).
  - Update `package.json` to include the test in `npm test`.
