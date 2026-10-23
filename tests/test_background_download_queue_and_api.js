/**
 * FocusGuard Automated Verification Suite
 * Tests: Background Multi-Video Download Queue, Service Worker Lifecycle,
 * API Reliability, Retry-After Backoff, Request Deduplication & Error Recovery.
 */

const assert = require('assert');

// 1. Mock Browser Environment for Service Worker Context
let mockStorage = {};
let mockBrowserDownloads = new Map();
let nextDownloadId = 5001;

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
    onChanged: {
      addListener: () => {}
    }
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
      const results = [];
      mockBrowserDownloads.forEach(d => {
        if (!query || query.id === undefined || query.id === d.id) {
          results.push(d);
        }
      });
      if (cb) cb(results);
      return Promise.resolve(results);
    },
    pause: (id, cb) => {
      if (mockBrowserDownloads.has(id)) {
        mockBrowserDownloads.get(id).paused = true;
      }
      if (cb) cb();
      return Promise.resolve();
    },
    resume: (id, cb) => {
      if (mockBrowserDownloads.has(id)) {
        mockBrowserDownloads.get(id).paused = false;
      }
      if (cb) cb();
      return Promise.resolve();
    },
    cancel: (id, cb) => {
      if (mockBrowserDownloads.has(id)) {
        mockBrowserDownloads.get(id).state = 'interrupted';
      }
      if (cb) cb();
      return Promise.resolve();
    },
    onChanged: {
      addListener: () => {}
    }
  },
  runtime: {
    lastError: null,
    onMessage: { addListener: () => {} },
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    sendMessage: () => {}
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
    updateDynamicRules: () => Promise.resolve()
  }
};

// Set global mocks for background.js require
global.chrome = mockChrome;

// Import background module exports
const bg = require('../background.js');

