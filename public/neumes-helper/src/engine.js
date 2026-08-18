// Resolution engine.
//
// Input: a transcription model (neumes per syllable, significative letters,
// per-note overrides) + a clef, a starting GABC position, and the flat state.
// Output: resolved notes (GABC staff position + clef-resolved note name +
// letter) and an assembled GABC score string, with diagnostic warnings.
//
// Everything is computed in GABC *staff positions* (a..m = 0..12). The clef is
// what turns a position into an actual pitch name, so the semitone (horned
// virga) and fa anchors land on the correct letters for whatever clef is set.
//
// Pitch logic:
//   * default motion is one staff step in the contour direction;
//   * significative letters force direction / unison / a moderate leap / fa;
//   * a horned virga snaps its note to the nearest semitone-above pitch;
//   * the editor can override any leap or flag per note.

import {
  noteNameAt,
  snapToNameNearStaff,
  snapToSemitoneAboveAt,
  posToLetter,
  letterToPos,
  inRange,
} from './pitch.js';
import { NEUMES, lookupNeume, renderNote } from './neumes.js';
import { resolveLetters } from './significative.js';

function resolveStartPos(model) {
  if (typeof model.startPos === 'number') return model.startPos;
  if (model.startLetter) return letterToPos(model.startLetter);
  return letterToPos('f'); // a sensible mid-staff default
}

// Merge catalogue default flags with per-note editor overrides.
function mergeFlags(base = {}, override = {}) {
  const out = { ...base };
  for (const [k, v] of Object.entries(override || {})) {
    if (v === false || v == null) delete out[k];
    else out[k] = v;
  }
  return out;
}

// Apply an absolute pitch anchor (fa / d) and/or the horned-virga semitone
// snap. An anchor pins to its fixed in-staff pitch (so it doesn't drift with
// the melody); the semitone snap is relative to the running note.
function applyConstraints(pos, flags, constraint, clef, bFlat) {
  let out = pos;
  if (constraint.anchorName) out = snapToNameNearStaff(constraint.anchorName, clef);
  if (flags.semitoneVirga) out = snapToSemitoneAboveAt(out, clef, bFlat);
  return out;
}

// Resolve the position of a neume's FIRST note relative to the previous note.
function resolveConnection(prevPos, neume, constraint, note0Flags, clef, bFlat) {
  // 1. explicit editor leap wins outright.
  if (neume.connect && typeof neume.connect.leap === 'number') {
    return applyConstraints(prevPos + neume.connect.leap, note0Flags, constraint, clef, bFlat);
  }

  // 2. otherwise derive a direction + magnitude.
  let dir = constraint.dir; // may be null (unknown) or -1/0/1
  if (neume.connect && typeof neume.connect.dir === 'number') dir = neume.connect.dir;

  let move;
  if (dir == null || dir === 0) {
    move = 0;
  } else {
    const mag = (neume.connect && neume.connect.mag) || constraint.magnitudeHint || 1;
    move = dir * mag;
  }

  return applyConstraints(prevPos + move, note0Flags, constraint, clef, bFlat);
}

