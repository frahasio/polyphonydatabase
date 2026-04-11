(function () {
  'use strict';

  const SCHEMA_VERSION = 8;
  const STORAGE_KEY = 'liturgyBooklet_autosave_v8';
  const DEFAULT_BOOKLET_MARGIN_MM = 16;
  const DEFAULT_SECTION_GAP_AFTER_MM = 8;
  const DEFAULT_BLOCK_FONT_SCALE = 1;
  const GAP_FLEX_PX = 4;
  const MARGIN_TOLERANCE_PX = 10;
  const LINE_H_PX = 23.2;
  var BOOKLET_FOOTER_RESERVE_PX = 30;

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

  const CHANT_TEXT_FONT_KEYS = ['crimson', 'times', 'palatino', 'garamond', 'georgia'];
  const CHANT_TEXT_FONT_STACKS = {
    crimson: "'Crimson Text', serif",
    times: "'Times New Roman', Times, serif",
    palatino: '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
    garamond: '"Palatino Linotype", Palatino, Garamond, "Times New Roman", serif',
    georgia: 'Georgia, "Times New Roman", Times, serif',
  };

  function normalizeChantTextFontKey(k) {
    const s = String(k || '').toLowerCase();
    return CHANT_TEXT_FONT_KEYS.indexOf(s) >= 0 ? s : 'crimson';
  }

  function parseBoundedNumber(raw, min, max, fallback) {
    const n = parseFloat(String(raw).trim().replace(',', '.'));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  /** @type {{ schemaVersion: number, projectTitle: string, settings: object, blocks: object[] }} */
  let state = {
    schemaVersion: SCHEMA_VERSION,
    projectTitle: '',
    settings: {
      pageSize: 'A4',
      marginMm: DEFAULT_BOOKLET_MARGIN_MM,
      previewDisplay: 'scroll',
      fontFamilyKey: 'georgia',
      rubricColor: '#8b1538',
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
  let renderPreviewTimer = null;

  function scheduleRenderPreview() {
    if (renderPreviewTimer) clearTimeout(renderPreviewTimer);
    renderPreviewTimer = setTimeout(function () {
      renderPreviewTimer = null;
      renderPreview();
    }, 250);
  }

  function scrollPreviewToBlock(blockId) {
    if (!blockId) return;
    var root = document.getElementById('previewPages');
    if (!root) return;
    var target = root.querySelector('[data-block-id="' + blockId + '"]');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

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

  function appendCreditsFooterToLastPage(pageDivs) {
    if (!pageDivs.length) return;
    const last = pageDivs[pageDivs.length - 1];
    const inner = last.querySelector('.page-inner-flow');
    if (!inner) return;
    const old = inner.querySelector('.booklet-export-footer');
    if (old) old.remove();
    const footer = document.createElement('div');
    footer.className = 'booklet-export-footer';
    footer.style.paddingTop = '0.4rem';
    footer.style.fontSize = '7.5pt';
    footer.style.lineHeight = '1.35';
    footer.style.color = '#6c757d';
    const credits = collectCatalogueEditionCredits(state.blocks);
    const parts = [
      'Generated at polyphonydatabase.com (Polyphony Database).',
    ];
    if (credits.length) {
      parts.push('Edition credits: ' + credits.join(', ') + '.');
    }
    footer.textContent = parts.join(' ');
    inner.appendChild(footer);
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

  function getBookletMarginMm() {
    const mm = Number(state.settings.marginMm);
    return Number.isFinite(mm)
      ? Math.min(40, Math.max(6, Math.round(mm)))
      : DEFAULT_BOOKLET_MARGIN_MM;
  }

  function applyCssVars() {
    const root = document.documentElement;
    root.style.setProperty('--booklet-margin-mm', String(getBookletMarginMm()));
    root.style.setProperty('--booklet-font-scale', '1');
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
    const m = getBookletMarginMm();
    return Math.max(200, mmToPx(pageW - 2 * m));
  }

  function getMaxPageBodyHeightPx() {
    const pageH = state.settings.pageSize === 'A5' ? 210 : 297;
    const m = getBookletMarginMm();
    return Math.max(120, mmToPx(pageH - 2 * m));
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

  function normalizeHtmlColorForSanitize(v) {
    if (v == null) return '';
    const s = String(v).trim();
    if (!s) return '';
    if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
    if (/^rgba?\s*\(/i.test(s)) return s;
    if (/^[a-z][a-z0-9()%,.\s-]*$/i.test(s) && s.length < 40) return s.toLowerCase();
    return '';
  }

  function sanitizeRichInlineStyle(styleStr) {
    const parts = [];
    const st = String(styleStr || '');
    const cm = st.match(/color\s*:\s*([^;]+)/i);
    if (cm) {
      const col = normalizeHtmlColorForSanitize(cm[1]);
      if (col) {
        parts.push('color:' + col);
      }
    }
    const fm = st.match(/font-size\s*:\s*([^;]+)/i);
    if (fm) {
      const raw = fm[1].trim();
      const low = raw.toLowerCase();
      if (low === 'inherit' || low === 'initial') {
        parts.push('font-size:' + low);
      } else if (/^(?:\d+(?:\.\d+)?)(?:pt|px|em|rem|%)$/i.test(raw)) {
        const num = parseFloat(raw);
        if (num > 0 && num <= 72) {
          parts.push('font-size:' + raw);
        }
      }
    }
    const ta = st.match(/text-align\s*:\s*([^;]+)/i);
    if (ta) {
      var v = ta[1].trim().toLowerCase();
      if (/^-webkit-/.test(v)) v = v.replace(/^-webkit-/, '');
      if (/^(left|center|right|justify|start|end)$/.test(v)) {
        parts.push('text-align:' + v);
      }
    }
    const tal = st.match(/text-align-last\s*:\s*([^;]+)/i);
    if (tal) {
      var vl = tal[1].trim().toLowerCase();
      if (/^(left|center|right|justify|start|end|auto)$/.test(vl)) {
        parts.push('text-align-last:' + vl);
      }
    }
    return parts.join(';');
  }

  /**
   * Safe subset for rubric/reading/translation: b, i, u, br, lists, span[style=color|font-size].
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
      if (tag === 'ol' || tag === 'ul') {
        const el = document.createElement(tag);
        const start = node.getAttribute('start');
        if (tag === 'ol' && start != null && /^\d+$/.test(String(start).trim())) {
          const n0 = parseInt(start, 10);
          if (n0 >= 1 && n0 <= 9999) {
            el.setAttribute('start', String(n0));
          }
        }
        appendChildren(el, node);
        return el;
      }
      if (tag === 'li') {
        const el = document.createElement('li');
        appendChildren(el, node);
        return el;
      }
      if (tag === 'span') {
        const el = document.createElement('span');
        const safe = sanitizeRichInlineStyle(node.getAttribute('style') || '');
        if (safe) {
          el.setAttribute('style', safe);
        }
        appendChildren(el, node);
        return el;
      }
      if (tag === 'p' || tag === 'div') {
        const st = node.getAttribute('style') || '';
        var alignAttr = (node.getAttribute('align') || '').trim().toLowerCase();
        var safeStyle = sanitizeRichInlineStyle(st);
        if (!safeStyle && alignAttr && /^(left|center|right|justify)$/.test(alignAttr)) {
          safeStyle = 'text-align:' + alignAttr;
        }
        if (safeStyle) {
          const el = document.createElement(tag);
          el.setAttribute('style', safeStyle);
          appendChildren(el, node);
          return el;
        }
        const f = document.createDocumentFragment();
        appendChildren(f, node);
        return f;
      }
      if (tag === 'font') {
        const col = normalizeHtmlColorForSanitize(node.getAttribute('color'));
        const inner = document.createDocumentFragment();
        appendChildren(inner, node);
        if (col) {
          const span = document.createElement('span');
          span.setAttribute('style', 'color:' + col);
          while (inner.firstChild) {
            span.appendChild(inner.firstChild);
          }
          return span;
        }
        return inner;
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

  function plainTextFromHtml(html) {
    const w = document.createElement('div');
    w.appendChild(sanitizeToFragment(html));
    return (w.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function stripGabcHeaderValue(v) {
    return String(v || '')
      .replace(/;+\s*$/g, '')
      .trim();
  }

  /** Section list line for chant blocks: office-part · name when both exist in GABC header. */
  function chantGabcListPreviewFromGabc(raw) {
    const s = String(raw || '').trim();
    if (!s) return 'Empty GABC';
    try {
      if (typeof getHeader === 'function') {
        const header = getHeader(s);
        const part = stripGabcHeaderValue(header['office-part'] || header.officePart);
        const name = stripGabcHeaderValue(header.name);
        if (part && name) return part + ' · ' + name;
      }
    } catch (e) {
      /* ignore */
    }
    const body = s.replace(/^[^\n%]*%%\s*\n?/m, '').trim() || s.split('\n')[0] || s;
    return body.replace(/\s+/g, ' ').trim();
  }

  function blockTypeMeta(b) {
    const t = b.type;
    if (t === 'rubric') {
      return { icon: 'bi-person-arms-up', color: '#8b1538', label: 'Rubric' };
    }
    if (t === 'reading') {
      return { icon: 'bi-text-paragraph', color: '#0d6efd', label: 'Text' };
    }
    if (t === 'chant_gabc') {
      return { icon: 'bi-music-note-beamed', color: '#6f42c1', label: 'Chant (GABC)' };
    }
    if (t === 'image') {
      return { icon: 'bi-image', color: '#198754', label: 'Image' };
    }
    if (t === 'title') {
      return { icon: 'bi-text-center', color: '#495057', label: 'Title rule' };
    }
    if (t === 'edition_pdf') {
      return { icon: 'bi-file-earmark-pdf', color: '#c41230', label: 'Edition PDF' };
    }
    if (t === 'page_break') {
      return { icon: 'bi-file-earmark-break', color: '#6c757d', label: 'Page break' };
    }
    if (t === 'jgabc_propers') {
      return { icon: 'bi-music-note', color: '#fd7e14', label: 'Propers (legacy)' };
    }
    return { icon: 'bi-question-square', color: '#6c757d', label: t || 'Section' };
  }

  function blockListLinePreview(b) {
    if (b.type === 'rubric') {
      const st = String(b.sectionTitle || '').trim();
      const body = plainTextFromHtml(b.text || '');
      if (st && body) return st + ' · ' + body;
      return st || body || 'Empty rubric';
    }
    if (b.type === 'reading') {
      const st = String(b.sectionTitle || '').trim();
      const o = plainTextFromHtml(b.text || '');
      const tr = plainTextFromHtml(b.translation || '');
      const parts = [];
      if (st) parts.push(st);
      if (o) parts.push(o);
      if (translationHasContent(b.translation) && tr) parts.push('(' + tr + ')');
      return parts.length ? parts.join(' · ') : 'Empty text';
    }
    if (b.type === 'edition_pdf') {
      const tit = String(b.title || '').trim();
      const u = String(b.url || '').trim();
      const fr = b.pdfPageFrom != null ? b.pdfPageFrom : 1;
      const to = b.pdfPageTo;
      const pg =
        to != null && to !== '' && !isNaN(parseInt(to, 10))
          ? 'p.' + fr + '–' + to
          : 'p.' + fr + '+';
      if (tit && u) return tit + ' · ' + pg;
      if (tit) return tit + ' · ' + pg;
      if (u) return u + ' · ' + pg;
      return 'Edition PDF · set URL';
    }
    if (b.type === 'chant_gabc') {
      return chantGabcListPreviewFromGabc(b.gabc);
    }
    if (b.type === 'image') {
      const cap = String(b.label || '').trim();
      return cap || 'Image (no list label)';
    }
    if (b.type === 'title') {
      const tx = String(b.text || '').trim();
      return tx || 'Title (empty)';
    }
    if (b.type === 'page_break') {
      return 'Page break';
    }
    if (b.type === 'jgabc_propers') {
      return 'Legacy propers — replace with GABC';
    }
    return String(b.type || '');
  }

  function applyRichFontSize(ed, sizeCss, onChange) {
    ed.focus();
    try {
      document.execCommand('styleWithCSS', false, true);
    } catch (e) {
      /* ignore */
    }
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) {
      onChange();
      return;
    }
    const span = document.createElement('span');
    span.style.fontSize = sizeCss === 'inherit' ? 'inherit' : sizeCss;
    try {
      range.surroundContents(span);
    } catch (err) {
      const contents = range.extractContents();
      span.appendChild(contents);
      range.insertNode(span);
      range.setStartAfter(span);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    onChange();
  }

  function bindRichToolbar(toolbarRoot, ed, onChange) {
    let savedRange = null;
    toolbarRoot.addEventListener(
      'mousedown',
      function (e) {
        if (!e.target.closest('[data-rich-cmd], [data-rich-font-select], .booklet-rich-color-pick')) return;
        if (e.target.closest('select')) return;
        const sel = window.getSelection();
        if (sel.rangeCount > 0 && ed.contains(sel.anchorNode) && ed.contains(sel.focusNode)) {
          try {
            savedRange = sel.getRangeAt(0).cloneRange();
          } catch (e0) {
            savedRange = null;
          }
        }
      },
      true
    );

    function restoreSelection() {
      ed.focus();
      if (!savedRange) return;
      try {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      } catch (eR) {
        /* ignore */
      }
    }

    toolbarRoot.querySelectorAll('[data-rich-cmd]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        restoreSelection();
        const cmd = btn.getAttribute('data-rich-cmd');
        try {
          try {
            document.execCommand('styleWithCSS', false, true);
          } catch (e1) {
            /* ignore */
          }
          if (cmd === 'justifyLeft' || cmd === 'justifyCenter' || cmd === 'justifyRight' || cmd === 'justifyFull') {
            document.execCommand(cmd, false, null);
            var alignVal = { justifyLeft: 'left', justifyCenter: 'center', justifyRight: 'right', justifyFull: 'justify' }[cmd];
            var children = ed.childNodes;
            for (var ci = 0; ci < children.length; ci++) {
              var ch = children[ci];
              if (ch.nodeType === 1 && (ch.tagName === 'DIV' || ch.tagName === 'P')) {
                ch.style.textAlign = alignVal;
                ch.removeAttribute('align');
              }
            }
            if (ed.style.textAlign) {
              ed.style.textAlign = '';
            }
            if (ed.getAttribute('align')) {
              ed.removeAttribute('align');
            }
            if (children.length === 0 || (children.length === 1 && children[0].nodeType === 3)) {
              var wrapper = document.createElement('div');
              wrapper.style.textAlign = alignVal;
              while (ed.firstChild) wrapper.appendChild(ed.firstChild);
              ed.appendChild(wrapper);
            }
          } else if (cmd) {
            document.execCommand(cmd, false, null);
          }
        } catch (err) {
          /* ignore */
        }
        onChange();
      });
    });
    const fontSel = toolbarRoot.querySelector('[data-rich-font-select]');
    if (fontSel) {
      fontSel.addEventListener('change', function () {
        const v = fontSel.value;
        if (v === '') return;
        restoreSelection();
        applyRichFontSize(ed, v, onChange);
        fontSel.value = '';
      });
    }
    var colorPick = toolbarRoot.querySelector('.booklet-rich-color-pick');
    if (colorPick) {
      colorPick.addEventListener('input', function () {
        restoreSelection();
        try {
          document.execCommand('styleWithCSS', false, true);
          document.execCommand('foreColor', false, colorPick.value);
        } catch (e) { /* ignore */ }
        onChange();
      });
    }
    ed.addEventListener('input', onChange);
    ed.addEventListener('blur', onChange);
  }

  function makeBookletChantContext(chantBlock) {
    const b = chantBlock || {};
    var ctxt = new exsurge.ChantContext(exsurge.TextMeasuringStrategy.Canvas);
    ctxt.condenseLineAmount = 1;
    const glyphMult = Math.min(2.5, Math.max(0.3, Number(b.chantGlyphScale) || 1.4));
    ctxt.setGlyphScaling((1 / 16) * glyphMult);
    const lyricPx = Math.min(36, Math.max(10, Number(b.chantNeumeSize) || 23));
    const tfk = normalizeChantTextFontKey(b.chantTextFont);
    ctxt.setFont(CHANT_TEXT_FONT_STACKS[tfk], lyricPx / 0.9);
    var gapRaw = b.chantSystemGap != null ? Number(b.chantSystemGap) : 1;
    ctxt.spaceBetweenSystems = Math.max(0, (Number.isFinite(gapRaw) ? gapRaw : 1) * 3);
    const dropCapScale = Math.min(1.6, Math.max(0.5, Number(b.chantDropCapScale) || 1));
    ctxt.textStyles.dropCap.size = Math.round((lyricPx / 19.2) * 64 * dropCapScale);
    ctxt.textStyles.annotation.size = Math.round((lyricPx / 19.2) * 12.8);
    const tight = Math.min(2.0, Math.max(0.2, Number(b.chantLyricTight) || 1.1));
    ctxt.minLyricWordSpacing *= tight;
    if (b.chantLyricLanguage === 'english' && typeof exsurge.English === 'function') {
      ctxt.defaultLanguage = new exsurge.English();
    } else if (typeof exsurge.Latin === 'function') {
      ctxt.defaultLanguage = new exsurge.Latin();
    }
    ctxt.accidentalSpaceMultiplier = 1.5;
    ctxt.specialCharProperties['font-family'] = "'Versiculum'";
    ctxt.specialCharProperties['font-variant'] = 'normal';
    ctxt.specialCharProperties['font-weight'] = '400';
    var defaultSpecialCharText = ctxt.specialCharText;
    ctxt.specialCharText = function (char) {
      return defaultSpecialCharText(char).toLowerCase();
    };
    const chantRub = String(b.chantRubricColor || '').trim();
    ctxt.setRubricColor(
      chantRub && /^#[0-9a-f]{6}$/i.test(chantRub) ? chantRub : '#000000'
    );
    const sc = String(b.chantStaffColor || '').trim();
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

  function stripLegacyBookletSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    delete settings.fontScale;
    delete settings.sectionGapMm;
    delete settings.chantNeumeSize;
    delete settings.chantStaffColor;
    delete settings.chantLinePadTop;
    delete settings.chantLyricTight;
    delete settings.chantSystemGap;
    delete settings.chantDropCapScale;
  }

  function chantDefaultsFromLegacySettings(leg) {
    return {
      chantNeumeSize: leg.chantNeumeSize != null ? Number(leg.chantNeumeSize) : 19.2,
      chantStaffColor: leg.chantStaffColor != null ? String(leg.chantStaffColor) : '',
      chantLinePadTop: leg.chantLinePadTop != null ? Number(leg.chantLinePadTop) : 6,
      chantLyricTight: leg.chantLyricTight != null ? Number(leg.chantLyricTight) : 0.7,
      chantSystemGap: leg.chantSystemGap != null ? Number(leg.chantSystemGap) : 4,
      chantDropCapScale: leg.chantDropCapScale != null ? Number(leg.chantDropCapScale) : 1,
    };
  }

  function normalizeBlocksV8(blocks, legSettings, applyLegacySpacingAndChant, migrateChantGapToV8Ui) {
    const leg = legSettings || {};
    const legacyGap =
      applyLegacySpacingAndChant && leg.sectionGapMm != null
        ? Math.min(30, Math.max(0, Number(leg.sectionGapMm)))
        : null;
    const legacyFont =
      applyLegacySpacingAndChant && leg.fontScale != null
        ? Math.min(1.5, Math.max(0.75, Number(leg.fontScale)))
        : null;
    const chantD = applyLegacySpacingAndChant ? chantDefaultsFromLegacySettings(leg) : null;

    return (blocks || []).map(function (b) {
      if (b.type === 'edition_pdf') {
        const o = normalizeEditionPdfBlock(b);
        if (o.hidden === undefined) o.hidden = false;
        if (o.sectionGapAfterMm == null) {
          o.sectionGapAfterMm = legacyGap != null ? legacyGap : DEFAULT_SECTION_GAP_AFTER_MM;
        } else {
          o.sectionGapAfterMm = Math.min(40, Math.max(-40, Number(o.sectionGapAfterMm)));
        }
        return o;
      }
      if (b.type === 'page_break') {
        const o = { ...b };
        if (o.hidden === undefined) o.hidden = false;
        return o;
      }
      const o = { ...b };
      if (o.hidden === undefined) o.hidden = false;
      if (o.sectionGapAfterMm == null) {
        o.sectionGapAfterMm = legacyGap != null ? legacyGap : DEFAULT_SECTION_GAP_AFTER_MM;
      } else {
        o.sectionGapAfterMm = Math.min(40, Math.max(-40, Number(o.sectionGapAfterMm)));
      }
      if (o.type === 'rubric' || o.type === 'reading') {
        if (o.fontScale == null) {
          o.fontScale = legacyFont != null ? legacyFont : DEFAULT_BLOCK_FONT_SCALE;
        } else {
          o.fontScale = Math.min(1.5, Math.max(0.75, Number(o.fontScale)));
        }
      }
      if (o.type === 'chant_gabc') {
        const cd = chantD || {};
        o.chantNeumeSize =
          o.chantNeumeSize != null
            ? Math.min(36, Math.max(10, Number(o.chantNeumeSize)))
            : Math.min(36, Math.max(10, Number(cd.chantNeumeSize) || 23));
        o.chantGlyphScale =
          o.chantGlyphScale != null
            ? Math.min(2.5, Math.max(0.3, Number(o.chantGlyphScale)))
            : 1.4;
        o.chantStaffColor = o.chantStaffColor != null ? String(o.chantStaffColor) : cd.chantStaffColor || '';
        o.chantLinePadTop =
          o.chantLinePadTop != null
            ? Math.min(10, Math.max(-10, Number(o.chantLinePadTop)))
            : cd.chantLinePadTop != null
              ? Math.min(10, Math.max(-10, Number(cd.chantLinePadTop)))
              : 0;
        o.chantLyricTight =
          o.chantLyricTight != null
            ? Math.min(2.0, Math.max(0.2, Number(o.chantLyricTight)))
            : Math.min(2.0, Math.max(0.2, Number(cd.chantLyricTight) || 1.1));
        let gapRaw =
          o.chantSystemGap != null
            ? Number(o.chantSystemGap)
            : cd.chantSystemGap != null
              ? Number(cd.chantSystemGap)
              : 0;
        if (!Number.isFinite(gapRaw)) {
          gapRaw = 0;
        }
        if (migrateChantGapToV8Ui) {
          gapRaw = Math.min(8, Math.max(-8, gapRaw / 2));
        } else {
          gapRaw = Math.min(8, Math.max(-8, gapRaw));
        }
        o.chantSystemGap = gapRaw;
        o.chantDropCapScale =
          o.chantDropCapScale != null
            ? Math.min(1.6, Math.max(0.5, Number(o.chantDropCapScale)))
            : Math.min(1.6, Math.max(0.5, Number(cd.chantDropCapScale) || 1));
        if (o.chantUseDropCap === undefined) o.chantUseDropCap = true;
        if (o.chantLyricLanguage !== 'english') o.chantLyricLanguage = 'latin';
        o.chantTextFont = normalizeChantTextFontKey(o.chantTextFont || 'crimson');
        if (o.chantRubricColor === undefined) o.chantRubricColor = '';
        else {
          const cr = String(o.chantRubricColor).trim();
          o.chantRubricColor = /^#[0-9a-f]{6}$/i.test(cr) ? cr : '';
        }
      }
      if (o.type === 'reading') {
        if (o.translation === undefined) o.translation = '';
        if (o.parallelLeftPct == null) o.parallelLeftPct = 50;
        if (o.parallelBorder === undefined) o.parallelBorder = false;
        if (o.parallelGapMm == null) o.parallelGapMm = 4;
        if (o.sectionTitle === undefined) o.sectionTitle = '';
        if (o.sectionSourceRef === undefined) o.sectionSourceRef = '';
      }
      if (o.type === 'rubric') {
        if (o.sectionTitle === undefined) o.sectionTitle = '';
        if (o.sectionSourceRef === undefined) o.sectionSourceRef = '';
      }
      if (o.type === 'image') {
        if (o.label === undefined) o.label = '';
        if (o.imageWidthPx == null) {
          o.imageWidthPx = 0;
        } else {
          o.imageWidthPx = Math.min(4000, Math.max(0, Math.round(Number(o.imageWidthPx))));
        }
        if (o.imageAlign !== 'left' && o.imageAlign !== 'right') {
          o.imageAlign = 'center';
        }
      }
      if (o.type === 'title') {
        if (o.text === undefined) o.text = '';
        o.titleFontKey =
          BOOKLET_FONT_STACKS[o.titleFontKey] != null ? o.titleFontKey : '';
        const tc = String(o.titleTextColor || '#212529').trim();
        o.titleTextColor = /^#[0-9a-f]{6}$/i.test(tc) ? tc : '#212529';
        const lc = String(o.titleLineColor || '#adb5bd').trim();
        o.titleLineColor = /^#[0-9a-f]{6}$/i.test(lc) ? lc : '#adb5bd';
      }
      return o;
    });
  }

  function finalizeProjectV8(parsed, applyLegacySpacingAndChant) {
    const oldSv =
      parsed.schemaVersion != null && Number.isFinite(Number(parsed.schemaVersion))
        ? Number(parsed.schemaVersion)
        : 1;
    const migrateChantGap = oldSv < SCHEMA_VERSION;
    parsed.schemaVersion = SCHEMA_VERSION;
    parsed.projectTitle = parsed.projectTitle != null ? String(parsed.projectTitle) : '';
    parsed.settings = parsed.settings || {};
    stripLegacyBookletSettings(parsed.settings);
    parsed.settings.previewDisplay =
      parsed.settings.previewDisplay === 'booklet' ? 'booklet' : 'scroll';
    parsed.settings.fontFamilyKey =
      BOOKLET_FONT_STACKS[parsed.settings.fontFamilyKey] != null
        ? parsed.settings.fontFamilyKey
        : 'georgia';
    const rc = parsed.settings.rubricColor || '#8b1538';
    parsed.settings.rubricColor = /^#[0-9a-f]{6}$/i.test(rc) ? rc : '#8b1538';
    const mg = Number(parsed.settings.marginMm);
    parsed.settings.marginMm = Number.isFinite(mg)
      ? Math.min(40, Math.max(6, Math.round(mg)))
      : DEFAULT_BOOKLET_MARGIN_MM;
    parsed.blocks = normalizeBlocksV8(
      parsed.blocks,
      parsed.settings,
      applyLegacySpacingAndChant,
      migrateChantGap
    );
    return parsed;
  }

  function migrateProject(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    const v = parsed.schemaVersion || 1;
    if (v >= SCHEMA_VERSION) {
      return finalizeProjectV8(parsed, false);
    }
    const applyLegacy = true;
    if (v === 7) {
      return finalizeProjectV8(parsed, false);
    }
    if (v === 6) {
      return finalizeProjectV8(parsed, applyLegacy);
    }
    if (v === 5) {
      parsed.projectTitle = parsed.projectTitle != null ? String(parsed.projectTitle) : '';
      parsed.settings = parsed.settings || {};
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
      return finalizeProjectV8(parsed, applyLegacy);
    }
    if (v === 4) {
      parsed.projectTitle = parsed.projectTitle != null ? String(parsed.projectTitle) : '';
      parsed.settings = parsed.settings || {};
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
      return finalizeProjectV8(parsed, applyLegacy);
    }
    if (v === 3) {
      parsed.projectTitle = '';
      parsed.settings = parsed.settings || {};
      parsed.settings.fontFamilyKey = 'georgia';
      parsed.settings.rubricColor = '#8b1538';
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
      return finalizeProjectV8(parsed, applyLegacy);
    }
    if (v === 2) {
      parsed.projectTitle = '';
      parsed.settings = parsed.settings || {};
      parsed.settings.previewDisplay = 'scroll';
      parsed.settings.fontFamilyKey = 'georgia';
      parsed.settings.rubricColor = '#8b1538';
      parsed.blocks = (parsed.blocks || []).map((b) => {
        if (b.type === 'image' && b.label === undefined) {
          return { ...b, label: '', imageWidthPx: 0, imageAlign: 'center' };
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
      return finalizeProjectV8(parsed, applyLegacy);
    }
    if (v === 1) {
      parsed.projectTitle = '';
      parsed.settings = parsed.settings || {};
      parsed.settings.sectionGapMm = parsed.settings.sectionGapMm ?? 8;
      parsed.settings.previewDisplay = 'scroll';
      parsed.settings.fontFamilyKey = 'georgia';
      parsed.settings.rubricColor = '#8b1538';
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
          return { ...b, label: b.label != null ? b.label : '', imageWidthPx: 0, imageAlign: 'center' };
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
      return finalizeProjectV8(parsed, applyLegacy);
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
        const v7old = localStorage.getItem('liturgyBooklet_autosave_v7');
        if (v7old && !localStorage.getItem(STORAGE_KEY)) {
          const m = migrateProject(JSON.parse(v7old));
          if (m) {
            state = m;
            applyCssVars();
            localStorage.removeItem('liturgyBooklet_autosave_v7');
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          }
        }
        const v6old = localStorage.getItem('liturgyBooklet_autosave_v6');
        if (v6old && !localStorage.getItem(STORAGE_KEY)) {
          const m = migrateProject(JSON.parse(v6old));
          if (m) {
            state = m;
            applyCssVars();
            localStorage.removeItem('liturgyBooklet_autosave_v6');
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          }
        }
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
    const pd = document.getElementById('selPreviewDisplay');
    const sf = document.getElementById('selBookletFont');
    const rc = document.getElementById('inpRubricColor');
    const pt = document.getElementById('inpProjectTitle');
    if (sz) sz.value = state.settings.pageSize;
    if (pd) pd.value = state.settings.previewDisplay === 'booklet' ? 'booklet' : 'scroll';
    if (sf) sf.value = BOOKLET_FONT_STACKS[state.settings.fontFamilyKey] ? state.settings.fontFamilyKey : 'georgia';
    if (rc) rc.value = /^#[0-9a-f]{6}$/i.test(state.settings.rubricColor || '') ? state.settings.rubricColor : '#8b1538';
    if (pt) pt.value = state.projectTitle != null ? state.projectTitle : '';
    const mgInp = document.getElementById('inpBookletMarginMm');
    if (mgInp) {
      const m = getBookletMarginMm();
      mgInp.value = String(m);
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

  function renderChantGabcToLines(gabcRaw, widthPx, chantBlock) {
    if (!gabcRaw || !String(gabcRaw).trim()) {
      const d = document.createElement('div');
      d.className = 'text-muted small booklet-section';
      d.textContent =
        'Paste GABC here (e.g. from Ben Bloomfield’s propers tool — link under Advanced in the toolbar).';
      return [d];
    }
    try {
      const gabc = gabcToExsurge(String(gabcRaw));
      const header = getHeader(gabcRaw);
      const cb = chantBlock || {};
      const ctxt = makeBookletChantContext(cb);
      const staffColor = header.staffLineColor || (header.cValues && header.cValues.staffLineColor);
      const overrideStaff = String(cb.chantStaffColor || '').trim();
      if (!overrideStaff && staffColor) ctxt.staffLineColor = staffColor;
      const mappings = exsurge.Gabc.createMappingsFromSource(ctxt, gabc);
      const headerAllowsInitial = header['initial-style'] !== '0' && header['initial-style'] !== 0;
      const blockAllowsDropCap = cb.chantUseDropCap !== false;
      const initialStyle = blockAllowsDropCap && headerAllowsInitial;
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
      score.mapExsurgeToGabc = function () {};
      score.performLayout(ctxt);
      score.layoutChantLines(ctxt, widthPx);
      const html = score.createSvgForEachLine(ctxt);
      const temp = document.createElement('div');
      temp.innerHTML = html;
      const lines = [];
      var padTop = Math.max(0, cb.chantLinePadTop != null ? Number(cb.chantLinePadTop) : 2);
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
      const pageWidthMm = state.settings.pageSize === 'A5' ? 148 : 210;
      const pageHeightMm = state.settings.pageSize === 'A5' ? 210 : 297;
      const fullPageWidthPx = mmToPx(pageWidthMm);
      const fullPageHeightPx = mmToPx(pageHeightMm);
      var PDF_DPI_MULT = 1;
      for (let pNum = first; pNum <= last; pNum++) {
        const page = await pdf.getPage(pNum);
        const base = page.getViewport({ scale: 1 });
        const scale = (fullPageWidthPx * PDF_DPI_MULT) / base.width;
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const img = document.createElement('img');
        img.src = canvas.toDataURL('image/png');
        img.alt = 'PDF page ' + pNum;
        img.style.width = fullPageWidthPx + 'px';
        img.style.height = 'auto';
        img.style.objectPosition = 'top center';
        const unit = document.createElement('div');
        unit.className = 'booklet-pdf-page-unit booklet-pdf-bleed';
        unit.style.height = fullPageHeightPx + 'px';
        unit.style.maxHeight = fullPageHeightPx + 'px';
        unit.style.overflow = 'hidden';
        unit.dataset.editionUrl = absUrl;
        unit.dataset.editionPage = String(pNum);
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
    wrap.dataset.blockId = b.id;
    if (b.type === 'rubric' || b.type === 'reading') {
      const fs = Math.min(1.5, Math.max(0.75, Number(b.fontScale) || DEFAULT_BLOCK_FONT_SCALE));
      wrap.style.fontSize = 'calc(11pt * ' + fs + ')';
    }
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
        var _mount = document.getElementById('bookletMeasureMount');
        if (_mount) {
          _mount.style.cssText = 'position:absolute;left:-9999px;visibility:hidden;width:600px;overflow:visible;';
          var _tmpL = innerL.cloneNode(true); var _tmpR = innerR.cloneNode(true);
          _mount.appendChild(_tmpL); _mount.appendChild(_tmpR);
          var _lhL = parseFloat(getComputedStyle(_tmpL).lineHeight) || 0;
          var _lhR = parseFloat(getComputedStyle(_tmpR).lineHeight) || 0;
          var _maxLh = Math.max(_lhL, _lhR, 20);
          _mount.innerHTML = '';
          _mount.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;width:1px;height:1px;overflow:hidden;';
          innerL.style.lineHeight = _maxLh + 'px';
          innerR.style.lineHeight = _maxLh + 'px';
        }
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
      const frame = document.createElement('div');
      frame.className = 'booklet-image-frame';
      const align = b.imageAlign === 'left' || b.imageAlign === 'right' ? b.imageAlign : 'center';
      frame.style.textAlign = align;
      if (b.dataBase64 && b.mime) {
        const img = document.createElement('img');
        img.className = 'user-img';
        img.src = 'data:' + b.mime + ';base64,' + b.dataBase64;
        img.alt = '';
        const wPx = Number(b.imageWidthPx);
        if (Number.isFinite(wPx) && wPx > 0) {
          img.style.width = Math.min(4000, Math.round(wPx)) + 'px';
          img.style.maxWidth = '100%';
        }
        img.style.height = 'auto';
        img.style.display = 'inline-block';
        img.style.verticalAlign = 'top';
        frame.appendChild(img);
        wrap.appendChild(frame);
      } else {
        const p = document.createElement('p');
        p.className = 'text-muted small';
        p.textContent = 'No image — use Replace image in the editor.';
        wrap.appendChild(p);
      }
    } else if (b.type === 'title') {
      const row = document.createElement('div');
      row.className = 'booklet-title-rule';
      const lineL = document.createElement('span');
      lineL.className = 'booklet-title-rule-line';
      lineL.setAttribute('aria-hidden', 'true');
      const lineR = document.createElement('span');
      lineR.className = 'booklet-title-rule-line';
      lineR.setAttribute('aria-hidden', 'true');
      const textEl = document.createElement('span');
      textEl.className = 'booklet-title-rule-text';
      textEl.textContent = String(b.text || '').trim();
      const fk =
        b.titleFontKey && BOOKLET_FONT_STACKS[b.titleFontKey] != null
          ? b.titleFontKey
          : null;
      const fontStack =
        BOOKLET_FONT_STACKS[fk || state.settings.fontFamilyKey] || BOOKLET_FONT_STACKS.georgia;
      textEl.style.fontFamily = fontStack;
      const tc = String(b.titleTextColor || '').trim();
      textEl.style.color = /^#[0-9a-f]{6}$/i.test(tc) ? tc : '#212529';
      const lc = String(b.titleLineColor || '').trim();
      const lineCol = /^#[0-9a-f]{6}$/i.test(lc) ? lc : '#adb5bd';
      lineL.style.backgroundColor = lineCol;
      lineR.style.backgroundColor = lineCol;
      row.appendChild(lineL);
      row.appendChild(textEl);
      row.appendChild(lineR);
      wrap.appendChild(row);
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

  function blockSectionGapAfterMm(b) {
    const g = Number(b.sectionGapAfterMm);
    return Number.isFinite(g) ? Math.min(40, Math.max(-40, g)) : DEFAULT_SECTION_GAP_AFTER_MM;
  }

  async function buildFlowList() {
    var w = getContentWidthPx();
    var out = [];
    for (var bi = 0; bi < state.blocks.length; bi++) {
      var b = state.blocks[bi];
      if (b.hidden) continue;
      if (b.type === 'page_break') {
        out.push({ t: 'break' });
        continue;
      }
      var gapAfter = blockSectionGapAfterMm(b);
      var splittable = (b.type === 'rubric' || b.type === 'reading');
      if (b.type === 'chant_gabc') {
        var lines = renderChantGabcToLines(b.gabc || '', w, b);
        for (var li = 0; li < lines.length; li++) {
          lines[li].dataset.blockId = b.id;
          var isLast = li === lines.length - 1;
          out.push({ t: 'flow', el: lines[li], splittable: false, gapMm: isLast ? gapAfter : 0, internalGapPx: li > 0 ? 3 : 0 });
        }
        continue;
      }
      if (b.type === 'edition_pdf') {
        var units = await renderEditionPageUnits(b, w);
        for (var ui = 0; ui < units.length; ui++) {
          units[ui].dataset.blockId = b.id;
          out.push({ t: 'flow', el: units[ui], splittable: false, gapMm: ui === units.length - 1 ? gapAfter : 0, forceBreakBefore: true });
        }
        continue;
      }
      var el = buildStaticSectionEl(b);
      el.dataset.blockId = b.id;
      out.push({ t: 'flow', el: el, splittable: splittable, gapMm: gapAfter });
    }
    return out;
  }

  function measureInContext(el, widthPx) {
    var mount = document.getElementById('bookletMeasureMount');
    if (!mount) {
      var c = el.cloneNode(true);
      c.style.cssText = 'visibility:hidden;position:absolute;width:' + widthPx + 'px;';
      document.body.appendChild(c);
      var h = c.offsetHeight;
      c.remove();
      return h || 1;
    }
    mount.innerHTML = '';
    mount.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;width:' + widthPx + 'px;overflow:visible;';
    var clone = el.cloneNode(true);
    mount.appendChild(clone);
    var h = clone.offsetHeight;
    mount.innerHTML = '';
    mount.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;width:1px;height:1px;overflow:hidden;';
    return h || 1;
  }

  function snapToLineHeight(targetPx, el) {
    var lineH = 23.2;
    if (el && el.style && el.style.fontSize) {
      var fs = parseFloat(el.style.fontSize);
      if (fs && Number.isFinite(fs) && fs >= 6) lineH = fs * 1.45;
    }
    var snapped = Math.floor(targetPx / lineH) * lineH;
    return snapped > 0 ? snapped : targetPx;
  }

  function createClippedView(el, fromPx, toPx, widthPx, clipClass) {
    var container = document.createElement('div');
    container.className = 'booklet-clip-container' + (clipClass ? ' ' + clipClass : '');
    container.style.width = '100%';
    container.style.height = (toPx - fromPx) + 'px';
    container.style.overflow = 'hidden';
    container.style.position = 'relative';
    container.setAttribute('aria-hidden', 'true');
    var clone = el.cloneNode(true);
    clone.style.position = 'relative';
    clone.style.top = (-fromPx) + 'px';
    clone.style.width = '100%';
    clone.style.pointerEvents = 'none';
    if (el.dataset && el.dataset.blockId) container.dataset.blockId = el.dataset.blockId;
    container.appendChild(clone);
    return container;
  }

  function paginateFlow(flowItems, widthPx, pageHPx) {
    var pages = [];
    var curEls = [];
    var curHeights = [];
    var curGaps = [];
    var curGapFlex = [];
    var defaultGapMm = DEFAULT_SECTION_GAP_AFTER_MM;
    var pendingGapMm = defaultGapMm;

    function numFlexGaps() {
      var n = 0;
      for (var j = 0; j < curGapFlex.length; j++) if (curGapFlex[j]) n++;
      return n;
    }

    function calcContent(delta) {
      var t = 0;
      for (var j = 0; j < curHeights.length; j++) {
        t += (curGapFlex[j] ? Math.max(0, curGaps[j] + delta) : curGaps[j]) + curHeights[j];
      }
      return t;
    }

    function buildAdjGaps(delta) {
      var out = [];
      for (var j = 0; j < curGaps.length; j++) {
        out.push(curGapFlex[j] ? Math.max(0, curGaps[j] + delta) : curGaps[j]);
      }
      return out;
    }

    function pushPage(els, gaps, padTop, padBot) {
      pages.push({
        elements: els,
        adjustedGaps: gaps,
        padTopAdjust: Math.round(padTop * 10) / 10,
        padBottomAdjust: Math.round(padBot * 10) / 10
      });
    }

    function finalizePage() {
      if (!curEls.length) return;
      var ideal = calcContent(0);
      var nf = numFlexGaps();
      var delta = 0;
      if (ideal > pageHPx) {
        delta = nf > 0 ? -Math.min(GAP_FLEX_PX, (ideal - pageHPx) / nf) : 0;
      } else if (ideal < pageHPx) {
        delta = nf > 0 ? Math.min(GAP_FLEX_PX, (pageHPx - ideal) / nf) : 0;
      }
      var adjusted = calcContent(delta);
      var padAdj = Math.max(-(MARGIN_TOLERANCE_PX / 2), (pageHPx - adjusted) / 2);
      pushPage(curEls, buildAdjGaps(delta), padAdj, padAdj);
    }

    function flushPage() {
      finalizePage();
      curEls = [];
      curHeights = [];
      curGaps = [];
      curGapFlex = [];
      pendingGapMm = defaultGapMm;
    }

    function bestLineSnap(avail, maxAvail) {
      if (avail < LINE_H_PX) return { h: avail, borrow: 0 };
      var fn = Math.floor(avail / LINE_H_PX);
      var ch = (fn + 1) * LINE_H_PX;
      var fh = fn * LINE_H_PX;
      if (ch <= maxAvail) return { h: ch, borrow: Math.max(0, ch - avail) };
      if (fh > 0) return { h: fh, borrow: 0 };
      return { h: avail, borrow: 0 };
    }

    function splitContinuation(el, totalH, startOffset, w) {
      var offset = startOffset;
      while (offset < totalH) {
        var rem = totalH - offset;
        var snap = bestLineSnap(pageHPx, pageHPx + MARGIN_TOLERANCE_PX);
        if (rem <= snap.h) {
          curEls = [createClippedView(el, offset, totalH, w, 'booklet-clip-bottom')];
          curHeights = [rem];
          curGaps = [0];
          curGapFlex = [false];
          break;
        }
        var sliceH = snap.h;
        var cls = offset === 0 ? 'booklet-clip-top' : 'booklet-clip-mid';
        var clip = createClippedView(el, offset, offset + sliceH, w, cls);
        var padAdj = Math.max(-(MARGIN_TOLERANCE_PX / 2), (pageHPx - sliceH) / 2);
        pushPage([clip], [0], padAdj, padAdj);
        offset += sliceH;
      }
    }

    function placeOnNewPage(el, h, splittable, w) {
      if (h <= pageHPx + MARGIN_TOLERANCE_PX || !splittable) {
        curEls = [el];
        curHeights = [h];
        curGaps = [0];
        curGapFlex = [false];
      } else {
        splitContinuation(el, h, 0, w);
      }
    }

    for (var i = 0; i < flowItems.length; i++) {
      var item = flowItems[i];
      if (item.t === 'break') { flushPage(); continue; }

      var el = item.el;
      var h = measureInContext(el, widthPx);
      var gap = 0, gapFlex = false;

      if (curEls.length > 0) {
        if (item.internalGapPx != null && item.internalGapPx >= 0) {
          gap = item.internalGapPx;
        } else {
          gap = mmToPx(pendingGapMm);
          gapFlex = true;
        }
      }

      if (item.forceBreakBefore && curEls.length) {
        flushPage();
        gap = 0;
        gapFlex = false;
      }

      var minGap = gapFlex ? Math.max(0, gap - GAP_FLEX_PX) : gap;
      var minTotal = calcContent(-GAP_FLEX_PX) + minGap + h;

      if (minTotal <= pageHPx + MARGIN_TOLERANCE_PX) {
        curEls.push(el);
        curHeights.push(h);
        curGaps.push(gap);
        curGapFlex.push(gapFlex);
      }
      else if (item.splittable && curEls.length > 0) {
        var minAbove = calcContent(-GAP_FLEX_PX) + minGap;
        var maxRemaining = pageHPx + MARGIN_TOLERANCE_PX - minAbove;

        if (maxRemaining >= 60) {
          var deltas = [-GAP_FLEX_PX, 0, GAP_FLEX_PX];
          var best = null;

          for (var d = 0; d < deltas.length; d++) {
            var dt = deltas[d];
            var above = calcContent(dt) + (gapFlex ? Math.max(0, gap + dt) : gap);
            var avail = pageHPx - above;
            var maxA = pageHPx + MARGIN_TOLERANCE_PX - above;
            if (maxA < 20) continue;

            var snap = bestLineSnap(Math.max(0, avail), Math.max(0, maxA));
            if (snap.h < 20) continue;
            var splitH = Math.min(snap.h, h);
            var total = above + splitH;
            var absPad = Math.abs(pageHPx - total);

            if (!best || absPad < best.absPad) {
              best = {
                dt: dt, splitH: splitH, total: total, absPad: absPad,
                gAdj: gapFlex ? Math.max(0, gap + dt) : gap
              };
            }
          }

          if (best && best.splitH >= 20) {
            var clipTop = createClippedView(el, 0, best.splitH, widthPx, 'booklet-clip-top');
            var adjGaps = buildAdjGaps(best.dt);
            adjGaps.push(best.gAdj);
            var els = curEls.slice();
            els.push(clipTop);
            var padAdj = Math.max(-(MARGIN_TOLERANCE_PX / 2), (pageHPx - best.total) / 2);
            pushPage(els, adjGaps, padAdj, padAdj);

            curEls = [];
            curHeights = [];
            curGaps = [];
            curGapFlex = [];
            pendingGapMm = defaultGapMm;

            if (best.splitH < h) {
              splitContinuation(el, h, best.splitH, widthPx);
            }
          } else {
            flushPage();
            placeOnNewPage(el, h, true, widthPx);
          }
        } else {
          flushPage();
          placeOnNewPage(el, h, true, widthPx);
        }
      }
      else if (item.splittable) {
        if (curEls.length) flushPage();
        placeOnNewPage(el, h, true, widthPx);
      }
      else {
        if (curEls.length) flushPage();
        placeOnNewPage(el, h, false, widthPx);
      }

      if (item.gapMm != null) pendingGapMm = item.gapMm;
      else pendingGapMm = defaultGapMm;
    }

    if (curEls.length) flushPage();
    return pages;
  }

  function buildBookletSpreadViews(numPages) {
    var views = [];
    if (numPages <= 0) return views;
    views.push({ left: -1, right: 0 });
    for (var i = 1; i < numPages; i += 2) {
      views.push({ left: i, right: i + 1 < numPages ? i + 1 : -1 });
    }
    return views;
  }

  function cloneSpreadPageOrNull(pageDivs, numReal, idx) {
    if (idx >= 0 && idx < numReal) return pageDivs[idx].cloneNode(true);
    return null;
  }

  function spreadPageNaturalSize(pg) {
    var sizeAttr = pg && pg.dataset && pg.dataset.size;
    if (sizeAttr === 'A5') return { w: mmToPx(148), h: mmToPx(210) };
    return { w: mmToPx(210), h: mmToPx(297) };
  }

  function scaleBookletSpread(host) {
    var slots = host.querySelectorAll('.booklet-spread-slot');
    if (slots.length !== 2) return;
    var slotW = slots[0].clientWidth;
    var slotH = slots[0].clientHeight;
    if (slotW <= 100 || slotH <= 100) {
      setTimeout(function () { scaleBookletSpread(host); }, 250);
      return;
    }
    var outers = [];
    var inners = [];
    var pgs = [];
    slots.forEach(function (slot) {
      var outer = slot.querySelector('.booklet-scale-outer');
      var inner = outer && outer.querySelector('.booklet-scale-inner');
      var pg = inner && inner.querySelector('.booklet-page');
      outers.push(outer);
      inners.push(inner);
      pgs.push(pg);
      if (outer && inner) {
        inner.style.transform = '';
        inner.style.width = '';
        inner.style.height = '';
        outer.style.width = '';
        outer.style.height = '';
        outer.style.minHeight = '';
      }
    });
    var has0 = !!pgs[0];
    var has1 = !!pgs[1];
    if (!has0 && !has1) return;
    var box0 = has0 ? spreadPageNaturalSize(pgs[0]) : { w: 1, h: 1 };
    var box1 = has1 ? spreadPageNaturalSize(pgs[1]) : { w: 1, h: 1 };
    var sc = 1;
    if (has0 && has1) {
      sc = Math.min(
        slotW / box0.w,
        slotH / box0.h,
        slotW / box1.w,
        slotH / box1.h,
        1
      );
    } else if (has0) {
      sc = Math.min(slotW / box0.w, slotH / box0.h, 1);
    } else {
      sc = Math.min(slotW / box1.w, slotH / box1.h, 1);
    }
    sc = Math.max(sc, 0.15);
    var scaledH = [];
    scaledH[0] = has0 ? box0.h * sc : 0;
    scaledH[1] = has1 ? box1.h * sc : 0;
    const maxScaledH = Math.max(scaledH[0], scaledH[1], 1);
    for (let i = 0; i < 2; i++) {
      const outer = outers[i];
      const inner = inners[i];
      const pg = pgs[i];
      if (!outer || !inner) continue;
      if (!pg) {
        outer.classList.add('booklet-scale-outer--empty');
        outer.style.width = '0';
        outer.style.height = maxScaledH + 'px';
        outer.style.minHeight = maxScaledH + 'px';
        continue;
      }
      outer.classList.remove('booklet-scale-outer--empty');
      const box = i === 0 ? box0 : box1;
      const nw = box.w;
      const nh = box.h;
      inner.style.width = nw + 'px';
      inner.style.height = nh + 'px';
      inner.style.transform = 'scale(' + sc + ')';
      inner.style.transformOrigin = 'top left';
      outer.style.width = nw * sc + 'px';
      outer.style.height = nh * sc + 'px';
    }
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
    const leftClone = cloneSpreadPageOrNull(pageDivs, n, v.left);
    if (leftClone) leftClone.dataset.bookletPageSourceIndex = String(v.left);
    const lo = document.createElement('div');
    lo.className = 'booklet-scale-outer' + (leftClone ? '' : ' booklet-scale-outer--empty');
    const li = document.createElement('div');
    li.className = 'booklet-scale-inner';
    if (leftClone) li.appendChild(leftClone);
    lo.appendChild(li);
    leftSlot.appendChild(lo);
    const rightClone = cloneSpreadPageOrNull(pageDivs, n, v.right);
    if (rightClone) rightClone.dataset.bookletPageSourceIndex = String(v.right);
    const ro = document.createElement('div');
    ro.className = 'booklet-scale-outer' + (rightClone ? '' : ' booklet-scale-outer--empty');
    const ri = document.createElement('div');
    ri.className = 'booklet-scale-inner';
    if (rightClone) ri.appendChild(rightClone);
    ro.appendChild(ri);
    rightSlot.appendChild(ro);
    if (label) {
      label.textContent =
        'Spread ' + (index + 1) + ' / ' + views.length;
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        const runScale = function () {
          scaleBookletSpread(host);
        };
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(runScale).catch(runScale);
        } else {
          runScale();
        }
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
    var root = document.getElementById('previewPages');
    var store = document.getElementById('bookletPageStore');
    if (!root) return;
    var myTok = ++previewToken;
    var size = state.settings.pageSize;
    var prevHost = root.querySelector('.booklet-spread-host');
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

    var flow;
    try {
      flow = await buildFlowList();
    } catch (e) {
      console.error(e);
      root.innerHTML = '<p class="text-danger small">Layout error: ' + escapeHtml(e.message || String(e)) + '</p>';
      return;
    }
    if (myTok !== previewToken) return;

    var widthPx = getContentWidthPx();
    var pageHPx = getMaxPageBodyHeightPx();
    var marginPx = mmToPx(getBookletMarginMm());
    var pageResults = paginateFlow(flow, widthPx, pageHPx);

    var pageDivs = pageResults.map(function (pg) {
      var page = document.createElement('div');
      page.className = 'booklet-page';
      page.dataset.size = size;
      if (pg.padTopAdjust || pg.padBottomAdjust) {
        page.style.paddingTop = (marginPx + (pg.padTopAdjust || 0)) + 'px';
        page.style.paddingBottom = (marginPx + (pg.padBottomAdjust || 0)) + 'px';
      }
      var inner = document.createElement('div');
      inner.className = 'page-inner-flow';
      var body = document.createElement('div');
      body.className = 'booklet-page-body';
      pg.elements.forEach(function (el, idx) {
        el.style.marginTop = (pg.adjustedGaps[idx] || 0) + 'px';
        el.style.marginBottom = '0';
        body.appendChild(el);
      });
      inner.appendChild(body);
      page.appendChild(inner);
      return page;
    });

    root.innerHTML = '';
    if (!pageDivs.length) {
      root.innerHTML = '<p class="text-muted small px-2">Nothing to show yet.</p>';
      exportPageElements = [];
      return;
    }

    pageDivs.forEach(function (p) {
      var body = p.querySelector('.booklet-page-body');
      if (!body) return;
      var children = body.children;
      var allPdf = children.length > 0;
      for (var ci = 0; ci < children.length; ci++) {
        if (!children[ci].classList.contains('booklet-pdf-page-unit')) { allPdf = false; break; }
      }
      if (allPdf) p.classList.add('booklet-page--pdf-full');
      
    });

    appendCreditsFooterToLastPage(pageDivs);

    exportPageElements = pageDivs;

    var display = state.settings.previewDisplay === 'booklet' ? 'booklet' : 'scroll';
    if (display === 'scroll') {
      pageDivs.forEach(function (p) { root.appendChild(p); });
    } else {
      if (store) pageDivs.forEach(function (p) { store.appendChild(p); });
      mountBookletSpreadUi(root, pageDivs);
    }
    if (selectedBlockId) {
      setTimeout(function () { scrollPreviewToBlock(selectedBlockId); }, 150);
    }
  }

  function richAlignToolbarHtml() {
    return `
          <div class="btn-group btn-group-sm flex-wrap mb-1" role="group">
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="justifyLeft" title="Align left" aria-label="Align left"><i class="bi bi-text-left" aria-hidden="true"></i></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="justifyCenter" title="Centre" aria-label="Align centre"><i class="bi bi-text-center" aria-hidden="true"></i></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="justifyRight" title="Align right" aria-label="Align right"><i class="bi bi-text-right" aria-hidden="true"></i></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="justifyFull" title="Justify" aria-label="Justify"><i class="bi bi-justify" aria-hidden="true"></i></button>
          </div>`;
  }

  function richFontSizeSelectHtml() {
    return `
          <select class="form-select form-select-sm mb-1 align-middle" data-rich-font-select style="max-width:7.75rem" title="Font size (selection)" aria-label="Font size">
            <option value="" selected>Size…</option>
            <option value="inherit">Default</option>
            <option value="9pt">9 pt</option>
            <option value="10pt">10 pt</option>
            <option value="11pt">11 pt</option>
            <option value="12pt">12 pt</option>
            <option value="13pt">13 pt</option>
            <option value="14pt">14 pt</option>
            <option value="16pt">16 pt</option>
            <option value="18pt">18 pt</option>
          </select>`;
  }

  function richColorPickerHtml() {
    return '<input type="color" class="booklet-rich-color-pick mb-1" value="#212529" title="Text colour">';
  }

  function richListToolbarHtml() {
    return `
          <div class="btn-group btn-group-sm flex-wrap mb-1" role="group">
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="insertOrderedList" title="Numbered list (hanging indent for verses)"><i class="bi bi-list-ol" aria-hidden="true"></i></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="insertUnorderedList" title="Bullet list"><i class="bi bi-list-ul" aria-hidden="true"></i></button>
          </div>`;
  }

  function editorLayoutPanelHtml(b, showGap, showFont) {
    const gap = b.sectionGapAfterMm != null ? b.sectionGapAfterMm : DEFAULT_SECTION_GAP_AFTER_MM;
    const fs = b.fontScale != null ? b.fontScale : DEFAULT_BLOCK_FONT_SCALE;
    return `
        <div class="border rounded booklet-layout-compact bg-light small mb-1">
          ${
            showGap
              ? `<label class="form-label small mb-0" title="Extra vertical space after this block. Negative values tighten the gap (e.g. when chant SVG leaves excess whitespace).">Space after this section (mm)</label>
          <input type="number" class="form-control form-control-sm mb-0" id="edBlockGap" min="-40" max="40" step="1" value="${gap}">`
              : ''
          }
          ${
            showFont
              ? `<label class="form-label small mb-0 mt-2">Text size (× body)</label>
          <input type="range" class="form-range" id="edBlockFontScale" min="0.75" max="1.5" step="0.05" value="${fs}">`
              : ''
          }
        </div>`;
  }

  function wireEditorSectionLayout(panel, b, showGap, showFont) {
    const gapEl = panel.querySelector('#edBlockGap');
    const fsEl = panel.querySelector('#edBlockFontScale');
    const push = () => {
      if (showGap && gapEl) {
        const g = parseFloat(String(gapEl.value).trim().replace(',', '.'));
        b.sectionGapAfterMm = Number.isFinite(g)
          ? Math.min(40, Math.max(-40, Math.round(g)))
          : DEFAULT_SECTION_GAP_AFTER_MM;
      }
      if (showFont && fsEl) {
        const f = parseFloat(fsEl.value);
        b.fontScale = Number.isFinite(f)
          ? Math.min(1.5, Math.max(0.75, f))
          : DEFAULT_BLOCK_FONT_SCALE;
      }
      scheduleAutosave();
      scheduleRenderPreview();
      renderBlockList();
    };
    gapEl?.addEventListener('input', push);
    fsEl?.addEventListener('input', push);
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
    scheduleRenderPreview();
  }

  function renderBlockList() {
    const el = document.getElementById('blockList');
    if (!el) return;
    el.innerHTML = '';
    state.blocks.forEach((b, idx) => {
      const row = document.createElement('div');
      row.className = 'booklet-block-row';

      const meta = blockTypeMeta(b);
      const line = blockListLinePreview(b);

      var div = document.createElement('div');
      div.className =
        'block-list-item' +
        (b.id === selectedBlockId ? ' active' : '') +
        (b.hidden ? ' opacity-50' : '');
      div.dataset.id = b.id;
      div.dataset.blockId = b.id;
      div.draggable = true;
      div.title = meta.label + ' \u2014 ' + line;
      div.setAttribute('aria-label', meta.label + ': ' + line);

      div.addEventListener('dragstart', function (ev) {
        ev.dataTransfer.setData('text/plain', b.id);
        ev.dataTransfer.effectAllowed = 'move';
        div.classList.add('dragging');
      });
      div.addEventListener('dragend', function () {
        div.classList.remove('dragging');
        el.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(function (d) {
          d.classList.remove('drag-over-top', 'drag-over-bottom');
        });
      });

      var badge = document.createElement('span');
      badge.className = 'booklet-block-type-badge';
      badge.style.backgroundColor = meta.color;
      badge.title = meta.label;
      badge.setAttribute('aria-hidden', 'true');
      var ic = document.createElement('i');
      ic.className = 'bi ' + meta.icon;
      badge.appendChild(ic);

      var textEl = document.createElement('span');
      textEl.className = 'booklet-block-preview-text';
      textEl.textContent = line;

      var actions = document.createElement('span');
      actions.className = 'booklet-block-actions';
      var vis = document.createElement('button');
      vis.type = 'button';
      vis.className = 'btn';
      vis.title = b.hidden ? 'Show' : 'Hide';
      vis.innerHTML = b.hidden ? '<i class="bi bi-eye-slash"></i>' : '<i class="bi bi-eye"></i>';
      vis.addEventListener('click', function (ev) {
        ev.stopPropagation();
        b.hidden = !b.hidden;
        scheduleAutosave();
        renderBlockList();
        scheduleRenderPreview();
      });
      var dup = document.createElement('button');
      dup.type = 'button';
      dup.className = 'btn';
      dup.title = 'Duplicate';
      dup.innerHTML = '<i class="bi bi-copy"></i>';
      dup.addEventListener('click', function (ev) {
        ev.stopPropagation();
        duplicateBlock(b.id);
      });
      var rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'btn booklet-action-danger';
      rm.title = 'Remove';
      rm.innerHTML = '<i class="bi bi-trash3"></i>';
      rm.addEventListener('click', function (ev) {
        ev.stopPropagation();
        state.blocks = state.blocks.filter(function (x) { return x.id !== b.id; });
        if (selectedBlockId === b.id) selectedBlockId = null;
        scheduleAutosave();
        renderBlockList();
        renderEditor();
        scheduleRenderPreview();
      });
      actions.appendChild(vis);
      actions.appendChild(dup);
      actions.appendChild(rm);

      div.appendChild(badge);
      div.appendChild(textEl);
      div.appendChild(actions);
      div.addEventListener('click', function () {
        selectedBlockId = b.id;
        renderBlockList();
        renderEditor();
        setTimeout(function () { scrollPreviewToBlock(b.id); }, 100);
      });
      row.appendChild(div);

      el.appendChild(row);
    });

    el.addEventListener('dragover', function (ev) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      var items = el.querySelectorAll('.block-list-item');
      items.forEach(function (d) { d.classList.remove('drag-over-top', 'drag-over-bottom'); });
      var target = ev.target.closest('.block-list-item');
      if (!target || target.classList.contains('dragging')) return;
      var rect = target.getBoundingClientRect();
      var midY = rect.top + rect.height / 2;
      if (ev.clientY < midY) target.classList.add('drag-over-top');
      else target.classList.add('drag-over-bottom');
    });
    el.addEventListener('drop', function (ev) {
      ev.preventDefault();
      var draggedId = ev.dataTransfer.getData('text/plain');
      var target = ev.target.closest('.block-list-item');
      if (!target) return;
      var targetId = target.dataset.blockId;
      if (!draggedId || !targetId || draggedId === targetId) return;
      var fromIdx = state.blocks.findIndex(function (x) { return x.id === draggedId; });
      var toIdx = state.blocks.findIndex(function (x) { return x.id === targetId; });
      if (fromIdx < 0 || toIdx < 0) return;
      var rect = target.getBoundingClientRect();
      var midY = rect.top + rect.height / 2;
      if (ev.clientY >= midY) toIdx = Math.min(toIdx + 1, state.blocks.length);
      var moved = state.blocks.splice(fromIdx, 1)[0];
      if (fromIdx < toIdx) toIdx--;
      state.blocks.splice(toIdx, 0, moved);
      scheduleAutosave();
      renderBlockList();
      scheduleRenderPreview();
    });

  }

  function renderEditor() {
    const panel = document.getElementById('editorPanel');
    if (!panel) return;
    const b = state.blocks.find((x) => x.id === selectedBlockId);
    if (!b) {
      panel.innerHTML =
        '<p class="text-muted small mb-0" title="Choose a section in the list above, or use Add section.">Select a section or add one.</p>';
      return;
    }
    if (b.type === 'page_break') {
      panel.innerHTML =
        editorLayoutPanelHtml(b, false, false) +
        '<p class="small text-muted mb-0" title="The following section will begin on a new page in the on-screen preview and in the downloaded PDF.">Starts a new page after the previous section.</p>';
      wireEditorSectionLayout(panel, b, false, false);
      return;
    }
    if (b.type === 'title') {
      const tfk = b.titleFontKey != null ? String(b.titleFontKey) : '';
      const fontOpts =
        '<option value=""' +
        (tfk === '' ? ' selected' : '') +
        '>Same as booklet body</option>' +
        Object.keys(BOOKLET_FONT_STACKS)
          .map(function (k) {
            return (
              '<option value="' +
              escapeAttr(k) +
              '"' +
              (tfk === k ? ' selected' : '') +
              '>' +
              escapeHtml(k.charAt(0).toUpperCase() + k.slice(1)) +
              '</option>'
            );
          })
          .join('');
      const ttc = /^#[0-9a-f]{6}$/i.test(String(b.titleTextColor || '').trim())
        ? String(b.titleTextColor).trim()
        : '#212529';
      const tlc = /^#[0-9a-f]{6}$/i.test(String(b.titleLineColor || '').trim())
        ? String(b.titleLineColor).trim()
        : '#adb5bd';
      panel.innerHTML = `
        ${editorLayoutPanelHtml(b, true, false)}
        <label class="form-label small mb-1" for="edTitleText" title="Centered small caps with horizontal rules to the margins.">Title text</label>
        <input type="text" class="form-control form-control-sm mb-2" id="edTitleText" value="${escapeAttr(b.text || '')}" placeholder="e.g. Kyrie">
        <label class="form-label small mb-1" for="edTitleFont">Font</label>
        <select id="edTitleFont" class="form-select form-select-sm mb-2">${fontOpts}</select>
        <div class="row g-2 mb-0">
          <div class="col-6">
            <label class="form-label small mb-0" for="edTitleTextCol">Text colour</label>
            <input type="color" id="edTitleTextCol" class="form-control form-control-color w-100" value="${escapeAttr(ttc)}">
          </div>
          <div class="col-6">
            <label class="form-label small mb-0" for="edTitleLineCol">Line colour</label>
            <input type="color" id="edTitleLineCol" class="form-control form-control-color w-100" value="${escapeAttr(tlc)}">
          </div>
        </div>
      `;
      const syncTitle = function () {
        b.text = panel.querySelector('#edTitleText').value;
        b.titleFontKey = panel.querySelector('#edTitleFont').value;
        const tc = panel.querySelector('#edTitleTextCol').value;
        b.titleTextColor = /^#[0-9a-f]{6}$/i.test(tc) ? tc : '#212529';
        const lc = panel.querySelector('#edTitleLineCol').value;
        b.titleLineColor = /^#[0-9a-f]{6}$/i.test(lc) ? lc : '#adb5bd';
        scheduleAutosave();
        scheduleRenderPreview();
        renderBlockList();
      };
      panel.querySelector('#edTitleText').addEventListener('input', syncTitle);
      panel.querySelector('#edTitleFont').addEventListener('change', syncTitle);
      panel.querySelector('#edTitleTextCol').addEventListener('input', syncTitle);
      panel.querySelector('#edTitleLineCol').addEventListener('input', syncTitle);
      wireEditorSectionLayout(panel, b, true, false);
      return;
    }
    if (b.type === 'rubric') {
      panel.innerHTML = `
        ${editorLayoutPanelHtml(b, true, true)}
        <label class="form-label small mb-1" title="Optional bold line above the rubric body.">Title <span class="text-muted">(optional)</span></label>
        <input type="text" class="form-control form-control-sm mb-1" id="edRubricSecTitle" value="${escapeAttr(b.sectionTitle || '')}" placeholder="Bold, left-aligned above rubric">
        <label class="form-label small mb-1" title="Optional italic line, right-aligned under the title.">Source reference <span class="text-muted">(optional)</span></label>
        <input type="text" class="form-control form-control-sm mb-1" id="edRubricSecSource" value="${escapeAttr(b.sectionSourceRef || '')}" placeholder="Italic, right — e.g. rubric source">
        <label class="form-label small mb-0" title="Bold, italic, underline, size, lists, alignment, and colour are reflected in the preview and PDF.">Rubric text</label>
        <div class="booklet-rich-toolbar rubric-tb d-flex flex-wrap align-items-center gap-1">
          <div class="btn-group btn-group-sm flex-wrap mb-1" role="group">
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="bold" title="Bold"><strong>B</strong></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="italic" title="Italic"><em>I</em></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="underline" title="Underline"><u>U</u></button>
          </div>
          ${richFontSizeSelectHtml()}
          ${richListToolbarHtml()}
          ${richAlignToolbarHtml()}
          ${richColorPickerHtml()}
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
        scheduleRenderPreview();
        renderBlockList();
      };
      st.addEventListener('input', pushMeta);
      ss.addEventListener('input', pushMeta);
      wireEditorSectionLayout(panel, b, true, true);
      const push = () => {
        b.text = ed.innerHTML;
        scheduleAutosave();
        scheduleRenderPreview();
        renderBlockList();
      };
      bindRichToolbar(panel.querySelector('.rubric-tb'), ed, push);
    } else if (b.type === 'reading') {
      const split = b.parallelLeftPct != null ? b.parallelLeftPct : 50;
      const gap = b.parallelGapMm != null ? b.parallelGapMm : 4;
      panel.innerHTML = `
        ${editorLayoutPanelHtml(b, true, true)}
        <label class="form-label small mb-1" title="Optional bold heading above both columns.">Section title <span class="text-muted">(optional)</span></label>
        <input type="text" class="form-control form-control-sm mb-1" id="edReadSecTitle" value="${escapeAttr(b.sectionTitle || '')}" placeholder="Bold, left above both columns">
        <label class="form-label small mb-1" title="Optional italic reference, right-aligned.">Source reference <span class="text-muted">(optional)</span></label>
        <input type="text" class="form-control form-control-sm mb-1" id="edReadSecSource" value="${escapeAttr(b.sectionSourceRef || '')}" placeholder="Italic, right — e.g. John 3:16">
        <label class="form-label small mb-0" title="Primary column; formatting applies in preview and PDF.">Original</label>
        <div class="booklet-rich-toolbar read-tb-orig d-flex flex-wrap align-items-center gap-1">
          <div class="btn-group btn-group-sm flex-wrap mb-1" role="group">
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="bold" title="Bold"><strong>B</strong></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="italic" title="Italic"><em>I</em></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="underline" title="Underline"><u>U</u></button>
          </div>
          ${richFontSizeSelectHtml()}
          ${richListToolbarHtml()}
          ${richAlignToolbarHtml()}
          ${richColorPickerHtml()}
        </div>
        <div class="form-control form-control-sm booklet-rich-ed mb-2" contenteditable="true" id="edReadOrig"></div>
        <label class="form-label small mb-0" title="When this field has text, the preview uses two parallel columns (original and translation) with the split and spacing you set below.">Translation <span class="text-muted">(parallel when filled)</span></label>
        <div class="booklet-rich-toolbar read-tb-trans d-flex flex-wrap align-items-center gap-1">
          <div class="btn-group btn-group-sm flex-wrap mb-1" role="group">
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="bold" title="Bold"><strong>B</strong></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="italic" title="Italic"><em>I</em></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="underline" title="Underline"><u>U</u></button>
          </div>
          ${richFontSizeSelectHtml()}
          ${richListToolbarHtml()}
          ${richAlignToolbarHtml()}
          ${richColorPickerHtml()}
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
        scheduleRenderPreview();
        renderBlockList();
      };
      rst.addEventListener('input', pushMetaRead);
      rss.addEventListener('input', pushMetaRead);
      const push = () => {
        b.text = edO.innerHTML;
        b.translation = edT.innerHTML;
        scheduleAutosave();
        scheduleRenderPreview();
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
        let ggm = parseInt(ig.value, 10);
        if (!Number.isFinite(ggm)) {
          ggm = b.parallelGapMm != null ? b.parallelGapMm : 4;
        }
        b.parallelGapMm = Math.min(20, Math.max(0, ggm));
        scheduleAutosave();
        scheduleRenderPreview();
      };
      rng.addEventListener('input', syncParallel);
      chk.addEventListener('change', syncParallel);
      ig.addEventListener('input', syncParallel);
      wireEditorSectionLayout(panel, b, true, true);
    } else if (b.type === 'image') {
      const iw = b.imageWidthPx != null ? Math.round(Number(b.imageWidthPx)) : 0;
      const ia = b.imageAlign === 'left' || b.imageAlign === 'right' ? b.imageAlign : 'center';
      panel.innerHTML = `
        ${editorLayoutPanelHtml(b, true, false)}
        <label class="form-label small mb-1" title="Shown only in the left section list, not on booklet pages. The image is stored as base64 inside the project JSON.">Section list name</label>
        <input type="text" class="form-control form-control-sm mb-1" id="edImgLabel" value="${escapeAttr(b.label || '')}" placeholder="e.g. Cover, Map — not shown in booklet">
        <label class="form-label small mb-1" for="edImgWidth" title="0 = as wide as the text column allows (max 100% of page body).">Width (px)</label>
        <input type="number" class="form-control form-control-sm mb-1" id="edImgWidth" min="0" max="4000" step="10" value="${iw > 0 ? iw : ''}" placeholder="0 = fit column">
        <label class="form-label small mb-1" for="edImgAlign">Alignment</label>
        <select id="edImgAlign" class="form-select form-select-sm mb-2">
          <option value="left"${ia === 'left' ? ' selected' : ''}>Left</option>
          <option value="center"${ia === 'center' ? ' selected' : ''}>Centre</option>
          <option value="right"${ia === 'right' ? ' selected' : ''}>Right</option>
        </select>
        <button type="button" class="btn btn-sm btn-outline-primary" id="edReplaceImg">Replace image</button>
      `;
      const li = panel.querySelector('#edImgLabel');
      li.addEventListener('input', () => {
        b.label = li.value;
        scheduleAutosave();
        renderBlockList();
      });
      const syncImgLayout = function () {
        const wRaw = panel.querySelector('#edImgWidth').value.trim();
        const w = wRaw === '' ? 0 : parseInt(wRaw, 10);
        b.imageWidthPx = Number.isFinite(w) ? Math.min(4000, Math.max(0, w)) : 0;
        b.imageAlign = panel.querySelector('#edImgAlign').value;
        scheduleAutosave();
        scheduleRenderPreview();
        renderBlockList();
      };
      panel.querySelector('#edImgWidth').addEventListener('input', syncImgLayout);
      panel.querySelector('#edImgWidth').addEventListener('change', syncImgLayout);
      panel.querySelector('#edImgAlign').addEventListener('change', syncImgLayout);
      panel.querySelector('#edReplaceImg').addEventListener('click', () => pickImageForBlock(b.id));
      wireEditorSectionLayout(panel, b, true, false);
    } else if (b.type === 'edition_pdf') {
      panel.innerHTML = `
        ${editorLayoutPanelHtml(b, true, false)}
        <label class="form-label small mb-1" title="Search the Polyphony catalogue for an edition PDF, or paste any PDF URL in the field below.">Search editions</label>
        <input type="search" class="form-control form-control-sm mb-1" id="edEditionSearch" placeholder="Work title, composer…" autocomplete="off">
        <div id="edEditionResults" class="booklet-edition-results mb-1 d-none list-group list-group-flush"></div>
        <label class="form-label small mb-0" title="Any reachable PDF URL or a path on this site.">PDF URL</label>
        <input type="url" class="form-control form-control-sm mb-1" id="edUrl" value="${escapeAttr(b.url || '')}" placeholder="https://… or site-relative path">
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
        scheduleRenderPreview();
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
        scheduleRenderPreview();
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
      wireEditorSectionLayout(panel, b, true, false);
    } else if (b.type === 'chant_gabc') {
      const cn = b.chantNeumeSize != null ? b.chantNeumeSize : 23;
      const cg = b.chantGlyphScale != null ? b.chantGlyphScale : 1;
      const cl = b.chantLinePadTop != null ? b.chantLinePadTop : 0;
      const ct = b.chantLyricTight != null ? b.chantLyricTight : 1.1;
      const cs = b.chantSystemGap != null ? b.chantSystemGap : 0;
      const cd = b.chantDropCapScale != null ? b.chantDropCapScale : 1;
      const csc = String(b.chantStaffColor || '').trim();
      const cscVal = /^#[0-9a-f]{6}$/i.test(csc) ? csc : '#000000';
      const crc = String(b.chantRubricColor || '').trim();
      const crcVal = /^#[0-9a-f]{6}$/i.test(crc) ? crc : '#000000';
      const clang = b.chantLyricLanguage === 'english' ? 'english' : 'latin';
      const ctf = normalizeChantTextFontKey(b.chantTextFont);
      const chantFontOpts = [
        ['crimson', 'Crimson Text'],
        ['times', 'Times New Roman'],
        ['palatino', 'Palatino'],
        ['garamond', 'Garamond-style'],
        ['georgia', 'Georgia'],
      ]
        .map(function (kv) {
          return (
            '<option value="' +
            escapeAttr(kv[0]) +
            '"' +
            (kv[0] === ctf ? ' selected' : '') +
            '>' +
            escapeHtml(kv[1]) +
            '</option>'
          );
        })
        .join('');
      panel.innerHTML = `
        ${editorLayoutPanelHtml(b, true, false)}
        <label class="form-label small mb-0" for="edGabc" title="Full GABC including the %% header block. For Mass propers, build in Ben’s propers tool (toolbar → Advanced) and paste here.">GABC</label>
        <textarea class="form-control form-control-sm font-monospace mt-1" rows="8" id="edGabc">${escapeHtml(b.gabc || '')}</textarea>
        ${
          b.legacyHash
            ? '<p class="small text-warning mb-0 mt-1" title="Legacy field from an older save format; preview uses pasted GABC only.">Old hash (unused): <code class="small">' +
              escapeHtml(String(b.legacyHash).slice(0, 64)) +
              '</code>…</p>'
            : ''
        }
        <div class="small border rounded px-2 py-1 mt-1 bg-light">
          <div class="mt-1 pb-1">
          <div class="mb-2" style="font-size:0.72rem">
            <div class="d-flex align-items-center justify-content-between mb-1"><span>Lyric size</span><div class="btn-group btn-group-sm" data-chant-prop="chantNeumeSize" data-s="21" data-m="23" data-l="25"></div></div>
            <div class="d-flex align-items-center justify-content-between mb-1"><span>Staff scale</span><div class="btn-group btn-group-sm" data-chant-prop="chantGlyphScale" data-s="1.26" data-m="1.4" data-l="1.54"></div></div>
            <div class="d-flex align-items-center justify-content-between mb-1"><span>System gap</span><div class="btn-group btn-group-sm" data-chant-prop="chantSystemGap" data-s="0" data-m="1" data-l="2"></div></div>
            <div class="d-flex align-items-center justify-content-between mb-1"><span>Tightness</span><div class="btn-group btn-group-sm" data-chant-prop="chantLyricTight" data-s="1.2" data-m="1.1" data-l="1.0"></div></div>
            <div class="d-flex align-items-center justify-content-between mb-1"><span>Line pad</span><div class="btn-group btn-group-sm" data-chant-prop="chantLinePadTop" data-s="0" data-m="2" data-l="4"></div></div>
            <div class="d-flex align-items-center justify-content-between mb-1"><span>Drop cap</span><div class="btn-group btn-group-sm" data-chant-prop="chantDropCapScale" data-s="0.9" data-m="1.0" data-l="1.1"></div></div>
          </div>
          <div class="form-check mb-2">
            <input class="form-check-input" type="checkbox" id="edChantUseDropCap" ${b.chantUseDropCap !== false ? 'checked' : ''}>
            <label class="form-check-label" for="edChantUseDropCap">Drop cap</label>
          </div>
          <label class="form-label mb-0" style="font-size:0.74rem">Lyric language</label>
          <select id="edChantLyricLang" class="form-select form-select-sm mb-2">
            <option value="latin"${clang === 'latin' ? ' selected' : ''}>Latin syllabification</option>
            <option value="english"${clang === 'english' ? ' selected' : ''}>English syllabification</option>
          </select>
          <label class="form-label mb-0" style="font-size:0.74rem">Lyric font</label>
          <select id="edChantTextFont" class="form-select form-select-sm mb-2">${chantFontOpts}</select>
          <label class="form-label mb-0" style="font-size:0.74rem">Staff colour</label>
          <div class="d-flex align-items-center gap-2 mb-1">
            <input type="color" id="edChantStaff" class="form-control form-control-color" value="${escapeAttr(cscVal)}">
            <button type="button" class="btn btn-sm btn-outline-secondary" id="edChantStaffDef">GABC default</button>
          </div>
          <label class="form-label mb-0" style="font-size:0.74rem">Rubric / verse marks</label>
          <div class="d-flex align-items-center gap-2 mb-0">
            <input type="color" id="edChantRubric" class="form-control form-control-color" value="${escapeAttr(crcVal)}">
            <button type="button" class="btn btn-sm btn-outline-secondary" id="edChantRubricDef">Black</button>
          </div>
          </div>
        </div>
      `;
      const ta = panel.querySelector('#edGabc');
      ta.addEventListener('input', () => {
        b.gabc = ta.value;
        scheduleAutosave();
        scheduleRenderPreview();
        renderBlockList();
      });
      wireEditorSectionLayout(panel, b, true, false);
      var chkUseDropCap = panel.querySelector('#edChantUseDropCap');
      chkUseDropCap?.addEventListener('change', function () {
        b.chantUseDropCap = !!chkUseDropCap.checked;
        scheduleAutosave();
        scheduleRenderPreview();
        renderBlockList();
      });
      panel.querySelector('#edChantLyricLang')?.addEventListener('change', function () {
        b.chantLyricLanguage =
          panel.querySelector('#edChantLyricLang').value === 'english' ? 'english' : 'latin';
        scheduleAutosave();
        scheduleRenderPreview();
        renderBlockList();
      });
      panel.querySelector('#edChantTextFont')?.addEventListener('change', function () {
        b.chantTextFont = normalizeChantTextFontKey(panel.querySelector('#edChantTextFont').value);
        scheduleAutosave();
        scheduleRenderPreview();
        renderBlockList();
      });
      panel.querySelectorAll('[data-chant-prop]').forEach(function (grp) {
        var prop = grp.dataset.chantProp;
        var vals = { s: parseFloat(grp.dataset.s), m: parseFloat(grp.dataset.m), l: parseFloat(grp.dataset.l) };
        var cur = b[prop] != null ? Number(b[prop]) : vals.m;
        ['s', 'm', 'l'].forEach(function (key) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = key.toUpperCase();
          var isActive = Math.abs(cur - vals[key]) <= Math.abs(cur - vals.s) && Math.abs(cur - vals[key]) <= Math.abs(cur - vals.m) && Math.abs(cur - vals[key]) <= Math.abs(cur - vals.l);
          btn.className = 'btn ' + (isActive ? 'btn-primary' : 'btn-outline-secondary');
          btn.style.fontSize = '0.6rem';
          btn.style.padding = '0.1rem 0.35rem';
          btn.addEventListener('click', function () {
            b[prop] = vals[key];
            grp.querySelectorAll('.btn').forEach(function (b2) { b2.className = 'btn btn-outline-secondary'; b2.style.fontSize = '0.6rem'; b2.style.padding = '0.1rem 0.35rem'; });
            btn.className = 'btn btn-primary';
            btn.style.fontSize = '0.6rem';
            btn.style.padding = '0.1rem 0.35rem';
            scheduleAutosave();
            scheduleRenderPreview();
            renderBlockList();
          });
          grp.appendChild(btn);
        });
        var closest = 'm';
        var minDist = Math.abs(cur - vals.m);
        if (Math.abs(cur - vals.s) < minDist) { closest = 's'; minDist = Math.abs(cur - vals.s); }
        if (Math.abs(cur - vals.l) < minDist) { closest = 'l'; }
        var btns = grp.querySelectorAll('.btn');
        btns.forEach(function (b2) { b2.className = 'btn btn-outline-secondary'; b2.style.fontSize = '0.6rem'; b2.style.padding = '0.1rem 0.35rem'; });
        var idx = closest === 's' ? 0 : closest === 'l' ? 2 : 1;
        if (btns[idx]) { btns[idx].className = 'btn btn-primary'; btns[idx].style.fontSize = '0.6rem'; btns[idx].style.padding = '0.1rem 0.35rem'; }
      });
      panel.querySelector('#edChantStaff')?.addEventListener('input', () => {
        const cv = panel.querySelector('#edChantStaff').value;
        b.chantStaffColor = /^#[0-9a-f]{6}$/i.test(cv) ? cv : '';
        scheduleAutosave();
        scheduleRenderPreview();
        renderBlockList();
      });
      panel.querySelector('#edChantStaffDef')?.addEventListener('click', () => {
        b.chantStaffColor = '';
        scheduleAutosave();
        scheduleRenderPreview();
        renderBlockList();
      });
      panel.querySelector('#edChantRubric')?.addEventListener('input', () => {
        const cv = panel.querySelector('#edChantRubric').value;
        b.chantRubricColor = /^#[0-9a-f]{6}$/i.test(cv) ? cv : '';
        scheduleAutosave();
        scheduleRenderPreview();
        renderBlockList();
      });
      panel.querySelector('#edChantRubricDef')?.addEventListener('click', () => {
        b.chantRubricColor = '';
        const inp = panel.querySelector('#edChantRubric');
        if (inp) inp.value = '#000000';
        scheduleAutosave();
        scheduleRenderPreview();
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
      b.imageWidthPx = 0;
      b.imageAlign = 'center';
      setTimeout(() => pickImageForBlock(b.id), 0);
    }
    if (type === 'title') {
      b.text = '';
      b.titleFontKey = '';
      b.titleTextColor = '#212529';
      b.titleLineColor = '#adb5bd';
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
    if (type === 'chant_gabc') {
      b.gabc = '';
      b.chantNeumeSize = 23;
      b.chantGlyphScale = 1.4;
      b.chantStaffColor = '';
      b.chantLinePadTop = 0;
      b.chantLyricTight = 1.1;
      b.chantSystemGap = 0;
      b.chantDropCapScale = 1;
      b.chantUseDropCap = true;
      b.chantLyricLanguage = 'latin';
      b.chantTextFont = 'crimson';
      b.chantRubricColor = '';
    }
    if (type !== 'page_break') {
      b.hidden = false;
      b.sectionGapAfterMm = DEFAULT_SECTION_GAP_AFTER_MM;
    } else {
      b.hidden = false;
    }
    if (type === 'rubric' || type === 'reading') {
      b.fontScale = DEFAULT_BLOCK_FONT_SCALE;
    }
    state.blocks.push(b);
    selectedBlockId = b.id;
    scheduleAutosave();
    renderBlockList();
    renderEditor();
    scheduleRenderPreview();
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
            scheduleRenderPreview();
            renderBlockList();
            renderEditor();
          }
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  function duplicateBlock(blockId) {
    var idx = state.blocks.findIndex(function (x) { return x.id === blockId; });
    if (idx < 0) return;
    var clone = JSON.parse(JSON.stringify(state.blocks[idx]));
    clone.id = uid();
    state.blocks.splice(idx + 1, 0, clone);
    selectedBlockId = clone.id;
    scheduleAutosave();
    renderBlockList();
    renderEditor();
    scheduleRenderPreview();
  }

  function removeSelectedBlock() {
    if (!selectedBlockId) return;
    state.blocks = state.blocks.filter((x) => x.id !== selectedBlockId);
    selectedBlockId = null;
    scheduleAutosave();
    renderBlockList();
    renderEditor();
    scheduleRenderPreview();
  }

  async function downloadJson() {
    var json = JSON.stringify(state, null, 2);
    var filename = safeFilenameBase(state.projectTitle, 'liturgy-booklet-project') + '.json';
    if (window.showSaveFilePicker) {
      try {
        var handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: 'Booklet project',
            accept: { 'application/json': ['.json'] }
          }]
        });
        var writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    var blob = new Blob([json], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function bookletRootCssVarsInline() {
    const cs = getComputedStyle(document.documentElement);
    const names = [
      '--booklet-margin-mm',
      '--booklet-font-scale',
      '--booklet-body-font',
      '--booklet-rubric-color',
    ];
    return names
      .map(function (n) {
        const v = cs.getPropertyValue(n).trim();
        return v ? n + ':' + v + ';' : '';
      })
      .join('');
  }

  /**
   * Full HTML document for headless Chromium (same CSS variables, stylesheets, and page markup
   * as the live preview). Chant stays as SVG (vector in PDF).
   */
  function buildBookletServerPdfHtml(pageElements) {
    const origin = window.location.origin;
    const links = [];
    document.querySelectorAll('link[rel="stylesheet"]').forEach(function (l) {
      const href = l.getAttribute('href');
      if (href) {
        links.push(
          '<link rel="stylesheet" href="' + escapeAttr(new URL(href, origin).href) + '">'
        );
      }
    });
    const styles = [];
    document.querySelectorAll('style').forEach(function (s) {
      styles.push('<style>' + s.textContent + '</style>');
    });
    const varBlock = bookletRootCssVarsInline();
    const extra =
      '<style>' +
      ':root{' +
      varBlock +
      '}' +
      'body.booklet-print-export{background:#fff!important;margin:0!important;padding:0!important;}' +
      '.booklet-print-export .booklet-page{box-shadow:none!important;margin:0 auto!important;' +
      'page-break-after:always;break-after:page;}' +
      '.booklet-print-export .booklet-page:last-child{page-break-after:auto;break-after:auto;}' +
      '</style>';
    const bodies = pageElements
      .map(function (p) {
        return p.outerHTML;
      })
      .join('\n');
    return (
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
      '<base href="' +
      escapeAttr(origin + '/') +
      '">' +
      links.join('') +
      styles.join('') +
      extra +
      '</head><body class="booklet-print-export">' +
      bodies +
      '</body></html>'
    );
  }

  function loadJsonFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const m = migrateProject(parsed);
        if (!m || !Array.isArray(m.blocks)) {
          alert('Invalid or unsupported project file (supported schemas: 1–' + SCHEMA_VERSION + ').');
          return;
        }
        state = m;
        selectedBlockId = null;
        applyCssVars();
        syncControlsFromState();
        scheduleAutosave();
        renderBlockList();
        renderEditor();
        scheduleRenderPreview();
      } catch (e) {
        alert('Could not read project file.');
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function printBookletClientSide() {
    const pages = exportPageElements.filter(
      (el) => el && el.isConnected && el.dataset.placeholder !== 'true'
    );
    if (!pages.length) {
      alert('Add content before printing.');
      return;
    }
    const html = buildBookletServerPdfHtml(pages);
    const w = window.open('', '_blank');
    if (!w) {
      alert('Pop-up blocked — please allow pop-ups for this site, then try again.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    const ready = function () {
      setTimeout(function () {
        w.focus();
        w.print();
      }, 600);
    };
    if (w.document.fonts && w.document.fonts.ready) {
      w.document.fonts.ready.then(ready).catch(ready);
    } else {
      w.addEventListener('load', ready);
    }
  }

  function buildPdfManifestAndHtml(pages) {
    var manifest = [];
    var contentPages = [];
    var puppeteerIdx = 0;
    for (var i = 0; i < pages.length; i++) {
      var p = pages[i];
      if (p.classList.contains('booklet-page--pdf-full')) {
        var body = p.querySelector('.booklet-page-body');
        var unit = body && body.querySelector('.booklet-pdf-page-unit[data-edition-url]');
        if (unit) {
          manifest.push({ type: 'edition', url: unit.dataset.editionUrl, pdfPage: parseInt(unit.dataset.editionPage, 10) || 1 });
        } else {
          contentPages.push(p);
          manifest.push({ type: 'content', puppeteerPageIndex: puppeteerIdx++ });
        }
      } else {
        contentPages.push(p);
        manifest.push({ type: 'content', puppeteerPageIndex: puppeteerIdx++ });
      }
    }
    var html = buildBookletServerPdfHtml(contentPages);
    return { html: html, manifest: manifest };
  }

  async function downloadPdf() {
    var pages = exportPageElements.filter(function (el) { return el && el.isConnected && el.dataset.placeholder !== 'true'; });
    if (!pages.length) { alert('Add content before downloading a PDF.'); return; }
    var btn = document.getElementById('btnDownloadPdf');
    var oldText = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Building\u2026'; }
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      var mh = buildPdfManifestAndHtml(pages);
      var r = await fetch('/api/booklet/pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ html: mh.html, pageSize: state.settings.pageSize === 'A5' ? 'A5' : 'A4', manifest: mh.manifest }),
      });
      if (!r.ok) {
        var msg = 'Server PDF export failed (status ' + r.status + ').';
        try { var j = await r.json(); if (j && j.error) msg = j.error; } catch (e) { /* ignore */ }
        alert(msg);
        return;
      }
      var blob = await r.blob();
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = safeFilenameBase(state.projectTitle, 'liturgy-booklet') + '.pdf';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      console.error(e);
      alert('PDF export failed (network or server error).');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = oldText; }
    }
  }

  function bindUi() {
    document.getElementById('bookletSidebar')?.addEventListener('click', function (e) {
      const t = e.target.closest('[data-add-type]');
      if (!t) return;
      e.preventDefault();
      addBlock(t.getAttribute('data-add-type'));
    });

    document.getElementById('selPageSize')?.addEventListener('change', (e) => {
      state.settings.pageSize = e.target.value;
      scheduleAutosave();
      scheduleRenderPreview();
    });
    document.getElementById('selPreviewDisplay')?.addEventListener('change', (e) => {
      state.settings.previewDisplay = e.target.value === 'booklet' ? 'booklet' : 'scroll';
      scheduleAutosave();
      scheduleRenderPreview();
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
      scheduleRenderPreview();
    });
    document.getElementById('inpRubricColor')?.addEventListener('input', (e) => {
      const v = e.target.value;
      state.settings.rubricColor = /^#[0-9a-f]{6}$/i.test(v) ? v : '#8b1538';
      applyCssVars();
      scheduleAutosave();
      scheduleRenderPreview();
    });
    document.getElementById('inpBookletMarginMm')?.addEventListener('change', (e) => {
      const inp = e.target;
      const raw = parseFloat(String(inp.value).trim().replace(',', '.'));
      state.settings.marginMm = Number.isFinite(raw)
        ? Math.min(40, Math.max(6, Math.round(raw)))
        : DEFAULT_BOOKLET_MARGIN_MM;
      inp.value = String(getBookletMarginMm());
      applyCssVars();
      scheduleAutosave();
      scheduleRenderPreview();
    });

    
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
    document.getElementById('chkDebugLayout')?.addEventListener('change', function () {
      var pp = document.getElementById('previewPages');
      if (pp) {
        if (this.checked) pp.classList.add('booklet-debug');
        else pp.classList.remove('booklet-debug');
      }
    });
  }

  loadAutosave();
  applyCssVars();
  syncControlsFromState();
  bindUi();
  renderBlockList();
  renderEditor();
  scheduleRenderPreview();
})();
