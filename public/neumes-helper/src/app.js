import { NEUMES } from './neumes.js';
import { SIGNIFICATIVE } from './significative.js';
import { syllabifyText } from './syllabify.js';
import { resolve } from './engine.js';
import { noteNameAt, letterToPos } from './pitch.js';

// ---- state ---------------------------------------------------------------
// The starting pitch is a GABC staff position (letter). What note that *sounds*
// depends on the clef, so the picker shows the resolved pitch name alongside.
const START_LETTERS = ['c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];

// Soft editorial contour: the direction this neume's first note moves relative
// to the previous note, WITHOUT committing to an interval size. The engine
// resolves these as one step by default and recomputes them whenever anchors
// (fa, horned virga) or exact leaps elsewhere shift the line.
const CONTOURS = [
  { v: 'auto', label: 'auto', title: 'no editorial direction yet (defaults to continue from previous note)' },
  { v: '1', label: '▲ higher', title: 'higher than the previous note (relative, updates dynamically)' },
  { v: '0', label: '= same', title: 'same pitch as the previous note' },
  { v: '-1', label: '▼ lower', title: 'lower than the previous note (relative, updates dynamically)' },
];

// Optional hard override when you actually know the interval.
const EXACT_LEAPS = [
  { v: '', label: '— exact interval —' },
  { v: '1', label: 'up a 2nd' }, { v: '2', label: 'up a 3rd' }, { v: '3', label: 'up a 4th' }, { v: '4', label: 'up a 5th' },
  { v: '-1', label: 'down a 2nd' }, { v: '-2', label: 'down a 3rd' }, { v: '-3', label: 'down a 4th' }, { v: '-4', label: 'down a 5th' },
];

// Interval options for an interior note of a multi-note neume (its step from
// the previous note within the same neume).
const INTERVALS = [
  { v: '-4', label: 'down a 5th' }, { v: '-3', label: 'down a 4th' }, { v: '-2', label: 'down a 3rd' }, { v: '-1', label: 'down a 2nd' },
  { v: '0', label: 'unison' },
  { v: '1', label: 'up a 2nd' }, { v: '2', label: 'up a 3rd' }, { v: '3', label: 'up a 4th' }, { v: '4', label: 'up a 5th' },
];

// Keyboard shortcut character -> neume id (also shown as a badge on the palette).
const NEUME_KEYS = {
  '.': 'punctum',
  '/': 'virga',
  ',': 'pes',
  '\\': 'clivis',
  '^': 'torculus',
  v: 'porrectus',
  c: 'climacus',
  s: 'scandicus',
};
const KEY_FOR_NEUME = Object.fromEntries(Object.entries(NEUME_KEYS).map(([k, id]) => [id, k]));

// Separation bars (GABC code -> description). Inserted as standalone tokens.
const BARS = [
  { code: ',', label: 'Quarter bar (divisio minima)' },
  { code: ';', label: 'Half bar (divisio minor)' },
  { code: ':', label: 'Full bar (divisio maior)' },
  { code: '::', label: 'Double bar (divisio finalis)' },
];
const BAR_LABELS = Object.fromEntries(BARS.map((b) => [b.code, b.label]));

const NOTE_FLAGS = [
  ['quilisma', 'quilisma'],
  ['oriscus', 'oriscus'],
  ['stropha', 'stropha'],
  ['liquescent', 'liquescent'],
  ['inclinatum', 'inclinatum'],
  ['semitoneVirga', 'horned (semitone)'],
  ['episema', 'episema'],
  ['mora', 'mora (·)'],
];

const state = {
  clef: 'c4',
  startLetter: 'f',
  bFlat: false,
  // The text box is the source of truth for syllables; each syllable holds its
  // own neumes and an optional bar that follows it (barAfter).
  syllables: [], // { text, wordstart, linebreak, neumes: [...], barAfter? }
  selSyl: null,
  selNeume: null,
  selNote: null, // active note index within the selected neume (null = last)
  barSelected: false, // true => the bar after selSyl is the current selection
};

// ---- model for the engine ------------------------------------------------
function model() {
  return {
    clef: state.clef,
    startLetter: state.startLetter,
    bFlat: state.bFlat,
    // Pass every syllable; the engine keeps resolved output 1:1 with this list.
    syllables: state.syllables.map((s) => ({
      text: s.text,
      neumes: s.neumes || [],
      wordstart: s.wordstart,
      linebreak: s.linebreak,
      barAfter: s.barAfter,
    })),
  };
}

function resolved() {
  try {
    const r = resolve(model());
    return { r, rs: r.syllables }; // rs[i] aligns with state.syllables[i]
  } catch (err) {
    return { r: { gabc: '', syllables: [], warnings: [{ message: String(err.message) }] }, rs: [] };
  }
}

// ---- DOM helpers ---------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const kid of kids) node.append(kid?.nodeType ? kid : document.createTextNode(kid ?? ''));
  return node;
}

