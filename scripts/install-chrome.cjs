'use strict';

/**
 * Ensures a Chrome is available for Puppeteer's PDF export.
 *
 * On Heroku we install real Google Chrome via the apt buildpack (see Aptfile),
 * so this script detects that and skips the (flaky, ~150 MB) Puppeteer download
 * entirely. Locally (e.g. Windows dev) there is no system Chrome, so it falls
 * back to downloading Chrome into a top-level `puppeteer-cache/` dir (see
 * .puppeteerrc.cjs). The download is best-effort: a failure never breaks the
 * build, because the server resolves Chrome from several locations at runtime.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const cacheDir = path.join(__dirname, '..', 'puppeteer-cache');
const chromeRoot = path.join(cacheDir, 'chrome');
const exeName = process.platform === 'win32' ? 'chrome.exe' : 'chrome';

const systemChromes = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.GOOGLE_CHROME_BIN,
  '/app/.apt/opt/google/chrome/chrome',
  '/app/.apt/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome-stable',
].filter(Boolean);

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

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

function findCachedChrome() {
  for (const build of listDirs(chromeRoot)) {
    const buildPath = path.join(chromeRoot, build);
    for (const inner of listDirs(buildPath)) {
      const exe = path.join(buildPath, inner, exeName);
      if (exists(exe)) return exe;
    }
  }
  return null;
}

const systemChrome = systemChromes.find(exists);
if (systemChrome) {
  console.log('[install-chrome] System Chrome found, skipping download:', systemChrome);
  process.exit(0);
}

const cached = findCachedChrome();
if (cached) {
  console.log('[install-chrome] Chrome already cached, skipping download:', cached);
  process.exit(0);
}

// No usable Chrome anywhere: clear any partial download, then try to fetch one.
try {
  fs.rmSync(cacheDir, { recursive: true, force: true });
} catch (err) {
  console.warn('[install-chrome] could not clean cache dir:', err && err.message);
}

console.log('[install-chrome] Downloading Chrome for Puppeteer...');
try {
  execSync('npx --yes puppeteer browsers install chrome --path puppeteer-cache', {
    stdio: 'inherit',
  });
} catch (err) {
  console.warn(
    '[install-chrome] Chrome download failed (continuing; server will look for a system Chrome at runtime):',
    err && err.message
  );
}
