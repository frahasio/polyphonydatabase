import express from 'express';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

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