// ---- syllabify (the text box is the live source of truth) ----------------
function textToSlots(text) {
  const tokens = syllabifyText(text);
  const slots = [];
  let wordstart = true;
  let linebreak = false;
  for (const tok of tokens) {
    if (tok.kind === 'space') {
      wordstart = true;
    } else if (tok.kind === 'newline') {
      wordstart = true;
      linebreak = true;
    } else if (tok.kind === 'syllable') {
      slots.push({ text: tok.text, wordstart, linebreak, neumes: [] });
      wordstart = false;
      linebreak = false;
    } else if (slots.length) {
      slots[slots.length - 1].text += tok.text;
    }
  }
  return slots;
}

// Carry neumes (and the trailing bar) from old syllables onto the freshly
// syllabified ones by matching syllable text (LCS), so editing the text box
// preserves the work you've already done wherever the syllable is unchanged.
function carryOverNeumes(oldSyls, newSlots) {
  const a = oldSyls;
  const b = newSlots;
  // Match on letters only, so adding punctuation or changing case to a syllable
  // doesn't drop its neumes.
  const key = (s) => (s.text || '').replace(/[^\p{L}]/gu, '').toLowerCase();
  const ka = a.map(key);
  const kb = b.map(key);
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = ka[i] === kb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ka[i] === kb[j]) {
      if (a[i].neumes && a[i].neumes.length) b[j].neumes = a[i].neumes;
      if (a[i].barAfter) b[j].barAfter = a[i].barAfter;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return b;
}

function rebuildFromText() {
  const slots = textToSlots($('#textInput').value);
  carryOverNeumes(state.syllables, slots);
  state.syllables = slots;
  // keep the selection sane after re-syllabification
  if (state.selSyl == null || state.selSyl >= slots.length) state.selSyl = slots.length ? Math.min(state.selSyl ?? 0, slots.length - 1) : null;
  state.selNeume = null;
  state.selNote = null;
  state.barSelected = false;
  render();
}

// Rebuild the text-box contents from the syllable list (used when loading a
// saved project), gluing within-word syllables and breaking lines as stored.
function reconstructText(syls) {
  let out = '';
  syls.forEach((s, i) => {
    const sep = i === 0 ? '' : s.linebreak ? '\n' : s.wordstart ? ' ' : '';
    out += sep + s.text;
  });
  return out;
}

// ---- rendering -----------------------------------------------------------
// Format a leap (in staff steps) as a directed interval: +2 -> "↑3" (a third),
// 0 -> "=" (unison).
function fmtLeap(leap) {
  if (leap === 0) return '=';
  return (leap > 0 ? '↑' : '↓') + (Math.abs(leap) + 1);
}

// Keep the page's bottom padding and the preview height in step with the
// (variable-height) docked palette/editor.
function adjustDock() {
  const dock = $('#dock');
  if (dock) document.documentElement.style.setProperty('--dock-h', `${dock.offsetHeight}px`);
}

function render() {
  renderGrid();
  renderInspector();
  renderOutput();
  requestAnimationFrame(adjustDock);
}

const PX_PER_STEP = 6;
const MAX_OFFSET = 36;

