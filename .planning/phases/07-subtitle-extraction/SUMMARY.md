# Phase 7: Subtitle Extraction & Softsubs (WebVTT to SRT) Summary

## Overview
Phase 7 introduces HLS multivariant subtitle rendition extraction (`#EXT-X-MEDIA:TYPE=SUBTITLES`) and pure, standards-compliant WebVTT to SubRip (`.srt`) conversion. Most importantly, it strictly safeguards the user's primary requirement: **single-video file downloads by default** (`enableDownloadSubtitles: false`).

## Key Deliverables & Achievements
1. **Master Playlist Subtitle Parser (`SUBS-01`)**:
   - Implemented `extractSubtitleRenditions(playlistText, baseUrl)` in [player_controller.js](file:///c:/Extenshon/aniwatch-redirect-block/player_controller.js).
   - Extracts all subtitle tracks (English, Spanish, French, etc.) with resolved URLs, default/forced flags, and language ISO codes.
2. **WebVTT to SRT Converter (`SUBS-02`)**:
   - Implemented `convertVttToSrt(vttContent)` in [player_controller.js](file:///c:/Extenshon/aniwatch-redirect-block/player_controller.js).
   - Cleans WEBVTT headers, removes comment blocks (`NOTE`), voice tags (`<v Name>`), and HTML formatting.
   - Formats timestamps to standard SRT syntax (`HH:MM:SS,mmm --> HH:MM:SS,mmm` with comma separator and zero-padded hours).
   - Numbers cues sequentially starting from 1.
3. **Single-Video Default Protection (`SUBS-03`)**:
   - Subtitle file export is gated behind `playerSettings.enableDownloadSubtitles` (default `false`).
   - By default, downloading an episode produces **only one video file** (`.mp4`), strictly satisfying the user's requirement.
   - When opted-in, generates `${baseName}.srt` alongside the video.
4. **Verification**:
   - [tests/test_subtitle_extraction_and_softsubs.js](file:///c:/Extenshon/aniwatch-redirect-block/tests/test_subtitle_extraction_and_softsubs.js) passes 4/4 assertions.