export function resolve(model) {
  const bFlat = !!model.bFlat;
  const clef = model.clef || 'c4';
  let currentPos = resolveStartPos(model);

  const warnings = [];
  const resolvedSyllables = [];
  const tokens = []; // { gabc, wordstart, isBar }
  const tracker = { prevPos: null };
  let isFirstNoteOfPiece = true;

  for (let si = 0; si < model.syllables.length; si++) {
    const syl = model.syllables[si];
    const resolvedNeumes = [];
    let gabcFrag = '';

    for (const neumeInput of syl.neumes || []) {
      const cat = lookupNeume(neumeInput.type) || NEUMES[neumeInput.type];
      if (!cat) {
        warnings.push({ syllable: si, message: `Unknown neume: ${neumeInput.type}` });
        continue;
      }
      const { noteFlags, contour } = cat.expand(neumeInput.count);
      const overrides = neumeInput.notes || [];
      const constraint = resolveLetters(neumeInput.letters || []);

      const note0Flags = mergeFlags(noteFlags[0], overrides[0] && overrides[0].flags);

      const notes = [];
      // First note: connect to previous (or honour start pitch for the very
      // first note of the piece).
      let pos;
      if (isFirstNoteOfPiece) {
        pos = applyConstraints(currentPos, note0Flags, constraint, clef, bFlat);
        isFirstNoteOfPiece = false;
      } else {
        pos = resolveConnection(currentPos, neumeInput, constraint, note0Flags, clef, bFlat);
      }
      notes.push(makeNote(pos, note0Flags, clef, warnings, si, constraint.marks, 0, tracker));

      let running = pos;
      for (let k = 1; k < noteFlags.length; k++) {
        const ovr = overrides[k] || {};
        const flags = mergeFlags(noteFlags[k], ovr.flags);
        let nextPos;
        if (typeof ovr.leap === 'number') {
          nextPos = running + ovr.leap;
        } else {
          const dir = typeof ovr.dir === 'number' ? ovr.dir : contour[k - 1];
          const mag = ovr.mag || 1;
          nextPos = running + dir * mag;
        }
        if (flags.semitoneVirga) nextPos = snapToSemitoneAboveAt(nextPos, clef, bFlat);
        notes.push(makeNote(nextPos, flags, clef, warnings, si, [], k, tracker));
        running = nextPos;
      }

      currentPos = running;
      const fragment = notes.map((n) => renderNote(n.letter, n.flags)).join('');
      gabcFrag += fragment;
      resolvedNeumes.push({ type: cat.id, name: cat.name, notes, gabc: fragment });
    }

    const text = syl.text ?? '';
    // A syllable contributes a GABC token only if it carries notes; a bar that
    // follows it is emitted as its own standalone token.
    if (syl.neumes && syl.neumes.length) {
      tokens.push({ gabc: `${text}(${gabcFrag})`, wordstart: !!syl.wordstart, isBar: false });
    }
    if (syl.barAfter) {
      tokens.push({ gabc: `(${syl.barAfter})`, wordstart: true, isBar: true });
    }
    // resolvedSyllables stays 1:1 with the input syllables for easy UI mapping.
    resolvedSyllables.push({ text, neumes: resolvedNeumes, barAfter: syl.barAfter });
  }

  // Assemble: a space precedes a token only at a word boundary, around bars,
  // or for the first token; syllables within a word are glued together so
  // Gregorio adds the hyphens itself.
  let gabc = `(${clef})`;
  let prevBar = false;
  tokens.forEach((t, i) => {
    const sep = i === 0 || t.wordstart || t.isBar || prevBar ? ' ' : '';
    gabc += sep + t.gabc;
    prevBar = t.isBar;
  });

  return { gabc, syllables: resolvedSyllables, warnings, clef, bFlat };
}

function makeNote(pos, flags, clef, warnings, si, marks, idx, tracker) {
  // Apply connection-level marks (e.g. tenere -> mora) to the note they sit by.
  const noteFlags = { ...flags };
  if (marks && marks.includes('tenere') && idx === 0) noteFlags.mora = true;

  const intervalFromPrev = tracker && tracker.prevPos != null ? pos - tracker.prevPos : null;
  if (tracker) tracker.prevPos = pos;

  const letter = posToLetter(pos);
  const ir = inRange(pos);
  if (!ir) {
    warnings.push({
      syllable: si,
      message: `A note falls outside the GABC range a–m (got '${letter}'); change the clef or starting pitch.`,
    });
  }
  return {
    pos,
    name: noteNameAt(pos, clef),
    letter,
    inRange: ir,
    intervalFromPrev,
    isNeumeHead: idx === 0,
    flags: noteFlags,
  };
}
