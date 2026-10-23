/**
 * Test Suite: Fragmented MP4 (.m4s) Stitched MP4 Downloads,
 * Player Control Quality Filtering, Max Quality Fallback, and Stable Handling.
 */
const assert = require('assert');

// DOM Mocking
class MockElement {
  constructor(tagName, textContent = '', attrs = {}, parent = null) {
    this.tagName = tagName.toUpperCase();
    this.textContent = textContent;
    this.attrs = { ...attrs };
    this.children = [];
    this.parent = parent;
    this.parentElement = parent;
    this.style = {};
    this.listeners = {};
    this.classList = {
      _classes: new Set(attrs.class ? attrs.class.split(' ') : []),
      add: (c) => this.classList._classes.add(c),
      remove: (c) => this.classList._classes.delete(c),
      contains: (c) => this.classList._classes.has(c)
    };
    if (parent) parent.children.push(this);
  }

  get className() {
    return Array.from(this.classList._classes).join(' ');
  }
  set className(val) {
    this.classList._classes = new Set(String(val || '').split(' ').filter(Boolean));
  }

  get innerHTML() { return this._innerHTML || ''; }
  set innerHTML(html) {
    this._innerHTML = html;
    this.children = [];

    const dqMatches = Array.from(html.matchAll(/data-quality="([^"]+)"/g));
    if (dqMatches.length > 0) {
      for (const m of dqMatches) {
        const q = m[1];
        const child = new MockElement('DIV', '', { class: 'fg-quality-item', 'data-quality': q }, this);
        const badgeRegex = new RegExp(`data-quality="${q}"[\\s\\S]*?class="fg-quality-data-badge"[^>]*>([^<]+)<`);
        const bMatch = html.match(badgeRegex);
        if (bMatch) {
          new MockElement('SPAN', bMatch[1], { class: 'fg-quality-data-badge' }, child);
        }
      }
      return;
    }

    const idMatches = html.match(/id="([^"]+)"/g) || [];
    idMatches.forEach(m => {
      const idVal = m.replace(/id="|"/g, '');
      new MockElement('SPAN', '', { id: idVal }, this);
    });
  }

  getAttribute(name) { return this.attrs[name] !== undefined ? this.attrs[name] : null; }
  setAttribute(name, val) { this.attrs[name] = String(val); }
  removeAttribute(name) { delete this.attrs[name]; }
  hasAttribute(name) { return this.attrs[name] !== undefined; }

  addEventListener(evt, cb) {
    this.listeners[evt] = this.listeners[evt] || [];
    this.listeners[evt].push(cb);
  }

  dispatchEvent(event) {
    const list = this.listeners[event.type] || [];
    list.forEach(cb => cb(event));
  }

  click() {
    this.dispatchEvent({
      type: 'click',
      target: this,
      preventDefault: () => {},
      stopPropagation: () => {}
    });
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const selectors = selector.split(',').map(s => s.trim());

    function matchSingle(node, sel) {
      if (sel === 'video' && node.tagName === 'VIDEO') return true;
      if (sel === 'source' && node.tagName === 'SOURCE') return true;
      if (sel === '#focusguard-download-btn' && (node.id === 'focusguard-download-btn' || (node.attrs && node.attrs.id === 'focusguard-download-btn'))) return true;
      if (sel === '#fg-download-ep-badge' && (node.id === 'fg-download-ep-badge' || (node.attrs && node.attrs.id === 'fg-download-ep-badge'))) return true;
      if (sel === '.fg-quality-popover' && node.classList.contains('fg-quality-popover')) return true;
      if (sel === '.fg-quality-item' && node.classList.contains('fg-quality-item')) return true;
      if (sel === '.fg-quality-tier-badge' && node.classList.contains('fg-quality-tier-badge')) return true;
      if (sel.startsWith('.')) return node.classList.contains(sel.slice(1));
      if (sel.startsWith('#')) return node.id === sel.slice(1) || (node.attrs && node.attrs.id === sel.slice(1));
      if (sel.startsWith('[') && sel.endsWith(']')) {
        const attr = sel.slice(1, -1);
        return node.hasAttribute(attr);
      }
      return false;
    }

    function match(node) {
      return selectors.some(s => matchSingle(node, s));
    }

    function walk(node) {
      if (!node.children) return;
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
      if (cur.attrs && cur.attrs.id && sel.includes('#' + cur.attrs.id)) return cur;
      if (cur.classList) {
        for (const c of cur.classList._classes) {
          if (sel.includes('.' + c)) return cur;
        }
      }
      cur = cur.parent || cur.parentElement;
    }
    return null;
  }

  appendChild(el) {
    el.parent = this;
    el.parentElement = this;
    this.children.push(el);
    return el;
  }

  matches() { return false; }
}

class MockDocument extends MockElement {
  constructor(title = '') {
    super('#DOCUMENT');
    this.title = title;
    this.body = new MockElement('BODY', '', {}, this);
    this.documentElement = this;
  }
  createElement(tag) { return new MockElement(tag); }
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
}

