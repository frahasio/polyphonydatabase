/**
 * Matcher: guess the language of titles that have none, from the title text
 * itself (stopword + suffix evidence — no external API). Writes rows to the
 * suggestions table for human review; nothing is applied automatically.
 *
 * Usage: node scripts/suggest-title-languages.js [--dry-run]
 * Cheap enough to run over every untagged title each time; dedupe_key
 * prevents duplicate queue entries.
 */
import { pool } from '../src/db.js';

const DRY_RUN = process.argv.includes('--dry-run');
// Below this confidence the guess is noise — leave the title for manual
// tagging rather than filling the queue with coin-flips.
const MIN_CONFIDENCE = Number(process.env.TITLE_LANG_MIN_CONFIDENCE) || 0.35;

// Distinctive high-frequency words per language, tuned for short incipits.
// Words shared between languages (e.g. "non" Latin/Italian, "in"
// Latin/English/German) are deliberately listed under several languages so
// they cancel out rather than mislead.
const WORDS = {
  Latin: [
    'et', 'in', 'est', 'non', 'qui', 'quae', 'quod', 'quam', 'cum', 'ad', 'me', 'te',
    'mihi', 'tibi', 'nos', 'ne', 'sed', 'ut', 'si', 'de', 'ex', 'per', 'super', 'sub',
    'domine', 'dominus', 'domini', 'deus', 'dei', 'deo', 'deum', 'jesu', 'iesu',
    'christe', 'christi', 'maria', 'mariae', 'virgo', 'sancta', 'sancte', 'sancti',
    'sanctus', 'gloria', 'alleluia', 'ave', 'salve', 'regina', 'mater', 'pater',
    'anima', 'caeli', 'caelo', 'terra', 'terram', 'ecce', 'quia', 'tu', 'ego', 'o',
    'miserere', 'laudate', 'cantate', 'benedictus', 'benedicta', 'omnes', 'omnia',
  ],
  Italian: [
    'che', 'chi', 'di', 'la', 'il', 'lo', 'gli', 'le', 'mi', 'io', 'tu', 'non', 'si',
    'per', 'con', 'del', 'della', 'dell', 'nel', 'al', 'da', 'se', 'ma', 'più', 'piu',
    'amor', 'amore', 'amanti', 'cor', 'core', 'cuore', 'occhi', 'dolce', 'vita',
    'morte', 'morir', 'morire', 'donna', 'madonna', 'ben', 'bella', 'bello', 'mio',
    'mia', 'tuo', 'tua', 'sospir', 'crudo', 'crudel', 'ohimè', 'ohime', 'deh', 'ecco',
  ],
  English: [
    'the', 'of', 'and', 'my', 'thy', 'thee', 'thou', 'is', 'a', 'to', 'in', 'i',
    'lord', 'god', 'o', 'when', 'shall', 'will', 'unto', 'upon', 'not', 'me', 'have',
    'his', 'her', 'from', 'with', 'all', 'praise', 'sing', 'come', 'hear', 'prayer',
    'heart', 'soul', 'king', 'heaven', 'saviour', 'as', 'on', 'this', 'that', 'be',
  ],
  French: [
    'le', 'les', 'des', 'du', 'je', 'tu', 'vous', 'nous', 'mon', 'ma', 'mes', 'ton',
    'que', 'qui', 'ne', 'pas', 'est', 'et', 'en', 'un', 'une', 'au', 'aux', 'dans',
    'amour', 'coeur', 'cœur', 'dieu', 'seigneur', 'plaisir', 'douce', 'doux', 'bien',
    'quand', 'plus', 'sans', 'pour', 'sur', 'mais', 'moy', 'vostre', 'mort',
  ],
  German: [
    'ich', 'und', 'der', 'die', 'das', 'ein', 'eine', 'mein', 'dein', 'ist', 'nicht',
    'herr', 'gott', 'du', 'wir', 'ihr', 'mit', 'auf', 'von', 'zu', 'so', 'wie', 'wenn',
    'herz', 'lieb', 'liebe', 'wohl', 'nun', 'alle', 'uns', 'dich', 'mich', 'sich',
  ],
  Spanish: [
    'el', 'los', 'las', 'la', 'y', 'de', 'del', 'que', 'mi', 'no', 'yo', 'me', 'con',
    'por', 'para', 'un', 'una', 'es', 'dios', 'señor', 'senor', 'amor', 'ojos',
    'vida', 'muerte', 'alma', 'corazón', 'corazon', 'niño', 'nino', 'ay', 'muy',
  ],
  Dutch: [
    'de', 'het', 'een', 'ik', 'mijn', 'niet', 'god', 'heer', 'en', 'van', 'te', 'is',
    'die', 'dat', 'met', 'als', 'zijn', 'ons', 'wij', 'ghi', 'mijnen', 'seer',
  ],
};

