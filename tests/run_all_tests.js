/**
 * FocusGuard Test Runner
 * Executes all automated test suites sequentially and provides a unified status report.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const testsDir = __dirname;
const testFiles = [
  'test_download_episode.js',
  'test_universal_download.js',
  'test_m4s_and_quality_control.js',
  'test_complete_video_smooth_playback.js',
  'test_dub_all_time.js',
  'test_dub_continuity.js',
  'test_background_download_queue_and_api.js',
  'test_smooth_vlc_playback_and_metadata.js',
  'test_player_playback_crash_prevention.js',
  'test_audio_and_seek_smoothness.js',
  'test_continuous_download_and_caching_fixes.js',
  'test_batch_season_downloader.js',
  'test_subtitle_extraction_and_softsubs.js',
  'test_popup_dashboard_and_audio_switcher.js',
  'test_continuous_download_stress_and_resilience.js',
  'test_unlimited_downloads_and_do_nothing_mode.js'
];

console.log('================================================================');
console.log('       FocusGuard Test Suite Runner (16 Suites)                 ');
console.log('================================================================\n');

let passed = 0;
let failed = 0;
const results = [];
const startTime = Date.now();

for (let i = 0; i < testFiles.length; i++) {
  const file = testFiles[i];
  const fullPath = path.join(testsDir, file);
  if (!fs.existsSync(fullPath)) {
    console.error(`[SKIP] Missing test file: ${file}`);
    continue;
  }

  const suiteStart = Date.now();
  process.stdout.write(`[${i + 1}/${testFiles.length}] Running ${file}... `);

  const res = spawnSync(process.execPath, [fullPath], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' }
  });

  const duration = ((Date.now() - suiteStart) / 1000).toFixed(2);

  if (res.status === 0) {
    passed++;
    console.log(`PASS (${duration}s)`);
    results.push({ file, status: 'PASS', duration });
  } else {
    failed++;
    console.log(`FAIL (${duration}s)`);
    console.error(`\n--- Error Output for ${file} ---\n${res.stderr || res.stdout}\n`);
    results.push({ file, status: 'FAIL', duration, error: res.stderr || res.stdout });
  }
}

const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

console.log('\n================================================================');
console.log(`Test Execution Summary: ${passed} passed, ${failed} failed (${totalDuration}s)`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('All test suites executed successfully! ✓\n');
  process.exit(0);
}