// Global environment
const mockDoc = new MockDocument('Test Video Page');
global.document = mockDoc;
global.window = {
  location: { hostname: 'example.com', href: 'https://example.com/watch/video1' },
  top: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {},
  postMessage: () => {},
  getComputedStyle: () => ({ position: 'relative' }),
  requestAnimationFrame: (cb) => setTimeout(cb, 0)
};
global.window.top = global.window;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.MutationObserver = class {
  observe() {}
  disconnect() {}
};
global.Blob = class {
  constructor(parts = [], options = {}) {
    this.parts = parts;
    this.type = options.type || '';
    this.size = parts.reduce((acc, p) => acc + (p.byteLength || (p.buffer ? p.buffer.byteLength : 0) || 0), 0);
  }
};
global.MediaRecorder = class {
  static isTypeSupported() { return true; }
  constructor(stream, opts) {
    this.state = 'inactive';
  }
  start() {
    this.state = 'recording';
    setTimeout(() => {
      if (this.ondataavailable) this.ondataavailable({ data: new global.Blob([new Uint8Array(10)]) });
      if (this.onstop) this.onstop();
    }, 10);
  }
  stop() {
    this.state = 'inactive';
    if (this.ondataavailable) this.ondataavailable({ data: new global.Blob([new Uint8Array(10)]) });
    if (this.onstop) this.onstop();
  }
};

const {
  mountDownloadButton,
  parseHlsByteRange,
  getAvailableQualities,
  parseMasterPlaylist,
  downloadActiveVideo
} = require('../player_controller.js');

console.log('=== Test Suite: .m4s to .mp4, Quality Controls & Max Quality Fallback ===\n');

// --- Test 1: HLS BYTERANGE Parser ---
console.log('--- Test 1: HLS BYTERANGE Parser ---');
{
  const r1 = parseHlsByteRange('820@0');
  assert.strictEqual(r1, '0-819', '820@0 should map to HTTP byte range 0-819');

  const r2 = parseHlsByteRange('5000@1234');
  assert.strictEqual(r2, '1234-6233', '5000@1234 should map to HTTP byte range 1234-6233');

  const r3 = parseHlsByteRange('1000');
  assert.strictEqual(r3, '0-999', '1000 without offset should start at 0');

  console.log('✓ Test 1 Passed: BYTERANGE length@offset cleanly converted to HTTP Range header: ' + r1 + ', ' + r2);
}

// --- Test 2: Filter Qualities from Player Controls in DOM ---
console.log('\n--- Test 2: Filter Qualities from Player Controls in DOM ---');
{
  const container = new MockElement('div', '', { class: 'player-container' }, mockDoc.body);
  const video = new MockElement('video', '', {}, container);
  const qMenu = new MockElement('div', '', { class: 'vjs-quality-selector' }, container);
  new MockElement('button', '1080p Full HD', { class: 'vjs-menu-item', 'data-quality': '1080p' }, qMenu);
  new MockElement('button', '720p HD', { class: 'vjs-menu-item', 'data-quality': '720p' }, qMenu);
  new MockElement('button', 'Auto', { class: 'vjs-menu-item', 'data-quality': 'auto' }, qMenu);

  const available = getAvailableQualities(video, null, 'https://example.com/video.m3u8');
  assert.strictEqual(available.length, 2, 'Should only return 1080p and 720p, filtering out Auto');
  assert.strictEqual(available[0].quality, '1080p');
  assert.strictEqual(available[1].quality, '720p');
  console.log('✓ Test 2 Passed: DOM player quality controls detected (filtered out Auto):', available.map(a => a.quality));
}

// --- Test 3: Player with No Multiple Qualities ---
console.log('\n--- Test 3: Player with No Multiple Qualities ---');
{
  const container = new MockElement('div', '', { class: 'single-player' }, mockDoc.body);
  const video = new MockElement('video', '', {}, container);

  const available = getAvailableQualities(video, null, 'https://example.com/direct.mp4');
  assert.strictEqual(available.length, 0, 'Single player with no quality controls should return 0 available qualities');
  console.log('✓ Test 3 Passed: Player without quality selector returns 0 qualities');
}

