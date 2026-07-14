/**
 * Daily matcher: find candidate recordings for catalogue groups that have
 * none, by searching YouTube and Spotify for "composer + title". Writes
 * scored rows to the suggestions table for human review — nothing is applied
 * automatically.
 *
 * Usage: node scripts/suggest-recordings.js [batchSize]
 * The YouTube Data API free quota (10,000 units/day, 100 per search) is the
 * limiter, so batchSize defaults to 80 (~8,000 units). Spotify is cheap and
 * runs for the same groups. Intended for a daily Heroku Scheduler run.
 */
import { pool } from '../src/db.js';

// YouTube's free quota (~100 searches/day) is the real limiter and resets
// daily; Spotify has no comparable hard cap. Big batches are allowed — once
// YouTube's quota is exhausted we stop calling it and let Spotify carry the
// rest of the run.
const BATCH = Math.min(Math.max(parseInt(process.argv[2], 10) || 80, 1), 2000);
// Surname must always match; MIN_SCORE applies to the fraction of distinctive
// title words found in the candidate text. 0.7 keeps the "Missa pro
// defunctis offered for a Missa de feria" class of false positive out (a
// 2-word title with 1 word matched scores 0.5) while letting long titles
// with one missing word through for human review.
const MIN_SCORE = Number(process.env.RECORDINGS_MIN_SCORE) || 0.7;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let youtubeExhausted = false;

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Fold i/j and u/v so Latin spelling variants match ("Iubilate"/"Jubilate").
function foldSpelling(s) {
  return String(s || '').replace(/j/g, 'i').replace(/v/g, 'u');
}

// Composer names are stored "Surname, Forenames"; the surname is the strong
// signal (e.g. "Victoria", "Palestrina").
function composerSurname(composerDisplay) {
  const first = String(composerDisplay || '').split(',')[0].split(';')[0];
  const norm = normalize(first);
  const parts = norm.split(' ').filter((w) => w.length >= 3);
  return parts.length ? parts[parts.length - 1] : norm;
}

/**
 * Score a candidate: the composer surname MUST appear in the candidate text
 * (otherwise 0), then the score is the fraction of distinctive title words
 * (length >= 3, spelling-folded) found. MIN_SCORE decides what is worth a
 * human's time — everything is reviewed anyway, so moderate recall beats
 * the old all-or-nothing rule that rejected candidates missing one word.
 */
function scoreCandidate(title, composerDisplay, candidateText) {
  const text = foldSpelling(normalize(candidateText));
  const surname = foldSpelling(composerSurname(composerDisplay));
  if (!surname || !text.includes(surname)) return 0;

  const titleWords = foldSpelling(normalize(title)).split(' ').filter((w) => w.length >= 3);
  if (!titleWords.length) return 0; // nothing distinctive to confirm the piece
  const matched = titleWords.filter((w) => text.includes(w)).length;
  return Math.round((matched / titleWords.length) * 100) / 100;
}

// Retry on transient failures (Spotify intermittently returns bursts of
// 502s). This matters more now groups are checkpointed: a failed search
// means the group is never re-searched, so give each request a fair chance.
async function fetchJson(url, options, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    const resp = await fetch(url, options);
    if (resp.ok) return resp.json();
    const transient = resp.status === 429 || resp.status >= 500;
    if (!transient || attempt >= tries) throw new Error(`HTTP ${resp.status}`);
    await sleep(1000 * attempt);
  }
}

// ---- YouTube ----
async function searchYouTube(query) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || youtubeExhausted) return [];
  const url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&q=' +
    encodeURIComponent(query) + '&key=' + key;
  const resp = await fetch(url);
  if (resp.status === 403 || resp.status === 429) {
    // dailyLimitExceeded / quotaExceeded / rate limited — stop hitting
    // YouTube for the rest of this run so we don't waste hundreds of calls.
    youtubeExhausted = true;
    console.warn(`YouTube quota reached (HTTP ${resp.status}) — skipping YouTube for the rest of this run.`);
    return [];
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  return (data.items || []).map((it) => ({
    videoId: it.id.videoId,
    title: it.snippet.title,
    channel: it.snippet.channelTitle,
    description: it.snippet.description,
  })).filter((v) => v.videoId);
}

