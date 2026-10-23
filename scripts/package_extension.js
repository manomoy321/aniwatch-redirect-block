/**
 * FocusGuard Extension Packaging Script (Node.js)
 * Packages extension files into a zip archive for GitHub Actions and releases.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.join(rootDir, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error('Error: manifest.json not found in', rootDir);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const version = manifest.version || '1.0.0';
const distDir = path.join(rootDir, 'dist');
const buildDir = path.join(distDir, 'build');
const zipFileName = `focusguard-aniwatch-downloader-v${version}.zip`;
const zipFilePath = path.join(distDir, zipFileName);

console.log(`Packaging FocusGuard v${version}...`);

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

if (fs.existsSync(buildDir)) {
  fs.rmSync(buildDir, { recursive: true, force: true });
}
fs.mkdirSync(buildDir, { recursive: true });

const filesToCopy = [
  'manifest.json',
  'background.js',
  'content.js',
  'content.css',
  'inject.js',
  'player_controller.js',
  'player_hud.css'
];

const dirsToCopy = [
  'icons',
  'popup'
];

function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

for (const file of filesToCopy) {
  const src = path.join(rootDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(buildDir, file));
    console.log(`  + Added file: ${file}`);
  } else {
    console.warn(`  ! Missing file: ${file}`);
  }
}

for (const dir of dirsToCopy) {
  const src = path.join(rootDir, dir);
  if (fs.existsSync(src)) {
    copyRecursive(src, path.join(buildDir, dir));
    console.log(`  + Added directory: ${dir}`);
  } else {
    console.warn(`  ! Missing directory: ${dir}`);
  }
}

// Zip creation using platform tools or archiver
try {
  if (process.platform === 'win32') {
    execSync(`powershell -Command "Compress-Archive -Path '${buildDir}\\*' -DestinationPath '${zipFilePath}' -Force"`);
  } else {
    // Linux / macOS in GitHub Actions
    execSync(`cd "${buildDir}" && zip -r "${zipFilePath}" ./*`);
  }
  fs.rmSync(buildDir, { recursive: true, force: true });
  const stats = fs.statSync(zipFilePath);
  console.log(`\nSuccessfully created: ${zipFileName} (${(stats.size / 1024).toFixed(1)} KB)`);
} catch (err) {
  console.error('Failed to create zip file:', err.message);
  process.exit(1);
}
