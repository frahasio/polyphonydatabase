import express from 'express';
import fs from 'fs';
import { lookup } from 'dns/promises';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { requireAuth } from '../middleware/auth.js';
import { PDFDocument } from 'pdf-lib';

const router = express.Router();

function chromeBinaryExists(p) {
  if (!p || typeof p !== 'string') return false;
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/**
 * Heroku: Puppeteer's cached Chrome path from build often is missing at runtime in the slug.
 * Prefer a real file: env vars, then common apt paths (Google Chrome buildpack), then Puppeteer
 * only if that path exists.
 */
function resolveChromeExecutable(puppeteerModule) {
  const envPath = (
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.GOOGLE_CHROME_BIN ||
    ''
  ).trim();
  if (chromeBinaryExists(envPath)) return envPath;

  const candidates = [
    // Real binary from the google-chrome .deb (the /usr/bin symlink is absolute
    // and therefore broken once relocated under /app/.apt, so target it directly).
    '/app/.apt/opt/google/chrome/chrome',
    '/app/.apt/opt/google/chrome/google-chrome',
    '/app/.apt/usr/bin/google-chrome-stable',
    '/app/.apt/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const p of candidates) {
    if (chromeBinaryExists(p)) return p;
  }

  if (puppeteerModule && typeof puppeteerModule.executablePath === 'function') {
    try {
      const cached = puppeteerModule.executablePath();
      if (chromeBinaryExists(cached)) return cached;
    } catch {
      /* ignore */
    }
  }

  // Scan known Puppeteer cache directories for any chrome/chromium binary.
  const cacheDirs = [
    '/app/puppeteer-cache',
    process.cwd() + '/puppeteer-cache',
    '/app/node_modules/.cache/puppeteer',
    '/app/.cache/puppeteer',
    process.env.HOME ? process.env.HOME + '/.cache/puppeteer' : null,
  ].filter(Boolean);
  for (const dir of cacheDirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const walk = [dir];
      while (walk.length) {
        const d = walk.pop();
        for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
          const full = d + '/' + ent.name;
          if (ent.isDirectory()) {
            walk.push(full);
          } else if (
            ent.isFile() &&
            /^(chrome|chromium)$/i.test(ent.name) &&
            chromeBinaryExists(full)
          ) {
            try {
              fs.accessSync(full, fs.constants.X_OK);
              return full;
            } catch {
              /* not executable */
            }
          }
        }
      }
    } catch {
      /* ignore unreadable directories */
    }
  }

  return null;
}

/**
 * PDF engine lifecycle. Heroku's router kills any request at a hard 30s
 * (H12 -> 503), and renders on an eco dyno were taking 11-19s with a fresh
 * Chrome launch per request — close enough to tip over the limit. So:
 * - one shared Chrome, launched lazily and kept for BROWSER_IDLE_CLOSE_MS
 *   after the last render (proof + download bursts reuse it), then closed
 *   to give the dyno its memory back;
 * - renders are serialized, since two concurrent Chromes would exhaust the
 *   512MB dyno anyway.
 */
const BROWSER_IDLE_CLOSE_MS = 60 * 1000;
let sharedBrowserPromise = null;
let browserIdleTimer = null;
let renderChain = Promise.resolve();

class PdfEngineError extends Error {
  constructor(clientMessage) {
    super(clientMessage);
    this.clientMessage = clientMessage;
  }
}