function renderGrid() {
  const grid = $('#grid');
  grid.replaceChildren();
  const { rs } = resolved();

  // Reference pitch for the contour display: the mean of all resolved notes.
  const allP = [];
  for (const rsyl of rs) for (const n of rsyl.neumes) for (const note of n.notes) allP.push(note.pos);
  const refP = allP.length ? allP.reduce((a, b) => a + b, 0) / allP.length : 0;
  const offsetFor = (p) => Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, (refP - p) * PX_PER_STEP));

  state.syllables.forEach((syl, si) => {
    if (syl.linebreak && si > 0) grid.append(el('div', { class: 'linebreak' }));

    const card = el('div', { class: 'syl' + (si === state.selSyl && !state.barSelected ? ' selected' : '') + (syl.wordstart && !syl.linebreak ? ' wordstart' : '') });
    card.addEventListener('click', () => {
      state.selSyl = si;
      state.barSelected = false;
      state.selNeume = syl.neumes.length ? state.selNeume : null;
      state.selNote = null;
      render();
    });

    const neumesBox = el('div', { class: 'neumes' });
    const rsyl = rs[si];
    if (!syl.neumes.length) {
      neumesBox.append(el('span', { class: 'empty' }, '+'));
    } else {
      syl.neumes.forEach((nm, ni) => {
        const cat = NEUMES[nm.type];
        const rn = rsyl && rsyl.neumes[ni];
        const warn = rn && rn.notes.some((n) => !n.inRange);
        const chip = el('span', {
          class: 'chip' + (si === state.selSyl && ni === state.selNeume ? ' sel' : '') + (warn ? ' warn' : ''),
          title: cat ? cat.name : nm.type,
        }, cat ? cat.glyph : '?');
        const pitches = rn ? rn.notes.map((n) => n.letter).join('') : '';
        chip.append(el('span', { class: 'pitch' }, pitches));
        // badge any significative letters assigned to this neume
        if (nm.letters && nm.letters.length) {
          chip.classList.add('haslet');
          chip.append(el('span', { class: 'siglet', title: 'significative letters: ' + nm.letters.join(' ') }, nm.letters.join('')));
        }
        // badge manual interval overrides:
        //  - the connection (first note) only when it's a real leap (a 3rd+);
        //  - any interior interval that differs from the neume's default shape.
        const ovr = [];
        if (nm.connect && typeof nm.connect.leap === 'number' && Math.abs(nm.connect.leap) >= 2) ovr.push(nm.connect.leap);
        const contour = cat ? cat.expand(nm.count).contour : [];
        (nm.notes || []).forEach((nt, k) => {
          if (k >= 1 && nt && typeof nt.leap === 'number' && nt.leap !== contour[k - 1]) ovr.push(nt.leap);
        });
        if (ovr.length) {
          chip.classList.add('hasovr');
          chip.append(el('span', { class: 'ovr', title: 'edited interval(s)' }, ovr.map(fmtLeap).join(' ')));
        }
        // raise/lower the chip to visualise the melodic contour
        if (rn && rn.notes.length) {
          const avg = rn.notes.reduce((a, n) => a + n.pos, 0) / rn.notes.length;
          chip.style.transform = `translateY(${offsetFor(avg)}px)`;
        }
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          state.selSyl = si;
          state.selNeume = ni;
          state.selNote = null;
          render();
        });
        neumesBox.append(chip);
      });
    }

    card.append(neumesBox, el('div', { class: 'text' }, syl.text));
    grid.append(card);

    // a separation bar that follows this syllable
    if (syl.barAfter) {
      const barEl = el('div', {
        class: 'bar' + (si === state.selSyl && state.barSelected ? ' selected' : ''),
        title: BAR_LABELS[syl.barAfter] || syl.barAfter,
      }, el('span', { class: 'barcode' }, syl.barAfter));
      barEl.addEventListener('click', (e) => { e.stopPropagation(); state.selSyl = si; state.barSelected = true; state.selNeume = null; state.selNote = null; render(); });
      grid.append(barEl);
    }
  });

  if (!state.syllables.length) grid.append(el('span', { class: 'hint' }, 'Type or paste text above to begin.'));
}

function selectedNeume() {
  if (state.selSyl == null || state.selNeume == null) return null;
  const syl = state.syllables[state.selSyl];
  return syl ? syl.neumes[state.selNeume] : null;
}

