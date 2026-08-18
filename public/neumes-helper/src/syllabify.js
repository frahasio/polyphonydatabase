// Ecclesiastical-Latin syllabifier.
//
// Liturgical Latin divides into syllables by fairly regular rules. This is a
// pragmatic implementation tuned for chant texts; it is meant as a *first
// pass* that the editor can correct in the grid (split/merge), not as an
// infallible authority.
//
// Rules applied:
//   * Diphthongs ae, oe, au, eu, ui (and capitalised forms) count as one vowel
//     nucleus; a following vowel starts a new syllable (hiatus), except the
//     common qu-/gu- + vowel and i-as-glide cases handled below.
//   * A single consonant between vowels goes with the following vowel.
//   * Two consonants split between syllables, UNLESS the pair is a mute+liquid
//     (e.g. tr, pr, cl, gl, ...) or a digraph (ch, ph, th, gn, qu, gu), which
//     stay together with the following vowel.
//   * Three+ consonants: keep a trailing mute+liquid / digraph with the next
//     syllable, the rest close the current one.

const VOWELS = 'aeiouyàáâèéêìíîòóôùúûAEIOUYÀÁÂÈÉÊÌÍÎÒÓÔÙÚÛæœÆŒ';
// Only the reliably-monosyllabic Latin diphthongs. (eu/ui are left out so
// De-us, me-us, etc. divide correctly; use a manual hyphen for the rare
// genuine eu/ui diphthong.)
const DIPHTHONGS = ['ae', 'oe', 'au'];
const DIGRAPHS = ['ch', 'ph', 'th', 'rh', 'gn', 'qu', 'gu', 'sc'];
const MUTES = 'bcdgptf';
const LIQUIDS = 'lr';

function isVowel(ch) {
  return !!ch && VOWELS.includes(ch);
}

function lc(ch) {
  return ch ? ch.toLowerCase() : '';
}

// Split a single word (letters only) into syllables.
export function syllabifyWord(word) {
  if (!word) return [word];
  // Manual override: if the editor typed hyphens, honour them verbatim.
  if (word.includes('-')) return word.split('-').filter((s) => s.length > 0);
  const chars = [...word];
  const lower = chars.map(lc);

  // 1. Find vowel-nucleus positions (collapsing diphthongs and qu/gu glides).
  const nuclei = [];
  for (let i = 0; i < chars.length; i++) {
    if (!isVowel(chars[i])) continue;
    // qu / gu: the u is a glide, not its own nucleus.
    if (lower[i] === 'u' && i > 0 && (lower[i - 1] === 'q' || lower[i - 1] === 'g') && isVowel(chars[i + 1] || '')) {
      continue;
    }
    // Consonantal i (yod): word-initial or intervocalic "i" before a vowel
    // acts as a consonant, so it does not form its own nucleus — it glides onto
    // the following vowel (iu-bi-la, al-le-lu-ia, e-ius, ma-ior).
    if (lower[i] === 'i' && isVowel(chars[i + 1] || '') && (i === 0 || isVowel(chars[i - 1]))) {
      continue;
    }
    // diphthong: this vowel + next form one nucleus.
    const pair = lower[i] + (lower[i + 1] || '');
    if (DIPHTHONGS.includes(pair)) {
      nuclei.push({ start: i, end: i + 1 });
      i++;
      continue;
    }
    nuclei.push({ start: i, end: i });
  }

  if (nuclei.length <= 1) return [word];

  // 2. Between consecutive nuclei, place the split point among the consonants.
  const cuts = []; // index in `chars` at which a new syllable begins
  for (let n = 0; n < nuclei.length - 1; n++) {
    const consStart = nuclei[n].end + 1;
    const consEnd = nuclei[n + 1].start - 1; // inclusive
    const numCons = consEnd - consStart + 1;

    let cut;
    if (numCons <= 0) {
      cut = nuclei[n + 1].start; // hiatus: split right before next vowel
    } else if (numCons === 1) {
      cut = consStart; // single consonant joins the following syllable
    } else {
      // 2+ consonants: check whether the LAST pair stays together.
      const a = lower[consEnd - 1];
      const b = lower[consEnd];
      const lastPair = a + b;
      const keepTogether = DIGRAPHS.includes(lastPair) || (MUTES.includes(a) && LIQUIDS.includes(b));
      cut = keepTogether ? consEnd - 1 : consEnd;
    }
    cuts.push(cut);
  }

  // 3. Slice the word at the cut points.
  const syllables = [];
  let prev = 0;
  for (const c of cuts) {
    syllables.push(chars.slice(prev, c).join(''));
    prev = c;
  }
  syllables.push(chars.slice(prev).join(''));
  return syllables.filter((s) => s.length > 0);
}

// Tokenise free text into words and separators, syllabifying each word.
// Returns a flat list of { text, kind } where kind is 'syllable' | 'sep'.
export function syllabifyText(text) {
  const out = [];
  const tokens = text.match(/[\p{L}\u00C0-\u024F'’-]+|[^\p{L}\s]+|\s+/gu) || [];
  for (const tok of tokens) {
    if (/^\s+$/.test(tok)) {
      // Preserve hard line breaks from the pasted text so the editor grid can
      // wrap at the same points; collapse other runs of whitespace to a space.
      out.push({ text: tok, kind: /\n/.test(tok) ? 'newline' : 'space' });
    } else if (/[\p{L}]/u.test(tok)) {
      for (const syl of syllabifyWord(tok)) out.push({ text: syl, kind: 'syllable' });
    } else {
      // punctuation / bars: attach as their own editable token.
      out.push({ text: tok, kind: 'sep' });
    }
  }
  return out;
}
