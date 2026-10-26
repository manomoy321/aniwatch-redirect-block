/**
 * FocusGuard Automated Verification Suite: Phase 8 - Batch & Whole-Season Downloader Engine
 * Validates:
 * 1. Episode drawer scraping across multiple site DOM variations (Aniwatch, HiAnime).
 * 2. Episode range filtering and boundary clamping.
 * 3. Batch job payload generation with single-video file enforcement (no .json companion files).
 * 4. Background service worker queue_batch_downloads handler and FIFO queueing.
 * 5. Concurrency limiter under batch load (max 2 active downloads, remaining queued).
 * 6. Batch control actions (pause_all_downloads, resume_all_downloads, cancel_all_downloads).
 * 7. Batch button mounting and interactive modal range selection.
 */

const assert = require('assert');

// 1. Setup Mock DOM & Environment
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
    this.value = attrs.value || '';
    this.checked = attrs.checked !== undefined ? Boolean(attrs.checked) : false;
    if (parent && parent.children) parent.children.push(this);
  }
  get className() { return this.attrs.class || ''; }
  set className(val) {
    this.attrs.class = String(val);
    this.classList = new MockClassList(String(val));
  }
  get innerHTML() { return this._innerHTML || ''; }
  set innerHTML(html) {
    this._innerHTML = String(html);
    const idMatches = html.match(/id="([^"]+)"/g) || [];
    idMatches.forEach(m => {
      const idVal = m.replace(/id="|"/g, '');
      const clsMatch = html.match(new RegExp(`class="([^"]+)"[^>]*id="${idVal}"`)) || html.match(new RegExp(`id="${idVal}"[^>]*class="([^"]+)"`));
      const clsVal = clsMatch ? clsMatch[1] : '';
      const textMatch = html.match(new RegExp(`id="${idVal}"[^>]*>([^<]+)<`));
      const textVal = textMatch ? textMatch[1] : '';
      new MockElement('SPAN', textVal, { id: idVal, class: clsVal }, this);
    });

    const clsMatches = html.match(/class="([^"]+)"/g) || [];
    clsMatches.forEach(m => {
      const clsVal = m.replace(/class="|"/g, '');
      const textMatch = html.match(new RegExp(`class="${clsVal}"[^>]*>([^<]+)<`));
      const textVal = textMatch ? textMatch[1] : '';
      new MockElement('DIV', textVal, { class: clsVal }, this);
    });
  }
  getAttribute(name) { return this.attrs[name] !== undefined ? this.attrs[name] : null; }
  setAttribute(name, val) { this.attrs[name] = String(val); }
  removeAttribute(name) { delete this.attrs[name]; }
  hasAttribute(name) { return this.attrs[name] !== undefined; }
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
  removeEventListener(type, fn) {
    if (this.listeners.has(type)) {
      this.listeners.set(type, this.listeners.get(type).filter(f => f !== fn));
    }
  }
  dispatchEvent(event) {
    const list = this.listeners.get(event.type) || [];
    list.forEach(fn => fn(event));
    return true;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  querySelectorAll(selector) {
    const results = [];
    const parts = selector.split(',').map(s => s.trim()).filter(Boolean);

    function matchSingle(node, sel) {
      if (!node) return false;
      if (sel === 'video' && node.tagName === 'VIDEO') return true;
      if (sel.startsWith('#') && node.attrs && node.attrs.id === sel.slice(1)) return true;
      if (sel.startsWith('.') && node.classList && node.classList.contains(sel.slice(1))) return true;
      if (sel.includes('.ssl-item') && node.classList && node.classList.contains('ssl-item')) return true;
      if (sel.includes('.ep-item') && node.classList && node.classList.contains('ep-item')) return true;
      if (sel.includes('[data-number]') && node.hasAttribute('data-number')) return true;
      if (sel.includes('#episodes-title') && node.attrs && node.attrs.id === 'episodes-title') return true;
      if (sel.includes('.block_area-header') && node.classList && node.classList.contains('block_area-header')) return true;
      return false;
    }

    function match(node) {
      return parts.some(p => matchSingle(node, p));
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
  closest(selector) {
    let curr = this.parentElement;
    while (curr) {
      if (selector.startsWith('#') && curr.attrs && curr.attrs.id === selector.slice(1)) return curr;
      if (selector.startsWith('.') && curr.classList && curr.classList.contains(selector.slice(1))) return curr;
      curr = curr.parentElement;
    }
    return null;
  }
  remove() {
    if (this.parent && this.parent.children) {
      this.parent.children = this.parent.children.filter(c => c !== this);
    }
  }
}

class MockDocument extends MockElement {
  constructor() {
    super('#DOCUMENT');
    this.body = new MockElement('BODY', '', {}, this);
    this.documentElement = this;
    this.head = new MockElement('HEAD', '', {}, this);
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
  createElement(tag) {
    return new MockElement(tag);
  }
}

const mockDoc = new MockDocument();
global.document = mockDoc;
global.window = {
  location: { hostname: 'aniwatch.to', href: 'https://aniwatch.to/watch/solo-leveling?ep=1', pathname: '/watch/solo-leveling', search: '?ep=1' },
  top: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {},
  postMessage: () => {},
  requestAnimationFrame: (cb) => setTimeout(cb, 0),
  MutationObserver: class { observe() {} disconnect() {} }
};
global.window.top = global.window;
global.MutationObserver = global.window.MutationObserver;

let mockStorage = {};
let mockBrowserDownloads = new Map();
let nextDownloadId = 7001;
let sentMessages = [];

const mockChrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        const res = {};
        const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        keyList.forEach(k => {
          if (mockStorage[k] !== undefined) res[k] = mockStorage[k];
        });
        if (cb) cb(res);
        return Promise.resolve(res);
      },
      set: (items, cb) => {
        Object.assign(mockStorage, items);
        if (cb) cb();
        return Promise.resolve();
      }
    },
    onChanged: { addListener: () => {} }
  },
  downloads: {
    download: (opts, cb) => {
      const id = nextDownloadId++;
      mockBrowserDownloads.set(id, {
        id,
        url: opts.url,
        filename: opts.filename,
        state: 'in_progress',
        bytesReceived: 0,
        totalBytes: 104857600,
        paused: false
      });
      if (cb) cb(id);
      return Promise.resolve(id);
    },
    search: (query, cb) => {
      if (cb) cb([]);
      return Promise.resolve([]);
    },
    pause: (id, cb) => {
      if (mockBrowserDownloads.has(id)) mockBrowserDownloads.get(id).paused = true;
      if (cb) cb();
      return Promise.resolve();
    },
    resume: (id, cb) => {
      if (mockBrowserDownloads.has(id)) mockBrowserDownloads.get(id).paused = false;
      if (cb) cb();
      return Promise.resolve();
    },
    cancel: (id, cb) => {
      if (mockBrowserDownloads.has(id)) mockBrowserDownloads.get(id).state = 'interrupted';
      if (cb) cb();
      return Promise.resolve();
    },
    onChanged: { addListener: () => {} }
  },
  runtime: {
    lastError: null,
    onMessage: { addListener: () => {} },
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    sendMessage: (msg, cb) => {
      sentMessages.push(msg);
      if (cb) cb({ success: true });
      return Promise.resolve({ success: true });
    }
  },
  tabs: {
    query: () => Promise.resolve([]),
    get: () => Promise.resolve({}),
    update: () => Promise.resolve({}),
    remove: () => Promise.resolve(),
    sendMessage: () => Promise.resolve(),
    onCreated: { addListener: () => {} },
    onUpdated: { addListener: () => {} },
    onRemoved: { addListener: () => {} },
    onActivated: { addListener: () => {} }
  },
  action: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {}
  },
  webNavigation: {
    onBeforeNavigate: { addListener: () => {} }
  },
  declarativeNetRequest: {
    updateDynamicRules: () => Promise.resolve(),
    getDynamicRules: () => Promise.resolve([])
  }
};
global.chrome = mockChrome;