function renderInspector() {
  const box = $('#inspector');
  box.replaceChildren();

  const selected = state.selSyl != null ? state.syllables[state.selSyl] : null;

  // Bar editor (when the selected item is a bar that follows a syllable).
  if (selected && state.barSelected) {
    const barRow = el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'Separation bar'));
    for (const b of BARS) {
      barRow.append(el('button', { class: 'toggle' + (selected.barAfter === b.code ? ' on' : ''), title: b.label, onclick: () => { selected.barAfter = b.code; render(); } }, b.code));
    }
    box.append(barRow);
    box.append(el('div', { class: 'row' }, el('button', { onclick: () => deleteSelected() }, 'Delete bar')));
    return;
  }

  const nm = selectedNeume();
  if (!nm) {
    box.append(el('p', { class: 'hint' }, state.selSyl == null
      ? 'Select a syllable, then click a neume in the palette (or press a shortcut key) to add it.'
      : 'Click a neume in the palette (or press a shortcut key) to add it; select an existing neume to edit it.'));
    return;
  }
  const cat = NEUMES[nm.type];
  box.append(el('div', { class: 'row' }, el('strong', {}, cat.name), el('span', { class: 'muted' }, ` — ${cat.description}`)));

  // connection — soft editorial contour
  const cs = connectionState(nm);
  const connRow = el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'Direction vs previous note (editorial contour)'));
  for (const c of CONTOURS) {
    const on = cs.mode === 'soft' ? String(cs.dir) === c.v : (c.v === 'auto' && cs.mode === 'auto');
    connRow.append(el('button', { class: 'toggle' + (on ? ' on' : ''), title: c.title, onclick: () => setContour(nm, c.v) }, c.label));
  }
  box.append(connRow);

  // optional exact interval override
  const exRow = el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'Exact interval (overrides contour)'));
  const exSel = el('select', { onchange: (e) => setExactLeap(nm, e.target.value) });
  for (const c of EXACT_LEAPS) {
    const o = el('option', { value: c.v }, c.label);
    if (cs.mode === 'hard' && String(cs.leap) === c.v) o.selected = true;
    exSel.append(o);
  }
  exRow.append(exSel);
  box.append(exRow);

  // significative letters
  const letRow = el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'Significative letters'));
  for (const [key, def] of Object.entries(SIGNIFICATIVE)) {
    const on = (nm.letters || []).includes(key);
    letRow.append(el('button', {
      class: 'toggle' + (on ? ' on' : ''), title: `${def.latin} — ${def.gloss}`,
      onclick: () => toggleLetter(nm, key),
    }, key));
  }
  box.append(letRow);

  // count for variable neumes
  if (cat.variable) {
    const countRow = el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'Number of notes'));
    countRow.append(
      el('button', { onclick: () => setCount(nm, cat, -1) }, '–'),
      el('span', {}, String(nm.count ?? cat.defaultCount ?? cat.minNotes)),
      el('button', { onclick: () => setCount(nm, cat, +1) }, '+'),
    );
    box.append(countRow);
  }

  // per-note editing
  const { rs } = resolved();
  const rsyl = rs[state.selSyl];
  const rn = rsyl && rsyl.neumes[state.selNeume];
  if (rn) {
    const last = rn.notes.length - 1;
    const active = state.selNote == null ? last : Math.min(state.selNote, last);

    const noteRow = el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'Notes — click to select; ▲▼ raise/lower (arrow keys too)'));
    rn.notes.forEach((note, k) => {
      const cell = el('div', { class: 'note-edit' + (k === active ? ' active' : '') });
      cell.append(el('div', { class: 'nudge' },
        el('button', { onclick: (e) => { e.stopPropagation(); nudge(nm, k, +1); } }, '▲'),
        el('button', { onclick: (e) => { e.stopPropagation(); nudge(nm, k, -1); } }, '▼'),
      ));
      cell.append(el('span', { class: 'lt' + (note.inRange ? '' : ' warn') }, `${note.letter}`));
      cell.append(el('span', { class: 'muted', style: 'font-size:.7rem' }, note.name));
      cell.addEventListener('click', () => { state.selNote = k; renderInspector(); });
      noteRow.append(cell);
    });
    box.append(noteRow);

    // explicit interval control for an interior note (its step within the neume)
    if (active >= 1) {
      const ivRow = el('div', { class: 'row' }, el('span', { class: 'lbl' }, `Interval into note ${active + 1} (within this neume)`));
      const sel = el('select', { onchange: (e) => setNoteLeap(nm, active, e.target.value) });
      const cur = rn.notes[active].intervalFromPrev;
      for (const iv of INTERVALS) {
        const o = el('option', { value: iv.v }, iv.label);
        if (parseInt(iv.v, 10) === cur) o.selected = true;
        sel.append(o);
      }
      ivRow.append(sel);
      box.append(ivRow);
    }

    // mark/flag toggles for the active note
    const flagRow = el('div', { class: 'row' }, el('span', { class: 'lbl' }, `Marks on note ${active + 1}`));
    const curFlags = (nm.notes && nm.notes[active] && nm.notes[active].flags) || {};
    for (const [flag, label] of NOTE_FLAGS) {
      const on = !!curFlags[flag];
      flagRow.append(el('button', { class: 'toggle' + (on ? ' on' : ''), onclick: () => toggleFlag(nm, active, flag) }, label));
    }
    box.append(flagRow);
  }

  box.append(el('div', { class: 'row' }, el('button', { onclick: () => deleteNeume() }, 'Delete neume')));
}

