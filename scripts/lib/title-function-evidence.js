/**
 * Shared legitimacy test for a title → function link against the DO corpus
 * and the Vulgate psalter. Used to cite existing functions_titles rows and
 * to decide which pre-queue / suspicious links to drop.
 */
import { splitIncipitParts, foldSpelling, isOrdinaryText } from './matching.js';
import { matchPart, seasonOfDay, isMassProperPosition } from './do-corpus.js';
import { isPsalmVerse } from './psalm-verses.js';

/** Numbered Sundays whose psalm communions/introits are not distinctive. */
export function isOrdinaryTimeFunction(name) {
  return /ordinary time|post pentecost|epiphany ii|epiphany iii|septuagesima|sexagesima|quinquagesima/i
    .test(String(name || ''));
}

/** Functions where a psalm verse as Office (not Mass proper) is still the point. */
export function allowsPsalmOffice(name) {
  return /office for the dead|requiem/i.test(String(name || ''));
}

/** Best DO evidence for linking titleText to functionName, or null. */
export function findLinkEvidenceIn(titleText, functionName, corpus) {
  const parts = splitIncipitParts(titleText).map(foldSpelling);
  if (!parts.length) return null;
  const fn = String(functionName || '');
  let best = null;
  const partsHit = new Set();
  const psalmDays = new Set();

  for (const part of parts) {
    if (isOrdinaryText(part)) continue;
    const psalm = isPsalmVerse(part);
    for (const unit of matchPart(part, corpus)) {
      for (const place of unit.places) {
        const dayFn = place.fn || '';
        const season = seasonOfDay(place.day);
        if (dayFn !== fn && season !== fn) continue;
        if (psalm && !isMassProperPosition(place.position) && !allowsPsalmOffice(fn)) continue;
        partsHit.add(part);
        if (psalm) psalmDays.add(place.day);
        const n = Math.min(part.split(' ').length, unit.words.length);
        const rank = (isMassProperPosition(place.position) ? 100 : 0) + n;
        if (!best || rank > best.rank) best = { unit, place, rank, psalm };
      }
    }
  }
  if (!best) return null;
  // One Sunday communion of a psalm is not a durable feast assignment.
  if (best.psalm && psalmDays.size < 2 && !allowsPsalmOffice(fn)) {
    if (isOrdinaryTimeFunction(fn) || !isMassProperPosition(best.place.position)) return null;
  }
  return {
    match_text: best.unit.sample.slice(0, 200),
    match_citation: best.unit.citation || null,
    match_position: `${best.place.position} — ${best.place.dayLabel}`,
    parts_matched: partsHit.size,
    parts_total: parts.length,
    mass_proper: isMassProperPosition(best.place.position),
    psalm: !!best.psalm,
  };
}

/** Any DO hit for this function, including Office — used only to cite. */
export function findAnyDoEvidence(titleText, functionName, corpus) {
  const parts = splitIncipitParts(titleText).map(foldSpelling);
  const fn = String(functionName || '');
  let best = null;
  for (const part of parts) {
    if (isOrdinaryText(part)) continue;
    for (const unit of matchPart(part, corpus)) {
      for (const place of unit.places) {
        const dayFn = place.fn || '';
        const season = seasonOfDay(place.day);
        if (dayFn !== fn && season !== fn) continue;
        const n = Math.min(part.split(' ').length, unit.words.length);
        const rank = (isMassProperPosition(place.position) ? 100 : 0) + n;
        if (!best || rank > best.rank) best = { unit, place, rank };
      }
    }
  }
  if (!best) return null;
  return {
    match_text: best.unit.sample.slice(0, 200),
    match_citation: best.unit.citation || null,
    match_position: `${best.place.position} — ${best.place.dayLabel}`,
    mass_proper: isMassProperPosition(best.place.position),
  };
}

/**
 * Unlink only when we can show the assignment is a psalm-verse coincidence:
 * Office/lesson hit, or a 1-day ordinary-time Mass proper. Manual links
 * the matcher cannot see (rhymed offices, "O …" prefixes) are left alone.
 */
export function isPsalmOfficeCoincidence(titleText, functionName, corpus) {
  const parts = splitIncipitParts(titleText).map(foldSpelling);
  if (!parts.some((p) => !isOrdinaryText(p) && isPsalmVerse(p))) return false;
  if (findLinkEvidenceIn(titleText, functionName, corpus)) return false;
  const loose = findAnyDoEvidence(titleText, functionName, corpus);
  if (!loose) return false;
  if (allowsPsalmOffice(functionName)) return false;
  if (loose.mass_proper && !isOrdinaryTimeFunction(functionName)) return false;
  return true;
}