// ---- Spotify (client-credentials) ----
let spotifyToken = null;
async function getSpotifyToken() {
  if (spotifyToken) return spotifyToken;
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  const data = await fetchJson('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  spotifyToken = data.access_token;
  return spotifyToken;
}

async function searchSpotify(query) {
  let token = await getSpotifyToken();
  if (!token) return [];
  const url = 'https://api.spotify.com/v1/search?type=track&limit=5&q=' + encodeURIComponent(query);
  let data;
  try {
    data = await fetchJson(url, { headers: { Authorization: 'Bearer ' + token } });
  } catch (err) {
    // Cached token may have expired mid-run (client-credentials tokens last
    // 1 hour); refresh once and retry.
    if (!String(err.message).includes('401')) throw err;
    spotifyToken = null;
    token = await getSpotifyToken();
    if (!token) return [];
    data = await fetchJson(url, { headers: { Authorization: 'Bearer ' + token } });
  }
  return ((data.tracks && data.tracks.items) || []).map((t) => ({
    url: t.external_urls && t.external_urls.spotify,
    title: t.name,
    artists: (t.artists || []).map((a) => a.name),
    album: t.album && t.album.name,
    durationMs: t.duration_ms,
  })).filter((t) => t.url);
}

function fmtDuration(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

async function insertSuggestion(kind, groupId, payload, score, source, dedupeKey) {
  const result = await pool.query(
    `INSERT INTO suggestions (kind, group_id, payload, score, source, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (dedupe_key) DO NOTHING`,
    [kind, groupId, JSON.stringify(payload), score, source, dedupeKey]
  );
  return result.rowCount;
}

async function main() {
  // recordings_checked_at is set for EVERY processed group (matched or not)
  // so daily runs advance through the catalogue instead of re-searching the
  // same block of unmatchable low-id groups forever.
  const groups = await pool.query(`
    SELECT g.id, g.display_title,
      (
        SELECT string_agg(DISTINCT comp.name, ', ')
        FROM compositions c
        CROSS JOIN LATERAL unnest(COALESCE(c.composer_id_list, ARRAY[]::integer[])) AS cid
        JOIN composers comp ON comp.id = cid AND comp.id != 23
        WHERE c.group_id = g.id
      ) AS composers
    FROM groups g
    WHERE g.recordings_checked_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM recordings r WHERE r.group_id = g.id)
      AND EXISTS (
        SELECT 1 FROM compositions c
        WHERE c.group_id = g.id
          AND c.composer_id_list IS NOT NULL
          AND array_length(array_remove(c.composer_id_list, 23), 1) > 0
      )
    ORDER BY g.id
    LIMIT $1
  `, [BATCH]);

  console.log(`Checking ${groups.rows.length} groups without recordings...`);
  let inserted = 0;

  for (const g of groups.rows) {
    // Mark as searched up front (even if the APIs fail midway).
    await pool.query('UPDATE groups SET recordings_checked_at = NOW() WHERE id = $1', [g.id]);
    if (!g.composers) continue;
    const primaryComposer = g.composers.split(',')[0].trim() + (g.composers.includes(',') ? '' : '');
    const query = `${g.composers.split(';')[0]} ${g.display_title}`.slice(0, 180);

    // YouTube
    try {
      const yt = await searchYouTube(query);
      const scored = yt
        .map((v) => ({ v, score: scoreCandidate(g.display_title, g.composers, `${v.title} ${v.channel} ${v.description}`) }))
        .filter((x) => x.score >= MIN_SCORE)
        .sort((a, b) => b.score - a.score);
      if (scored.length) {
        const best = scored[0];
        inserted += await insertSuggestion('recording_youtube', g.id, {
          url: 'https://www.youtube.com/watch?v=' + best.v.videoId,
          video_title: best.v.title,
          performer_name: best.v.channel,
          matched_query: query,
        }, best.score, 'youtube', `ryt:${g.id}:${best.v.videoId}`);
      }
    } catch (err) {
      console.warn(`  group ${g.id} youtube: ${err.message}`);
    }

    // Spotify
    try {
      const sp = await searchSpotify(query);
      const scored = sp
        .map((t) => ({ t, score: scoreCandidate(g.display_title, g.composers, `${t.title} ${t.artists.join(' ')} ${t.album}`) }))
        .filter((x) => x.score >= MIN_SCORE)
        .sort((a, b) => b.score - a.score);
      if (scored.length) {
        const best = scored[0];
        // Prefer an artist that isn't the composer as the performer.
        const surname = composerSurname(g.composers);
        const performer = best.t.artists.find((a) => !normalize(a).includes(surname)) || best.t.artists[0] || '';
        inserted += await insertSuggestion('recording_spotify', g.id, {
          url: best.t.url,
          track_title: best.t.title,
          performer_name: performer,
          duration: fmtDuration(best.t.durationMs),
          matched_query: query,
        }, best.score, 'spotify', `rsp:${g.id}:${best.t.url}`);
      }
    } catch (err) {
      console.warn(`  group ${g.id} spotify: ${err.message}`);
    }

    await sleep(300);
  }

  console.log(`Done. Inserted ${inserted} recording suggestions.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