function renderOutput() {
  const { r } = resolved();
  $('#gabc').value = r.gabc;
  const ul = $('#warnings');
  ul.replaceChildren();
  for (const w of r.warnings) ul.append(el('li', {}, w.message));
  renderPreview(r.gabc);
}

// ---- Exsurge live notation preview --------------------------------------
// Baseline settings adapted from the polyphonydatabase booklet creator's
// makeBookletChantContext, minus the per-block options, so the preview reads
// clearly without any controls on this page.
function makePreviewContext(ex) {
  const strategy = ex.TextMeasuringStrategy ? ex.TextMeasuringStrategy.Canvas : undefined;
  const ctxt = new ex.ChantContext(strategy);
  if (ctxt.condenseLineAmount !== undefined) ctxt.condenseLineAmount = 1;
  ctxt.scaleDefs = false;
  ctxt.setGlyphScaling((1 / 16) * 1.4);
  ctxt.setFont("'Crimson Text', 'Palatino Linotype', Palatino, serif", 23 / 0.9);
  ctxt.interSyllabicMultiplier = 2.5;
  ctxt.spaceBetweenSystems = 1.5;
  ctxt.minSpaceAboveStaff = 2;
  ctxt.minSpaceBelowStaff = 1;
  ctxt.accidentalSpaceMultiplier = 1.5;
  if (typeof ex.Latin === 'function') ctxt.defaultLanguage = new ex.Latin();
  if (typeof ctxt.setRubricColor === 'function') ctxt.setRubricColor('#8b1538');
  return ctxt;
}

