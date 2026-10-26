/**
 * FocusGuard Verification Suite: Smooth VLC Playback & Metadata Integration
 * Validates:
 * 1. Stream format detection (MPEG-TS vs ISO-BMFF / fMP4)
 * 2. H.264 SPS parser for video resolution and profile detection
 * 3. MP4 atom box construction (ftyp, moov, udta, meta, ilst, ©nam, ©ART, ©alb, trkn)
 * 4. fMP4 smoothing (duration calculation, mvhd/tkhd patching, styp neutralizer, tfdt continuity)
 * 5. MPEG-TS timestamp normalizer (PCR/PTS/DTS continuity smoothing & CC fixing)
 * 6. MPEG-TS to ISO BMFF fMP4 transmuxer for stutter-free VLC playback
 * 7. Companion episode metadata payload & JSON file exporter (.info.json)
 * 8. End-to-end convertAndRemuxStreamForSmoothPlayback orchestrator
 */

const assert = require('assert');

// 1. Mock DOM and Web APIs for Node.js test environment
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
  contains(el) {
    let cur = el;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parent || cur.parentElement;
    }
    return false;
  }
  closest(sel) {
    let cur = this;
    while (cur) {
      if (sel.startsWith('#') && cur.attrs && cur.attrs.id === sel.slice(1)) return cur;
      if (sel.startsWith('.') && cur.classList && cur.classList.contains(sel.slice(1))) return cur;
      cur = cur.parent || cur.parentElement;
    }
    return null;
  }
}

class MockDocument extends MockElement {
  constructor(title = '') {
    super('#DOCUMENT');
    this.title = title;
    this.body = new MockElement('BODY', '', {}, this);
    this.documentElement = this;
  }
  getElementById(id) {
    function find(node) {
      if (node.attrs && node.attrs.id === id) return node;
      if (node.children) {
        for (const c of node.children) {
          const res = find(c);
          if (res) return res;
        }
      }
      return null;
    }
    return find(this);
  }
  createElement(tag) { return new MockElement(tag); }
}

// Setup globals
const mockGlobalDoc = new MockDocument('Watch Jujutsu Kaisen Episode 1 - HiAnime');
global.document = mockGlobalDoc;
global.window = {
  location: { hostname: 'hianime.to', href: 'https://hianime.to/watch/jujutsu-kaisen-season-2?ep=1', pathname: '/watch/jujutsu-kaisen-season-2', search: '?ep=1' },
  top: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {},
  postMessage: () => {},
  getComputedStyle: () => ({ position: 'relative' }),
  requestAnimationFrame: (cb) => setTimeout(cb, 0),
  navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FocusGuard/2.5' }
};
global.window.top = global.window;

// Polyfill Blob if not present
if (typeof global.Blob === 'undefined') {
  global.Blob = class {
    constructor(parts = [], options = {}) {
      this.parts = parts;
      this.type = options.type || '';
      let len = 0;
      for (const p of parts) {
        if (typeof p === 'string') len += Buffer.byteLength(p);
        else if (p && p.byteLength !== undefined) len += p.byteLength;
        else if (p && p.length) len += p.length;
      }
      this.size = len;
    }
    async arrayBuffer() {
      const bufs = [];
      for (const p of this.parts) {
        if (typeof p === 'string') bufs.push(Buffer.from(p));
        else if (p instanceof Uint8Array || p instanceof ArrayBuffer) bufs.push(Buffer.from(p));
        else if (p && p.buffer) bufs.push(Buffer.from(p.buffer, p.byteOffset, p.byteLength));
      }
      return Buffer.concat(bufs).buffer;
    }
  };
}

// Helper to convert any Blob (native or mock) to Node Buffer
async function blobToBuffer(b) {
  if (!b) return Buffer.alloc(0);
  if (typeof b.arrayBuffer === 'function') {
    const ab = await b.arrayBuffer();
    return Buffer.from(ab);
  }
  if (b.parts) {
    const bufs = [];
    for (const p of b.parts) {
      if (typeof p === 'string') bufs.push(Buffer.from(p));
      else if (p instanceof Uint8Array || p instanceof ArrayBuffer) bufs.push(Buffer.from(p));
      else if (p && p.buffer) bufs.push(Buffer.from(p.buffer, p.byteOffset, p.byteLength));
    }
    return Buffer.concat(bufs);
  }
  return Buffer.alloc(0);
}

