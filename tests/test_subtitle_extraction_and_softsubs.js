/**
 * FocusGuard Verification Suite: Subtitle Extraction & Softsubs (Phase 7)
 * Validates:
 * 1. SUBS-01: Extraction of #EXT-X-MEDIA:TYPE=SUBTITLES renditions from HLS multivariant playlists.
 * 2. SUBS-02: WebVTT to SubRip (.srt) conversion with timestamp accuracy (HH:MM:SS,mmm) and sequential cue numbering.
 * 3. SUBS-03: Single-video default protection (NO separate companion subtitle or info file unless explicitly opted-in).
 * 4. Opt-in subtitle file export matching the episode naming convention when enableDownloadSubtitles: true.
 */

const assert = require('assert');

// 1. Mock Browser Environment for player_controller.js
class MockClassList {
  constructor(str = '') {
    this.classes = new Set(str.split(/\s+/).filter(Boolean));
  }
  add(c) { this.classes.add(c); }
  remove(c) { this.classes.delete(c); }
  contains(c) { return this.classes.has(c); }
}

class MockElement {
  constructor(tagName = 'DIV', text = '', attrs = {}, parent = null) {
    this.tagName = (tagName || 'DIV').toUpperCase();
    this.textContent = text;
    this.attrs = { ...attrs };
    this.parent = parent;
    this.parentElement = parent;
    this.children = [];
    this.classList = new MockClassList(attrs.class || '');
    this.style = {};
    this.listeners = new Map();
    if (parent && parent.children) parent.children.push(this);
  }
  getAttribute(name) { return this.attrs[name] !== undefined ? this.attrs[name] : null; }
  setAttribute(name, val) { this.attrs[name] = String(val); }
  get download() { return this.attrs.download || this._download || ''; }
  set download(val) { this.attrs.download = val; this._download = val; }
  get href() { return this.attrs.href || this._href || ''; }
  set href(val) { this.attrs.href = val; this._href = val; }
  remove() {
    if (this.parent && this.parent.children) {
      this.parent.children = this.parent.children.filter(c => c !== this);
    }
  }
  appendChild(el) {
    el.parent = this;
    el.parentElement = this;
    this.children.push(el);
    return el;
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  click() {
    const list = this.listeners.get('click') || [];
    list.forEach(fn => fn({ preventDefault: () => {}, stopPropagation: () => {} }));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  querySelectorAll(selector) {
    const results = [];
    function match(node) {
      if (!node) return false;
      if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
      if (selector.startsWith('#')) return (node.attrs && node.attrs.id === selector.slice(1));
      if (node.tagName && node.tagName.toLowerCase() === selector.toLowerCase()) return true;
      return false;
    }
    function walk(node) {
      if (!node || !node.children) return;
      for (const child of node.children) {
        if (match(child)) results.push(child);
        walk(child);
      }
    }
    walk(this);
    return results;
  }
}

global.document = {
  createElement: (tag) => new MockElement(tag),
  getElementById: (id) => global.document.body.querySelector('#' + id),
  body: new MockElement('BODY'),
  documentElement: new MockElement('HTML'),
  addEventListener: () => {},
  querySelector: (s) => global.document.body.querySelector(s),
  querySelectorAll: (s) => global.document.body.querySelectorAll(s),
  head: new MockElement('HEAD')
};

global.MutationObserver = class {
  observe() {}
  disconnect() {}
};

global.window = {
  document: global.document,
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { href: 'https://aniwatch.to/watch/solo-leveling?ep=1', hostname: 'aniwatch.to', pathname: '/watch/solo-leveling', search: '?ep=1' },
  top: null,
  clearTimeout: () => {},
  setTimeout: (fn) => { fn(); return 1; },
  setInterval: () => 1,
  clearInterval: () => {},
  getComputedStyle: () => ({ position: 'relative' }),
  navigator: { userAgent: 'Mozilla/5.0' },
  MutationObserver: global.MutationObserver
};
global.window.top = global.window;

let revokedUrls = [];
const NativeURL = global.URL;
const MockURL = function(url, base) {
  return new NativeURL(url, base);
};
MockURL.createObjectURL = (blob) => `blob:mock-uuid-${Math.random().toString(36).substr(2, 8)}`;
MockURL.revokeObjectURL = (url) => { revokedUrls.push(url); };
MockURL.prototype = NativeURL.prototype;
global.URL = MockURL;

global.chrome = {
  storage: {
    sync: {
      get: (keys, cb) => cb({ playerSettings: {} }),
      set: (data, cb) => { if (cb) cb(); }
    },
    local: {
      get: (keys, cb) => cb({}),
      set: (data, cb) => { if (cb) cb(); }
    }
  },
  runtime: {
    sendMessage: (msg, cb) => { if (cb) cb({ success: true }); },
    onMessage: { addListener: () => {} }
  }
};

global.Blob = class Blob {
  constructor(parts, opts = {}) {
    this.parts = parts || [];
    this.type = opts.type || '';
    let size = 0;
    for (const p of this.parts) {
      if (typeof p === 'string') size += Buffer.byteLength(p);
      else if (p && p.byteLength !== undefined) size += p.byteLength;
      else if (p && p.length !== undefined) size += p.length;
    }
    this.size = size;
  }
};

const downloadedFiles = [];
// Track triggered file downloads
const originalCreateElement = global.document.createElement;
global.document.createElement = function(tag) {
  const el = originalCreateElement(tag);
  if (tag.toLowerCase() === 'a') {
    const origClick = el.click.bind(el);
    el.click = function() {
      downloadedFiles.push({ filename: el.download, href: el.href });
      origClick();
    };
  }
  return el;
};

// Import functions from player_controller.js
const {
  extractSubtitleRenditions,
  convertVttToSrt,
  downloadEpisodeSubtitleFile,
  playerSettings,
  triggerFileSave
} = require('../player_controller.js');

console.log('=== FocusGuard Phase 7: Subtitle Extraction & Softsubs Verification Suite ===\n');

async function runTests() {
  // =========================================================================
  // Test 1: Extract Subtitle Renditions from Master Playlist (SUBS-01)
  // =========================================================================
  console.log('--- Test 1: HLS Master Playlist Subtitle Extraction (SUBS-01) ---');

  const masterPlaylist = `
#EXTM3U
#EXT-X-VERSION:4
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,LANGUAGE="eng",URI="subs/eng.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Spanish",DEFAULT=NO,AUTOSELECT=NO,FORCED=NO,LANGUAGE="spa",URI="subs/spa.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="French",DEFAULT=NO,AUTOSELECT=NO,FORCED=NO,LANGUAGE="fre",URI="subs/fre.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080,SUBTITLES="subs"
1080p.m3u8
  `.trim();

  const baseM3u8 = 'https://megacloud.tv/embed-2/hls/master.m3u8';
  const subs = extractSubtitleRenditions(masterPlaylist, baseM3u8);

  assert(Array.isArray(subs), 'Subtitle renditions must be an array');
  assert.strictEqual(subs.length, 3, `Expected 3 subtitle renditions, got ${subs.length}`);
  assert.strictEqual(subs[0].name, 'English', 'First subtitle should be English');
  assert.strictEqual(subs[0].language, 'eng', 'Language tag should be eng');
  assert.strictEqual(subs[0].isDefault, true, 'English should be default');
  assert.strictEqual(subs[0].url, 'https://megacloud.tv/embed-2/hls/subs/eng.m3u8', 'Relative URI must resolve against base URL');

  assert.strictEqual(subs[1].name, 'Spanish');
  assert.strictEqual(subs[1].language, 'spa');
  assert.strictEqual(subs[1].isDefault, false);

  console.log('✓ Test 1 Passed: Subtitle renditions extracted and resolved accurately.\n');

  // =========================================================================
  // Test 2: WebVTT to SubRip (.srt) Conversion Accuracy (SUBS-02)
  // =========================================================================
  console.log('--- Test 2: WebVTT to SRT Converter Precision (SUBS-02) ---');

  const sampleVtt = `WEBVTT
Kind: captions
Language: en

NOTE This is a comment that must be stripped

1
00:00:01.250 --> 00:00:04.500
<v Narrator>Arise, shadow soldiers!</v>

2
00:00:05.100 --> 00:00:08.350
<b>The Monarch of Shadows has awakened.</b>

00:09.000 --> 00:12.750
Short format timestamp cue without hours
`;

  const srt = convertVttToSrt(sampleVtt);
  assert(srt.length > 0, 'Converted SRT must not be empty');
  assert(!srt.includes('WEBVTT'), 'SRT must not contain WEBVTT header');
  assert(!srt.includes('NOTE'), 'SRT must not contain NOTE comment blocks');
  assert(!srt.includes('<v Narrator>'), 'SRT must strip voice tags');
  assert(!srt.includes('<b>'), 'SRT must strip HTML styling tags');

  // Check timestamp formatting (comma instead of period, padded hours)
  assert(srt.includes('00:00:01,250 --> 00:00:04,500'), 'Cues must use comma millisecond separator: 00:00:01,250');
  assert(srt.includes('00:00:05,100 --> 00:00:08,350'), 'Second cue timestamp must match');
  assert(srt.includes('00:00:09,000 --> 00:00:12,750'), 'Short format timestamp MM:SS.mmm must pad hour to 00:00:09,000');

  // Verify sequential cue numbering
  assert(srt.includes('1\n00:00:01,250'), 'Cue 1 number must precede timing');
  assert(srt.includes('2\n00:00:05,100'), 'Cue 2 number must precede timing');
  assert(srt.includes('3\n00:00:09,000'), 'Cue 3 number must be sequentially assigned');

  console.log('✓ Test 2 Passed: WebVTT converted to pure, standards-compliant SRT.\n');

  // =========================================================================
  // Test 3: Single-Video File Default Protection (SUBS-03)
  // =========================================================================
  console.log('--- Test 3: Single-Video Default Enforcement (SUBS-03) ---');

  assert.strictEqual(
    playerSettings.enableDownloadSubtitles,
    false,
    'playerSettings.enableDownloadSubtitles must be FALSE by default'
  );
  assert.strictEqual(
    playerSettings.enableDownloadMetadata,
    false,
    'playerSettings.enableDownloadMetadata must be FALSE by default'
  );

  downloadedFiles.length = 0;
  // Trigger standard video save
  triggerFileSave(new global.Blob(['video-payload'], { type: 'video/mp4' }), 'Solo Leveling - Episode 01 [1080p].mp4');

  assert.strictEqual(downloadedFiles.length, 1, `Exactly 1 file must be downloaded by default, got ${downloadedFiles.length}`);
  assert.strictEqual(downloadedFiles[0].filename, 'Solo Leveling - Episode 01 [1080p].mp4');
  assert(!downloadedFiles.some(f => f.filename.endsWith('.srt')), 'No .srt companion file downloaded by default');
  assert(!downloadedFiles.some(f => f.filename.endsWith('.json')), 'No .info.json companion file downloaded by default');

  console.log('✓ Test 3 Passed: Default single-video integrity strictly protected (0 companion files).\n');

  // =========================================================================
  // Test 4: Opt-In Subtitle Download (enableDownloadSubtitles = true)
  // =========================================================================
  console.log('--- Test 4: Opt-In Subtitle File Export ---');

  downloadedFiles.length = 0;
  const mockMeta = {
    animeTitle: 'Solo Leveling',
    episodeNum: '01',
    baseName: 'Solo Leveling - Episode 01 [1080p]',
    filename: 'Solo Leveling - Episode 01 [1080p].mp4'
  };

  const directVtt = `WEBVTT

1
00:00:01.000 --> 00:00:05.000
I alone level up.
`;

  const subRes = await downloadEpisodeSubtitleFile(mockMeta, directVtt, 'https://example.com/master.m3u8');
  assert.strictEqual(subRes.success, true, 'Subtitle export must succeed');
  assert.strictEqual(subRes.filename, 'Solo Leveling - Episode 01 [1080p].srt');
  assert(downloadedFiles.some(f => f.filename === 'Solo Leveling - Episode 01 [1080p].srt'), 'Subtitle file download triggered');

  console.log('✓ Test 4 Passed: Opt-in subtitle export produces cleanly named .srt file.\n');

  console.log('================================================================');
  console.log('ALL 4 PHASE 7 SUBTITLE EXTRACTION & SOFTSUBS TESTS PASSED! ✓');
  console.log('================================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