async function runTestSuite() {
  console.log('=== FocusGuard Background Download Engine & API Hardening Suite ===\n');
  await bg.initDownloadQueue();

  // ---------------------------------------------------------------------------
  // Test 1: One Successful Video Download
  // ---------------------------------------------------------------------------
  console.log('--- Test 1: One Successful Video Download ---');
  bg.setDownloadQueue([]);
  mockStorage = {};

  const job1Res = await bg.queueDownload({
    url: 'https://cdn.anime.com/ep01.mp4',
    filename: 'Naruto - Episode 01.mp4',
    title: 'Naruto - Episode 01',
    quality: '1080p',
    totalBytes: 524288000
  });

  assert.ok(job1Res.job, 'Job must be created');
  assert.strictEqual(job1Res.job.filename, 'Naruto - Episode 01.mp4');
  assert.strictEqual(job1Res.job.status, 'downloading');
  assert.ok(job1Res.job.downloadId > 0, 'Must have received browser downloadId');
  console.log('✓ Test 1 Passed: Single video download queued & initiated with ID:', job1Res.job.id);

  // ---------------------------------------------------------------------------
  // Test 2: Several Downloads Queued Together (FIFO Concurrency Limits)
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 2: Several Downloads Queued Together (FIFO Concurrency) ---');
  bg.setDownloadQueue([]);
  const settings = bg.getQueueSettings();
  settings.maxConcurrent = 2; // Concurrency limit

  const q1 = await bg.queueDownload({ url: 'https://cdn.anime.com/ep02.mp4', filename: 'Ep 02.mp4' });
  const q2 = await bg.queueDownload({ url: 'https://cdn.anime.com/ep03.mp4', filename: 'Ep 03.mp4' });
  const q3 = await bg.queueDownload({ url: 'https://cdn.anime.com/ep04.mp4', filename: 'Ep 04.mp4' });
  const q4 = await bg.queueDownload({ url: 'https://cdn.anime.com/ep05.mp4', filename: 'Ep 05.mp4' });

  assert.strictEqual(q1.job.status, 'downloading', 'Job 1 must be downloading');
  assert.strictEqual(q2.job.status, 'downloading', 'Job 2 must be downloading');
  assert.strictEqual(q3.job.status, 'queued', 'Job 3 must be queued (concurrency capped at 2)');
  assert.strictEqual(q4.job.status, 'queued', 'Job 4 must be queued');

  // Complete Job 1 in browser & queue, and trigger processQueue -> Job 3 should start in FIFO order
  if (mockBrowserDownloads.has(q1.job.downloadId)) {
    mockBrowserDownloads.get(q1.job.downloadId).state = 'complete';
  }
  await bg.updateJobProgress({ jobId: q1.job.id, status: 'completed', progress: 100 });
  await bg.processQueue();

  const currentQ = bg.getDownloadQueue();
  const j3 = currentQ.find(j => j.id === q3.job.id);
  const j4 = currentQ.find(j => j.id === q4.job.id);

  assert.strictEqual(j3.status, 'downloading', 'Job 3 must have automatically started in FIFO order');
  assert.strictEqual(j4.status, 'queued', 'Job 4 must still be queued until next slot opens');
  console.log('✓ Test 2 Passed: Concurrency capped at 2; completed job prompted FIFO start of next queued item.');

  // ---------------------------------------------------------------------------
  // Test 3: Popup Closes During Download (Background Queue Persistence)
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 3: Popup Closes During Download (Background Autonomous Run) ---');
  // Simulate progress updates occurring without any popup connected
  await bg.updateJobProgress({
    jobId: q2.job.id,
    bytesReceived: 25000000,
    totalBytes: 50000000,
    progress: 50,
    status: 'downloading'
  });

  await bg.persistQueue(true); // Immediate sync to chrome.storage.local
  const storedData = await mockChrome.storage.local.get(['downloadQueue']);
  const storedJob2 = storedData.downloadQueue.find(j => j.id === q2.job.id);

  assert.ok(storedJob2, 'Job 2 must exist in persistent storage');
  assert.strictEqual(storedJob2.progress, 50, 'Progress must be 50% in storage');
  assert.strictEqual(storedJob2.bytesReceived, 25000000);
  console.log('✓ Test 3 Passed: Background queue persisted authoritative state while popup was closed.');

  // ---------------------------------------------------------------------------
  // Test 4: Background Service Worker Restart & Queue Restoration
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 4: Service Worker Suspension & Recovery ---');
  // Clear in-memory array to simulate SW death
  bg.setDownloadQueue([]);
  assert.strictEqual(bg.getDownloadQueue().length, 0);

  // SW wakes up: calls initDownloadQueue()
  await bg.initDownloadQueue();
  const recoveredQ = bg.getDownloadQueue();
  assert.ok(recoveredQ.length >= 3, 'Must have restored queue from persistent storage');
  assert.ok(recoveredQ.some(j => j.id === q2.job.id));
  console.log('✓ Test 4 Passed: Queue cleanly rehydrated from storage on worker startup.');

  // ---------------------------------------------------------------------------
  // Test 5: One Download Fails While Others Continue (Failure Isolation)
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 5: Failure Isolation ---');
  await bg.updateJobProgress({ jobId: j3.id, status: 'failed', error: 'HTTP 404 Not Found' });
  await bg.processQueue();

  const afterFailQ = bg.getDownloadQueue();
  const failedJ3 = afterFailQ.find(j => j.id === j3.id);
  const runningJ4 = afterFailQ.find(j => j.id === j4.id);

  assert.strictEqual(failedJ3.status, 'failed', 'Job 3 is marked failed');
  assert.strictEqual(failedJ3.error, 'HTTP 404 Not Found');
  assert.strictEqual(runningJ4.status, 'downloading', 'Job 4 automatically started despite Job 3 failure');
  console.log('✓ Test 5 Passed: Job failure was isolated; remaining queue continued uninterrupted.');

  // ---------------------------------------------------------------------------
  // Test 6: Network Disconnection & Recovery (fetchWithRetry)
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 6: Network Disconnection & Recovery (fetchWithRetry) ---');
  let fetchAttempts = 0;
  const originalFetch = global.fetch;

  // Mock fetch that fails with network error once, then succeeds
  global.fetch = async (url, opts) => {
    fetchAttempts++;
    if (fetchAttempts === 1) {
      throw new TypeError('Failed to fetch: network disconnected');
    }
    return {
      ok: true,
      status: 200,
      text: async () => '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n720p.m3u8',
      headers: { get: () => null }
    };
  };

  const retryRes = await bg.fetchWithRetry('https://cdn.anime.com/manifest.m3u8', {
    maxRetries: 2,
    baseDelayMs: 20
  });

  assert.strictEqual(retryRes.status, 200);
  assert.strictEqual(fetchAttempts, 2, 'Must have retried after initial network failure');
  console.log('✓ Test 6 Passed: fetchWithRetry automatically recovered from transient network failure.');

  // ---------------------------------------------------------------------------
  // Test 7: HTTP 429 & 5xx Exponential Backoff with Jitter & Retry-After
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 7: HTTP 429 & 5xx Exponential Backoff & Retry-After ---');
  // 7a: parseRetryAfterHeader
  assert.strictEqual(bg.parseRetryAfterHeader('3'), 3000, '3 seconds parsed to 3000ms');
  assert.strictEqual(bg.parseRetryAfterHeader(null), null);
  assert.strictEqual(bg.parseRetryAfterHeader('invalid'), null);

  // 7b: isTransientHttpStatus
  assert.strictEqual(bg.isTransientHttpStatus(429), true, '429 is transient');
  assert.strictEqual(bg.isTransientHttpStatus(503), true, '503 is transient');
  assert.strictEqual(bg.isTransientHttpStatus(502), true, '502 is transient');
  assert.strictEqual(bg.isTransientHttpStatus(404), false, '404 is permanent');
  assert.strictEqual(bg.isTransientHttpStatus(401), false, '401 is permanent');

  // 7c: Mock 429 then 200
  let rateLimitAttempts = 0;
  global.fetch = async () => {
    rateLimitAttempts++;
    if (rateLimitAttempts === 1) {
      return {
        ok: false,
        status: 429,
        headers: {
          get: (name) => (name.toLowerCase() === 'retry-after' ? '1' : null)
        }
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => 'Success after rate limit',
      headers: { get: () => null }
    };
  };

  const rateLimitRes = await bg.fetchWithRetry('https://api.stream.com/token', {
    maxRetries: 2,
    baseDelayMs: 50
  });
  assert.strictEqual(rateLimitRes.status, 200);
  assert.strictEqual(rateLimitAttempts, 2, 'Retried after 429 Retry-After');
  console.log('✓ Test 7 Passed: 429 Retry-After parsed and backoff respected.');

  // ---------------------------------------------------------------------------
  // Test 8: Permanent Failures (401/403/404) NOT Blindly Retried
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 8: Permanent Failures (401/403/404) Rejection ---');
  let authAttempts = 0;
  global.fetch = async () => {
    authAttempts++;
    return {
      ok: false,
      status: 403,
      headers: { get: () => null }
    };
  };

  const authRes = await bg.fetchWithRetry('https://api.stream.com/secret.m3u8', {
    maxRetries: 3,
    baseDelayMs: 20
  });

  assert.strictEqual(authRes.status, 403);
  assert.strictEqual(authAttempts, 1, 'Must NOT retry permanent 403 Forbidden failure');
  console.log('✓ Test 8 Passed: 403 Forbidden terminated immediately without blind retries.');

  // Restore fetch
  global.fetch = originalFetch;

  // ---------------------------------------------------------------------------
  // Test 9: Duplicate Download Requests & In-Flight Deduplication
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 9: Request & Queue Deduplication ---');
  bg.setDownloadQueue([]);
  const originalJob = await bg.queueDownload({
    url: 'https://cdn.anime.com/ep09.mp4',
    filename: 'Ep 09.mp4'
  });

  const dupJob = await bg.queueDownload({
    url: 'https://cdn.anime.com/ep09.mp4',
    filename: 'Ep 09.mp4'
  });

  assert.strictEqual(originalJob.job.id, dupJob.job.id, 'Duplicate job must return existing job ID');
  assert.strictEqual(bg.getDownloadQueue().length, 1, 'Queue length must remain 1');
  console.log('✓ Test 9 Passed: Duplicate download request deduplicated to single job.');

  // ---------------------------------------------------------------------------
  // Test 10: User Pause, Resume & Cancellation
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 10: User Pause, Resume & Cancellation ---');
  const cancelJobId = originalJob.job.id;
  await bg.pauseJob(cancelJobId);
  let jobState = bg.getDownloadQueue().find(j => j.id === cancelJobId);
  assert.strictEqual(jobState.status, 'paused', 'Job must be paused');

  await bg.resumeJob(cancelJobId);
  jobState = bg.getDownloadQueue().find(j => j.id === cancelJobId);
  assert.strictEqual(jobState.status, 'downloading', 'Job must be resumed to downloading');

  await bg.cancelJob(cancelJobId);
  jobState = bg.getDownloadQueue().find(j => j.id === cancelJobId);
  assert.strictEqual(jobState.status, 'cancelled', 'Job must be marked cancelled');
  console.log('✓ Test 10 Passed: Pause, resume, and cancellation verified.');

  // ---------------------------------------------------------------------------
  // Test 11: Retry and Remove Operations
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 11: Retry & Remove Operations ---');
  await bg.retryJob(cancelJobId);
  jobState = bg.getDownloadQueue().find(j => j.id === cancelJobId);
  assert.strictEqual(jobState.status, 'downloading', 'Cancelled job was cleanly retried');

  await bg.removeJob(cancelJobId);
  jobState = bg.getDownloadQueue().find(j => j.id === cancelJobId);
  assert.strictEqual(jobState, undefined, 'Job must be removed from queue');
  console.log('✓ Test 11 Passed: Retry and remove operations executed cleanly.');

  // ---------------------------------------------------------------------------
  // Test 12: Unknown File Size Graceful Fallback
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 12: Unknown File Size (totalBytes = 0) Fallback ---');
  const unknownSizeJob = await bg.queueDownload({
    url: 'https://cdn.stream.com/chunked-live.mp4',
    filename: 'Live Stream.mp4',
    totalBytes: 0
  });

  await bg.updateJobProgress({
    jobId: unknownSizeJob.job.id,
    bytesReceived: 1048576,
    totalBytes: 0,
    status: 'downloading'
  });

  const updatedUnknownJob = bg.getDownloadQueue().find(j => j.id === unknownSizeJob.job.id);
  assert.ok(!isNaN(updatedUnknownJob.progress), 'Progress must not be NaN');
  assert.strictEqual(updatedUnknownJob.bytesReceived, 1048576);
  console.log('✓ Test 12 Passed: Unknown file size handled gracefully with zero NaN errors.');

  // ---------------------------------------------------------------------------
  // Test 13: Corrupted Metadata Recovery
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 13: Corrupted Metadata Recovery ---');
  mockStorage['downloadQueue'] = 'corrupted_string_not_array';
  await bg.initDownloadQueue();
  assert.ok(Array.isArray(bg.getDownloadQueue()), 'Must fallback to valid empty array');
  console.log('✓ Test 13 Passed: Corrupted storage safely fell back to clean array.');

  // ---------------------------------------------------------------------------
  // Test 14: Clear Completed Jobs
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 14: Clear Completed Jobs ---');
  bg.setDownloadQueue([
    { id: 'job_c1', status: 'completed', filename: 'Done1.mp4' },
    { id: 'job_f1', status: 'failed', filename: 'Fail1.mp4' },
    { id: 'job_a1', status: 'downloading', filename: 'Active1.mp4' },
    { id: 'job_q1', status: 'queued', filename: 'Queued1.mp4' }
  ]);

  await bg.clearCompletedJobs();
  const cleanedQ = bg.getDownloadQueue();
  assert.strictEqual(cleanedQ.length, 2, 'Only active and queued jobs should remain');
  assert.ok(cleanedQ.every(j => j.status === 'downloading' || j.status === 'queued'));
  console.log('✓ Test 14 Passed: Completed and failed jobs pruned while active jobs preserved.');

  // ---------------------------------------------------------------------------
  // Test 15: Browser Restart Reconciliation (reconcileQueueWithBrowser)
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 15: Browser Restart Reconciliation ---');
  bg.setDownloadQueue([
    {
      id: 'job_stale',
      downloadId: 99999, // non-existent in mock browser downloads
      status: 'downloading',
      filename: 'Stale Download.mp4',
      createdAt: Date.now() - 10000,
      updatedAt: Date.now() - 10000
    }
  ]);

  await bg.reconcileQueueWithBrowser();
  const reconciledJob = bg.getDownloadQueue().find(j => j.id === 'job_stale');
  assert.strictEqual(reconciledJob.status, 'failed', 'Lost browser download marked failed');
  assert.ok(reconciledJob.error.includes('interrupted'));
  console.log('✓ Test 15 Passed: Stale browser downloads reconciled on startup.');

  // ---------------------------------------------------------------------------
  // Test 16: Existing Redirect Blocker & Protection Integrity
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 16: Redirect Blocker & Core Protection Features Preserved ---');
  assert.strictEqual(bg.isAdOrRedirectUrl('https://popads.net/banner.js'), true);
  assert.strictEqual(bg.isAdOrRedirectUrl('https://aniwatchtv.to/watch/episode-1'), false);
  console.log('✓ Test 16 Passed: Ad/Redirect URL detection pattern matching verified.');

  console.log('\n================================================================');
  console.log('ALL 16 BACKGROUND DOWNLOAD QUEUE, API HARDENING & RESILIENCE TESTS PASSED! ✓');
  console.log('================================================================');
}

runTestSuite().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
