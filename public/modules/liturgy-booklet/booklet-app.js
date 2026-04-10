(function () {
  'use strict';

  const SCHEMA_VERSION = 6;
  const STORAGE_KEY = 'liturgyBooklet_autosave_v6';

  const BOOKLET_FONT_STACKS = {
    georgia: 'Georgia, "Times New Roman", Times, serif',
    times: '"Times New Roman", Times, Georgia, serif',
    palatino: 'Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif',
    garamond: '"Palatino Linotype", Palatino, Garamond, "Times New Roman", serif',
    arial: 'Arial, Helvetica, sans-serif',
    verdana: 'Verdana, Geneva, Tahoma, sans-serif',
    trebuchet: '"Trebuchet MS", Helvetica, Arial, sans-serif',
    tahoma: 'Tahoma, Geneva, Verdana, sans-serif',
    courier: '"Courier New", Courier, monospace',
  };

  /** @type {{ schemaVersion: number, projectTitle: string, settings: object, blocks: object[] }} */
  let state = {
    schemaVersion: SCHEMA_VERSION,
    projectTitle: '',
    settings: {
      pageSize: 'A4',
      marginMm: 15,
      fontScale: 1,
      sectionGapMm: 8,
      previewDisplay: 'scroll',
      fontFamilyKey: 'georgia',
      rubricColor: '#8b1538',
      chantNeumeSize: 19.2,
      chantStaffColor: '',
      chantLinePadTop: 6,
      chantLyricTight: 0.7,
      chantSystemGap: 4,
    },
    blocks: [],
  };

  let selectedBlockId = null;
  let autosaveTimer = null;
  let previewToken = 0;
  /** @type {HTMLElement[]} */
  let exportPageElements = [];
  let bookletSpreadIndex = 0;
  /** @type {{ left: number, right: number }[]} */
  let bookletSpreadViews = [];
  let bookletWheelAccum = 0;
  let lastBookletSpreadPageCount = -1;
  /** @type {AbortController | null} */
  let editionSearchAbort = null;

  function uid() {
    return 'b_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  }

  function resolvePdfUrl(url) {
    const s = String(url || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith('//')) return window.location.protocol + s;
    if (s.startsWith('/')) return window.location.origin + s;
    return s;
  }

  function safeFilenameBase(title, fallback) {
    let s = String(title || '').trim();
    s = s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    s = s.slice(0, 80);
    return s || fallback;
  }

  function normalizeEditionPdfBlock(b) {
    if (b.type !== 'edition_pdf') return b;
    const out = { ...b };
    delete out.catalogueEditionId;
    if (out.catalogueEditorName === undefined) out.catalogueEditorName = '';
    if (out.catalogueGroupTitle === undefined) out.catalogueGroupTitle = '';
    if (out.catalogueSourceUrl === undefined) out.catalogueSourceUrl = null;
    return out;
  }

  function collectCatalogueEditionCredits(blocks) {
    const names = new Set();
    (blocks || []).forEach(function (b) {
      if (b.type !== 'edition_pdf') return;
      const n = String(b.catalogueEditorName || '').trim();
      if (n) names.add(n);
    });
    return Array.from(names).sort(function (a, b2) {
      return a.localeCompare(b2);
    });
  }

  function buildWatermarkPage(size) {
    const page = document.createElement('div');
    page.className = 'booklet-page';
    page.dataset.size = size;
    page.dataset.watermark = 'true';
    const inner = document.createElement('div');
    inner.className = 'page-inner-flow';
    inner.style.display = 'flex';
    inner.style.flexDirection = 'column';
    inner.style.minHeight = '100%';
    const box = document.createElement('div');
    box.className = 'booklet-watermark booklet-section';
    const p1 = document.createElement('p');
    p1.className = 'text-muted text-center mb-2 booklet-richtext';
    p1.style.textAlign = 'center';
    p1.innerHTML =
      'Generated with <strong>Polyphony Database</strong> (<a href="https://polyphonydatabase.com" target="_blank" rel="noopener noreferrer">polyphonydatabase.com</a>).';
    box.appendChild(p1);
    const credits = collectCatalogueEditionCredits(state.blocks);
    if (credits.length) {
      const p2 = document.createElement('p');
      p2.className = 'text-muted text-center mb-0 booklet-richtext';
      p2.style.textAlign = 'center';
      p2.textContent = 'Edition credits: ' + credits.join(', ') + '.';
      box.appendChild(p2);
    }
    inner.appendChild(box);
    page.appendChild(inner);
    return page;
  }

  async function fetchEditionSearchResults(query, signal) {
    const params = new URLSearchParams({
      page: 1,
      page_size: 25,
      title: query,
      has_editions: 'true',
    });
    const r = await fetch('/api/search/groups?' + params.toString(), { signal });
    if (!r.ok) throw new Error('Search failed');
    return r.json();
  }

  function formatEditionSearchMeta(g) {
    const parts = [];
    if (g.composer_display) parts.push(String(g.composer_display));
    const tone = g.tone;
    if (tone != null) {
      const ts = Array.isArray(tone) ? tone.filter(Boolean).join(', ') : String(tone);
      if (ts) parts.push('Tone(s): ' + ts);
    }
    const fn = g.function_names;
    if (Array.isArray(fn) && fn.length) {
      parts.push(
        'Type: ' + fn.slice(0, 5).join('; ') + (fn.length > 5 ? '…' : '')
      );
    }
    if (g.even_odd) parts.push('Even/odd: ' + String(g.even_odd));
    return parts.join(' · ');
  }

  function flattenEditionSearchRows(data) {
    const rows = [];
    const groups = data.groups || [];
    groups.forEach(function (g) {
      const eds = g.editions;
      if (!eds || !Array.isArray(eds)) return;
      const meta = formatEditionSearchMeta(g);
      eds.forEach(function (e) {
        if (!e || !e.file_url) return;
        rows.push({
          groupTitle: g.display_title || '',
          editorName: e.editor_name || 'Unknown editor',
          voicing: e.voicing != null ? String(e.voicing) : '',
          fileUrl: e.file_url,
          metaLine: meta,
        });
      });
    });
    return rows;
  }

  function mmToPx(mm) {
    return (mm * 96) / 25.4;
  }

  function applyCssVars() {
    const root = document.documentElement;
    root.style.setProperty('--booklet-margin-mm', String(state.settings.marginMm));
    root.style.setProperty('--booklet-font-scale', String(state.settings.fontScale));
    root.style.setProperty('--booklet-section-gap-mm', String(state.settings.sectionGapMm ?? 8));
    const fk = state.settings.fontFamilyKey || 'georgia';
    root.style.setProperty(
      '--booklet-body-font',
      BOOKLET_FONT_STACKS[fk] || BOOKLET_FONT_STACKS.georgia
    );
    const rc = state.settings.rubricColor || '#8b1538';
    root.style.setProperty('--booklet-rubric-color', /^#[0-9a-f]{6}$/i.test(rc) ? rc : '#8b1538');
  }

  function getContentWidthPx() {
    const pageW = state.settings.pageSize === 'A5' ? 148 : 210;
    return Math.max(200, mmToPx(pageW - 2 * state.settings.marginMm));
  }

  function getMaxPageBodyHeightPx() {
    const pageH = state.settings.pageSize === 'A5' ? 210 : 297;
    return Math.max(120, mmToPx(pageH - 2 * state.settings.marginMm));
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  /**
   * Safe subset for rubric/reading/translation: b, i, u, br, span[style=color only].
   * @returns {DocumentFragment}
   */
  function sanitizeToFragment(html) {
    const frag = document.createDocumentFragment();
    const tpl = document.createElement('template');
    tpl.innerHTML = String(html || '').trim();

    function appendChildren(parent, node) {
      for (let c = node.firstChild; c; c = c.nextSibling) {
        const n = walk(c);
        if (!n) continue;
        if (n.nodeType === 11) {
          while (n.firstChild) parent.appendChild(n.firstChild);
        } else parent.appendChild(n);
      }
    }

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return document.createTextNode(node.textContent);
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      const tag = node.tagName.toLowerCase();
      if (tag === 'br') return document.createElement('br');
      if (tag === 'b' || tag === 'strong') {
        const el = document.createElement('b');
        appendChildren(el, node);
        return el;
      }
      if (tag === 'i' || tag === 'em') {
        const el = document.createElement('i');
        appendChildren(el, node);
        return el;
      }
      if (tag === 'u') {
        const el = document.createElement('u');
        appendChildren(el, node);
        return el;
      }
      if (tag === 'span') {
        const el = document.createElement('span');
        const st = node.getAttribute('style') || '';
        const cm = st.match(/color\s*:\s*([^;]+)/i);
        if (cm) {
          const col = cm[1].trim();
          if (/^#[0-9a-f]{3,8}$/i.test(col) || /^rgba?\s*\(/i.test(col)) {
            el.setAttribute('style', 'color:' + col);
          }
        }
        appendChildren(el, node);
        return el;
      }
      if (tag === 'p' || tag === 'div' || tag === 'font') {
        const f = document.createDocumentFragment();
        appendChildren(f, node);
        return f;
      }
      const f = document.createDocumentFragment();
      appendChildren(f, node);
      return f;
    }

    for (let c = tpl.content.firstChild; c; c = c.nextSibling) {
      const n = walk(c);
      if (!n) continue;
      if (n.nodeType === 11) {
        while (n.firstChild) frag.appendChild(n.firstChild);
      } else frag.appendChild(n);
    }
    return frag;
  }

  function initialRichHtmlForEditor(stored) {
    const s = stored || '';
    if (!s.trim()) return '<br>';
    if (!/<[a-z][\s\S]*>/i.test(s)) {
      return escapeHtml(s).replace(/\r\n|\r|\n/g, '<br>');
    }
    const w = document.createElement('div');
    w.appendChild(sanitizeToFragment(s));
    const h = w.innerHTML;
    return h.trim() ? h : '<br>';
  }

  function translationHasContent(html) {
    const w = document.createElement('div');
    w.appendChild(sanitizeToFragment(html));
    return (w.textContent || '').trim().length > 0;
  }

  function stripTagsForPreview(html) {
    const w = document.createElement('div');
    w.appendChild(sanitizeToFragment(html));
    let t = (w.textContent || '').replace(/\s+/g, ' ').trim();
    return t.length > 48 ? t.slice(0, 48) + '…' : t;
  }

  function bindRichToolbar(toolbarRoot, ed, onChange) {
    toolbarRoot.querySelectorAll('[data-rich-cmd]').forEach(function (btn) {
      btn.addEventListener('mousedown', function (e) {
        e.preventDefault();
      });
      btn.addEventListener('click', function () {
        ed.focus();
        const cmd = btn.getAttribute('data-rich-cmd');
        try {
          if (cmd === 'foreColor') {
            const c = btn.getAttribute('data-color');
            if (c) document.execCommand('foreColor', false, c);
          } else if (cmd) {
            document.execCommand(cmd, false, null);
          }
        } catch (err) {
          /* ignore */
        }
        onChange();
      });
    });
    ed.addEventListener('input', onChange);
    ed.addEventListener('blur', onChange);
  }

  function makeBookletChantContext() {
    const s = state.settings || {};
    var ctxt = new exsurge.ChantContext(exsurge.TextMeasuringStrategy.Canvas);
    ctxt.condenseLineAmount = 1;
    ctxt.setGlyphScaling(1 / 16);
    const neumePx = Math.min(28, Math.max(12, Number(s.chantNeumeSize) || 19.2));
    ctxt.setFont("'Crimson Text', serif", neumePx / 0.9);
    ctxt.spaceBetweenSystems = Math.min(24, Math.max(0, Number(s.chantSystemGap) || 4));
    ctxt.textStyles.dropCap.size = Math.round((neumePx / 19.2) * 64);
    ctxt.textStyles.annotation.size = Math.round((neumePx / 19.2) * 12.8);
    const tight = Math.min(1.5, Math.max(0.35, Number(s.chantLyricTight) || 0.7));
    ctxt.minLyricWordSpacing *= tight;
    ctxt.accidentalSpaceMultiplier = 1.5;
    ctxt.specialCharProperties['font-family'] = "'Versiculum'";
    ctxt.specialCharProperties['font-variant'] = 'normal';
    ctxt.specialCharProperties['font-weight'] = '400';
    var defaultSpecialCharText = ctxt.specialCharText;
    ctxt.specialCharText = function (char) {
      return defaultSpecialCharText(char).toLowerCase();
    };
    ctxt.setRubricColor('#c62828');
    const sc = String(s.chantStaffColor || '').trim();
    if (sc && /^#[0-9a-f]{3,8}$/i.test(sc)) {
      ctxt.staffLineColor = sc;
    }
    return ctxt;
  }

  function appendSectionHeading(wrap, b) {
    if (b.type !== 'rubric' && b.type !== 'reading') return;
    const t = String(b.sectionTitle || '').trim();
    const sref = String(b.sectionSourceRef || '').trim();
    if (!t && !sref) return;
    if (!t && sref) {
      const solo = document.createElement('div');
      solo.className = 'fst-italic text-muted small mb-1 booklet-section-heading-source';
      solo.style.textAlign = 'right';
      solo.textContent = sref;
      wrap.appendChild(solo);
      return;
    }
    const row = document.createElement('div');
    row.className =
      'booklet-section-heading d-flex justify-content-between align-items-baseline gap-2 flex-wrap mb-1';
    const left = document.createElement('div');
    left.className = 'fw-bold booklet-section-heading-title';
    left.textContent = t;
    row.appendChild(left);
    if (sref) {
      const right = document.createElement('div');
      right.className = 'fst-italic text-muted small booklet-section-heading-source';
      right.style.textAlign = 'right';
      right.textContent = sref;
      row.appendChild(right);
    }
    wrap.appendChild(row);
  }

  function migrateProject(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    const v = parsed.schemaVersion || 1;
    if (v >= SCHEMA_VERSION) {
      parsed.projectTitle = parsed.projectTitle != null ? String(parsed.projectTitle) : '';
      parsed.settings = parsed.settings || {};
      parsed.settings.sectionGapMm = parsed.settings.sectionGapMm ?? 8;
      parsed.settings.previewDisplay =
        parsed.settings.previewDisplay === 'booklet' ? 'booklet' : 'scroll';
      parsed.settings.fontFamilyKey =
        BOOKLET_FONT_STACKS[parsed.settings.fontFamilyKey] != null
          ? parsed.settings.fontFamilyKey
          : 'georgia';
      const rc = parsed.settings.rubricColor || '#8b1538';
      parsed.settings.rubricColor = /^#[0-9a-f]{6}$/i.test(rc) ? rc : '#8b1538';
      parsed.settings.chantNeumeSize = parsed.settings.chantNeumeSize ?? 19.2;
      parsed.settings.chantStaffColor = parsed.settings.chantStaffColor || '';
      parsed.settings.chantLinePadTop = parsed.settings.chantLinePadTop ?? 6;
      parsed.settings.chantLyricTight = parsed.settings.chantLyricTight ?? 0.7;
      parsed.settings.chantSystemGap = parsed.settings.chantSystemGap ?? 4;
      parsed.blocks = (parsed.blocks || []).map((b) => {
        if (b.type === 'image' && b.label === undefined) b.label = '';
        if (b.type === 'reading') {
          if (b.translation === undefined) b.translation = '';
          if (b.parallelLeftPct == null) b.parallelLeftPct = 50;
          if (b.parallelBorder === undefined) b.parallelBorder = false;
          if (b.parallelGapMm == null) b.parallelGapMm = 4;
          if (b.sectionTitle === undefined) b.sectionTitle = '';
          if (b.sectionSourceRef === undefined) b.sectionSourceRef = '';
        }
        if (b.type === 'rubric') {
          if (b.sectionTitle === undefined) b.sectionTitle = '';
          if (b.sectionSourceRef === undefined) b.sectionSourceRef = '';
        }
        if (b.type === 'edition_pdf') return normalizeEditionPdfBlock(b);
        return b;
      });
      return parsed;
    }
    if (v === 5) {
      parsed.schemaVersion = SCHEMA_VERSION;
      parsed.projectTitle = parsed.projectTitle != null ? String(parsed.projectTitle) : '';
      parsed.settings = parsed.settings || {};
      parsed.settings.chantNeumeSize = 19.2;
      parsed.settings.chantStaffColor = '';
      parsed.settings.chantLinePadTop = 6;
      parsed.settings.chantLyricTight = 0.7;
      parsed.settings.chantSystemGap = 4;
      parsed.blocks = (parsed.blocks || []).map((b) => {
        if (b.type === 'reading') {
          return {
            ...b,
            translation: b.translation != null ? b.translation : '',
            parallelLeftPct: b.parallelLeftPct != null ? b.parallelLeftPct : 50,
            parallelBorder: !!b.parallelBorder,
            parallelGapMm: b.parallelGapMm != null ? b.parallelGapMm : 4,
            sectionTitle: b.sectionTitle != null ? b.sectionTitle : '',
            sectionSourceRef: b.sectionSourceRef != null ? b.sectionSourceRef : '',
          };
        }
        if (b.type === 'rubric') {
          return {
            ...b,
            sectionTitle: b.sectionTitle != null ? b.sectionTitle : '',
            sectionSourceRef: b.sectionSourceRef != null ? b.sectionSourceRef : '',
          };
        }
        if (b.type === 'edition_pdf') return normalizeEditionPdfBlock(b);
        return { ...b };
      });
      return parsed;
    }
    if (v === 4) {
      parsed.schemaVersion = SCHEMA_VERSION;
      parsed.projectTitle = parsed.projectTitle != null ? String(parsed.projectTitle) : '';
      parsed.settings = parsed.settings || {};
      parsed.settings.chantNeumeSize = 19.2;
      parsed.settings.chantStaffColor = '';
      parsed.settings.chantLinePadTop = 6;
      parsed.settings.chantLyricTight = 0.7;
      parsed.settings.chantSystemGap = 4;
      parsed.blocks = (parsed.blocks || []).map((b) => {
        if (b.type === 'reading') {
          return {
            ...b,
            translation: b.translation != null ? b.translation : '',
            parallelLeftPct: b.parallelLeftPct != null ? b.parallelLeftPct : 50,
            parallelBorder: !!b.parallelBorder,
            parallelGapMm: b.parallelGapMm != null ? b.parallelGapMm : 4,
            sectionTitle: '',
            sectionSourceRef: '',
          };
        }
        if (b.type === 'rubric') {
          return { ...b, sectionTitle: '', sectionSourceRef: '' };
        }
        if (b.type === 'edition_pdf') return normalizeEditionPdfBlock(b);
        return { ...b };
      });
      return parsed;
    }
    if (v === 3) {
      parsed.schemaVersion = SCHEMA_VERSION;
      parsed.projectTitle = '';
      parsed.settings = parsed.settings || {};
      parsed.settings.fontFamilyKey = 'georgia';
      parsed.settings.rubricColor = '#8b1538';
      parsed.settings.chantNeumeSize = 19.2;
      parsed.settings.chantStaffColor = '';
      parsed.settings.chantLinePadTop = 6;
      parsed.settings.chantLyricTight = 0.7;
      parsed.settings.chantSystemGap = 4;
      parsed.blocks = (parsed.blocks || []).map((b) => {
        if (b.type === 'reading') {
          return {
            ...b,
            translation: b.translation != null ? b.translation : '',
            parallelLeftPct: b.parallelLeftPct != null ? b.parallelLeftPct : 50,
            parallelBorder: !!b.parallelBorder,
            parallelGapMm: b.parallelGapMm != null ? b.parallelGapMm : 4,
            sectionTitle: '',
            sectionSourceRef: '',
          };
        }
        if (b.type === 'rubric') {
          return { ...b, sectionTitle: '', sectionSourceRef: '' };
        }
        if (b.type === 'edition_pdf') return normalizeEditionPdfBlock(b);
        return { ...b };
      });
      return parsed;
    }
    if (v === 2) {
      parsed.schemaVersion = SCHEMA_VERSION;
      parsed.projectTitle = '';
      parsed.settings = parsed.settings || {};
      parsed.settings.previewDisplay = 'scroll';
      parsed.settings.fontFamilyKey = 'georgia';
      parsed.settings.rubricColor = '#8b1538';
      parsed.settings.chantNeumeSize = 19.2;
      parsed.settings.chantStaffColor = '';
      parsed.settings.chantLinePadTop = 6;
      parsed.settings.chantLyricTight = 0.7;
      parsed.settings.chantSystemGap = 4;
      parsed.blocks = (parsed.blocks || []).map((b) => {
        if (b.type === 'image' && b.label === undefined) {
          return { ...b, label: '' };
        }
        if (b.type === 'reading') {
          return {
            ...b,
            translation: '',
            parallelLeftPct: 50,
            parallelBorder: false,
            parallelGapMm: 4,
            sectionTitle: '',
            sectionSourceRef: '',
          };
        }
        if (b.type === 'rubric') {
          return { ...b, sectionTitle: '', sectionSourceRef: '' };
        }
        if (b.type === 'edition_pdf') return normalizeEditionPdfBlock({ ...b, type: 'edition_pdf' });
        return { ...b };
      });
      return parsed;
    }
    if (v === 1) {
      parsed.schemaVersion = SCHEMA_VERSION;
      parsed.projectTitle = '';
      parsed.settings = parsed.settings || {};
      parsed.settings.sectionGapMm = 8;
      parsed.settings.previewDisplay = 'scroll';
      parsed.settings.fontFamilyKey = 'georgia';
      parsed.settings.rubricColor = '#8b1538';
      parsed.settings.chantNeumeSize = 19.2;
      parsed.settings.chantStaffColor = '';
      parsed.settings.chantLinePadTop = 6;
      parsed.settings.chantLyricTight = 0.7;
      parsed.settings.chantSystemGap = 4;
      parsed.blocks = (parsed.blocks || []).map((b) => {
        if (b.type === 'jgabc_propers') {
          return {
            id: b.id,
            type: 'chant_gabc',
            gabc: '',
            legacyHash: b.hash || '',
          };
        }
        if (b.type === 'edition_pdf') {
          return normalizeEditionPdfBlock({
            ...b,
            pdfPageFrom: b.pdfPageFrom != null ? b.pdfPageFrom : 1,
            pdfPageTo: b.pdfPageTo != null ? b.pdfPageTo : null,
            title: b.title != null ? b.title : '',
            url: b.url != null ? b.url : '',
            catalogueEditorName: '',
            catalogueGroupTitle: '',
            catalogueSourceUrl: null,
          });
        }
        if (b.type === 'image') {
          return { ...b, label: b.label != null ? b.label : '' };
        }
        if (b.type === 'reading') {
          return {
            ...b,
            translation: '',
            parallelLeftPct: 50,
            parallelBorder: false,
            parallelGapMm: 4,
            sectionTitle: '',
            sectionSourceRef: '',
          };
        }
        if (b.type === 'rubric') {
          return { ...b, sectionTitle: '', sectionSourceRef: '' };
        }
        return { ...b };
      });
      return parsed;
    }
    return null;
  }

  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        console.warn('Autosave failed', e);
      }
    }, 400);
  }

  function loadAutosave() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const v5old = localStorage.getItem('liturgyBooklet_autosave_v5');
        if (v5old && !localStorage.getItem(STORAGE_KEY)) {
          const m = migrateProject(JSON.parse(v5old));
          if (m) {
            state = m;
            applyCssVars();
            localStorage.removeItem('liturgyBooklet_autosave_v5');
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          }
        }
        const v4 = localStorage.getItem('liturgyBooklet_autosave_v4');
        if (v4 && !localStorage.getItem(STORAGE_KEY)) {
          const m = migrateProject(JSON.parse(v4));
          if (m) {
            state = m;
            applyCssVars();
            localStorage.removeItem('liturgyBooklet_autosave_v4');
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          }
        }
        const v3 = localStorage.getItem('liturgyBooklet_autosave_v3');
        if (v3 && !localStorage.getItem(STORAGE_KEY)) {
          const m = migrateProject(JSON.parse(v3));
          if (m) {
            state = m;
            applyCssVars();
            localStorage.removeItem('liturgyBooklet_autosave_v3');
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          }
        }
        const v2 = localStorage.getItem('liturgyBooklet_autosave_v2');
        if (v2 && !localStorage.getItem(STORAGE_KEY)) {
          const m = migrateProject(JSON.parse(v2));
          if (m) {
            state = m;
            applyCssVars();
            localStorage.removeItem('liturgyBooklet_autosave_v2');
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          }
        }
        const old = localStorage.getItem('liturgyBooklet_autosave_v1');
        if (old && !localStorage.getItem(STORAGE_KEY)) {
          const m = migrateProject(JSON.parse(old));
          if (m) {
            state = m;
            applyCssVars();
            localStorage.removeItem('liturgyBooklet_autosave_v1');
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          }
        }
        return;
      }
      const m = migrateProject(JSON.parse(raw));
      if (m && Array.isArray(m.blocks)) {
        state = m;
        applyCssVars();
      }
    } catch (e) {
      console.warn('Autosave load failed', e);
    }
  }

  function syncControlsFromState() {
    const sz = document.getElementById('selPageSize');
    const m = document.getElementById('inpMargin');
    const fs = document.getElementById('rngFontScale');
    const sg = document.getElementById('inpSectionGap');
    const pd = document.getElementById('selPreviewDisplay');
    const sf = document.getElementById('selBookletFont');
    const rc = document.getElementById('inpRubricColor');
    const pt = document.getElementById('inpProjectTitle');
    const cn = document.getElementById('rngChantNeume');
    const cl = document.getElementById('rngChantLinePad');
    const ct = document.getElementById('rngChantLyricTight');
    const cs = document.getElementById('rngChantSystemGap');
    const csc = document.getElementById('inpChantStaffColor');
    if (sz) sz.value = state.settings.pageSize;
    if (m) m.value = String(state.settings.marginMm);
    if (fs) fs.value = String(state.settings.fontScale);
    if (sg) sg.value = String(state.settings.sectionGapMm ?? 8);
    if (pd) pd.value = state.settings.previewDisplay === 'booklet' ? 'booklet' : 'scroll';
    if (sf) sf.value = BOOKLET_FONT_STACKS[state.settings.fontFamilyKey] ? state.settings.fontFamilyKey : 'georgia';
    if (rc) rc.value = /^#[0-9a-f]{6}$/i.test(state.settings.rubricColor || '') ? state.settings.rubricColor : '#8b1538';
    if (pt) pt.value = state.projectTitle != null ? state.projectTitle : '';
    if (cn) cn.value = String(state.settings.chantNeumeSize ?? 19.2);
    if (cl) cl.value = String(state.settings.chantLinePadTop ?? 6);
    if (ct) ct.value = String(state.settings.chantLyricTight ?? 0.7);
    if (cs) cs.value = String(state.settings.chantSystemGap ?? 4);
    if (csc) {
      const sc = String(state.settings.chantStaffColor || '').trim();
      csc.value = /^#[0-9a-f]{6}$/i.test(sc) ? sc : '#000000';
    }
  }

  function gabcToExsurge(gabc) {
    return gabc
      .replace(/(<b>[^<]+)<sp>'(?:oe|œ)<\/sp>/g, '$1œ</b>\u0301<b>')
      .replace(/<v>\\([VRAvra])bar<\/v>/g, '$1/.')
      .replace(/<sp>([VRAvra])\/<\/sp>\.?/g, '$1/.')
      .replace(/<b><\/b>/g, '')
      .replace(/<sp>'(?:ae|æ)<\/sp>/g, 'ǽ')
      .replace(/<sp>'(?:oe|œ)<\/sp>/g, 'œ́')
      .replace(/<v>\\greheightstar<\/v>/g, '*')
      .replace(/<\/?sc>/g, '%')
      .replace(/<\/?b>/g, '*')
      .replace(/<\/?i>/g, '_')
      .replace(/(\s)_([^\s*]+)_(\(\))?(\s)/g, '$1^_$2_^$3$4')
      .replace(/(\([cf][1-4]\)|\s)(\d+\.)(\s\S)/g, '$1^$2^$3');
  }

  function renderChantGabcToLines(gabcRaw, widthPx) {
    if (!gabcRaw || !String(gabcRaw).trim()) {
      const d = document.createElement('div');
      d.className = 'text-muted small booklet-section';
      d.textContent =
        'Paste GABC here (e.g. copy from Ben Bloomfield’s propers tool — link under Advanced).';
      return [d];
    }
    try {
      const gabc = gabcToExsurge(String(gabcRaw));
      const header = getHeader(gabcRaw);
      const ctxt = makeBookletChantContext();
      const staffColor = header.staffLineColor || (header.cValues && header.cValues.staffLineColor);
      const overrideStaff = String(state.settings.chantStaffColor || '').trim();
      if (!overrideStaff && staffColor) ctxt.staffLineColor = staffColor;
      const mappings = exsurge.Gabc.createMappingsFromSource(ctxt, gabc);
      const initialStyle = header['initial-style'] !== '0' && header['initial-style'] !== 0;
      const score = new exsurge.ChantScore(ctxt, mappings, initialStyle);
      if (initialStyle && header.annotation) {
        try {
          const annotationArray = header.annotationArray;
          if (annotationArray) {
            score.annotation = new exsurge.Annotations(
              ctxt,
              '%' + annotationArray[0] + '%',
              '%' + annotationArray[1] + '%'
            );
          } else if (header.annotation) {
            score.annotation = new exsurge.Annotations(ctxt, '%' + header.annotation + '%');
          }
        } catch (annErr) {
          console.warn('Annotation layout skipped', annErr);
        }
      }
      if (typeof exsurge.Latin === 'function') {
        ctxt.defaultLanguage = new exsurge.Latin();
      }
      score.mapExsurgeToGabc = function () {};
      score.performLayout(ctxt);
      score.layoutChantLines(ctxt, widthPx);
      const html = score.createSvgForEachLine(ctxt);
      const temp = document.createElement('div');
      temp.innerHTML = html;
      const lines = [];
      const padTop = Math.min(20, Math.max(0, Number(state.settings.chantLinePadTop) || 6));
      temp.querySelectorAll('svg').forEach(function (svg) {
        svg.setAttribute('overflow', 'visible');
        svg.style.overflow = 'visible';
        const line = document.createElement('div');
        line.className = 'booklet-chant-line';
        line.style.paddingTop = padTop + 'px';
        line.style.overflow = 'visible';
        line.appendChild(svg);
        lines.push(line);
      });
      if (!lines.length) {
        const fb = document.createElement('div');
        fb.className = 'text-danger small booklet-section';
        fb.textContent = 'Could not render this GABC.';
        return [fb];
      }
      return lines;
    } catch (err) {
      console.error(err);
      const e = document.createElement('div');
      e.className = 'text-danger small booklet-section';
      e.textContent = 'GABC error: ' + (err.message || String(err));
      return [e];
    }
  }

  function ensurePdfWorker() {
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }
  }

  async function renderEditionPageUnits(b, widthPx) {
    const from = Math.max(1, parseInt(b.pdfPageFrom, 10) || 1);
    let to = b.pdfPageTo;
    if (to === '' || to === undefined || to === null) to = null;
    else to = parseInt(to, 10);
    if (!b.url || !String(b.url).trim()) {
      const d = document.createElement('div');
      d.className = 'text-muted small booklet-section';
      d.textContent = 'Add a PDF URL. Optionally set “From page” / “To page” to import only some pages.';
      return [d];
    }
    try {
      if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js not loaded');
      ensurePdfWorker();
      const absUrl = resolvePdfUrl(b.url);
      if (!absUrl) throw new Error('No PDF URL');
      const proxyUrl =
        '/api/booklet/pdf-proxy?url=' + encodeURIComponent(absUrl);
      const pdf = await pdfjsLib.getDocument({ url: proxyUrl, withCredentials: true }).promise;
      const last =
        to != null && !isNaN(to) ? Math.min(to, pdf.numPages) : pdf.numPages;
      const first = Math.min(from, pdf.numPages);
      if (first > pdf.numPages || first > last) throw new Error('Invalid page range');
      const out = [];
      for (let pNum = first; pNum <= last; pNum++) {
        const page = await pdf.getPage(pNum);
        const base = page.getViewport({ scale: 1 });
        const scale = widthPx / base.width;
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const img = document.createElement('img');
        img.src = canvas.toDataURL('image/png');
        img.alt = 'PDF page ' + pNum;
        const unit = document.createElement('div');
        unit.className = 'booklet-pdf-page-unit';
        unit.appendChild(img);
        out.push(unit);
      }
      return out;
    } catch (e) {
      console.error(e);
      const d = document.createElement('div');
      d.className = 'text-warning small booklet-section';
      d.innerHTML =
        'Could not load PDF via the site proxy (you must be signed in). For external URLs the server fetches the file for you. ' +
        '<em>' +
        escapeHtml(e.message || String(e)) +
        '</em>';
      return [d];
    }
  }

  function buildStaticSectionEl(b) {
    const wrap = document.createElement('div');
    wrap.className = 'booklet-section';
    if (b.type === 'rubric') {
      appendSectionHeading(wrap, b);
      const p = document.createElement('div');
      p.className = 'rubric booklet-richtext';
      p.appendChild(sanitizeToFragment(b.text || ''));
      wrap.appendChild(p);
    } else if (b.type === 'reading') {
      if (translationHasContent(b.translation)) {
        appendSectionHeading(wrap, b);
        const leftPct = Math.min(80, Math.max(20, parseInt(b.parallelLeftPct, 10) || 50));
        const rightPct = 100 - leftPct;
        const gapMm = Math.min(20, Math.max(0, parseInt(b.parallelGapMm, 10) || 4));
        const halfGap = gapMm / 2;
        const table = document.createElement('table');
        table.className = 'booklet-reading-parallel';
        const tr = document.createElement('tr');
        const tdL = document.createElement('td');
        tdL.style.width = leftPct + '%';
        tdL.style.paddingLeft = '0';
        tdL.style.paddingRight = halfGap + 'mm';
        tdL.style.paddingTop = '0';
        tdL.style.paddingBottom = '0';
        const tdR = document.createElement('td');
        tdR.style.width = rightPct + '%';
        tdR.style.paddingLeft = halfGap + 'mm';
        tdR.style.paddingRight = '0';
        tdR.style.paddingTop = '0';
        tdR.style.paddingBottom = '0';
        if (b.parallelBorder) {
          tdL.style.borderRight = '1px solid #adb5bd';
        }
        const innerL = document.createElement('div');
        innerL.className = 'booklet-richtext reading';
        innerL.appendChild(sanitizeToFragment(b.text || ''));
        const innerR = document.createElement('div');
        innerR.className = 'booklet-richtext reading';
        innerR.appendChild(sanitizeToFragment(b.translation || ''));
        tdL.appendChild(innerL);
        tdR.appendChild(innerR);
        tr.appendChild(tdL);
        tr.appendChild(tdR);
        table.appendChild(tr);
        wrap.appendChild(table);
      } else {
        appendSectionHeading(wrap, b);
        const p = document.createElement('div');
        p.className = 'reading booklet-richtext';
        p.appendChild(sanitizeToFragment(b.text || ''));
        wrap.appendChild(p);
      }
    } else if (b.type === 'image') {
      if (b.dataBase64 && b.mime) {
        const img = document.createElement('img');
        img.className = 'user-img';
        img.src = 'data:' + b.mime + ';base64,' + b.dataBase64;
        img.alt = '';
        wrap.appendChild(img);
      } else {
        const p = document.createElement('p');
        p.className = 'text-muted small';
        p.textContent = 'No image — use Replace image in the editor.';
        wrap.appendChild(p);
      }
    } else if (b.type === 'jgabc_propers') {
      const p = document.createElement('div');
      p.className = 'small text-muted';
      p.innerHTML =
        'Legacy “embedded propers” block. Converted to <strong>Chant (paste GABC)</strong> — paste your GABC or reload an older project.';
      wrap.appendChild(p);
    } else {
      wrap.textContent = 'Unknown block: ' + b.type;
    }
    return wrap;
  }

  /**
   * @returns {Promise<{t:string, el?: HTMLElement}[]>}
   */
  async function buildFlowList() {
    const w = getContentWidthPx();
    const out = [];
    for (const b of state.blocks) {
      if (b.type === 'page_break') {
        out.push({ t: 'break' });
        continue;
      }
      if (b.type === 'chant_gabc') {
        const lines = renderChantGabcToLines(b.gabc || '', w);
        lines.forEach((el) => out.push({ t: 'line', el: el }));
        continue;
      }
      if (b.type === 'edition_pdf') {
        const units = await renderEditionPageUnits(b, w);
        units.forEach((el) => out.push({ t: 'flow', el: el }));
        continue;
      }
      out.push({ t: 'flow', el: buildStaticSectionEl(b) });
    }
    return out;
  }

  function measureElHeight(el, widthPx) {
    const mount = document.getElementById('bookletMeasureMount');
    mount.innerHTML = '';
    mount.style.width = widthPx + 'px';
    mount.style.visibility = 'hidden';
    mount.style.position = 'absolute';
    mount.style.left = '-9999px';
    const clone = el.cloneNode(true);
    mount.appendChild(clone);
    const h = clone.offsetHeight;
    mount.innerHTML = '';
    return h || 1;
  }

  function packFlow(items) {
    const widthPx = getContentWidthPx();
    const maxH = getMaxPageBodyHeightPx();
    const gapSection = mmToPx(state.settings.sectionGapMm ?? 8);
    const gapLine = 3;
    const pages = [];
    let page = [];
    let curH = 0;
    let lastWasLine = false;

    function flush() {
      if (page.length) pages.push(page);
      page = [];
      curH = 0;
      lastWasLine = false;
    }

    for (const it of items) {
      if (it.t === 'break') {
        flush();
        continue;
      }
      const isLine = it.t === 'line';
      const el = it.el;
      const h = measureElHeight(el, widthPx);
      const gap =
        page.length === 0 ? 0 : isLine && lastWasLine ? gapLine : gapSection;
      if (page.length && curH + gap + h > maxH) {
        flush();
        const gap2 = 0;
        page.push(el);
        curH = h + gap2;
        lastWasLine = isLine;
      } else {
        if (page.length) curH += gap;
        page.push(el);
        curH += h;
        lastWasLine = isLine;
      }
    }
    flush();
    return pages;
  }

  function buildBookletSpreadViews(numPages) {
    const views = [];
    if (numPages <= 0) return views;
    const nPad = Math.ceil(numPages / 4) * 4;
    const sheets = nPad / 4;
    for (let s = 0; s < sheets; s++) {
      views.push({
        left: nPad - 2 * s - 1,
        right: 2 * s,
      });
      views.push({
        left: 2 * s + 1,
        right: nPad - 2 * s - 2,
      });
    }
    return views;
  }

  function makeBlankBookletPage() {
    const size = state.settings.pageSize;
    const page = document.createElement('div');
    page.className = 'booklet-page';
    page.dataset.size = size;
    page.dataset.blank = 'true';
    const inner = document.createElement('div');
    inner.className = 'page-inner-flow';
    inner.style.minHeight = '2mm';
    page.appendChild(inner);
    return page;
  }

  function cloneBookletSide(pageDivs, numReal, idx) {
    if (idx >= 0 && idx < numReal) return pageDivs[idx].cloneNode(true);
    return makeBlankBookletPage();
  }

  function scaleBookletSpread(host) {
    const slots = host.querySelectorAll('.booklet-spread-slot');
    if (slots.length !== 2) return;
    const slotW = slots[0].clientWidth;
    const slotH = slots[0].clientHeight;
    if (slotW <= 0 || slotH <= 0) return;
    slots.forEach(function (slot) {
      const outer = slot.querySelector('.booklet-scale-outer');
      const inner = outer && outer.querySelector('.booklet-scale-inner');
      const pg = inner && inner.querySelector('.booklet-page');
      if (!outer || !inner || !pg) return;
      inner.style.transform = '';
      inner.style.width = '';
      inner.style.height = '';
      outer.style.width = '';
      outer.style.height = '';
      const nw = pg.offsetWidth || 1;
      const nh = pg.offsetHeight || 1;
      const sc = Math.min(slotW / nw, slotH / nh, 1);
      inner.style.width = nw + 'px';
      inner.style.height = nh + 'px';
      inner.style.transform = 'scale(' + sc + ')';
      inner.style.transformOrigin = 'top left';
      outer.style.width = nw * sc + 'px';
      outer.style.height = nh * sc + 'px';
    });
  }

  function updateBookletSpreadDisplay(host, pageDivs, views, index) {
    const label = host.querySelector('#bookletSpreadLabel');
    const leftSlot = host.querySelector('.booklet-spread-slot[data-side="left"]');
    const rightSlot = host.querySelector('.booklet-spread-slot[data-side="right"]');
    if (!leftSlot || !rightSlot || !views.length) return;
    const v = views[Math.max(0, Math.min(index, views.length - 1))];
    const n = pageDivs.length;
    leftSlot.innerHTML = '';
    rightSlot.innerHTML = '';
    const lo = document.createElement('div');
    lo.className = 'booklet-scale-outer';
    const li = document.createElement('div');
    li.className = 'booklet-scale-inner';
    li.appendChild(cloneBookletSide(pageDivs, n, v.left));
    lo.appendChild(li);
    leftSlot.appendChild(lo);
    const ro = document.createElement('div');
    ro.className = 'booklet-scale-outer';
    const ri = document.createElement('div');
    ri.className = 'booklet-scale-inner';
    ri.appendChild(cloneBookletSide(pageDivs, n, v.right));
    ro.appendChild(ri);
    rightSlot.appendChild(ro);
    if (label) {
      label.textContent =
        'Sheet ' + (index + 1) + ' / ' + views.length + ' (print order; padded to ' + Math.ceil(n / 4) * 4 + ' pp.)';
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        scaleBookletSpread(host);
      });
    });
  }

  function mountBookletSpreadUi(root, pageDivs) {
    const n = pageDivs.length;
    if (n !== lastBookletSpreadPageCount) {
      bookletSpreadIndex = 0;
      lastBookletSpreadPageCount = n;
    }
    bookletSpreadViews = buildBookletSpreadViews(n);
    if (bookletSpreadIndex >= bookletSpreadViews.length) {
      bookletSpreadIndex = Math.max(0, bookletSpreadViews.length - 1);
    }

    const host = document.createElement('div');
    host.className = 'booklet-spread-host booklet-spread-ui';

    const nav = document.createElement('div');
    nav.className = 'booklet-spread-nav';
    const btnPrev = document.createElement('button');
    btnPrev.type = 'button';
    btnPrev.className = 'btn btn-sm btn-outline-secondary';
    btnPrev.innerHTML = '<i class="bi bi-chevron-left"></i> Previous sheet';
    const btnNext = document.createElement('button');
    btnNext.type = 'button';
    btnNext.className = 'btn btn-sm btn-outline-secondary';
    btnNext.innerHTML = 'Next sheet <i class="bi bi-chevron-right"></i>';
    const lab = document.createElement('span');
    lab.className = 'small text-muted';
    lab.id = 'bookletSpreadLabel';
    nav.appendChild(btnPrev);
    nav.appendChild(lab);
    nav.appendChild(btnNext);

    const vp = document.createElement('div');
    vp.className = 'booklet-spread-viewport';
    const leftSlot = document.createElement('div');
    leftSlot.className = 'booklet-spread-slot';
    leftSlot.dataset.side = 'left';
    const rightSlot = document.createElement('div');
    rightSlot.className = 'booklet-spread-slot';
    rightSlot.dataset.side = 'right';
    vp.appendChild(leftSlot);
    vp.appendChild(rightSlot);
    host.appendChild(nav);
    host.appendChild(vp);
    root.appendChild(host);

    function syncNavButtons() {
      btnPrev.disabled = bookletSpreadIndex <= 0;
      btnNext.disabled = bookletSpreadIndex >= bookletSpreadViews.length - 1;
    }

    function goPrev() {
      if (bookletSpreadIndex <= 0) return;
      bookletSpreadIndex--;
      updateBookletSpreadDisplay(host, pageDivs, bookletSpreadViews, bookletSpreadIndex);
      syncNavButtons();
    }
    function goNext() {
      if (bookletSpreadIndex >= bookletSpreadViews.length - 1) return;
      bookletSpreadIndex++;
      updateBookletSpreadDisplay(host, pageDivs, bookletSpreadViews, bookletSpreadIndex);
      syncNavButtons();
    }
    btnPrev.addEventListener('click', goPrev);
    btnNext.addEventListener('click', goNext);

    host._bookletWheelLock = false;
    bookletWheelAccum = 0;
    vp.addEventListener(
      'wheel',
      function (e) {
        if (state.settings.previewDisplay !== 'booklet') return;
        e.preventDefault();
        if (host._bookletWheelLock) return;
        bookletWheelAccum += e.deltaY;
        if (bookletWheelAccum > 90) {
          bookletWheelAccum = 0;
          host._bookletWheelLock = true;
          goNext();
          setTimeout(function () {
            host._bookletWheelLock = false;
          }, 500);
        } else if (bookletWheelAccum < -90) {
          bookletWheelAccum = 0;
          host._bookletWheelLock = true;
          goPrev();
          setTimeout(function () {
            host._bookletWheelLock = false;
          }, 500);
        }
      },
      { passive: false }
    );

    window.addEventListener('resize', onWinResize);
    function onWinResize() {
      scaleBookletSpread(host);
    }
    host._bookletCleanup = function () {
      window.removeEventListener('resize', onWinResize);
    };

    updateBookletSpreadDisplay(host, pageDivs, bookletSpreadViews, bookletSpreadIndex);
    syncNavButtons();
  }

  async function renderPreview() {
    const root = document.getElementById('previewPages');
    const store = document.getElementById('bookletPageStore');
    if (!root) return;
    const myTok = ++previewToken;
    const size = state.settings.pageSize;
    const prevHost = root.querySelector('.booklet-spread-host');
    if (prevHost && prevHost._bookletCleanup) prevHost._bookletCleanup();
    exportPageElements = [];
    if (store) store.innerHTML = '';

    if (!state.blocks.length) {
      const hint = document.createElement('div');
      hint.className = 'booklet-page';
      hint.dataset.placeholder = 'true';
      hint.dataset.size = size;
      const inner = document.createElement('div');
      inner.className = 'page-inner-flow text-muted text-center py-5';
      inner.innerHTML =
        '<p>Add sections from the left.</p><p class="small">Use <strong>Chant (paste GABC)</strong> with text from <a href="https://bbloomf.github.io/jgabc/propers.html" target="_blank" rel="noopener">Ben Bloomfield’s propers tool</a>.</p>';
      root.innerHTML = '';
      root.appendChild(hint);
      return;
    }

    root.innerHTML = '<p class="text-muted small no-print px-2">Laying out preview…</p>';

    let flow;
    try {
      flow = await buildFlowList();
    } catch (e) {
      console.error(e);
      root.innerHTML = '<p class="text-danger small">Layout error.</p>';
      return;
    }
    if (myTok !== previewToken) return;

    const pageGroups = packFlow(flow);
    const pageDivs = pageGroups.map(function (elements) {
      const page = document.createElement('div');
      page.className = 'booklet-page';
      page.dataset.size = size;
      const inner = document.createElement('div');
      inner.className = 'page-inner-flow';
      elements.forEach((el) => inner.appendChild(el));
      page.appendChild(inner);
      return page;
    });

    root.innerHTML = '';
    if (!pageDivs.length) {
      root.innerHTML =
        '<p class="text-muted small px-2">Nothing to show yet — add text, chant, or other sections (page breaks alone do not add pages).</p>';
      exportPageElements = [];
      return;
    }

    pageDivs.push(buildWatermarkPage(size));
    exportPageElements = pageDivs;

    const display = state.settings.previewDisplay === 'booklet' ? 'booklet' : 'scroll';

    const hintEl = document.getElementById('previewHint');
    if (hintEl) {
      hintEl.innerHTML =
        display === 'booklet'
          ? '<strong>Preview</strong> — booklet sheets (saddle-stitch order, padded to a multiple of four pages). Arrow buttons or wheel: next/previous sheet. PDF export still uses every page in order.'
          : '<strong>Preview</strong> — layout matches PDF pages (raster export). Switch to <em>booklet spreads</em> in the toolbar to preview folded imposition.';
    }

    if (display === 'scroll') {
      pageDivs.forEach(function (p) {
        root.appendChild(p);
      });
    } else {
      if (store) {
        pageDivs.forEach(function (p) {
          store.appendChild(p);
        });
      }
      mountBookletSpreadUi(root, pageDivs);
    }
  }

  function moveBlock(blockId, delta) {
    const i = state.blocks.findIndex((x) => x.id === blockId);
    if (i < 0) return;
    const j = i + delta;
    if (j < 0 || j >= state.blocks.length) return;
    const t = state.blocks[i];
    state.blocks[i] = state.blocks[j];
    state.blocks[j] = t;
    scheduleAutosave();
    renderBlockList();
    renderPreview();
  }

  function renderBlockList() {
    const el = document.getElementById('blockList');
    if (!el) return;
    el.innerHTML = '';
    state.blocks.forEach((b, idx) => {
      const row = document.createElement('div');
      row.className = 'booklet-block-row';

      const moves = document.createElement('div');
      moves.className = 'booklet-block-move';
      const btnUp = document.createElement('button');
      btnUp.type = 'button';
      btnUp.className = 'btn btn-outline-secondary';
      btnUp.title = 'Move up';
      btnUp.innerHTML = '<i class="bi bi-chevron-up" aria-hidden="true"></i>';
      btnUp.disabled = idx === 0;
      const btnDown = document.createElement('button');
      btnDown.type = 'button';
      btnDown.className = 'btn btn-outline-secondary';
      btnDown.title = 'Move down';
      btnDown.innerHTML = '<i class="bi bi-chevron-down" aria-hidden="true"></i>';
      btnDown.disabled = idx === state.blocks.length - 1;
      btnUp.addEventListener('click', (ev) => {
        ev.stopPropagation();
        moveBlock(b.id, -1);
      });
      btnDown.addEventListener('click', (ev) => {
        ev.stopPropagation();
        moveBlock(b.id, 1);
      });
      moves.appendChild(btnUp);
      moves.appendChild(btnDown);

      const div = document.createElement('div');
      div.className = 'block-list-item' + (b.id === selectedBlockId ? ' active' : '');
      const label =
        b.type === 'rubric'
          ? 'Rubric'
          : b.type === 'reading'
            ? 'Reading / prayer'
            : b.type === 'image'
              ? 'Image'
              : b.type === 'edition_pdf'
                ? 'Edition PDF'
                : b.type === 'chant_gabc'
                  ? 'Chant (GABC)'
                  : b.type === 'page_break'
                    ? '— Page break —'
                    : b.type === 'jgabc_propers'
                      ? 'Propers (legacy)'
                      : b.type;
      let preview = '';
      if (b.type === 'rubric') {
        preview = stripTagsForPreview(b.text || '');
      } else if (b.type === 'reading') {
        preview = stripTagsForPreview(b.text || '');
        if (translationHasContent(b.translation)) {
          preview += ' | ' + stripTagsForPreview(b.translation || '');
        }
      } else if (b.type === 'edition_pdf') {
        const tit = (b.title || '').trim();
        preview = (tit ? tit + ' · ' : '') + (b.url || '').slice(0, 28);
        const fr = b.pdfPageFrom != null ? b.pdfPageFrom : 1;
        const to = b.pdfPageTo;
        preview += to != null && to !== '' ? ' p.' + fr + '-' + to : ' p.' + fr + '+';
      } else if (b.type === 'chant_gabc') {
        preview = (b.gabc || '').replace(/\s+/g, ' ').slice(0, 40);
      } else if (b.type === 'image') {
        const cap = (b.label || '').trim();
        preview = cap ? cap.slice(0, 40) : '(no label)';
      }
      div.textContent = idx + 1 + '. ' + label + (preview ? ': ' + preview : '');
      div.dataset.id = b.id;
      div.addEventListener('click', () => {
        selectedBlockId = b.id;
        renderBlockList();
        renderEditor();
      });
      row.appendChild(moves);
      row.appendChild(div);
      el.appendChild(row);
    });
    const rm = document.getElementById('btnRemoveBlock');
    if (rm) rm.disabled = !selectedBlockId;
  }

  function renderEditor() {
    const panel = document.getElementById('editorPanel');
    if (!panel) return;
    const b = state.blocks.find((x) => x.id === selectedBlockId);
    if (!b) {
      panel.innerHTML = '<p class="text-muted">Select a section or add one.</p>';
      return;
    }
    if (b.type === 'page_break') {
      panel.innerHTML =
        '<p class="small text-muted">This forces the next section onto a new page in the preview and PDF.</p>';
      return;
    }
    if (b.type === 'rubric') {
      panel.innerHTML = `
        <label class="form-label small mb-1">Title <span class="text-muted">(optional)</span></label>
        <input type="text" class="form-control form-control-sm mb-1" id="edRubricSecTitle" value="${escapeAttr(b.sectionTitle || '')}" placeholder="Bold, left-aligned above rubric">
        <label class="form-label small mb-1">Source reference <span class="text-muted">(optional)</span></label>
        <input type="text" class="form-control form-control-sm mb-2" id="edRubricSecSource" value="${escapeAttr(b.sectionSourceRef || '')}" placeholder="Italic, right — e.g. rubric source">
        <p class="small text-muted mb-1">Bold, italic, underline, and text colour (preview + PDF).</p>
        <div class="booklet-rich-toolbar rubric-tb">
          <div class="btn-group btn-group-sm flex-wrap mb-1" role="group">
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="bold" title="Bold"><strong>B</strong></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="italic" title="Italic"><em>I</em></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="underline" title="Underline"><u>U</u></button>
          </div>
          <div class="btn-group btn-group-sm flex-wrap mb-1" role="group">
            <button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="foreColor" data-color="#212529" title="Black" style="color:#212529">A</button>
            <button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="foreColor" data-color="#8b1538" title="Burgundy" style="color:#8b1538">A</button>
            <button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="foreColor" data-color="#0d6efd" title="Blue" style="color:#0d6efd">A</button>
            <button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="foreColor" data-color="#198754" title="Green" style="color:#198754">A</button>
            <button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="foreColor" data-color="#6f42c1" title="Purple" style="color:#6f42c1">A</button>
          </div>
        </div>
        <div class="form-control form-control-sm booklet-rich-ed" contenteditable="true" id="edRichRubric"></div>
      `;
      const ed = panel.querySelector('#edRichRubric');
      ed.innerHTML = initialRichHtmlForEditor(b.text);
      const st = panel.querySelector('#edRubricSecTitle');
      const ss = panel.querySelector('#edRubricSecSource');
      const pushMeta = () => {
        b.sectionTitle = st ? st.value : '';
        b.sectionSourceRef = ss ? ss.value : '';
        scheduleAutosave();
        renderPreview();
        renderBlockList();
      };
      st.addEventListener('input', pushMeta);
      ss.addEventListener('input', pushMeta);
      const push = () => {
        b.text = ed.innerHTML;
        scheduleAutosave();
        renderPreview();
        renderBlockList();
      };
      bindRichToolbar(panel.querySelector('.rubric-tb'), ed, push);
    } else if (b.type === 'reading') {
      const split = b.parallelLeftPct != null ? b.parallelLeftPct : 50;
      const gap = b.parallelGapMm != null ? b.parallelGapMm : 4;
      panel.innerHTML = `
        <label class="form-label small mb-1">Section title <span class="text-muted">(optional)</span></label>
        <input type="text" class="form-control form-control-sm mb-1" id="edReadSecTitle" value="${escapeAttr(b.sectionTitle || '')}" placeholder="Bold, left above both columns">
        <label class="form-label small mb-1">Source reference <span class="text-muted">(optional)</span></label>
        <input type="text" class="form-control form-control-sm mb-2" id="edReadSecSource" value="${escapeAttr(b.sectionSourceRef || '')}" placeholder="Italic, right — e.g. John 3:16">
        <label class="form-label small mb-1">Original</label>
        <div class="booklet-rich-toolbar read-tb-orig">
          <div class="btn-group btn-group-sm flex-wrap mb-1" role="group">
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="bold" title="Bold"><strong>B</strong></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="italic" title="Italic"><em>I</em></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="underline" title="Underline"><u>U</u></button>
          </div>
          <div class="btn-group btn-group-sm flex-wrap mb-1" role="group">
            <button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="foreColor" data-color="#212529" title="Black" style="color:#212529">A</button>
            <button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="foreColor" data-color="#8b1538" title="Burgundy" style="color:#8b1538">A</button>
            <button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="foreColor" data-color="#0d6efd" title="Blue" style="color:#0d6efd">A</button>
            <button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="foreColor" data-color="#198754" title="Green" style="color:#198754">A</button>
            <button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="foreColor" data-color="#6f42c1" title="Purple" style="color:#6f42c1">A</button>
          </div>
        </div>
        <div class="form-control form-control-sm booklet-rich-ed mb-2" contenteditable="true" id="edReadOrig"></div>
        <label class="form-label small mb-1">Translation <span class="text-muted">(parallel columns when this has text)</span></label>
        <div class="booklet-rich-toolbar read-tb-trans">
          <div class="btn-group btn-group-sm flex-wrap mb-1" role="group">
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="bold" title="Bold"><strong>B</strong></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="italic" title="Italic"><em>I</em></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="underline" title="Underline"><u>U</u></button>
          </div>
          <div class="btn-group btn-group-sm flex-wrap mb-1" role="group">
            <button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="foreColor" data-color="#212529" title="Black" style="color:#212529">A</button>
            <button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="foreColor" data-color="#8b1538" title="Burgundy" style="color:#8b1538">A</button>
            <button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="foreColor" data-color="#0d6efd" title="Blue" style="color:#0d6efd">A</button>
            <button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="foreColor" data-color="#198754" title="Green" style="color:#198754">A</button>
            <button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="foreColor" data-color="#6f42c1" title="Purple" style="color:#6f42c1">A</button>
          </div>
        </div>
        <div class="form-control form-control-sm booklet-rich-ed mb-2" contenteditable="true" id="edReadTrans"></div>
        <div id="readParallelOpts" class="border rounded p-2 bg-light small">
          <label class="form-label small mb-1">Column split <span class="text-muted">(original width %)</span></label>
          <input type="range" class="form-range" id="rngReadSplit" min="20" max="80" step="1" value="${split}">
          <div class="d-flex justify-content-between"><span>20%</span><span id="readSplitVal">${split}%</span><span>80%</span></div>
          <div class="form-check mt-2">
            <input class="form-check-input" type="checkbox" id="chkReadBorder" ${b.parallelBorder ? 'checked' : ''}>
            <label class="form-check-label" for="chkReadBorder">Vertical line between columns only</label>
          </div>
          <label class="form-label small mb-0 mt-2">Space between columns (mm)</label>
          <input type="number" class="form-control form-control-sm" id="inpReadGap" min="0" max="20" value="${gap}">
        </div>
      `;
      const edO = panel.querySelector('#edReadOrig');
      const edT = panel.querySelector('#edReadTrans');
      const rst = panel.querySelector('#edReadSecTitle');
      const rss = panel.querySelector('#edReadSecSource');
      edO.innerHTML = initialRichHtmlForEditor(b.text);
      edT.innerHTML = initialRichHtmlForEditor(b.translation);
      const pushMetaRead = () => {
        b.sectionTitle = rst ? rst.value : '';
        b.sectionSourceRef = rss ? rss.value : '';
        scheduleAutosave();
        renderPreview();
        renderBlockList();
      };
      rst.addEventListener('input', pushMetaRead);
      rss.addEventListener('input', pushMetaRead);
      const push = () => {
        b.text = edO.innerHTML;
        b.translation = edT.innerHTML;
        scheduleAutosave();
        renderPreview();
        renderBlockList();
      };
      bindRichToolbar(panel.querySelector('.read-tb-orig'), edO, push);
      bindRichToolbar(panel.querySelector('.read-tb-trans'), edT, push);
      const rng = panel.querySelector('#rngReadSplit');
      const rv = panel.querySelector('#readSplitVal');
      const chk = panel.querySelector('#chkReadBorder');
      const ig = panel.querySelector('#inpReadGap');
      const syncParallel = () => {
        b.parallelLeftPct = parseInt(rng.value, 10) || 50;
        if (rv) rv.textContent = b.parallelLeftPct + '%';
        b.parallelBorder = !!chk.checked;
        b.parallelGapMm = Math.min(20, Math.max(0, parseInt(ig.value, 10) || 4));
        scheduleAutosave();
        renderPreview();
      };
      rng.addEventListener('input', syncParallel);
      chk.addEventListener('change', syncParallel);
      ig.addEventListener('input', syncParallel);
    } else if (b.type === 'image') {
      panel.innerHTML = `
        <label class="form-label small mb-1">Section list name</label>
        <input type="text" class="form-control form-control-sm mb-2" id="edImgLabel" value="${escapeAttr(b.label || '')}" placeholder="e.g. Cover, Map — not shown in booklet">
        <p class="small text-muted mb-2">Shown only in the left-hand section list. Stored as base64 in the project file.</p>
        <button type="button" class="btn btn-sm btn-outline-primary" id="edReplaceImg">Replace image</button>
      `;
      const li = panel.querySelector('#edImgLabel');
      li.addEventListener('input', () => {
        b.label = li.value;
        scheduleAutosave();
        renderBlockList();
      });
      panel.querySelector('#edReplaceImg').addEventListener('click', () => pickImageForBlock(b.id));
    } else if (b.type === 'edition_pdf') {
      panel.innerHTML = `
        <label class="form-label small mb-1">Search Polyphony editions</label>
        <input type="search" class="form-control form-control-sm mb-1" id="edEditionSearch" placeholder="Work title, composer…" autocomplete="off">
        <div id="edEditionResults" class="booklet-edition-results mb-2 d-none list-group list-group-flush"></div>
        <p class="small text-muted mb-1">Or paste a PDF URL (any host):</p>
        <input type="url" class="form-control form-control-sm mb-2" id="edUrl" value="${escapeAttr(b.url || '')}" placeholder="https://… or site-relative path">
        <label class="form-label small mb-1">From page (1-based)</label>
        <input type="number" class="form-control form-control-sm mb-2" id="edPdfFrom" min="1" value="${escapeAttr(String(b.pdfPageFrom != null ? b.pdfPageFrom : 1))}">
        <label class="form-label small mb-1">To page <span class="text-muted">(empty = through last page)</span></label>
        <input type="number" class="form-control form-control-sm mb-2" id="edPdfTo" min="1" placeholder="e.g. 3" value="${b.pdfPageTo != null && b.pdfPageTo !== '' ? escapeAttr(String(b.pdfPageTo)) : ''}">
        <label class="form-label small mb-1">Section list name <span class="text-muted">(not shown on pages)</span></label>
        <input type="text" class="form-control form-control-sm" id="edTitle" value="${escapeAttr(b.title || '')}" placeholder="Label in the section list">
      `;
      const u = panel.querySelector('#edUrl');
      const pf = panel.querySelector('#edPdfFrom');
      const pt = panel.querySelector('#edPdfTo');
      const t = panel.querySelector('#edTitle');
      const searchInp = panel.querySelector('#edEditionSearch');
      const resultsEl = panel.querySelector('#edEditionResults');

      function applyCatalogueEditionPick(row) {
        b.url = String(row.fileUrl || '').trim();
        b.catalogueSourceUrl = resolvePdfUrl(row.fileUrl);
        b.catalogueEditorName = row.editorName || '';
        b.catalogueGroupTitle = row.groupTitle || '';
        u.value = b.url;
        if (!String(b.title || '').trim()) {
          b.title = (row.groupTitle + ' — ' + row.editorName).slice(0, 120);
          t.value = b.title;
        }
        resultsEl.classList.add('d-none');
        resultsEl.innerHTML = '';
        searchInp.value = '';
        scheduleAutosave();
        renderPreview();
        renderBlockList();
      }

      const onChange = () => {
        const trimmed = u.value.trim();
        const resolved = resolvePdfUrl(trimmed);
        const src = b.catalogueSourceUrl ? resolvePdfUrl(b.catalogueSourceUrl) : '';
        if (!b.catalogueSourceUrl || resolved !== src) {
          b.catalogueEditorName = '';
          b.catalogueGroupTitle = '';
          b.catalogueSourceUrl = null;
        }
        b.url = trimmed;
        b.pdfPageFrom = Math.max(1, parseInt(pf.value, 10) || 1);
        const tv = pt.value.trim();
        const toNum = tv === '' ? null : parseInt(tv, 10);
        b.pdfPageTo = toNum != null && !isNaN(toNum) ? toNum : null;
        scheduleAutosave();
        renderPreview();
        renderBlockList();
      };
      u.addEventListener('input', onChange);
      pf.addEventListener('input', onChange);
      pt.addEventListener('input', onChange);
      t.addEventListener('input', () => {
        b.title = t.value;
        scheduleAutosave();
        renderBlockList();
      });

      if (searchInp && resultsEl) {
        let searchTimer = null;
        searchInp.addEventListener('input', function () {
          clearTimeout(searchTimer);
          const q = searchInp.value.trim();
          if (q.length < 2) {
            resultsEl.classList.add('d-none');
            resultsEl.innerHTML = '';
            return;
          }
          searchTimer = setTimeout(async function () {
            if (editionSearchAbort) editionSearchAbort.abort();
            editionSearchAbort = new AbortController();
            resultsEl.classList.remove('d-none');
            resultsEl.innerHTML =
              '<div class="list-group-item text-muted small py-2">Searching…</div>';
            try {
              const data = await fetchEditionSearchResults(q, editionSearchAbort.signal);
              if (selectedBlockId !== b.id) return;
              const rows = flattenEditionSearchRows(data);
              resultsEl.innerHTML = '';
              if (!rows.length) {
                resultsEl.innerHTML =
                  '<div class="list-group-item text-muted small py-2">No editions found.</div>';
                return;
              }
              rows.forEach(function (row) {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'list-group-item list-group-item-action text-start py-2';
                const ln1 = document.createElement('div');
                const vo = row.voicing ? ' · ' + row.voicing : '';
                ln1.textContent = row.groupTitle + ' — ' + row.editorName + vo;
                item.appendChild(ln1);
                if (row.metaLine) {
                  const ln2 = document.createElement('div');
                  ln2.className = 'text-muted small mt-1';
                  ln2.textContent = row.metaLine;
                  item.appendChild(ln2);
                }
                item.addEventListener('click', function () {
                  applyCatalogueEditionPick(row);
                });
                resultsEl.appendChild(item);
              });
            } catch (err) {
              if (err.name === 'AbortError') return;
              resultsEl.innerHTML =
                '<div class="list-group-item text-danger small py-2">Search failed.</div>';
            }
          }, 320);
        });
      }
    } else if (b.type === 'chant_gabc') {
      panel.innerHTML = `
        <p class="small text-muted mb-2">Paste full GABC (including header lines ending with <code>%%</code> if you use them). For complex Mass propers, build them in
        <a href="https://bbloomf.github.io/jgabc/propers.html" target="_blank" rel="noopener">Ben’s propers tool</a> and copy the GABC from there.</p>
        <textarea class="form-control form-control-sm font-monospace" rows="12" id="edGabc">${escapeHtml(b.gabc || '')}</textarea>
        ${b.legacyHash ? '<p class="small text-warning mt-2">Old saved hash (not used for preview): <code class="small">' + escapeHtml(String(b.legacyHash).slice(0, 80)) + '</code></p>' : ''}
      `;
      const ta = panel.querySelector('#edGabc');
      ta.addEventListener('input', () => {
        b.gabc = ta.value;
        scheduleAutosave();
        renderPreview();
        renderBlockList();
      });
    } else if (b.type === 'jgabc_propers') {
      panel.innerHTML =
        '<p class="small text-muted">Replace this block with <strong>Chant (paste GABC)</strong> or reload after migration.</p>';
    }
  }

  function addBlock(type) {
    const b = { id: uid(), type };
    if (type === 'rubric') {
      b.text = '';
      b.sectionTitle = '';
      b.sectionSourceRef = '';
    }
    if (type === 'reading') {
      b.text = '';
      b.translation = '';
      b.parallelLeftPct = 50;
      b.parallelBorder = false;
      b.parallelGapMm = 4;
      b.sectionTitle = '';
      b.sectionSourceRef = '';
    }
    if (type === 'image') {
      b.mime = 'image/png';
      b.dataBase64 = '';
      b.label = '';
      setTimeout(() => pickImageForBlock(b.id), 0);
    }
    if (type === 'edition_pdf') {
      b.url = '';
      b.title = '';
      b.catalogueEditorName = '';
      b.catalogueGroupTitle = '';
      b.catalogueSourceUrl = null;
      b.pdfPageFrom = 1;
      b.pdfPageTo = null;
    }
    if (type === 'chant_gabc') b.gabc = '';
    state.blocks.push(b);
    selectedBlockId = b.id;
    scheduleAutosave();
    renderBlockList();
    renderEditor();
    renderPreview();
  }

  function pickImageForBlock(blockId) {
    const b = state.blocks.find((x) => x.id === blockId);
    if (!b || b.type !== 'image') return;
    const input = document.getElementById('fileImagePick');
    input.onchange = () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        const res = reader.result;
        if (typeof res === 'string' && res.startsWith('data:')) {
          const m = res.match(/^data:([^;]+);base64,(.+)$/);
          if (m) {
            b.mime = m[1];
            b.dataBase64 = m[2];
            scheduleAutosave();
            renderPreview();
            renderBlockList();
            renderEditor();
          }
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  function removeSelectedBlock() {
    if (!selectedBlockId) return;
    state.blocks = state.blocks.filter((x) => x.id !== selectedBlockId);
    selectedBlockId = null;
    scheduleAutosave();
    renderBlockList();
    renderEditor();
    renderPreview();
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = safeFilenameBase(state.projectTitle, 'liturgy-booklet-project') + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function loadJsonFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const m = migrateProject(parsed);
        if (!m || !Array.isArray(m.blocks)) {
          alert('Invalid or unsupported project file (schema 1–' + SCHEMA_VERSION + ').');
          return;
        }
        state = m;
        selectedBlockId = null;
        applyCssVars();
        syncControlsFromState();
        scheduleAutosave();
        renderBlockList();
        renderEditor();
        renderPreview();
      } catch (e) {
        alert('Could not read project file.');
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  async function downloadPdf() {
    const pages = exportPageElements.filter(
      (el) => el && el.isConnected && el.dataset.placeholder !== 'true'
    );
    if (!pages.length) {
      alert('Add content before downloading a PDF.');
      return;
    }
    if (typeof html2canvas === 'undefined' || typeof PDFLib === 'undefined') {
      alert('PDF libraries failed to load.');
      return;
    }

    const btn = document.getElementById('btnDownloadPdf');
    const oldText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Building…';
    }

    try {
      const pdfDoc = await PDFLib.PDFDocument.create();
      const pageW =
        state.settings.pageSize === 'A5' ? PDFLib.PageSizes.A5[0] : PDFLib.PageSizes.A4[0];
      const pageH =
        state.settings.pageSize === 'A5' ? PDFLib.PageSizes.A5[1] : PDFLib.PageSizes.A4[1];

      for (let i = 0; i < pages.length; i++) {
        const el = pages[i];
        const canvas = await html2canvas(el, {
          scale: 2.25,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false,
        });
        const jpgDataUrl = canvas.toDataURL('image/jpeg', 0.88);
        const jpgBytes = await fetch(jpgDataUrl).then((r) => r.arrayBuffer());
        let image;
        try {
          image = await pdfDoc.embedJpg(jpgBytes);
        } catch (e) {
          const pngBlob = await new Promise((resolve, reject) => {
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob'))), 'image/png');
          });
          const pngBytes = await pngBlob.arrayBuffer();
          image = await pdfDoc.embedPng(pngBytes);
        }
        const page = pdfDoc.addPage([pageW, pageH]);
        const iw = image.width;
        const ih = image.height;
        const scale = Math.min(pageW / iw, pageH / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        const x = (pageW - dw) / 2;
        const y = (pageH - dh) / 2;
        page.drawImage(image, { x, y, width: dw, height: dh });
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = safeFilenameBase(state.projectTitle, 'liturgy-booklet') + '.pdf';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      console.error(e);
      alert('PDF export failed.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = oldText;
      }
    }
  }

  function bindUi() {
    document.querySelectorAll('[data-add-type]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        addBlock(btn.getAttribute('data-add-type'));
      });
    });

    document.getElementById('selPageSize')?.addEventListener('change', (e) => {
      state.settings.pageSize = e.target.value;
      scheduleAutosave();
      renderPreview();
    });
    document.getElementById('inpMargin')?.addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      state.settings.marginMm = Number.isFinite(v) ? Math.min(40, Math.max(5, v)) : 15;
      applyCssVars();
      scheduleAutosave();
      renderPreview();
    });
    document.getElementById('inpSectionGap')?.addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      state.settings.sectionGapMm = Number.isFinite(v) ? Math.min(30, Math.max(0, v)) : 8;
      applyCssVars();
      scheduleAutosave();
      renderPreview();
    });
    document.getElementById('rngFontScale')?.addEventListener('input', (e) => {
      state.settings.fontScale = parseFloat(e.target.value) || 1;
      applyCssVars();
      scheduleAutosave();
      renderPreview();
    });
    document.getElementById('selPreviewDisplay')?.addEventListener('change', (e) => {
      state.settings.previewDisplay = e.target.value === 'booklet' ? 'booklet' : 'scroll';
      scheduleAutosave();
      renderPreview();
    });
    document.getElementById('inpProjectTitle')?.addEventListener('input', (e) => {
      state.projectTitle = e.target.value;
      scheduleAutosave();
    });
    document.getElementById('selBookletFont')?.addEventListener('change', (e) => {
      const k = e.target.value;
      state.settings.fontFamilyKey = BOOKLET_FONT_STACKS[k] != null ? k : 'georgia';
      applyCssVars();
      scheduleAutosave();
      renderPreview();
    });
    document.getElementById('inpRubricColor')?.addEventListener('input', (e) => {
      const v = e.target.value;
      state.settings.rubricColor = /^#[0-9a-f]{6}$/i.test(v) ? v : '#8b1538';
      applyCssVars();
      scheduleAutosave();
      renderPreview();
    });

    document.getElementById('rngChantNeume')?.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      state.settings.chantNeumeSize = Number.isFinite(v) ? Math.min(28, Math.max(12, v)) : 19.2;
      scheduleAutosave();
      renderPreview();
    });
    document.getElementById('rngChantLinePad')?.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      state.settings.chantLinePadTop = Number.isFinite(v) ? Math.min(20, Math.max(0, v)) : 6;
      scheduleAutosave();
      renderPreview();
    });
    document.getElementById('rngChantLyricTight')?.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      state.settings.chantLyricTight = Number.isFinite(v) ? Math.min(1.5, Math.max(0.35, v)) : 0.7;
      scheduleAutosave();
      renderPreview();
    });
    document.getElementById('rngChantSystemGap')?.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      state.settings.chantSystemGap = Number.isFinite(v) ? Math.min(24, Math.max(0, v)) : 4;
      scheduleAutosave();
      renderPreview();
    });
    document.getElementById('btnChantStaffDefault')?.addEventListener('click', () => {
      state.settings.chantStaffColor = '';
      syncControlsFromState();
      scheduleAutosave();
      renderPreview();
    });
    document.getElementById('inpChantStaffColor')?.addEventListener('input', (e) => {
      const v = e.target.value;
      state.settings.chantStaffColor = /^#[0-9a-f]{6}$/i.test(v) ? v : '';
      scheduleAutosave();
      renderPreview();
    });

    document.getElementById('btnRemoveBlock')?.addEventListener('click', removeSelectedBlock);
    document.getElementById('btnSaveProject')?.addEventListener('click', downloadJson);
    document.getElementById('btnLoadProject')?.addEventListener('click', () =>
      document.getElementById('fileLoadProject').click()
    );
    document.getElementById('fileLoadProject')?.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) loadJsonFile(f);
    });
    document.getElementById('btnDownloadPdf')?.addEventListener('click', () => downloadPdf());
    document.getElementById('btnPrint')?.addEventListener('click', () => window.print());
  }

  loadAutosave();
  applyCssVars();
  syncControlsFromState();
  bindUi();
  renderBlockList();
  renderEditor();
  renderPreview();
})();
