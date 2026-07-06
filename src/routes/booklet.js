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
 * Booklet PDF: headless Chromium via Puppeteer. Matches on-screen print CSS more closely than
 * WeasyPrint (different layout engine) or raster html2canvas. Page breaks follow the same
 * print rules as the preview (e.g. .booklet-page + break-after).
 * Body is parsed by app-level express.json (raised limit for this payload).
 */
router.post('/pdf', requireAuth, async (req, res) => {
  let browser;
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

    let launch;
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
        return res.status(503).json({
          error:
            'PDF engine unavailable: the puppeteer package failed to load on this server. ' +
            'Confirm `npm install` ran on deploy and see README “Liturgy booklet PDF export”.',
        });
      }
    }
    launch =
      typeof mod.launch === 'function'
        ? mod.launch.bind(mod)
        : mod.default && typeof mod.default.launch === 'function'
          ? mod.default.launch.bind(mod.default)
          : null;
    if (!launch) {
      console.error('booklet pdf: puppeteer has no launch()');
      return res.status(503).json({
        error: 'PDF engine misconfigured: puppeteer module loaded but launch() is missing.',
      });
    }

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
      browser = await launch(launchOpts);
    } catch (launchErr) {
      console.error('booklet pdf: puppeteer launch failed', launchErr);
      const hint =
        process.env.PUPPETEER_EXECUTABLE_PATH || process.env.GOOGLE_CHROME_BIN
          ? 'Check that PUPPETEER_EXECUTABLE_PATH / GOOGLE_CHROME_BIN points to a real binary on this host.'
          : 'Set PUPPETEER_EXECUTABLE_PATH (or GOOGLE_CHROME_BIN) to system Chrome/Chromium, or rely on Puppeteer’s downloaded browser after a successful postinstall.';
      return res.status(503).json({
        error:
          'Chrome/Chromium could not be started for PDF export. ' +
          hint +
          ' See README section “Liturgy booklet PDF export (server)”. ' +
          'Server log: ' +
          String(launchErr && launchErr.message ? launchErr.message : launchErr),
      });
    }
    const page = await browser.newPage();
    await page.emulateMediaType('print');
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(function () {
      return new Promise(function (resolve) {
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(resolve).catch(resolve);
        } else {
          resolve();
        }
      });
    });
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
              finalDoc.addPage(copied);
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
  } catch (err) {
    console.error('booklet pdf:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'PDF generation failed' });
    }
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.warn('booklet pdf browser close', closeErr);
      }
    }
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