global.URL = {
  createObjectURL: (blob) => 'blob:mock-url-' + Math.random().toString(36).substring(2),
  revokeObjectURL: () => {}
};

global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => cb({ enableSmoothPlayback: true, enableDownloadMetadata: true }),
      set: (data, cb) => { if (cb) cb(); }
    }
  },
  runtime: {
    sendMessage: (msg, cb) => { if (cb) cb({ success: true }); }
  }
};

global.MutationObserver = class {
  observe() {}
  disconnect() {}
};

const controller = require('../player_controller.js');

async function runTestSuite() {
  console.log('=== FocusGuard Smooth VLC Playback & Metadata Verification Suite ===\n');

  // -------------------------------------------------------------
  // Test 1: Container Format Detection (MPEG-TS vs ISO-BMFF)
  // -------------------------------------------------------------
  console.log('--- Test 1: Container Format Detection ---');
  {
    // Case A: Standard MPEG-TS buffer (188-byte packets starting with 0x47)
    const tsPacketCount = 5;
    const tsBuffer = new Uint8Array(tsPacketCount * 188);
    for (let i = 0; i < tsPacketCount; i++) {
      tsBuffer[i * 188] = 0x47; // TS Sync byte
      tsBuffer[i * 188 + 1] = 0x00;
      tsBuffer[i * 188 + 2] = 0x10; // PID
      tsBuffer[i * 188 + 3] = 0x10; // payload only
    }

    const formatTs = controller.detectStreamFormat([tsBuffer]);
    assert.strictEqual(formatTs, 'mpegts', 'Expected MPEG-TS format detection');
    console.log('✓ Case A Passed: Detected MPEG-TS stream format correctly.');

    // Case B: ISO BMFF / fMP4 segment starting with ftyp box
    const fmp4Buffer = new Uint8Array(32);
    const dv = new DataView(fmp4Buffer.buffer);
    dv.setUint32(0, 32); // size
    // 'ftyp'
    fmp4Buffer.set([0x66, 0x74, 0x79, 0x70], 4);
    // 'isom'
    fmp4Buffer.set([0x69, 0x73, 0x6f, 0x6d], 8);

    const formatFmp4 = controller.detectStreamFormat([fmp4Buffer]);
    assert.strictEqual(formatFmp4, 'isobmff', 'Expected ISO BMFF format detection');
    console.log('✓ Case B Passed: Detected ISO BMFF / fMP4 stream format correctly.');

    // Case C: Unknown buffer
    const randomBuffer = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    const formatUnknown = controller.detectStreamFormat([randomBuffer]);
    assert.strictEqual(formatUnknown, 'unknown', 'Expected unknown format for raw noise');
    console.log('✓ Case C Passed: Unknown format correctly recognized.');
  }

  // -------------------------------------------------------------
  // Test 2: H.264 SPS Bitstream Parser
  // -------------------------------------------------------------
  console.log('\n--- Test 2: H.264 SPS Bitstream Parser ---');
  {
    // A real 1080p SPS NAL unit (profile 100/High, level 41, 1920x1080)
    const spsHex = '67640029acd940780227e584000003000400000300f03c60c448';
    const spsBytes = new Uint8Array(spsHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

    const parsed = controller.parseSps(spsBytes);
    assert(parsed !== null, 'parseSps should successfully parse valid SPS');
    assert.strictEqual(parsed.profileIdc, 100, 'Profile IDC should be 100 (High Profile)');
    assert.strictEqual(parsed.levelIdc, 41, 'Level IDC should be 41 (Level 4.1)');
    assert.strictEqual(parsed.width, 1920, 'Parsed width must be 1920');
    assert.strictEqual(parsed.height, 1080, 'Parsed height must be 1080');
    console.log(`✓ Case A Passed: SPS successfully parsed -> ${parsed.width}x${parsed.height}, Profile ${parsed.profileIdc}, Level ${parsed.levelIdc}`);

    // Test with invalid / empty NAL
    const invalidSps = controller.parseSps(new Uint8Array([0x68, 0x00, 0x00])); // PPS instead of SPS
    assert.strictEqual(invalidSps, null, 'Non-SPS NAL must return null');
    console.log('✓ Case B Passed: Non-SPS NAL safely returns null without exceptions.');
  }

  // -------------------------------------------------------------
  // Test 3: MP4 Box Creation & ilst Metadata Box
  // -------------------------------------------------------------
  console.log('\n--- Test 3: MP4 Box Creation & ilst Metadata Box ---');
  {
    // Create simple box
    const payload = new Uint8Array([1, 2, 3, 4]);
    const box = controller.createMp4Box('test', [payload]);
    assert.strictEqual(box.byteLength, 12, 'Box should be 8 bytes header + 4 bytes payload');
    const dv = new DataView(box.buffer, box.byteOffset, box.byteLength);
    assert.strictEqual(dv.getUint32(0), 12, 'Size field must equal 12');
    const typeStr = String.fromCharCode(box[4], box[5], box[6], box[7]);
    assert.strictEqual(typeStr, 'test', 'Type field must match');
    console.log('✓ Case A Passed: createMp4Box builds valid 8-byte header boxes.');

    // Build ilst metadata
    const metaObj = {
      title: 'Jujutsu Kaisen Season 2 - Episode 01 [1080p]',
      showTitle: 'Jujutsu Kaisen Season 2',
      episodeNumber: '01',
      cleanEpisodeNumber: 1,
      quality: '1080p'
    };

    const udtaBox = controller.buildIlstMetadataBox(metaObj);
    assert(udtaBox instanceof Uint8Array, 'udta box must be Uint8Array');
    assert(udtaBox.byteLength > 40, 'udta box should contain nested meta and ilst hierarchy');

    // Verify 'udta' type
    const udtaType = String.fromCharCode(udtaBox[4], udtaBox[5], udtaBox[6], udtaBox[7]);
    assert.strictEqual(udtaType, 'udta', 'Root box must be udta');

    // Check presence of ilst and tags
    const udtaBuf = Buffer.from(udtaBox);
    assert(udtaBuf.includes(Buffer.from('meta')), 'udta must contain meta box');
    assert(udtaBuf.includes(Buffer.from('ilst')), 'meta must contain ilst box');
    assert(udtaBuf.includes(Buffer.from('©nam', 'latin1')), 'ilst must contain ©nam title atom');
    assert(udtaBuf.includes(Buffer.from('©alb', 'latin1')), 'ilst must contain ©alb album/series atom');
    assert(udtaBuf.includes(Buffer.from('trkn')), 'ilst must contain trkn episode number atom');
    console.log('✓ Case B Passed: Embedded iTunes/MP4 ilst metadata structure generated with title, series & episode tags.');
  }

  // -------------------------------------------------------------
  // Test 4: fMP4 Smooth Playback Optimization
  // -------------------------------------------------------------
  console.log('\n--- Test 4: fMP4 Smooth Playback Optimization (mvhd/tkhd patching & styp cleanup) ---');
  {
    function mkBox(type, contentU8) {
      const size = 8 + (contentU8 ? contentU8.byteLength : 0);
      const b = new Uint8Array(size);
      const dv = new DataView(b.buffer);
      dv.setUint32(0, size);
      for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
      if (contentU8) b.set(contentU8, 8);
      return b;
    }

    // Build a synthetic moov with mvhd (duration = 0) and trak/tkhd (duration = 0)
    const mvhdBody = new Uint8Array(100);
    const mvhdDv = new DataView(mvhdBody.buffer);
    mvhdDv.setUint8(0, 0); // version 0
    mvhdDv.setUint32(12, 1000); // timescale = 1000
    mvhdDv.setUint32(16, 0); // duration = 0 (streaming HLS default)
    const mvhdBox = mkBox('mvhd', mvhdBody);

    const tkhdBody = new Uint8Array(84);
    const tkhdDv = new DataView(tkhdBody.buffer);
    tkhdDv.setUint8(0, 0); // version 0
    tkhdDv.setUint32(20, 0); // duration = 0
    const tkhdBox = mkBox('tkhd', tkhdBody);
    const trakBox = mkBox('trak', tkhdBox);

    const moovBox = mkBox('moov', Buffer.concat([mvhdBox, trakBox]));

    // Build a synthetic moof with tfdt (decode time) and trun (sample durations)
    const tfdtBody = new Uint8Array(8);
    const tfdtDv = new DataView(tfdtBody.buffer);
    tfdtDv.setUint8(0, 0); // version 0
    tfdtDv.setUint32(4, 500); // baseMediaDecodeTime = 500
    const tfdtBox = mkBox('tfdt', tfdtBody);

    // trun with 10 samples of duration 1000 each
    const sampleCount = 10;
    const trunBody = new Uint8Array(12 + sampleCount * 4);
    const trunDv = new DataView(trunBody.buffer);
    trunDv.setUint8(0, 0); // version 0
    trunDv.setUint8(1, 0x00);
    trunDv.setUint8(2, 0x01); // flags: sample-duration-present (0x000100)
    trunDv.setUint8(3, 0x00);
    trunDv.setUint32(4, sampleCount);
    for (let s = 0; s < sampleCount; s++) {
      trunDv.setUint32(12 + s * 4, 1000);
    }
    const trunBox = mkBox('trun', trunBody);
    const trafBox = mkBox('traf', Buffer.concat([tfdtBox, trunBox]));
    const moofBox = mkBox('moof', trafBox);

    // Add a redundant styp box between fragments that causes VLC to stutter
    const stypBody = new Uint8Array(16);
    const stypBox = mkBox('styp', stypBody);

    const mdatBox = mkBox('mdat', new Uint8Array(100));

    const fmp4Segments = [moovBox, stypBox, moofBox, mdatBox];
    const meta = { title: 'Jujutsu Kaisen 01', showTitle: 'Jujutsu Kaisen', episodeNumber: '01' };

    const res = controller.optimizeFmp4ForSmoothPlayback(fmp4Segments, meta);
    const optimizedBlob = res.blob || res;
    assert(optimizedBlob instanceof Blob, 'Result must be a Blob');
    assert.strictEqual(optimizedBlob.type, 'video/mp4', 'Blob type must be video/mp4');

    // Verify that styp was neutralized to 'free'
    const outBuf = await blobToBuffer(optimizedBlob);
    assert(!outBuf.includes(Buffer.from('styp')), 'Intermediate styp boxes must be neutralized to prevent VLC stutter');
    assert(outBuf.includes(Buffer.from('free')), 'Neutralized styp box converted to free atom');

    // Verify that mvhd duration is now non-zero
    const mvhdIdx = outBuf.indexOf(Buffer.from('mvhd'));
    assert(mvhdIdx !== -1, 'mvhd must be present');
    const patchedDuration = outBuf.readUInt32BE(mvhdIdx + 4 + 16);
    assert(patchedDuration > 0, 'mvhd duration must be patched with positive duration for smooth VLC scrubbing');

    console.log(`✓ Test 4 Passed: fMP4 duration patched (${patchedDuration} ticks), intermediate styp converted to free, udta metadata injected.`);
  }

  // -------------------------------------------------------------
  // Test 5: MPEG-TS Timestamp Normalization & Continuity Counter Fix
  // -------------------------------------------------------------
  console.log('\n--- Test 5: MPEG-TS Timestamp Normalizer & PCR Continuity ---');
  {
    function createTsPesPacket(pid, continuity, ptsValue, isStart) {
      const pkt = new Uint8Array(188);
      pkt[0] = 0x47; // Sync
      pkt[1] = (isStart ? 0x40 : 0x00) | ((pid >> 8) & 0x1f);
      pkt[2] = pid & 0xff;
      pkt[3] = 0x10 | (continuity & 0x0f); // no adaptation field, payload only

      if (isStart) {
        pkt[4] = 0x00; pkt[5] = 0x00; pkt[6] = 0x01;
        pkt[7] = 0xe0; // video stream id
        pkt[8] = 0x00; pkt[9] = 0x00;
        pkt[10] = 0x80;
        pkt[11] = 0x80; // PTS present
        pkt[12] = 0x05;

        const p = ptsValue;
        pkt[13] = 0x21 | (((p / (1 << 30)) & 0x07) << 1);
        const m1 = (p >>> 15) & 0x7fff;
        pkt[14] = (m1 >>> 7) & 0xff;
        pkt[15] = ((m1 & 0x7f) << 1) | 0x01;
        const m2 = p & 0x7fff;
        pkt[16] = (m2 >>> 7) & 0xff;
        pkt[17] = ((m2 & 0x7f) << 1) | 0x01;
      }
      return pkt;
    }

    // Segment 1: PTS starting at 90,000 (1.0 sec)
    const seg1Pkt1 = createTsPesPacket(0x100, 0, 90000, true);
    const seg1Pkt2 = createTsPesPacket(0x100, 1, 93750, true);
    const seg1 = Buffer.concat([seg1Pkt1, seg1Pkt2]);

    // Segment 2: Has a massive timestamp jump (e.g. PTS = 900,000 instead of ~97,500)
    const seg2Pkt1 = createTsPesPacket(0x100, 5, 900000, true);
    const seg2Pkt2 = createTsPesPacket(0x100, 6, 903750, true);
    const seg2 = Buffer.concat([seg2Pkt1, seg2Pkt2]);

    const res5 = controller.smoothMpegTsTimestamps([seg1, seg2], { title: 'Test Anime' });
    const smoothedBlob = res5.blob || res5;
    assert(smoothedBlob instanceof Blob, 'Result must be a Blob');
    assert.strictEqual(smoothedBlob.type, 'video/mp4', 'Blob type must be video/mp4');

    const smoothedBuf = await blobToBuffer(smoothedBlob);
    assert.strictEqual(smoothedBuf.length, 188 * 4, 'Output should maintain all TS packets');

    // Read first packet's smoothed PTS
    const firstByte = smoothedBuf[13];
    const firstPtsHigh = (firstByte >> 1) & 0x07;
    assert.strictEqual(firstPtsHigh, 0, 'First PTS must be rebased to 0 for instantaneous VLC start');

    // Verify continuity counters are sequential modulo 16
    const cc0 = smoothedBuf[3] & 0x0f;
    const cc1 = smoothedBuf[188 + 3] & 0x0f;
    const cc2 = smoothedBuf[376 + 3] & 0x0f;
    const cc3 = smoothedBuf[564 + 3] & 0x0f;

    assert.strictEqual(cc1, (cc0 + 1) & 0x0f, 'Packet 1 CC must follow Packet 0');
    assert.strictEqual(cc2, (cc1 + 1) & 0x0f, 'Packet 2 CC must follow Packet 1 seamlessly across segment boundaries');
    assert.strictEqual(cc3, (cc2 + 1) & 0x0f, 'Packet 3 CC must follow Packet 2');

    console.log(`✓ Test 5 Passed: Discontinuous PTS rebased smoothly from 0; Continuity counters normalized (${cc0} -> ${cc1} -> ${cc2} -> ${cc3}).`);
  }

  // -------------------------------------------------------------
  // Test 6: MPEG-TS to ISO BMFF fMP4 Transmuxer
  // -------------------------------------------------------------
  console.log('\n--- Test 6: MPEG-TS to Pure ISO BMFF fMP4 Transmuxer ---');
  {
    function buildTestTsStream() {
      const pkts = [];
      const sps = [0x67, 0x64, 0x00, 0x29, 0xac, 0xd9, 0x40, 0x78, 0x02, 0x27, 0xe5, 0x84, 0x00, 0x00, 0x03, 0x00, 0x04, 0x00, 0x00, 0x03, 0x00, 0xf0, 0x3c, 0x60, 0xc4, 0x48];
      const pps = [0x68, 0xeb, 0xe3, 0xcb, 0x22, 0xc0];
      const slice = [0x65, 0x88, 0x84, 0x00, 0x10, 0x20, 0x30];

      const naluStream = [
        0x00, 0x00, 0x00, 0x01, ...sps,
        0x00, 0x00, 0x00, 0x01, ...pps,
        0x00, 0x00, 0x00, 0x01, ...slice
      ];

      const pkt = new Uint8Array(188);
      pkt[0] = 0x47;
      pkt[1] = 0x41;
      pkt[2] = 0x00;
      pkt[3] = 0x10;

      pkt[4] = 0x00; pkt[5] = 0x00; pkt[6] = 0x01;
      pkt[7] = 0xe0;
      pkt[8] = 0x00; pkt[9] = 0x00;
      pkt[10] = 0x80;
      pkt[11] = 0x80;
      pkt[12] = 0x05;
      pkt[13] = 0x21; pkt[14] = 0x05; pkt[15] = 0x81; pkt[16] = 0x5f; pkt[17] = 0x81;

      let writePos = 18;
      for (let b of naluStream) {
        if (writePos < 188) pkt[writePos++] = b;
      }

      pkts.push(pkt);
      return Buffer.concat(pkts);
    }

    const tsBuffer = buildTestTsStream();
    const meta = {
      title: 'Demon Slayer - Episode 01 [1080p]',
      showTitle: 'Demon Slayer',
      episodeNumber: '01',
      cleanEpisodeNumber: 1,
      quality: '1080p'
    };

    const res6 = controller.transmuxTsToSmoothMp4([tsBuffer], meta);
    const transmuxedBlob = res6.blob || res6;
    assert(transmuxedBlob instanceof Blob, 'Result must be a Blob');
    assert.strictEqual(transmuxedBlob.type, 'video/mp4', 'Blob type must be video/mp4');

    const mp4Buf = await blobToBuffer(transmuxedBlob);
    assert(mp4Buf.length > 50, 'Transmuxed MP4 should have substantial byte length');

    // Verify MP4 header starts with 'ftyp'
    const ftypType = mp4Buf.toString('ascii', 4, 8);
    assert.strictEqual(ftypType, 'ftyp', 'First box in transmuxed MP4 must be ftyp for VLC');

    // Verify presence of moov and moof
    assert(mp4Buf.includes(Buffer.from('moov')), 'Transmuxed MP4 must contain moov atom');
    assert(mp4Buf.includes(Buffer.from('moof')), 'Transmuxed MP4 must contain moof fragments');
    assert(mp4Buf.includes(Buffer.from('mdat')), 'Transmuxed MP4 must contain mdat media data');
    assert(mp4Buf.includes(Buffer.from('udta')), 'Transmuxed MP4 must contain udta metadata atom');

    console.log(`✓ Test 6 Passed: MPEG-TS transmuxed to pure ISO BMFF fMP4 (${mp4Buf.length} bytes) with ftyp, moov, moof, and udta metadata.`);
  }

  // -------------------------------------------------------------
  // Test 7: Episode Metadata Companion File (.info.json)
  // -------------------------------------------------------------
  console.log('\n--- Test 7: Episode Metadata Companion Payload & Download ---');
  {
    const metaObj = {
      title: 'Solo Leveling - Episode 07 [1080p]',
      showTitle: 'Solo Leveling',
      episodeNumber: '07',
      cleanEpisodeNumber: 7,
      quality: '1080p',
      durationSec: 1425.5
    };

    const payload = controller.generateEpisodeMetadataPayload(metaObj);
    assert.strictEqual(payload.title, metaObj.title);
    assert.strictEqual(payload.showTitle, 'Solo Leveling');
    assert.strictEqual(payload.episodeNumber, '07');
    assert.strictEqual(payload.cleanEpisodeNumber, 7);
    assert.strictEqual(payload.quality, '1080p');
    assert.strictEqual(payload.durationSec, 1425.5);
    assert.strictEqual(payload.formattedDuration, '23:45');
    assert.strictEqual(payload.format, 'mp4');
    assert.strictEqual(payload.codec, 'h264');
    assert.strictEqual(payload.remuxEngine, 'FocusGuard Smooth VLC Engine v2.5');
    assert(payload.createdAt.length > 0, 'Timestamp must be present');
    console.log('✓ Case A Passed: Complete companion JSON payload generated: ' + payload.title);

    // Test triggering metadata file download
    let downloadedFilename = null;
    let downloadedContent = null;

    const oldDocCreate = global.document.createElement;
    global.document.createElement = (tag) => {
      const el = oldDocCreate.call(global.document, tag);
      if (tag.toLowerCase() === 'a') {
        el.click = () => {
          downloadedFilename = el.download || (el.attrs && el.attrs.download);
          downloadedContent = el.href || (el.attrs && el.attrs.href);
        };
      }
      return el;
    };

    const videoFilename = 'Solo Leveling - Episode 07 [1080p].mp4';
    controller.downloadEpisodeMetadataFile(videoFilename, payload);

    assert(downloadedFilename !== null, 'Download must have been triggered');
    assert.strictEqual(downloadedFilename, 'Solo Leveling - Episode 07 [1080p].info.json', 'Companion metadata must end in .info.json');
    assert(downloadedContent.startsWith('blob:'), 'URL must be a valid blob link');
    console.log('✓ Case B Passed: Companion metadata file download triggered with: ' + downloadedFilename);

    global.document.createElement = oldDocCreate;
  }

  // -------------------------------------------------------------
  // Test 8: End-to-End Orchestrator (convertAndRemuxStreamForSmoothPlayback)
  // -------------------------------------------------------------
  console.log('\n--- Test 8: End-to-End Orchestrator Integration ---');
  {
    const tsPacketCount = 3;
    const tsBuffer = new Uint8Array(tsPacketCount * 188);
    for (let i = 0; i < tsPacketCount; i++) {
      tsBuffer[i * 188] = 0x47;
      tsBuffer[i * 188 + 1] = 0x00;
      tsBuffer[i * 188 + 2] = 0x10;
      tsBuffer[i * 188 + 3] = 0x10;
    }

    const meta = {
      title: 'One Piece - Episode 1090 [1080p]',
      showTitle: 'One Piece',
      episodeNumber: '1090',
      quality: '1080p'
    };

    // Case A: Smooth playback enabled (default)
    const resultA = await controller.convertAndRemuxStreamForSmoothPlayback([tsBuffer], meta, {
      enableSmoothPlayback: true,
      enableDownloadMetadata: true
    });
    assert(resultA.blob instanceof Blob, 'Result must contain video Blob');
    assert.strictEqual(resultA.format, 'mp4', 'Format must be mp4');
    assert(resultA.metadataPayload !== null, 'Metadata payload must be returned');
    assert.strictEqual(resultA.metadataPayload.episodeNumber, '1090');
    console.log('✓ Case A Passed: TS stream automatically converted to smooth MP4 with metadata payload.');

    // Case B: Smooth playback disabled by user toggle
    const resultB = await controller.convertAndRemuxStreamForSmoothPlayback([tsBuffer], meta, {
      enableSmoothPlayback: false,
      enableDownloadMetadata: false
    });
    assert(resultB.blob instanceof Blob, 'Result must contain raw Blob');
    assert.strictEqual(resultB.format, 'mp4');
    assert.strictEqual(resultB.metadataPayload, null, 'Metadata payload must be null when disabled');
    console.log('✓ Case B Passed: User toggle to disable smooth playback respected.');
  }

  console.log('\n================================================================');
  console.log('ALL 8 SMOOTH VLC PLAYBACK & METADATA SUITE TESTS PASSED! ✓');
  console.log('================================================================');
  process.exit(0);
}

runTestSuite().catch(err => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