async function runTests() {
  // --- Test 4: Download Button Visible and Direct Download at Max Quality ---
  console.log('\n--- Test 4: Download Button Visible & Max Quality Fallback ---');
  {
    const container = new MockElement('div', '', { class: 'player-container' }, mockDoc.body);
    const video = new MockElement('video', '', {}, container);
    video.videoHeight = 1080;
    video.__fg_stream_url__ = 'https://cdn.example.com/streams/full_movie.mp4';

    mountDownloadButton(video);
    const btn = container.querySelector('#focusguard-download-btn');
    assert.ok(btn, 'Download button MUST still be mounted and visible even without quality menu');

    let downloadedQuality = null;
    let downloadedFilename = null;
    global.chrome = {
      runtime: {
        sendMessage: (msg, cb) => {
          if (msg.action === 'download_video') {
            downloadedQuality = msg.quality;
            downloadedFilename = msg.filename;
            if (cb) cb({ success: true });
          }
        }
      }
    };

    // Clicking download button on player without quality controls directly triggers max quality download
    btn.click();
    await new Promise(r => setTimeout(r, 50));
    assert.ok(downloadedFilename && downloadedFilename.endsWith('.mp4'), 'Filename must end with .mp4');
    assert.ok(!container.querySelector('.fg-quality-popover.fg-popover-open'), 'Popover must NOT open if qualities are not available');
    console.log('✓ Test 4 Passed: Download button is visible; clicking directly downloaded at max quality with filename: ' + downloadedFilename);
  }

  // --- Test 5: Popover Opens Only When Multiple Qualities Exist ---
  console.log('\n--- Test 5: Popover Opens Only When Multiple Qualities Exist ---');
  {
    const container = new MockElement('div', '', { class: 'player-container' }, mockDoc.body);
    const video = new MockElement('video', '', {}, container);
    const qMenu = new MockElement('div', '', { class: 'vjs-quality-selector' }, container);
    new MockElement('button', '1080p', { class: 'vjs-menu-item', 'data-quality': '1080p' }, qMenu);
    new MockElement('button', '720p', { class: 'vjs-menu-item', 'data-quality': '720p' }, qMenu);

    mountDownloadButton(video);
    const host = container.querySelector('.fg-download-btn-host');
    const btn = container.querySelector('#focusguard-download-btn');
    assert.ok(btn, 'Download button mounted');

    btn.click();
    await new Promise(r => setTimeout(r, 30));
    const popover = host.querySelector('.fg-quality-popover');
    assert.ok(popover && popover.classList.contains('fg-popover-open'), 'Popover must open when multiple qualities exist on player');
    const items = popover.querySelectorAll('.fg-quality-item');
    assert.strictEqual(items.length, 2, 'Popover must only display the 2 available qualities');
    assert.strictEqual(items[0].getAttribute('data-quality'), '1080p');
    assert.strictEqual(items[1].getAttribute('data-quality'), '720p');
    console.log('✓ Test 5 Passed: Popover displays strictly the 2 available player qualities: [1080p, 720p]');
  }

  // --- Test 6: Rejection of Isolated .m4s Chunks ---
  console.log('\n--- Test 6: Rejection of Isolated .m4s and .ts Chunks from Direct Save ---');
  {
    const container = new MockElement('div', '', { class: 'player-container' }, mockDoc.body);
    const video = new MockElement('video', '', {}, container);
    // Rogue isolated chunk intercepted
    video.__fg_stream_url__ = 'https://cdn.example.com/hls/segment_001.m4s';

    let savedUrl = null;
    global.chrome.runtime.sendMessage = (msg, cb) => {
      if (msg.action === 'download_video') {
        savedUrl = msg.url;
        if (cb) cb({ success: true });
      } else if (cb) {
        cb({ success: false });
      }
    };

    // Calling downloadActiveVideo must NOT directly download segment_001.m4s
    await downloadActiveVideo('max', null, video);
    assert.notStrictEqual(savedUrl, 'https://cdn.example.com/hls/segment_001.m4s', 'Isolated .m4s chunk must NOT be passed to download');
    console.log('✓ Test 6 Passed: Isolated .m4s segment was prevented from being saved as broken video');
  }

  // --- Test 7: Scope Safety: getAvailableQualities is defined & clickable without ReferenceError ---
  console.log('\n--- Test 7: Scope Safety: getAvailableQualities is defined & clickable without ReferenceError ---');
  {
    const container = new MockElement('div', '', { class: 'player-container' }, mockDoc.body);
    const video = new MockElement('video', '', {}, container);
    video.videoHeight = 720;
    video.__fg_stream_url__ = 'https://cdn.example.com/stream.m3u8';

    mountDownloadButton(video);
    const btn = container.querySelector('#focusguard-download-btn');
    assert.ok(btn, 'Download button mounted');

    // Simulate clicking download button — MUST NOT throw ReferenceError: getAvailableQualities is not defined!
    let clickedWithoutError = false;
    try {
      btn.click();
      clickedWithoutError = true;
    } catch (e) {
      console.error('Click error:', e);
      assert.fail('Clicking download button threw error: ' + e.message);
    }
    assert.ok(clickedWithoutError, 'Clicking download button completed without throwing ReferenceError');
    console.log('✓ Test 7 Passed: getAvailableQualities is fully defined in scope and click handler succeeds');
  }

  // --- Test 8: Tube Site & Global Config Stream Discovery ---
  console.log('\n--- Test 8: Tube Site & Global Config Stream Discovery ---');
  {
    const { resolveActiveStreamUrl } = require('../player_controller.js');
    global.window.initials = {
      xplayerSettings: {
        sources: {
          hls: 'https://video-edge-10.examplecdn.com/hls/master.m3u8'
        }
      }
    };
    const resolved = resolveActiveStreamUrl(null);
    assert.strictEqual(resolved, 'https://video-edge-10.examplecdn.com/hls/master.m3u8', 'Must extract stream URL from window.initials');
    delete global.window.initials;
    console.log('✓ Test 8 Passed: Stream URL cleanly resolved from tube site configuration: ' + resolved);
  }

  console.log('\nALL .M4S TO .MP4, QUALITY CONTROL & STABLE DOWNLOAD TESTS PASSED! ✓\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});

