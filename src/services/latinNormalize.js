/**
 * House orthography for Latin liturgical texts:
 *
 *   - lowercase j -> i everywhere (ejus -> eius, allelúja -> allelúia)
 *   - capital J kept ONLY on proper nouns (Jesus, Jerusalem, Joánnes...);
 *     otherwise J -> I (Justus -> Iustus, JUbilate -> IUbilate)
 *   - ae / oe / œ digraphs -> æ (caeléstem -> cæléstem, coeli -> cæli),
 *     including accented (aé -> ǽ) and capital (Ae/Oe/Œ -> Æ) forms;
 *     diaeresis forms (aë, oë as in Israël, Noë) are left alone
 *
 * Applies to Latin only — never run this on English text.
 */

// Proper-noun stems that keep their J (matched case-insensitively at word
// start after the initial J).
const J_PROPER_STEMS = [
  'esu', // Jesu, Jesus, Jesum...
  'erusalem', 'erúsalem',
  'oann', 'oánn', // Joannes, Joannem...
  'acob', 'ácob',
  'oseph',
  'uda', 'úda', // Juda, Judas, Judaea, Judith handled below too
  'udith',
  'ordan', 'ordán',
  'esse',
  'oachim', 'óachim',
  'ona', 'óna', // Jonas, Jonathan
  'osaphat',
  'ericho', 'éricho',
  'ob', 'oel', 'óel',
  'ephte',
  'erem', 'érem', // Jeremias
  'osue', 'ósue', 'osu', // Josue
];

const stripAccentsLower = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function isProperJWord(word) {
  // word starts with J/j; check the remainder against the stems.
  const rest = stripAccentsLower(word.slice(1));
  return J_PROPER_STEMS.some((stem) => rest.startsWith(stripAccentsLower(stem)));
}

/** Normalize a plain Latin string (no GABC/HTML awareness). */
export function normalizeLatinText(text) {
  if (!text) return text;
  let s = String(text);

  // i/j policy. Handle word-by-word so we can inspect capital J words.
  s = s.replace(/\b[Jj][\wÀ-ÿ\u0100-\u017f]*/gu, (word) => {
    if (word[0] === 'J' && isProperJWord(word)) {
      // Keep the initial J; still fold any interior lowercase j (rare).
      return word[0] + word.slice(1).replace(/j/g, 'i');
    }
    const initial = word[0] === 'J' ? 'I' : 'i';
    return initial + word.slice(1).replace(/j/g, 'i');
  });
  // Interior lowercase j in words not starting with j (ejus, cujus, alleluja)
  s = s.replace(/j/g, 'i');

  // Digraphs -> æ. Order matters: accented pairs first.
  s = s
    .replace(/a[eé](?!\u0308)/g, (m) => (m[1] === 'é' ? 'ǽ' : 'æ'))
    .replace(/o[eé](?!\u0308)/g, (m) => (m[1] === 'é' ? 'ǽ' : 'æ'))
    .replace(/á[e]/g, 'ǽ')
    .replace(/œ́/g, 'ǽ')
    .replace(/œ/g, 'æ')
    .replace(/A[EeÉé]/g, 'Æ')
    .replace(/O[Ee]/g, 'Æ')
    .replace(/Œ/g, 'Æ');
  return s;
}

/**
 * Normalize the lyrics of a GABC score, leaving intact:
 *   - headers (except the name: value, which is display text)
 *   - note groups (...)
 *   - curly-brace groups {...}
 *   - markup tags <...> and the contents of <sp>...</sp> specials
 */
export function normalizeGabcLyrics(gabc) {
  if (!gabc) return gabc;
  const s = String(gabc);
  const pct = s.indexOf('%%');
  let head = pct >= 0 ? s.slice(0, pct + 2) : '';
  let body = pct >= 0 ? s.slice(pct + 2) : s;

  head = head.replace(/^(name:\s*)([^;]+)(;)/mi, (m, a, v, c) => a + normalizeLatinText(v) + c);

  const PROTECTED = /(\([^)]*\)|<sp>[\s\S]*?<\/sp>|<[^>]*>|\{[^}]*\})/g;
  body = body.split(PROTECTED).map((seg, i) => (i % 2 === 1 ? seg : normalizeLatinText(seg))).join('');

  return head + body;
}

/**
 * Shape a prose translation for a chant translation box: one line per
 * phrase-group (sentences), with // breaks at internal phrase boundaries.
 */
export function formatChantTranslation(text) {
  if (!text) return '';
  return String(text)
    .split(/\n{2,}/)
    .map((para) => para
      .replace(/\s*\n\s*/g, ' ')
      // Sentence boundaries become new lines
      .split(/(?<=[.!?])\s+(?=[A-Z“"])/)
      .map((sentence) => sentence.replace(/(?<=[;:])\s+/g, '//').trim())
      .join('\n'))
    .join('\n')
    .trim();
}
