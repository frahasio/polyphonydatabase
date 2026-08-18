// Neume catalogue.
//
// Each neume is described as a *contour over notes* plus default *nuance
// flags*, independent of absolute pitch. The engine (see engine.js) walks the
// contour from a starting pitch to produce diatonic indices, then this module
// renders the resolved pitches + flags into a GABC fragment.
//
// Conventions
// -----------
//   contour: directions BETWEEN the notes of this neume, length = noteCount-1.
//            U = +1 step, D = -1 step, S = 0 (unison). These are *default*
//            magnitudes of one step; the editor overrides leaps per note.
//   The relationship of a neume's FIRST note to the previous note (the
//   inter-neume connection) is NOT stored here — it comes from significative
//   letters or an editor override, and is handled by the engine.
//   noteFlags: per-note default nuance flags (quilisma, oriscus, stropha,
//            liquescent, inclinatum, virga).

export const U = 1;
export const D = -1;
export const S = 0;

const noFlags = () => ({});

// ---- GABC rendering of a single resolved note ----------------------------
export function renderNote(letter, flags = {}) {
  let out = flags.inclinatum ? letter.toUpperCase() : letter;
  if (flags.quilisma) out += 'w';
  if (flags.oriscus) out += 'o';
  if (flags.stropha) out += 's';
  if (flags.virga) out += 'v';
  // Liquescence: deminutus (~) is by far the most common; the augmentative /
  // diminutive forms are available for completeness.
  if (flags.liquescent === 'augmentative') out += '<';
  else if (flags.liquescent === 'diminutive') out += '>';
  else if (flags.liquescent) out += '~';
  if (flags.episema) out += '_';
  if (flags.mora) out += '.';
  return out;
}

// A catalogue entry can be either fixed (noteFlags + contour given directly) or
// variable (expand(count) -> {noteFlags, contour}). `expand(count)` normalises
// both into the same concrete shape.
function fixed(entry) {
  return {
    ...entry,
    variable: false,
    expand() {
      return { noteFlags: entry.noteFlags, contour: entry.contour };
    },
  };
}

function variable(entry) {
  return {
    ...entry,
    variable: true,
    expand(count) {
      return entry.build(count ?? entry.defaultCount ?? entry.minNotes);
    },
  };
}