function renderPreview(gabc) {
  const host = $('#preview');
  if (!host) return;
  const ex = window.exsurge;
  if (!ex) { host.innerHTML = '<span class="hint">Exsurge not loaded.</span>'; return; }
  // Need at least one sung syllable for a meaningful score.
  if (!/\([a-mA-M]/.test(gabc)) { host.innerHTML = '<span class="hint">Add neumes to see the notation preview.</span>'; return; }
  try {
    const ctxt = makePreviewContext(ex);
    const mappings = ex.Gabc.createMappingsFromSource(ctxt, gabc);
    const score = new ex.ChantScore(ctxt, mappings, false);
    if (typeof score.mapExsurgeToGabc === 'function') score.mapExsurgeToGabc = function () {};
    score.performLayout(ctxt);
    // Lay lines out to the preview's *content* width (clientWidth includes the
    // padding), with a little slack so nothing spills past the right edge.
    const cs = getComputedStyle(host);
    const padX = parseFloat(cs.paddingLeft || 0) + parseFloat(cs.paddingRight || 0);
    const width = Math.max(280, (host.clientWidth || 360) - padX - 6);
    score.layoutChantLines(ctxt, width);
    let svg;
    if (typeof score.createSvgForEachLine === 'function') svg = score.createSvgForEachLine(ctxt);
    else if (typeof score.createSvg === 'function') svg = score.createSvg(ctxt);
    else svg = score.createDrawable(ctxt);
    host.innerHTML = svg;
  } catch (err) {
    host.innerHTML = `<span class="hint">Preview unavailable: ${err.message}</span>`;
  }
}

// ---- mutations -----------------------------------------------------------
function addNeume(type) {
  if (state.selSyl == null) return;
  const syl = state.syllables[state.selSyl];
  state.barSelected = false;
  syl.neumes.push({ type, letters: [], notes: [] });
  state.selNeume = syl.neumes.length - 1;
  state.selNote = null;
  render();
}

// Attach a separation bar after the selected syllable.
function insertBar(code) {
  if (state.selSyl == null) return;
  state.syllables[state.selSyl].barAfter = code;
  state.barSelected = true;
  state.selNeume = null;
  state.selNote = null;
  render();
}

// Delete whatever is selected: a bar, or a neume.
function deleteSelected() {
  if (state.selSyl == null) return;
  if (state.barSelected) {
    delete state.syllables[state.selSyl].barAfter;
    state.barSelected = false;
    render();
    return;
  }
  deleteNeume();
}

function deleteNeume() {
  const syl = state.syllables[state.selSyl];
  if (!syl || state.selNeume == null) return;
  syl.neumes.splice(state.selNeume, 1);
  state.selNeume = syl.neumes.length ? Math.min(state.selNeume, syl.neumes.length - 1) : null;
  render();
}

// Move the selection across neumes (and empty syllables) linearly.
function navigate(dir) {
  const pos = [];
  state.syllables.forEach((s, si) => {
    if (s.neumes.length) s.neumes.forEach((_, ni) => pos.push([si, ni]));
    else pos.push([si, null]);
  });
  if (!pos.length) return;
  let idx = pos.findIndex(([si, ni]) => si === state.selSyl && ni === state.selNeume);
  if (idx === -1) idx = dir > 0 ? -1 : 0;
  idx = Math.max(0, Math.min(pos.length - 1, idx + dir));
  [state.selSyl, state.selNeume] = pos[idx];
  state.selNote = null;
  state.barSelected = false;
  render();
}

// Arrow keys raise/lower the currently selected note (the active note within
// the selected neume), so interior intervals are keyboard-editable too.
function bumpSelectedPitch(delta) {
  const nm = selectedNeume();
  if (!nm) return;
  const { rs } = resolved();
  const rn = rs[state.selSyl] && rs[state.selSyl].neumes[state.selNeume];
  if (!rn) return;
  const k = state.selNote == null ? 0 : Math.min(state.selNote, rn.notes.length - 1);
  nudge(nm, k, delta);
}

function installKeyboard() {
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); bumpSelectedPitch(+1); break;
      case 'ArrowDown': e.preventDefault(); bumpSelectedPitch(-1); break;
      case 'ArrowRight': e.preventDefault(); navigate(+1); break;
      case 'ArrowLeft': e.preventDefault(); navigate(-1); break;
      case 'Delete':
      case 'Backspace': e.preventDefault(); deleteSelected(); break;
      case '|': e.preventDefault(); insertBar(':'); break;
      default:
        if (NEUME_KEYS[e.key]) { e.preventDefault(); addNeume(NEUME_KEYS[e.key]); }
    }
  });
}

function connectionState(nm) {
  if (!nm.connect) return { mode: 'auto' };
  if (typeof nm.connect.leap === 'number') return { mode: 'hard', leap: nm.connect.leap };
  if (typeof nm.connect.dir === 'number') return { mode: 'soft', dir: nm.connect.dir };
  return { mode: 'auto' };
}

// Soft contour: store only a direction (no magnitude), so it stays relative.
function setContour(nm, v) {
  if (v === 'auto') delete nm.connect;
  else nm.connect = { dir: parseInt(v, 10) };
  render();
}

// Hard override: a fixed signed interval (in scale steps).
function setExactLeap(nm, v) {
  if (v === '') {
    // clearing the exact interval falls back to soft contour if one was set.
    if (nm.connect && typeof nm.connect.leap === 'number') delete nm.connect;
  } else {
    nm.connect = { leap: parseInt(v, 10) };
  }
  render();
}

function toggleLetter(nm, key) {
  nm.letters = nm.letters || [];
  const i = nm.letters.indexOf(key);
  if (i >= 0) nm.letters.splice(i, 1); else nm.letters.push(key);
  render();
}

function setCount(nm, cat, delta) {
  const cur = nm.count ?? cat.defaultCount ?? cat.minNotes;
  nm.count = Math.max(cat.minNotes, cur + delta);
  render();
}

function ensureNote(nm, k) {
  nm.notes = nm.notes || [];
  while (nm.notes.length <= k) nm.notes.push(null);
  if (!nm.notes[k]) nm.notes[k] = {};
  return nm.notes[k];
}

function nudge(nm, k, delta) {
  const { rs } = resolved();
  const rn = rs[state.selSyl].neumes[state.selNeume];
  const note = rn.notes[k];
  const current = note.intervalFromPrev ?? 0;
  if (k === 0) {
    nm.connect = { leap: current + delta };
  } else {
    ensureNote(nm, k).leap = current + delta;
  }
  render();
}

