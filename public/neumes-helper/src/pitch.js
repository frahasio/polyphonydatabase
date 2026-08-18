// Clef-aware pitch model.
//
// GABC encodes pitch as a *staff position* — letters a..m (13 positions) that
// mean "this line/space", independent of the clef. The actual sounding pitch
// (and therefore where the mi–fa / ti–do semitones fall) depends on where the
// clef sits. So everything here is computed from a GABC position PLUS the clef.
//
// Position integer: 0 = 'a' (lowest) … 12 = 'm' (highest).
//
// Clef → pitch-name mapping
// -------------------------
// With a do-clef on the top line of a 4-line staff (c4), GABC a..g = A..G (the
// documented "English notation" case). Moving the clef down one line shifts the
// name mapping by a third (two diatonic steps). A fa-clef names its line fa(F)
// instead of do(C), i.e. +3 steps relative to the same-line do-clef. That gives:
//   do-clef cL:  nameIndex(pos) = (pos + 6 - 2L) mod 7
//   fa-clef fL:  nameIndex(pos) = (pos + 2 - 2L) mod 7
// (names indexed 0=C,1=D,2=E,3=F,4=G,5=A,6=B). Verified against:
//   c4: f→F, a→A   c3: f→A   f3: f→D.

const NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

export const GABC_MIN = 0; // 'a'
export const GABC_MAX = 12; // 'm'

export function parseClef(clef) {
  const m = /^([cf])b?([1-4])$/.exec(String(clef || 'c4').toLowerCase());
  if (!m) return { type: 'c', line: 4 };
  return { type: m[1], line: parseInt(m[2], 10) };
}

export function letterToPos(letter) {
  return String(letter).toLowerCase().charCodeAt(0) - 97;
}

export function posToLetter(pos) {
  return String.fromCharCode(97 + pos);
}

export function inRange(pos) {
  return pos >= GABC_MIN && pos <= GABC_MAX;
}

// Diatonic name index (0=C..6=B) of a GABC position under a clef.
export function nameIndexAt(pos, clef) {
  const { type, line } = parseClef(clef);
  const off = type === 'c' ? 6 - 2 * line : 2 - 2 * line;
  return (((pos + off) % 7) + 7) % 7;
}

export function noteNameAt(pos, clef) {
  return NAMES[nameIndexAt(pos, clef)];
}

// Is the diatonic step from this note up to the next a semitone?
// Semitones sit at E–F and B–C; with B-flat, B–C becomes a tone and A–B♭ a
// semitone, so the "semitone above" set shifts {E,B} -> {E,A}.
export function hasSemitoneAbove(pos, clef, bFlat = false) {
  const n = noteNameAt(pos, clef);
  if (n === 'E') return true;
  if (n === 'B') return !bFlat;
  if (n === 'A') return bFlat;
  return false;
}

export function semitoneAboveNames(bFlat = false) {
  return bFlat ? ['E', 'A'] : ['E', 'B'];
}

// The middle of the 4-line staff in GABC positions. The staff lines sit at
// d(3) f(5) h(7) j(9), so the centre is g(6). Absolute pitch anchors register
// against this so e.g. 'd' is the bottom-line D and 'f' the F a third above —
// the same fixed pitches regardless of where the melody currently sits.
export const STAFF_CENTER = 6;

// The occurrence of `name` (under the clef) that sits in the staff — i.e.
// nearest the staff centre. Used for absolute pitch anchors (fa, d).
export function snapToNameNearStaff(name, clef, center = STAFF_CENTER) {
  let best = center;
  let bestDist = Infinity;
  for (let c = center - 6; c <= center + 6; c++) {
    if (noteNameAt(c, clef) !== name) continue;
    const dist = Math.abs(c - center);
    if (dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}

// Nearest position (to `pos`) whose clef-name equals `name`.
export function snapToNameAt(pos, name, clef) {
  let best = pos;
  let bestDist = Infinity;
  for (let c = pos - 6; c <= pos + 6; c++) {
    if (noteNameAt(c, clef) !== name) continue;
    const dist = Math.abs(c - pos);
    if (dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}

// Nearest position that carries a semitone above it (the horned/knuckled virga).
export function snapToSemitoneAboveAt(pos, clef, bFlat = false) {
  const names = semitoneAboveNames(bFlat);
  let best = pos;
  let bestDist = Infinity;
  for (let c = pos - 6; c <= pos + 6; c++) {
    if (!names.includes(noteNameAt(c, clef))) continue;
    const dist = Math.abs(c - pos);
    if (dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}
