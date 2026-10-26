---
last_mapped_commit: 553fb73d7c5ab013cf4980bb984affe822621868
last_mapped_at: 2026-10-26
---
# Architecture

**Analysis Date:** 2026-10-26

## Pattern Overview

**Overall:** Event-Driven Multi-Tier Browser Extension with Dual-World Content Injection and Binary In-Browser Remuxing.

**Key Characteristics:**
- **Zero-Dependency Native Architecture:** All binary parsing, cryptographic decryption, and UI components are implemented in vanilla JavaScript without heavy external node modules.
- **Dual-World Execution Model:** Clean separation between unprivileged web page contexts (`MAIN` world) and privileged extension execution contexts (`ISOLATED` world & background service worker).
- **Adaptive Concurrency & Socket Cooperativeness:** Download workers throttle concurrency (down to 2 workers with 25ms yield) while the HTML5 video player is actively playing, preventing buffer underrun crashes.
- **Pure-JS In-Browser Transmuxing:** Direct MPEG-TS to ISO BMFF fMP4 conversion, keyframe-aligned fragmenting, and multi-track interleaving.

## Layers

**1. Main World Injected Layer (`inject.js`):**
- Purpose: Early interception of window prototypes and DOM navigation.
- Contains: Redirect blocker (`window.open` traps, click event capturing), HTML5 `HTMLMediaElement` prototype hooks, and MSE segment interceptor (`window.__focusguard_mse_init_segment__`).
- Used by: All web pages and iframes loading media players.

**2. Isolated World Player Layer (`player_controller.js`, `content.js`):**
- Purpose: Stream sniffing, on-player HUD rendering, in-frame segment downloading, decryption, and remuxing.
- Contains: HLS parser, AES-128 decryptor, MPEG-TS demuxer, ISO BMFF box parser/builder, stall watchdog, and episode metadata generator.
- Depends on: Background service worker for DNR rulesets and global queue synchronization.

**3. Background Service Worker Layer (`background.js`):**
- Purpose: Persistent state management, network header manipulation, and browser download orchestration.
- Contains: FIFO download queue engine, DNR referer bypass engine, exponential backoff fetcher (`fetchWithRetry`), and browser download event sync.
- Used by: Popup UI and content scripts across all tabs and frames.

**4. Popup UI Presentation Layer (`popup/popup.html`, `popup/popup.css`, `popup/popup.js`):**
- Purpose: User control center and multi-video download dashboard.
- Contains: Toggle switches (AdBlock, Focus Lock, Auto DUB, Skip Intro, Smooth VLC Playback), active download queue cards with real-time progress bars, speed, segment counts, and queue controls (Pause, Resume, Retry, Cancel).

## Data Flow

### 1. Stream Detection & Download Flow

```
[Iframe / Player]
       │
       ▼ (Sniff / Snatch Stream URL)
[player_controller.js]
       │
       ├─► Request DNR Header Bypass ──► [background.js (DNR API)]
       │
       ▼ (Fetch Master Playlist)
[Parse Multivariant Streams & Audio Tracks]
       │
       ▼ (Adaptive Concurrency Queue)
[Fetch Segments (Video + Audio) & Decrypt AES-128]
       │
       ▼
[Remuxer & Timestamp Normalizer]
       │ ├─ Keyframe Alignment
       │ ├─ trun data_offset patch
       │ ├─ Audio Track Remap & Interleave
       │ └─ iTunes Metadata Injection (ilst)
       ▼
[Generated ISO BMFF MP4 Blob]
       │
       ▼
[Browser Download Manager / Background Queue]
```

### 2. Playback Stall Protection Flow

```
[HTML5 Video Element]
       │
       ▼ (Waiting / Stalled Event or Time Update Gap)
[Watchdog Timer (checkPlayerPlaybackWatchdog)]
       │
       ▼
[Throttle Download Concurrency (2 workers + 25ms delay)]
       │
       ▼ (If Stalled > 2.5s)
[Micro-Nudge Recovery (currentTime + 0.08s)]
```

## Key Abstractions

- `DownloadQueueManager`: State machine managing multi-video background downloads with retry, exponential backoff, and persistence.
- `StreamTransmuxer`: Decodes raw MPEG-TS packets (sync byte `0x47`, PES headers, PTS/DTS) and remuxes them into ISO BMFF fragments (`moof` + `mdat`).
- `BoxBuilder`: Generates ISO BMFF boxes (`ftyp`, `moov`, `mvhd`, `trak`, `tkhd`, `mdia`, `minf`, `stbl`, `mvex`, `trex`, `moof`, `traf`, `tfhd`, `tfdt`, `trun`, `mdat`, `udta`, `ilst`).
- `MetadataCompanion`: Generates companion `.info.json` payloads containing title, episode number, anime name, quality, duration, and download timestamps.

---

*Architecture analysis: 2026-10-26*
*Update after structural architecture changes*