const controller = require('../player_controller.js');
const bg = require('../background.js');

console.log('=== FocusGuard Phase 8: Batch & Whole-Season Downloader Verification Suite ===\n');

async function runTestSuite() {
  // ---------------------------------------------------------------------------
  // Test 1: Episode Drawer Scraping Across DOM Formats
  // ---------------------------------------------------------------------------
  console.log('--- Test 1: Episode Drawer Scraping (Aniwatch / HiAnime DOM) ---');
  {
    const testDoc = new MockDocument();
    const drawerContainer = new MockElement('DIV', '', { class: 'episodes-list' }, testDoc.body);

    // Simulate 5 episodes with Aniwatch markup
    for (let i = 1; i <= 5; i++) {
      new MockElement('A', `Episode ${i}`, {
        class: i === 1 ? 'ssl-item ep-item active' : 'ssl-item ep-item',
        'data-number': String(i),
        title: `Episode ${i}: Title ${i}`,
        href: `/watch/solo-leveling?ep=${i}`
      }, drawerContainer);
    }

    const scraped = controller.scrapeEpisodeDrawer(testDoc);
    assert.strictEqual(scraped.length, 5, 'Must scrape all 5 episodes');
    assert.strictEqual(scraped[0].episodeNum, '1', 'First episode is Ep 1');
    assert.strictEqual(scraped[0].active, true, 'Ep 1 is active');
    assert.strictEqual(scraped[4].episodeNum, '5', 'Last episode is Ep 5');
    assert.strictEqual(scraped[4].href, '/watch/solo-leveling?ep=5', 'Href accurately extracted');

    console.log('✓ Test 1 Passed: Scraped 5 episodes with accurate numbers, titles, and hrefs.');
  }

  // ---------------------------------------------------------------------------
  // Test 2: Episode Range Filtering & Boundary Clamping
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 2: Episode Range Filtering & Boundary Clamping ---');
  {
    const sampleEpisodes = [];
    for (let i = 1; i <= 24; i++) {
      sampleEpisodes.push({ episodeNum: String(i), title: `Episode ${i}`, href: `/watch/anime?ep=${i}` });
    }

    // Case A: Full range
    const allEps = controller.filterEpisodeRange(sampleEpisodes, null, null);
    assert.strictEqual(allEps.length, 24, 'All 24 episodes returned when range is unbounded');

    // Case B: Slice Ep 5 to Ep 12
    const sliceEps = controller.filterEpisodeRange(sampleEpisodes, 5, 12);
    assert.strictEqual(sliceEps.length, 8, '8 episodes returned between 5 and 12');
    assert.strictEqual(sliceEps[0].episodeNum, '5', 'First episode in slice is 5');
    assert.strictEqual(sliceEps[sliceEps.length - 1].episodeNum, '12', 'Last episode in slice is 12');

    // Case C: Clamped out-of-bounds start/end
    const highSlice = controller.filterEpisodeRange(sampleEpisodes, 20, 50);
    assert.strictEqual(highSlice.length, 5, 'Returns episodes 20-24 safely');

    console.log('✓ Test 2 Passed: Episode range filtering respects boundaries and clamps cleanly.');
  }

  // ---------------------------------------------------------------------------
  // Test 3: Batch Queue Payload Generation & Single-Video Enforcement
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 3: Batch Payload Generation & Single-Video Enforcement ---');
  {
    sentMessages = [];
    const testEpisodes = [
      { episodeNum: '1', title: 'Beginning' },
      { episodeNum: '2', title: 'The Next Step' }
    ];

    const result = controller.queueBatchEpisodes(testEpisodes, '1080p');
    assert.strictEqual(result.success, true, 'Batch queue succeeded');
    assert.strictEqual(result.count, 2, '2 jobs created');

    // Check filenames: must end in .mp4 and NOT .json
    for (const job of result.jobs) {
      assert.ok(job.filename.endsWith('.mp4'), `Job filename ${job.filename} must end in .mp4`);
      assert.ok(!job.filename.includes('.info.json'), `Job filename must not be companion .info.json`);
      assert.strictEqual(job.quality, '1080p', 'Quality set to 1080p');
      assert.strictEqual(job.status, 'queued', 'Initial status is queued');
    }

    assert.ok(sentMessages.some(m => m.action === 'queue_batch_downloads'), 'Sent queue_batch_downloads message to background');
    console.log('✓ Test 3 Passed: Batch payload strictly generates .mp4 filenames with zero companion .info.json files.');
  }

  // ---------------------------------------------------------------------------
  // Test 4: Background Service Worker queueBatchDownloads & FIFO Ordering
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 4: Background queueBatchDownloads & FIFO Ordering ---');
  {
    bg.setDownloadQueue([]); // Reset queue
    const batchItems = [
      { id: 'b1', url: 'https://cdn.example.com/ep01.mp4', filename: 'Anime - Episode 01 [1080p].mp4', quality: '1080p', type: 'direct' },
      { id: 'b2', url: 'https://cdn.example.com/ep02.mp4', filename: 'Anime - Episode 02 [1080p].mp4', quality: '1080p', type: 'direct' },
      { id: 'b3', url: 'https://cdn.example.com/ep03.mp4', filename: 'Anime - Episode 03 [1080p].mp4', quality: '1080p', type: 'direct' },
      { id: 'b4', url: 'https://cdn.example.com/ep04.mp4', filename: 'Anime - Episode 04 [1080p].mp4', quality: '1080p', type: 'direct' }
    ];

    const batchRes = bg.queueBatchDownloads(batchItems);
    assert.strictEqual(batchRes.success, true, 'queueBatchDownloads returns success');
    assert.strictEqual(batchRes.count, 4, '4 jobs enqueued');

    const queue = bg.getDownloadQueue();
    assert.strictEqual(queue.length, 4, 'Download queue has 4 jobs');
    assert.strictEqual(queue[0].id, 'b1', 'FIFO order preserved (b1 first)');
    assert.strictEqual(queue[3].id, 'b4', 'FIFO order preserved (b4 fourth)');

    console.log('✓ Test 4 Passed: 4 batch episodes enqueued atomically in FIFO order.');
  }

  // ---------------------------------------------------------------------------
  // Test 5: Concurrency Control Under Batch Load
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 5: Concurrency Control Under Batch Load (Max 2 Active) ---');
  {
    const queue = bg.getDownloadQueue();
    const activeJobs = queue.filter(j => j.status === 'downloading' || j.status === 'preparing');
    const queuedJobs = queue.filter(j => j.status === 'queued');

    assert.strictEqual(activeJobs.length, 2, 'Exactly 2 active download slots running (maxConcurrent = 2)');
    assert.strictEqual(queuedJobs.length, 2, 'Remaining 2 downloads queued waiting for slots');

    console.log('✓ Test 5 Passed: Concurrency strictly throttled to 2 active downloads under batch load.');
  }

  // ---------------------------------------------------------------------------
  // Test 6: Batch Controls (Pause All, Resume All, Cancel All)
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 6: Batch Controls (pauseAllJobs, resumeAllJobs, cancelAllJobs) ---');
  {
    // A. Pause All
    const pauseRes = bg.pauseAllJobs();
    assert.strictEqual(pauseRes.success, true);
    const queueAfterPause = bg.getDownloadQueue();
    assert.ok(queueAfterPause.every(j => j.status === 'paused'), 'All jobs paused');
    console.log('✓ Case A Passed: All jobs paused via pauseAllJobs.');

    // B. Resume All
    const resumeRes = bg.resumeAllJobs();
    assert.strictEqual(resumeRes.success, true);
    const queueAfterResume = bg.getDownloadQueue();
    const activeAfterResume = queueAfterResume.filter(j => j.status === 'downloading' || j.status === 'preparing');
    assert.strictEqual(activeAfterResume.length, 2, '2 jobs resumed active; remaining 2 queued');
    console.log('✓ Case B Passed: Jobs resumed and queue runner active with 2 concurrent workers.');

    // C. Cancel All
    const cancelRes = bg.cancelAllJobs();
    assert.strictEqual(cancelRes.success, true);
    const queueAfterCancel = bg.getDownloadQueue();
    assert.ok(queueAfterCancel.every(j => j.status === 'cancelled'), 'All jobs cancelled');
    console.log('✓ Case C Passed: All jobs cancelled via cancelAllJobs.');

    // D. Clear Completed & Cancelled
    const clearRes = bg.clearCompletedJobs();
    assert.strictEqual(clearRes.success, true);
    assert.strictEqual(bg.getDownloadQueue().length, 0, 'Cancelled jobs cleanly cleared');
    console.log('✓ Case D Passed: Cancelled jobs cleared from queue.');
  }

  // ---------------------------------------------------------------------------
  // Test 7: Batch Button Mounting & Modal Dialog
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 7: Batch Button Mounting & Modal Dialog ---');
  {
    const pageDoc = new MockDocument();
    new MockElement('DIV', 'Episode List', { class: 'block_area-header', id: 'episodes-title' }, pageDoc.body);
    const drawer = new MockElement('DIV', '', { class: 'episodes-list' }, pageDoc.body);
    for (let i = 1; i <= 12; i++) {
      new MockElement('A', `Episode ${i}`, {
        class: 'ssl-item ep-item',
        'data-number': String(i),
        title: `Episode ${i}`,
        href: `/watch/anime?ep=${i}`
      }, drawer);
    }

    const btn = controller.mountBatchDownloadButton(pageDoc);
    assert.ok(btn, 'Batch button mounted successfully');
    assert.strictEqual(btn.id, 'focusguard-batch-btn', 'Batch button has correct ID');

    // Open modal
    const modal = controller.openBatchModal(pageDoc);
    assert.ok(modal, 'Modal rendered into page document');
    assert.ok(modal.classList.contains('fg-batch-backdrop'), 'Modal has backdrop class');

    const titleEl = modal.querySelector('#fg-batch-title');
    assert.ok(titleEl, 'Modal title element exists');

    const epCountEl = modal.querySelector('.fg-batch-ep-count');
    assert.ok(epCountEl && epCountEl.textContent.includes('12 Episodes Detected'), 'Modal displays 12 Episodes Detected');

    console.log('✓ Test 7 Passed: Batch button mounted and interactive modal created with episode count.');
  }

  console.log('\n================================================================');
  console.log('ALL 7 PHASE 8 BATCH & SEASON DOWNLOADER TESTS PASSED! ✓');
  console.log('================================================================');
  process.exit(0);
}

runTestSuite().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