// Suffix evidence: characteristic word endings, weighted below whole-word
// hits. Latin inflections are highly distinctive in incipits.
const SUFFIXES = {
  Latin: ['um', 'us', 'am', 'em', 'orum', 'arum', 'ibus', 'atis', 'emus', 'avit', 'erunt', 'tur'],
  Italian: ['zza', 'ando', 'endo', 'ate', 'ita', 'ella', 'etto', 'issimo'],
  German: ['lich', 'ung', 'heit', 'keit', 'chen'],
};

// Accented characters / orthography as extra evidence.
const CHARS = {
  Italian: /[àèìòù]|(?:\b(?:d|l|ch|s|m|t|n|v|qu|gl)['’])/i,
  French: /[éèêëçâîôû]/,
  German: /[äöüß]/,
  Spanish: /[ñ¿¡]|ó/,
};

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\[.*?\]/g, ' ')
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
}

function detectLanguage(text) {
  const words = tokenize(text);
  if (!words.length) return null;
  const scores = new Map();
  const evidence = new Map();
  const bump = (lang, amount, why) => {
    scores.set(lang, (scores.get(lang) || 0) + amount);
    if (why) {
      if (!evidence.has(lang)) evidence.set(lang, []);
      evidence.get(lang).push(why);
    }
  };

  for (const [lang, list] of Object.entries(WORDS)) {
    const set = new Set(list);
    for (const w of words) if (set.has(w)) bump(lang, 1, w);
  }
  for (const [lang, suffixes] of Object.entries(SUFFIXES)) {
    for (const w of words) {
      if (w.length >= 4 && suffixes.some((s) => w.endsWith(s))) bump(lang, 0.5, `-${w.slice(-3)}`);
    }
  }
  for (const [lang, re] of Object.entries(CHARS)) {
    if (re.test(text)) bump(lang, 1.5, 'orthography');
  }

  const ranked = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] <= 0) return null;
  const [lang, top] = ranked[0];
  const second = ranked[1] ? ranked[1][1] : 0;
  // Confidence: how decisively the winner beats the runner-up, scaled by
  // how much of the title it explains.
  const margin = top > 0 ? (top - second) / top : 0;
  const coverage = Math.min(top / Math.max(words.length, 2), 1);
  const confidence = Math.round(margin * (0.5 + 0.5 * coverage) * 100) / 100;
  return { lang, confidence, evidence: (evidence.get(lang) || []).slice(0, 8) };
}

async function main() {
  const langRows = await pool.query('SELECT id, language FROM languages');
  const langIds = new Map(langRows.rows.map((r) => [r.language, r.id]));

  const titles = await pool.query(`
    SELECT t.id, t.text
    FROM titles t
    WHERE t.language IS NULL
      AND EXISTS (SELECT 1 FROM compositions c WHERE c.title_id = t.id)
    ORDER BY t.id
  `);
  console.log(`Guessing language for ${titles.rows.length} untagged titles${DRY_RUN ? ' [dry run]' : ''}...`);

  let inserted = 0;
  for (const title of titles.rows) {
    const guess = detectLanguage(title.text);
    if (!guess || guess.confidence < MIN_CONFIDENCE) continue;
    const languageId = langIds.get(guess.lang);
    if (languageId === undefined) continue;

    if (DRY_RUN) {
      console.log(`  ${title.id} "${title.text}" -> ${guess.lang} (${Math.round(guess.confidence * 100)}%: ${guess.evidence.join(', ')})`);
      inserted++;
      continue;
    }
    const result = await pool.query(
      `INSERT INTO suggestions (kind, title_id, payload, score, source, dedupe_key)
       VALUES ('title_language', $1, $2, $3, 'heuristic', $4)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        title.id,
        JSON.stringify({
          language_id: languageId,
          language_name: guess.lang,
          evidence: guess.evidence,
        }),
        guess.confidence,
        `tl:${title.id}`,
      ]
    );
    if (result.rowCount) {
      inserted++;
      console.log(`  ${title.id} "${title.text}" -> ${guess.lang} (${Math.round(guess.confidence * 100)}%)`);
    }
  }

  console.log(`Done. ${DRY_RUN ? 'Would insert' : 'Inserted'} ${inserted} language suggestions.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