// --------------------------------------------------------------------------
// The catalogue. `id` is the stable key; `aliases` feed the typed shorthand;
// `glyph` / `description` feed the clickable palette.
// --------------------------------------------------------------------------
export const NEUMES = {
  // ---- single notes ----
  punctum: fixed({
    id: 'punctum',
    name: 'Punctum',
    aliases: ['p', '.'],
    glyph: '\u25AA',
    description: 'Single note (square punctum).',
    noteFlags: [noFlags()],
    contour: [],
  }),

  virga: fixed({
    id: 'virga',
    name: 'Virga',
    aliases: ['v'],
    glyph: '\u2502',
    description: 'Single note, written with a stem. One pitch only.',
    noteFlags: [{ virga: true }],
    contour: [],
  }),

  // The "horned"/knuckled virga: a single note constrained to a pitch that has
  // a semitone immediately above it (E, B, or A when B-flat is active).
  virgaSemitone: fixed({
    id: 'virgaSemitone',
    name: 'Virga (horned / semitone)',
    aliases: ['vh', 'V^'],
    glyph: '\u2510',
    description: 'Virga marking a pitch with a semitone above it: E, B, or A (with flat).',
    noteFlags: [{ virga: true, semitoneVirga: true }],
    contour: [],
  }),

  oriscus: fixed({
    id: 'oriscus',
    name: 'Oriscus',
    aliases: ['o'],
    glyph: '\u223F',
    description: 'Single ornamental note, usually at the same pitch as its neighbour.',
    noteFlags: [{ oriscus: true }],
    contour: [],
  }),

  apostropha: fixed({
    id: 'apostropha',
    name: 'Apostropha',
    aliases: ["'", 'ap'],
    glyph: '\u2019',
    description: 'Single stropha note.',
    noteFlags: [{ stropha: true }],
    contour: [],
  }),

  // ---- two notes ----
  pes: fixed({
    id: 'pes',
    name: 'Pes (podatus)',
    aliases: ['/', 'pes', 'podatus'],
    glyph: '\u2197',
    description: 'Two notes ascending.',
    noteFlags: [noFlags(), noFlags()],
    contour: [U],
  }),

  clivis: fixed({
    id: 'clivis',
    name: 'Clivis (flexa)',
    aliases: ['\\', 'cli', 'clivis', 'flexa'],
    glyph: '\u2198',
    description: 'Two notes descending.',
    noteFlags: [noFlags(), noFlags()],
    contour: [D],
  }),

  epiphonus: fixed({
    id: 'epiphonus',
    name: 'Epiphonus (pes liquescent)',
    aliases: ['/~', 'epi'],
    glyph: '\u2197',
    description: 'Ascending two-note liquescent; second note sung lightly.',
    noteFlags: [noFlags(), { liquescent: true }],
    contour: [U],
  }),

  cephalicus: fixed({
    id: 'cephalicus',
    name: 'Cephalicus (clivis liquescent)',
    aliases: ['\\~', 'cep'],
    glyph: '\u2198',
    description: 'Descending two-note liquescent; second note sung lightly.',
    noteFlags: [noFlags(), { liquescent: true }],
    contour: [D],
  }),

  // ---- three notes ----
  torculus: fixed({
    id: 'torculus',
    name: 'Torculus',
    aliases: ['^', 'tor'],
    glyph: '\u2229',
    description: 'Three notes: up then down.',
    noteFlags: [noFlags(), noFlags(), noFlags()],
    contour: [U, D],
  }),

  porrectus: fixed({
    id: 'porrectus',
    name: 'Porrectus',
    aliases: ['por', 'v^'],
    glyph: '\u222A',
    description: 'Three notes: down then up.',
    noteFlags: [noFlags(), noFlags(), noFlags()],
    contour: [D, U],
  }),

  // Quilisma is most often a quilisma + rising note(s). This entry is the
  // common quilisma-pes; the quilisma flag can also be applied to any note.
  quilismaPes: fixed({
    id: 'quilismaPes',
    name: 'Quilisma (pes)',
    aliases: ['w', 'qui'],
    glyph: '\u2933',
    description: 'Quilisma followed by an ascending note (ascending semitone gesture).',
    noteFlags: [{ quilisma: true }, noFlags()],
    contour: [U],
  }),

  distropha: variable({
    id: 'distropha',
    name: 'Distropha',
    aliases: ['ss', "''"],
    glyph: '\u2019\u2019',
    description: 'Two strophae on the same pitch.',
    minNotes: 2,
    defaultCount: 2,
    build: (count) => ({
      noteFlags: Array.from({ length: count }, () => ({ stropha: true })),
      contour: Array.from({ length: count - 1 }, () => S),
    }),
  }),

  tristropha: variable({
    id: 'tristropha',
    name: 'Tristropha',
    aliases: ['sss', "'''"],
    glyph: '\u2019\u2019\u2019',
    description: 'Three strophae on the same pitch.',
    minNotes: 3,
    defaultCount: 3,
    build: (count) => ({
      noteFlags: Array.from({ length: count }, () => ({ stropha: true })),
      contour: Array.from({ length: count - 1 }, () => S),
    }),
  }),

  // ---- variable-length ascending / descending ----
  scandicus: variable({
    id: 'scandicus',
    name: 'Scandicus',
    aliases: ['sca', '//'],
    glyph: '\u2197',
    description: 'Ascending series of notes (punctum, virga, podatus); last note a virga.',
    minNotes: 3,
    defaultCount: 3,
    build: (count) => ({
      noteFlags: Array.from({ length: count }, (_, i) => (i === count - 1 ? { virga: true } : {})),
      contour: Array.from({ length: count - 1 }, () => U),
    }),
  }),

  climacus: variable({
    id: 'climacus',
    name: 'Climacus',
    aliases: ['clm', '\\\\'],
    glyph: '\u2198',
    description: 'Descending series: a (virga) head followed by descending puncta inclinata.',
    minNotes: 3,
    defaultCount: 3,
    build: (count) => ({
      noteFlags: Array.from({ length: count }, (_, i) => (i === 0 ? {} : { inclinatum: true })),
      contour: Array.from({ length: count - 1 }, () => D),
    }),
  }),

  ancus: variable({
    id: 'ancus',
    name: 'Ancus (climacus liquescent)',
    aliases: ['anc'],
    glyph: '\u2198',
    description: 'Descending climacus whose final note is liquescent.',
    minNotes: 3,
    defaultCount: 3,
    build: (count) => ({
      noteFlags: Array.from({ length: count }, (_, i) => {
        if (i === 0) return {};
        if (i === count - 1) return { inclinatum: true, liquescent: true };
        return { inclinatum: true };
      }),
      contour: Array.from({ length: count - 1 }, () => D),
    }),
  }),
};

// Build a lookup from every alias/id to its neume id, for the typed shorthand.
export const ALIAS_INDEX = (() => {
  const idx = new Map();
  for (const neume of Object.values(NEUMES)) {
    idx.set(neume.id.toLowerCase(), neume.id);
    for (const a of neume.aliases) idx.set(a.toLowerCase(), neume.id);
  }
  return idx;
})();

export function lookupNeume(token) {
  const id = ALIAS_INDEX.get(String(token).toLowerCase());
  return id ? NEUMES[id] : null;
}