function toggleFlag(nm, k, flag) {
  const note = ensureNote(nm, k);
  note.flags = note.flags || {};
  if (note.flags[flag]) delete note.flags[flag]; else note.flags[flag] = true;
  render();
}

// Set an interior note's interval (step from the previous note) explicitly.
function setNoteLeap(nm, k, v) {
  ensureNote(nm, k).leap = parseInt(v, 10);
  render();
}

// ---- palette + controls wiring ------------------------------------------
function buildBars() {
  const host = $('#bars');
  if (!host) return;
  for (const b of BARS) {
    host.append(el('button', { class: 'barbtn', title: b.label, onclick: () => insertBar(b.code) },
      el('span', { class: 'barcode' }, b.code),
      el('span', { class: 'n' }, b.label.replace(/ \(.*/, '')),
    ));
  }
}

function buildPalette() {
  const pal = $('#palette');
  for (const cat of Object.values(NEUMES)) {
    const key = KEY_FOR_NEUME[cat.id];
    const btn = el('button', { title: cat.description + (key ? ` — shortcut: ${key}` : ''), onclick: () => addNeume(cat.id) },
      el('span', { class: 'g' }, cat.glyph),
      el('span', { class: 'n' }, cat.name),
    );
    if (key) btn.append(el('span', { class: 'key' }, key));
    pal.append(btn);
  }
}

function refreshStartOptions() {
  const sel = $('#start');
  if (!sel) return;
  sel.replaceChildren();
  for (const letter of START_LETTERS) {
    const name = noteNameAt(letterToPos(letter), state.clef);
    const o = el('option', { value: letter }, `${letter} ( = ${name} )`);
    if (letter === state.startLetter) o.selected = true;
    sel.append(o);
  }
}

function buildControls() {
  const clef = $('#clef');
  for (const c of ['c1', 'c2', 'c3', 'c4', 'f1', 'f2', 'f3', 'f4']) {
    const o = el('option', { value: c }, c);
    if (c === state.clef) o.selected = true;
    clef.append(o);
  }
  clef.addEventListener('change', (e) => { state.clef = e.target.value; refreshStartOptions(); render(); });

  const start = $('#start');
  start.addEventListener('change', (e) => { state.startLetter = e.target.value; render(); });
  refreshStartOptions();

  $('#bflat').addEventListener('change', (e) => { state.bFlat = e.target.checked; render(); });
  $('#copy').addEventListener('click', async () => { await navigator.clipboard.writeText($('#gabc').value); });
  $('#save').addEventListener('click', saveProject);
  $('#load').addEventListener('change', loadProject);
}

function saveProject() {
  const data = JSON.stringify({ version: 2, clef: state.clef, startLetter: state.startLetter, bFlat: state.bFlat, syllables: state.syllables }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'transcription.json' });
  a.click();
}

function loadProject(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const data = JSON.parse(reader.result);
    state.clef = data.clef || 'c4';
    state.startLetter = data.startLetter || 'f';
    state.bFlat = !!data.bFlat;
    // migrate legacy standalone bar items -> barAfter on the previous syllable
    const migrated = [];
    for (const item of data.syllables || []) {
      if (item.bar) {
        if (migrated.length) migrated[migrated.length - 1].barAfter = item.bar;
      } else {
        migrated.push({ text: item.text, wordstart: item.wordstart, linebreak: item.linebreak, neumes: item.neumes || [], barAfter: item.barAfter });
      }
    }
    state.syllables = migrated;
    state.selSyl = migrated.length ? 0 : null;
    state.selNeume = null;
    state.selNote = null;
    state.barSelected = false;
    $('#clef').value = state.clef;
    $('#bflat').checked = state.bFlat;
    $('#textInput').value = reconstructText(migrated);
    refreshStartOptions();
    render();
  };
  reader.readAsText(file);
}

// ---- init ----------------------------------------------------------------
buildControls();
buildBars();
buildPalette();
installKeyboard();

let resizeTimer = null;
window.addEventListener('resize', () => {
  adjustDock();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderPreview($('#gabc').value), 150);
});

// The text box drives the grid live (debounced).
let textTimer = null;
$('#textInput').addEventListener('input', () => {
  clearTimeout(textTimer);
  textTimer = setTimeout(rebuildFromText, 200);
});

$('#textInput').value = 'Beatus Birinus pontifex';
rebuildFromText();
