---
last_mapped_commit: 553fb73d7c5ab013cf4980bb984affe822621868
last_mapped_at: 2026-10-26
---
# Coding Conventions & Design Patterns

**Analysis Date:** 2026-10-26

## Architectural Patterns & Code Style

**1. Vanilla JavaScript & Zero External Runtime Dependencies:**
- All runtime production code is strictly pure JavaScript (ES2020+).
- Never introduce heavyweight external libraries (like `axios`, `hls.js`, or `ffmpeg.wasm`) into production runtime bundles; the extension relies on high-performance native browser APIs (`crypto.subtle`, `DataView`, `Uint8Array`, `fetch`, `chrome.*`).

**2. Scoped Closures & Clean Global Exports:**
- All script files wrap logic inside Immediately Invoked Function Expressions (IIFE) or modules to prevent global scope pollution.
- Safe runtime bridges expose interfaces conditionally:
  ```javascript
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ... };
  }
  if (typeof window !== 'undefined') {
    window.__focusguard_... = ...;
  }
  ```

**3. Binary Stream & Box Manipulation Standards:**
- Big-endian binary parsing using `DataView` with explicit endian flags (`v.getUint32(offset, false)`).
- Chunked typed-array allocation and subarray slicing to minimize garbage collector churn and prevent large memory spikes.
- Bitwise arithmetic for ISO BMFF flag manipulation (`flags = 0x000001 | 0x000100`).

## Error Handling & Resiliency Patterns

**1. Defensive Fallbacks & Safe Traps:**
- All DOM queries and window access check for null safety before accessing properties (e.g., `document.body ? ... : null`).
- Network fetches wrap in `try/catch` and use `fetchWithRetry` for transient recovery with exponential backoff and jitter.

**2. Playback Stall Watchdog & Adaptive Throttling:**
- Media streaming operations monitor the `HTMLMediaElement` playback state (`waiting`, `stalled`, `timeupdate`).
- When playback is active, segment download concurrency throttles down to prevent bandwidth starvation, socket exhaustion, or UI freezing.
- Stall watchdog limits micro-nudging recovery attempts to 3 per 30-second window to prevent thrashing.

**3. Deduplication & Cooldown Timers:**
- Rapid user clicks or redundant download triggers are throttled using an anti-double-download cooldown cache (1.5s–3.0s window).
- Background queue deduplicates requests matching URL, filename, and active status (`queued`, `downloading`).

## Naming Standards

- **Files:** lowercase with underscores (`player_controller.js`, `player_hud.css`, `test_audio_and_seek_smoothness.js`).
- **Functions:** camelCase with clear verb prefixes (`extractAudioRenditions`, `combineFmp4VideoAndAudio`, `patchMoofTrunDataOffsets`, `fetchResourceSafe`).
- **Constants:** UPPER_SNAKE_CASE (`TS_SYNC = 0x47`, `TS_SIZE = 188`, `STREAM_BYPASS_RULE_ID = 9999`).
- **DOM IDs & Classes:** kebab-case with descriptive prefixes (`focusguard-hud`, `dl-progress-bar`, `status-badge`).

---

*Conventions analysis: 2026-10-26*
*Update after style guide or architectural pattern changes*
