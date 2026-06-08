'use strict';

/**
 * Installs Chrome for Puppeteer, but only when it isn't already present.
 *
 * Chrome lives in a top-level `puppeteer-cache/` dir (see .puppeteerrc.cjs)
 * which Heroku persists between builds via package.json "cacheDirectories".
 * That means once Chrome is downloaded it survives subsequent deploys, so we
 * skip the (~150 MB) download unless the executable is actually missing.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const cacheDir = path.join(__dirname, '..', 'puppeteer-cache');
const chromeRoot = path.join(cacheDir, 'chrome');
const exeName = process.platform === 'win32' ? 'chrome.exe' : 'chrome';

function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function findChromeExecutable() {
  for (const build of listDirs(chromeRoot)) {
    const buildPath = path.join(chromeRoot, build);
    for (const inner of listDirs(buildPath)) {
      const exe = path.join(buildPath, inner, exeName);
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

const existing = findChromeExecutable();
if (existing) {
  console.log('[install-chrome] Chrome already present, skipping download:', existing);
  process.exit(0);
}

// Nothing usable cached: clear any partial download, then fetch a clean copy.
try {
  fs.rmSync(cacheDir, { recursive: true, force: true });
} catch (err) {
  console.warn('[install-chrome] could not clean cache dir:', err && err.message);
}

console.log('[install-chrome] Downloading Chrome for Puppeteer...');
execSync('npx --yes puppeteer browsers install chrome --path puppeteer-cache', {
  stdio: 'inherit',
});
