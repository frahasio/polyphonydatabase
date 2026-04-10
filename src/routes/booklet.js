import express from 'express';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

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
    if (!html.trim()) {
      return res.status(400).json({ error: 'Missing html' });
    }
    if (html.length > 24 * 1024 * 1024) {
      return res.status(400).json({ error: 'Document too large' });
    }

    let puppeteer;
    try {
      const mod = await import('puppeteer');
      puppeteer = mod.default;
    } catch (impErr) {
      console.error('booklet pdf: puppeteer import failed', impErr);
      return res.status(503).json({
        error:
          'PDF engine unavailable. Run npm install on the server (Puppeteer bundles Chromium).',
      });
    }

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.emulateMediaType('print');
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 120000 });

    const format = pageSize === 'A5' ? 'A5' : 'A4';
    const pdfBuffer = await page.pdf({
      format,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: false,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="liturgy-booklet.pdf"');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(Buffer.from(pdfBuffer));
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

function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === '0.0.0.0') return true;
  if (/^127\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h)) return true;
  return false;
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

    if (isBlockedHost(u.hostname)) {
      return res.status(403).json({ error: 'This URL host is not allowed' });
    }

    const upstream = await fetch(u.href, {
      redirect: 'follow',
      headers: { 'User-Agent': 'PolyphonyDatabase-Booklet/1' },
    });

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