async function loadPuppeteerLaunch() {
  let mod;
  try {
    mod = await import('puppeteer');
  } catch (impErr) {
    console.error('booklet pdf: puppeteer ESM import failed', impErr);
    try {
      const { createRequire } = await import('module');
      const require = createRequire(import.meta.url);
      mod = require('puppeteer');
    } catch (reqErr) {
      console.error('booklet pdf: puppeteer require() failed', reqErr);
      throw new PdfEngineError(
        'PDF engine unavailable: the puppeteer package failed to load on this server. ' +
          'Confirm `npm install` ran on deploy and see README “Liturgy booklet PDF export”.'
      );
    }
  }
  const launch =
    typeof mod.launch === 'function'
      ? mod.launch.bind(mod)
      : mod.default && typeof mod.default.launch === 'function'
        ? mod.default.launch.bind(mod.default)
        : null;
  if (!launch) {
    console.error('booklet pdf: puppeteer has no launch()');
    throw new PdfEngineError(
      'PDF engine misconfigured: puppeteer module loaded but launch() is missing.'
    );
  }
  return { mod, launch };
}

async function launchBrowser() {
  const { mod, launch } = await loadPuppeteerLaunch();
  const chromePath = resolveChromeExecutable(mod);
  const launchOpts = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
    ],
  };
  if (chromePath) {
    launchOpts.executablePath = chromePath;
  }
  try {
    return await launch(launchOpts);
  } catch (launchErr) {
    console.error('booklet pdf: puppeteer launch failed', launchErr);
    const hint =
      process.env.PUPPETEER_EXECUTABLE_PATH || process.env.GOOGLE_CHROME_BIN
        ? 'Check that PUPPETEER_EXECUTABLE_PATH / GOOGLE_CHROME_BIN points to a real binary on this host.'
        : 'Set PUPPETEER_EXECUTABLE_PATH (or GOOGLE_CHROME_BIN) to system Chrome/Chromium, or rely on Puppeteer’s downloaded browser after a successful postinstall.';
    throw new PdfEngineError(
      'Chrome/Chromium could not be started for PDF export. ' +
        hint +
        ' See README section “Liturgy booklet PDF export (server)”. ' +
        'Server log: ' +
        String(launchErr && launchErr.message ? launchErr.message : launchErr)
    );
  }
}

async function getSharedBrowser() {
  if (browserIdleTimer) {
    clearTimeout(browserIdleTimer);
    browserIdleTimer = null;
  }
  if (sharedBrowserPromise) {
    try {
      const existing = await sharedBrowserPromise;
      const connected =
        typeof existing.connected === 'boolean' ? existing.connected : existing.isConnected();
      if (connected) return existing;
    } catch {
      /* previous launch failed; relaunch below */
    }
    sharedBrowserPromise = null;
  }
  sharedBrowserPromise = launchBrowser();
  try {
    return await sharedBrowserPromise;
  } catch (err) {
    sharedBrowserPromise = null;
    throw err;
  }
}

function scheduleBrowserIdleClose() {
  if (browserIdleTimer) clearTimeout(browserIdleTimer);
  browserIdleTimer = setTimeout(function () {
    browserIdleTimer = null;
    const p = sharedBrowserPromise;
    sharedBrowserPromise = null;
    if (p) {
      p.then(function (b) { return b.close(); }).catch(function () {});
    }
  }, BROWSER_IDLE_CLOSE_MS);
  if (typeof browserIdleTimer.unref === 'function') browserIdleTimer.unref();
}

function withRenderLock(fn) {
  const run = renderChain.then(fn, fn);
  renderChain = run.then(
    function () {},
    function () {}
  );
  return run;
}

/**
 * Booklet PDF: headless Chromium via Puppeteer. Matches on-screen print CSS more closely than
 * WeasyPrint (different layout engine) or raster html2canvas. Page breaks follow the same
 * print rules as the preview (e.g. .booklet-page + break-after).
 * Body is parsed by app-level express.json (raised limit for this payload).
 */
