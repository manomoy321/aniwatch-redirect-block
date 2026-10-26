# Implementation Plan - Phase 7: Subtitle Extraction & Softsubs

## Overview
Enable parsing and extraction of softsub subtitles (WebVTT / SRT) from HLS playlists with clean VTT-to-SRT conversion. Strictly protect the user's primary requirement of downloading only the video file by default (gating any separate file downloads behind `enableDownloadSubtitles: false`).

## Requirements Covered
- **SUBS-01**: Parse `#EXT-X-MEDIA:TYPE=SUBTITLES` entries from HLS multivariant playlists.
- **SUBS-02**: Parse and convert WebVTT subtitle segments into standard SRT format.
- **SUBS-03**: Single-video file default protection (opt-in subtitle file export via `enableDownloadSubtitles`).

## Tasks Breakdown

### Task 1: Subtitle Playlist Extractor & VTT-to-SRT Converter in Player Controller
- File: `player_controller.js`
- Actions:
  - Implement `extractSubtitleRenditions(playlistText, basePlaylistUrl)`: extracts all `#EXT-X-MEDIA:TYPE=SUBTITLES` tracks (language, name, uri, isDefault, forced).
  - Implement `convertVttToSrt(vttContent)`: parses WebVTT header, cleans cue timestamps (replacing `.` with `,`), standardizes cue numbering.
  - Implement `fetchSubtitleStream(subUri, options)`: fetches subtitle playlist and segments, returning unified SRT string.
  - Wire subtitle handling into `downloadActiveVideo`: if `playerSettings.enableDownloadSubtitles` is true, trigger subtitle save; otherwise do NOT trigger separate file download.

### Task 2: Subtitle Settings in Popup and Background
- Files: `popup/popup.html`, `popup/popup.js`, `background.js`
- Actions:
  - Add `enableDownloadSubtitles: false` to default settings in `background.js` and `popup.js`.
  - Add optional toggle in `popup/popup.html`: "Download Subtitle File (.srt)" (unchecked by default).

### Task 3: Automated Verification Suite
- File: `tests/test_subtitle_extraction_and_softsubs.js`
- Actions:
  - Test 1: Parse `#EXT-X-MEDIA:TYPE=SUBTITLES` with multiple languages (English, Spanish, French).
  - Test 2: WebVTT to SRT conversion accuracy (timestamp format `00:01:23,456`, cue numbering).
  - Test 3: Verification that single-video download is preserved when `enableDownloadSubtitles` is false.
  - Test 4: Verification of subtitle export when `enableDownloadSubtitles` is true.
