import crypto from 'crypto';

// Lightweight bot screening for the public forms (registration, commission
// enquiry). Two checks, both invisible to humans:
//
// 1. HONEYPOT — the form has a `website` field hidden from sighted users and
//    assistive tech. Humans leave it empty; form-filling bots populate every
//    field. A filled honeypot is answered with a FAKE success so the bot
//    learns nothing.
// 2. TIMING TOKEN — the page fetches a signed timestamp (GET /api/auth/
//    form-token) when it loads and posts it back. The server requires the
//    token to be genuine (HMAC with SESSION_SECRET), at least MIN_FILL_MS
//    old (nobody fills a form in under 3 s) and no older than MAX_AGE_MS. A
//    client posting straight to the API without loading the page has no
//    token and is rejected.
//
// Rejections are logged with an `[antispam]` prefix so they show up in
// `heroku logs`.

const MIN_FILL_MS = 3000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const HONEYPOT_FIELD = 'website';
const TOKEN_FIELD = 'form_token';

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is required for form tokens');
  return s;
}

function sign(ts) {
  return crypto.createHmac('sha256', secret()).update(String(ts)).digest('hex');
}

export function issueFormToken() {
  const ts = Date.now();
  return `${ts}.${sign(ts)}`;
}

// Returns { ok: true } or { ok: false, silent, error }.
// `silent` = pretend success (honeypot); otherwise `error` is safe to show.
export function checkAntiSpam(req, formName) {
  const body = req.body || {};
  const ip = req.ip;

  if (typeof body[HONEYPOT_FIELD] === 'string' && body[HONEYPOT_FIELD].trim()) {
    console.warn(`[antispam] ${formName}: honeypot filled from ${ip}`);
    return { ok: false, silent: true };
  }

  const token = typeof body[TOKEN_FIELD] === 'string' ? body[TOKEN_FIELD] : '';
  const [tsPart, sig] = token.split('.');
  const ts = Number(tsPart);
  if (!tsPart || !sig || !Number.isFinite(ts)) {
    console.warn(`[antispam] ${formName}: missing/malformed form token from ${ip}`);
    return { ok: false, error: 'Please reload the page and try again.' };
  }
  const expected = sign(ts);
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    console.warn(`[antispam] ${formName}: bad form token signature from ${ip}`);
    return { ok: false, error: 'Please reload the page and try again.' };
  }
  const age = Date.now() - ts;
  if (age < MIN_FILL_MS) {
    console.warn(`[antispam] ${formName}: submitted ${age}ms after load from ${ip}`);
    return { ok: false, error: 'That was quick — please check the form and try again.' };
  }
  if (age > MAX_AGE_MS) {
    return { ok: false, error: 'This form has expired. Please reload the page and try again.' };
  }
  return { ok: true };
}