router.post('/pdf', requireAuth, async (req, res) => {
  let page;
  try {
    const html = req.body && typeof req.body.html === 'string' ? req.body.html : '';
    const pageSize = req.body && req.body.pageSize === 'A5' ? 'A5' : 'A4';
    const docTitle =
      req.body && typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 200) : '';
    if (!html.trim()) {
      return res.status(400).json({ error: 'Missing html' });
    }
    if (html.length > 24 * 1024 * 1024) {
      return res.status(400).json({ error: 'Document too large' });
    }

    await withRenderLock(async () => {
    const t0 = Date.now();
    const browser = await getSharedBrowser();
    const tLaunch = Date.now();
    page = await browser.newPage();
    await page.emulateMediaType('print');
    // 'load' (stylesheets + images) rather than 'networkidle0': idle-tracking
    // stalls on any hung CDN connection and its 500ms quiet window is wasted
    // time; web fonts are awaited explicitly below (bounded — a slow font
    // host must not push the whole request past Heroku's 30s H12 limit).
    await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
    await page.evaluate(function () {
      return new Promise(function (resolve) {
        if (document.fonts && document.fonts.ready) {
          var done = false;
          var finish = function () { if (!done) { done = true; resolve(); } };
          document.fonts.ready.then(finish).catch(finish);
          setTimeout(finish, 8000);
        } else {
          resolve();
        }
      });
    });
    const tContent = Date.now();
    // Chrome uses document.title as the PDF /Title; otherwise it falls back to
    // the page URL ("about:blank") which then shows in PDF viewers' title bars.
    await page.evaluate(function (t) {
      document.title = t || 'Liturgy booklet';
    }, docTitle);

    const format = pageSize === 'A5' ? 'A5' : 'A4';
    const pdfBuffer = await page.pdf({
      format,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: false,
    });

    const manifest = Array.isArray(req.body.manifest) ? req.body.manifest : null;

    let finalBuffer;
    if (manifest && manifest.some(e => e.type === 'edition')) {
      const puppeteerDoc = await PDFDocument.load(pdfBuffer);
      const finalDoc = await PDFDocument.create();
      // copyPages does not carry over document metadata, so set it explicitly.
      if (docTitle) finalDoc.setTitle(docTitle);
      finalDoc.setProducer('Polyphony Database');
      finalDoc.setCreator('Polyphony Database — Liturgy booklet');
      const editionCache = {};

      // Content pages carry their page numbers in the rendered HTML; merged
      // edition pages need theirs stamped here to keep one sequence.
      const pnPosition = typeof req.body.pageNumbersPosition === 'string' &&
        ['footer-center', 'footer-outer', 'header-center', 'header-outer'].includes(req.body.pageNumbersPosition)
        ? req.body.pageNumbersPosition
        : null;
      const requestedPnSize = Number(req.body.pageNumberSizePt);
      const PN_SIZE = Number.isFinite(requestedPnSize)
        ? Math.min(24, Math.max(6, requestedPnSize))
        : 9;
      const PN_COLOR = /^#[0-9a-f]{6}$/i.test(String(req.body.pageNumberColor || ''))
        ? String(req.body.pageNumberColor)
        : '#000000';
      const MM_TO_PT = 2.83465;
      // Distances from the page edge, matching the on-screen page-number
      // margins (fall back to sensible defaults).
      const vPt = (Number(req.body.pageNumberVMm) >= 0 ? Number(req.body.pageNumberVMm) : 8) * MM_TO_PT;
      const hPt = (Number(req.body.pageNumberHMm) >= 0 ? Number(req.body.pageNumberHMm) : 12) * MM_TO_PT;
      const pnImageCache = new Map();

      async function pageNumberImage(pageNumber) {
        const text = String(pageNumber);
        if (pnImageCache.has(text)) return pnImageCache.get(text);
        const rendered = await page.evaluate(({ value, sizePt, color }) => {
          const scale = 4;
          const fontPx = sizePt * (96 / 72) * scale;
          const family = getComputedStyle(document.documentElement)
            .getPropertyValue('--booklet-body-font')
            .trim() || 'serif';
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          context.font = fontPx + 'px ' + family;
          const metrics = context.measureText(value);
          const pad = 2 * scale;
          const ascent = Math.ceil(metrics.actualBoundingBoxAscent || fontPx * 0.8);
          const descent = Math.ceil(metrics.actualBoundingBoxDescent || fontPx * 0.2);
          canvas.width = Math.ceil(metrics.width) + pad * 2;
          canvas.height = ascent + descent + pad * 2;
          const draw = canvas.getContext('2d');
          draw.font = fontPx + 'px ' + family;
          draw.fillStyle = color;
          draw.textBaseline = 'alphabetic';
          draw.fillText(value, pad, pad + ascent);
          return {
            png: canvas.toDataURL('image/png').split(',')[1],
            widthPt: (canvas.width / scale) * (72 / 96),
            heightPt: (canvas.height / scale) * (72 / 96),
          };
        }, { value: text, sizePt: PN_SIZE, color: PN_COLOR });
        const image = await finalDoc.embedPng(Buffer.from(rendered.png, 'base64'));
        const result = { image, width: rendered.widthPt, height: rendered.heightPt };
        pnImageCache.set(text, result);
        return result;
      }

      async function stampEditionPageNumber(targetPage, pageNumber) {
        if (!pnPosition || !Number.isInteger(pageNumber)) return;
        const numberImage = await pageNumberImage(pageNumber);
        const { width, height } = targetPage.getSize();
        const isFooter = pnPosition.startsWith('footer');
        const y = isFooter ? vPt : height - vPt - numberImage.height;
        let x;
        if (pnPosition.endsWith('center')) {
          x = (width - numberImage.width) / 2;
        } else {
          // Outer edge: odd numbers recto (right), even verso (left).
          x = pageNumber % 2 === 1 ? width - hPt - numberImage.width : hPt;
        }
        targetPage.drawImage(numberImage.image, {
          x,
          y,
          width: numberImage.width,
          height: numberImage.height,
        });
      }

      for (const entry of manifest) {
        if (entry.type === 'content') {
          const idx = Number(entry.puppeteerPageIndex);
          if (idx >= 0 && idx < puppeteerDoc.getPageCount()) {
            const [copied] = await finalDoc.copyPages(puppeteerDoc, [idx]);
            finalDoc.addPage(copied);
          }
        } else if (entry.type === 'edition' && entry.url) {
          try {
            if (!editionCache[entry.url]) {
              const resp = await safeFetch(entry.url, {
                headers: { 'User-Agent': 'PolyphonyDatabase-Booklet/1' },
              });
              if (!resp.ok) throw new Error('Fetch failed: ' + resp.status);
              editionCache[entry.url] = await resp.arrayBuffer();
            }
            const editionDoc = await PDFDocument.load(editionCache[entry.url]);
            const pageIdx = Math.max(0, (parseInt(entry.pdfPage, 10) || 1) - 1);
            if (pageIdx < editionDoc.getPageCount()) {
              const [copied] = await finalDoc.copyPages(editionDoc, [pageIdx]);
              const added = finalDoc.addPage(copied);
              await stampEditionPageNumber(added, parseInt(entry.pageNumber, 10));
            }
          } catch (edErr) {
            console.warn('booklet pdf: edition page merge failed for', entry.url, edErr.message);
          }
        }
      }

      finalBuffer = Buffer.from(await finalDoc.save());
    } else {
      finalBuffer = Buffer.from(pdfBuffer);
    }

    const filenameBase =
      (docTitle.replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)) || 'liturgy-booklet';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + filenameBase + '.pdf"');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(finalBuffer);
    console.log(
      'booklet pdf: ok in ' + (Date.now() - t0) + 'ms ' +
      '(browser ' + (tLaunch - t0) + 'ms, content ' + (tContent - tLaunch) + 'ms, ' +
      'pdf+merge ' + (Date.now() - tContent) + 'ms, ' + Math.round(finalBuffer.length / 1024) + 'KB)'
    );
    });
  } catch (err) {
    console.error('booklet pdf:', err);
    if (!res.headersSent) {
      if (err instanceof PdfEngineError) {
        res.status(503).json({ error: err.clientMessage });
      } else {
        res.status(500).json({ error: 'PDF generation failed' });
      }
    }
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (closeErr) {
        console.warn('booklet pdf page close', closeErr);
      }
    }
    scheduleBrowserIdleClose();
  }
});

