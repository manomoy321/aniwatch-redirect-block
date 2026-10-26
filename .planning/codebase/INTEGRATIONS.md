---
last_mapped_commit: 553fb73d7c5ab013cf4980bb984affe822621868
last_mapped_at: 2026-10-26
---
# External Integrations

**Analysis Date:** 2026-10-26

## Streaming Platforms & Target Websites

**Supported Anime Streaming Hubs:**
- **HiAnime** (`hianime.to`, `*.hianime.to`)
- **Aniwatch** (`aniwatch.to`, `aniwatchtv.to`, `*.aniwatchtv.to`)
- **Kaido / Zoro / 9Anime** mirrors and successors

**Video Embed & CDN Hosting Providers:**
- **MegaCloud** (`megacloud.tv`, `megaplay.buzz`, `rapid-cloud.co`)
- **StreamWish** (`streamwish.to`, `*.streamwish.*`)
- **Vidstreaming / Vidcloud** (`vidstreaming.io`, `vidcloud.co`)
- **Akamaized / Cloudflare CDN edges** serving `.m3u8` playlists and `.ts` / `.m4s` chunks.

## Network & Protocol Integrations

**HLS (HTTP Live Streaming) Protocol:**
- **Master Playlist Parser:** Extracts multivariant streams, resolutions (1080p, 720p, 480p), and separate audio tracks (`#EXT-X-MEDIA:TYPE=AUDIO`).
- **Media Playlist Parser:** Parses `#EXTINF` segment durations, `#EXT-X-MAP` initialization segments, `#EXT-X-BYTERANGE` byte specifications, and `#EXT-X-KEY` AES-128 cryptographic keys.
- **DUB / SUB Audio Selection:** Auto-detects English audio tracks from multivariant playlists with fallback to primary stream.

**ISO BMFF / fMP4 Remuxing Engine:**
- Decodes and parses fragmented MP4 boxes (`ftyp`, `moov`, `mvhd`, `trak`, `tkhd`, `mdia`, `minf`, `stbl`, `mvex`, `trex`, `moof`, `mfhd`, `traf`, `tfhd`, `tfdt`, `trun`, `mdat`, `udta`, `ilst`).
- Remuxes and interleaves multi-track video and audio fMP4 streams into a single player-friendly ISO BMFF container.
- Corrects `trun.data_offset` offsets and maintains per-track monotonic decode times (`tfdt.baseMediaDecodeTime`) for smooth seeking in VLC, Windows Media Player, and QuickTime.

## Chrome Extension Platform Integrations

**1. Declarative Net Request (DNR) Proxy:**
- Dynamically configures ruleset IDs (`STREAM_BYPASS_RULE_ID = 9999`) to bypass anti-hotlinking HTTP 403 Forbidden checks.
- Modifies request headers (`Referer`, `Origin`) for target stream URLs to match the parent embed host.

**2. Chrome Downloads API:**
- Dispatches finalized blobs and direct URLs to the browser download manager via `chrome.downloads.download`.
- Employs `conflictAction: 'uniquify'` to prevent accidental file overwrites.
- Monitors progress and completion states via `chrome.downloads.onChanged`.

**3. Chrome Storage Local:**
- Stores background multi-video download queue (`downloadQueue`), user preferences (auto DUB, skip intros, smooth playback toggle), and blocker telemetry.

**4. Message Passing Bus:**
- Bidirectional communication between popup UI (`popup/popup.js`), background worker (`background.js`), and in-page controller (`player_controller.js`):
  - `start_download` / `queue_download`
  - `update_job_progress`
  - `cancel_tab_download`
  - `execute_player_cmd`

---

*Integration analysis: 2026-10-26*
*Update after external streaming server changes or API additions*
