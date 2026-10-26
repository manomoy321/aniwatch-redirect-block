# Onboarding Summary: Aniwatch Episode Downloader & Redirect Blocker - FocusGuard

**Onboarded Date:** 2026-10-26
**Repository:** `aniwatch-redirect-block`
**Status:** Brownfield repository fully mapped and indexed under GSD Core.

## What Was Learned & Mapped

1. **Architecture & Design:**
   - Dual-world Chrome Manifest V3 extension (`inject.js` in MAIN world for prototype traps and redirect blocking; `player_controller.js` in ISOLATED world for stream sniffing, segment downloading, decryption, and remuxing).
   - Authoritative background service worker (`background.js`) managing a FIFO queue with concurrency limits (2 concurrent downloads), automatic DNR header rewrites (`setStreamBypassHeaders`), and exponential backoff retry.
   - Zero-dependency client-side architecture using native Web APIs (`crypto.subtle`, `DataView`, `Uint8Array`).

2. **Audio Retention & VLC Seek Smoothness (Recent Phase 6 Delivery):**
   - Separate audio renditions (`#EXT-X-MEDIA:TYPE=AUDIO`) are automatically parsed and English DUB is prioritized.
   - Dual-track video + audio fMP4 streams are combined and interleaved with track remapping (video track 1, audio track 2).
   - Accurate ISO BMFF `patchMoofTrunDataOffsets` recalculates `trun.data_offset` into `moof` boxes, resolving external player scrubbing crashes in VLC, QuickTime, and Windows Media Player.

3. **Verification & Stability:**
   - 10 automated test suites (71 test assertions) in `tests/` covering download deduplication, stream sniffing, stall watchdog recovery, background queue recovery, VLC remuxing, and multi-track audio retention.
   - 100% test pass rate via `npm test`.

## Planning Artifacts Created

- `.planning/codebase/STACK.md`
- `.planning/codebase/INTEGRATIONS.md`
- `.planning/codebase/ARCHITECTURE.md`
- `.planning/codebase/STRUCTURE.md`
- `.planning/codebase/CONVENTIONS.md`
- `.planning/codebase/TESTING.md`
- `.planning/codebase/CONCERNS.md`
- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`

## Next Command

To inspect roadmap status and proceed with the next feature:
- `/gsd-progress` — Review project milestone status.
- `/gsd-plan-phase 7` — Plan Phase 7: Subtitle Extraction & Companion Export.