function isPrivateIp(ip) {
  const a = String(ip || '').toLowerCase();
  if (!a) return true;
  // IPv4 loopback, RFC1918, link-local (cloud metadata), 0.0.0.0/8, CGNAT
  if (/^127\./.test(a)) return true;
  if (/^10\./.test(a)) return true;
  if (/^192\.168\./.test(a)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) return true;
  if (/^169\.254\./.test(a)) return true;
  if (/^0\./.test(a)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a)) return true;
  // IPv6 loopback, link-local, unique-local, unspecified, v4-mapped
  if (a === '::1' || a === '::') return true;
  if (a.startsWith('fe80:') || a.startsWith('fc') || a.startsWith('fd')) return true;
  if (a.startsWith('::ffff:')) return isPrivateIp(a.slice(7));
  return false;
}

function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  return isPrivateIp(h.replace(/^\[|\]$/g, ''));
}

/**
 * True when the URL may be fetched server-side. Rejects non-http(s) schemes,
 * blocked hostnames, and — via DNS resolution — hostnames that point at
 * private/loopback/link-local addresses (SSRF, incl. DNS-rebinding names).
 */
async function isAllowedFetchUrl(u) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (isBlockedHost(u.hostname)) return false;
  try {
    const addrs = await lookup(u.hostname.replace(/^\[|\]$/g, ''), { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

/**
 * fetch() that validates every redirect hop against the SSRF rules, so a
 * public URL cannot redirect the server into an internal address.
 */
async function safeFetch(rawUrl, options = {}, maxRedirects = 3) {
  let current = new URL(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!(await isAllowedFetchUrl(current))) {
      throw new Error('URL target not allowed');
    }
    const resp = await fetch(current.href, { ...options, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(resp.status)) {
      const location = resp.headers.get('location');
      if (!location) return resp;
      current = new URL(location, current);
      continue;
    }
    return resp;
  }
  throw new Error('Too many redirects');
}

function isPdfContentType(ct) {
  if (!ct) return false;
  const c = ct.toLowerCase();
  return (
    c.includes('pdf') ||
    c.includes('octet-stream') ||
    c.includes('application/x-download')
  );
}

/**
 * Same-origin PDF fetch for the liturgy booklet (avoids browser CORS on PDF.js).
 * Authenticated users only. Blocks private / loopback targets (SSRF mitigation).
 */
router.get('/pdf-proxy', requireAuth, async (req, res) => {
  try {
    const rawUrl = req.query.url;
    if (!rawUrl || typeof rawUrl !== 'string') {
      return res.status(400).json({ error: 'Missing url parameter' });
    }

    let u;
    try {
      u = new URL(rawUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return res.status(400).json({ error: 'Only http(s) URLs are allowed' });
    }

    let upstream;
    try {
      upstream = await safeFetch(u.href, {
        headers: { 'User-Agent': 'PolyphonyDatabase-Booklet/1' },
      });
    } catch (fetchErr) {
      if (String(fetchErr.message).includes('not allowed')) {
        return res.status(403).json({ error: 'This URL host is not allowed' });
      }
      throw fetchErr;
    }

    if (!upstream.ok) {
      return res.status(502).json({ error: `Upstream returned ${upstream.status}` });
    }

    const ct = upstream.headers.get('content-type') || '';
    if (!isPdfContentType(ct) && !/\.pdf(\?|$)/i.test(u.pathname)) {
      return res.status(502).json({ error: 'URL did not return a PDF' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=120');

    if (upstream.body && typeof Readable.fromWeb === 'function') {
      await pipeline(Readable.fromWeb(upstream.body), res);
    } else {
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
    }
  } catch (err) {
    console.error('booklet pdf-proxy:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch PDF' });
    }
  }
});

export default router;
