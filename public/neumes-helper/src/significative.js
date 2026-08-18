// Litterae significativae (significative / "Romanian" letters) and other
// editorial annotations that constrain how a neume's first note relates to the
// previous note, or pin an absolute pitch.
//
// Each letter carries a `kind`:
//   'direction' — forces ascent/descent/unison of the connection (default
//                 magnitude one step; `mediocriter` hints a moderate move).
//   'anchor'    — pins an absolute pitch (fa).
//   'mark'      — affects rendering/length only (tenere), not pitch.
//
// `dir`: +1 up, -1 down, 0 unison, null = not a contour constraint.
// `hint`: optional preferred magnitude when the editor hasn't set a leap.

export const SIGNIFICATIVE = {
  e: { id: 'e', kind: 'direction', dir: 0, latin: 'equaliter', gloss: 'same pitch as previous note' },

  l: { id: 'l', kind: 'direction', dir: 1, latin: 'levare', gloss: 'higher' },
  s: { id: 's', kind: 'direction', dir: 1, latin: 'sursum', gloss: 'higher (up)' },

  h: { id: 'h', kind: 'direction', dir: -1, latin: 'humiliter', gloss: 'lower' },
  iu: { id: 'iu', kind: 'direction', dir: -1, latin: 'iusum', gloss: 'lower (down)' },
  io: { id: 'io', kind: 'direction', dir: -1, latin: 'iusum', gloss: 'lower (down)' },
  ius: { id: 'ius', kind: 'direction', dir: -1, latin: 'iusum', gloss: 'lower (down)' },
  u: { id: 'u', kind: 'direction', dir: -1, latin: 'iusum', gloss: 'lower (down)' },

  // mediocriter: a moderate move (not unison, not a wide leap). We leave the
  // direction to context but bias the magnitude toward a small leap (a third)
  // unless the editor sets it.
  m: { id: 'm', kind: 'direction', dir: null, hint: 3, latin: 'mediocriter', gloss: 'moderately (a moderate interval)' },

  // Absolute pitch anchors that pin to fixed staff pitches: d is the lower
  // (bottom line in a c4 clef) and f the minor third above it.
  f: { id: 'f', kind: 'anchor', name: 'F', latin: 'fa', gloss: 'the pitch fa (F) — a minor third above d' },
  d: { id: 'd', kind: 'anchor', name: 'D', latin: 'd', gloss: 'the pitch d — bottom line in a c4 clef' },

  // tenere: hold the note — rendered as a mora/episema, optionally a phrase end.
  t: { id: 't', kind: 'mark', mark: 'tenere', latin: 'tenere', gloss: 'hold / lengthen this note' },
};

export function lookupLetter(token) {
  return SIGNIFICATIVE[String(token).toLowerCase()] ?? null;
}

// Resolve a list of significative-letter tokens attached to a connection into a
// single constraint object the engine can apply.
export function resolveLetters(tokens = []) {
  const constraint = { dir: null, magnitudeHint: null, anchorName: null, marks: [] };
  for (const tok of tokens) {
    const def = lookupLetter(tok);
    if (!def) continue;
    if (def.kind === 'direction') {
      if (def.dir !== null) constraint.dir = def.dir;
      if (def.hint != null) constraint.magnitudeHint = def.hint;
    } else if (def.kind === 'anchor') {
      constraint.anchorName = def.name;
    } else if (def.kind === 'mark') {
      constraint.marks.push(def.mark);
    }
  }
  return constraint;
}
