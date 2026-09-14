/**
 * Vulgate psalm-verse index from the vendored jgabc psalter. A title part
 * that is a word-for-word prefix of a psalm verse is "psalm-generic": the
 * Divinum Officium per-day files only list propers, so a psalm used as
 * ferial psalmody looks unique whenever it appears as a proper on one
 * obscure day.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { foldSpelling, normalizeIncipit } from './matching.js';

const PSALMS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'public', 'vendor', 'jgabc', 'psalms'
);

let index = null;

function addVerse(indexMap, text) {
  const norm = foldSpelling(normalizeIncipit(text));
  const words = norm.split(' ').filter(Boolean);
  if (words.length < 2) return;
  const first2 = words.slice(0, 2).join(' ');
  if (!indexMap.has(first2)) indexMap.set(first2, []);
  const list = indexMap.get(first2);
  const key = words.join(' ');
  if (!list.some((v) => v.key === key)) list.push({ key, words });
}

export function loadPsalmVerseIndex() {
  if (index) return index;
  const map = new Map();
  if (!fs.existsSync(PSALMS_DIR)) {
    index = map;
    return index;
  }
  for (const f of fs.readdirSync(PSALMS_DIR)) {
    if (!/^\d{3}\.txt$/.test(f)) continue;
    const raw = fs.readFileSync(path.join(PSALMS_DIR, f), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      addVerse(map, line.replace(/[*†]/g, ' '));
      for (const half of line.split(/[*†]/)) addVerse(map, half);
    }
  }
  index = map;
  return index;
}

/**
 * True when a normalized+folded incipit is a word-for-word prefix of a
 * psalm verse (or the verse is a prefix of the incipit). Two-word parts
 * count only when they open a longer verse — "Dixit Dominus", "Beatus vir".
 */
export function isPsalmVerse(part) {
  const words = String(part || '').split(' ').filter(Boolean);
  if (words.length < 2) return false;
  const cands = loadPsalmVerseIndex().get(words.slice(0, 2).join(' ')) || [];
  for (const v of cands) {
    const n = Math.min(words.length, v.words.length);
    let ok = true;
    for (let i = 0; i < n; i++) if (words[i] !== v.words[i]) { ok = false; break; }
    if (!ok) continue;
    if (n >= 3) return true;
    if (words.length === 2 && v.words.length >= 4) return true;
  }
  return false;
}
