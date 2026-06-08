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

  /**
   * Curated Google Fonts for the booklet body & title typeface picker.
   * Each key is the Google Fonts family name (used as the stored value and CSS
   * family name).  `category` provides the generic CSS fallback.
   */
  const BOOKLET_FONTS = {
    'Crimson Text':        'serif',
    'EB Garamond':         'serif',
    'Cormorant Garamond':  'serif',
    'Lora':                'serif',
    'Libre Baskerville':   'serif',
    'Merriweather':        'serif',
    'Spectral':            'serif',
    'Source Serif 4':      'serif',
    'Noto Serif':          'serif',
    'Alegreya':            'serif',
    'Cardo':               'serif',
    'Gentium Plus':        'serif',
    'Playfair Display':    'serif',
    'Old Standard TT':     'serif',
    'Gelasio':             'serif',
    'Tinos':               'serif',
    'Open Sans':           'sans-serif',
    'Lato':                'sans-serif',
    'Inter':               'sans-serif',
    'Roboto':              'sans-serif',
    'Noto Sans':           'sans-serif',
    'Arimo':               'sans-serif',
    'Fira Sans':           'sans-serif',
    'Montserrat':          'sans-serif',
    'Courier Prime':       'monospace',
    'Cousine':             'monospace',
    'Source Code Pro':     'monospace',
  };

  const BOOKLET_DEFAULT_FONT = 'Crimson Text';

  /** Derive the BOOKLET_FONT_STACKS lookup from BOOKLET_FONTS. */
  const BOOKLET_FONT_STACKS = {};
  Object.keys(BOOKLET_FONTS).forEach(function (f) {
    BOOKLET_FONT_STACKS[f] = "'" + f + "', " + BOOKLET_FONTS[f];
  });

  /** Map pre-v9 system-font keys → Google Font equivalents. */
  const LEGACY_FONT_KEY_MAP = {
    georgia:   'Gelasio',
    times:     'Tinos',
    palatino:  'Lora',
    garamond:  'EB Garamond',
    arial:     'Arimo',
    verdana:   'Open Sans',
    trebuchet: 'Fira Sans',
    tahoma:    'Noto Sans',
    courier:   'Cousine',
  };

  /** Resolve a legacy system-font key to a Google Font family name. */
  function migrateFontKey(key) {
    if (BOOKLET_FONT_STACKS[key] != null) return key;
    return LEGACY_FONT_KEY_MAP[key] || BOOKLET_DEFAULT_FONT;
  }

  /** Get the CSS font-family stack for a given family name. */
  function fontStackFor(family) {
    return BOOKLET_FONT_STACKS[family] || "'" + family + "', serif";
  }

  /**
   * Dynamically inject a Google Fonts <link> into the page <head>.
   * No-ops if the font is already loaded.
   */
  function loadGoogleFont(family) {
    if (!family) return;
    var id = 'booklet-gfont-' + family.replace(/\s+/g, '-').toLowerCase();
    if (document.getElementById(id)) return;
    var link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' +
      encodeURIComponent(family) + ':ital,wght@0,400;0,600;0,700;1,400;1,700&display=swap';
    document.head.appendChild(link);
  }

  const CHANT_TEXT_FONT = "'Crimson Text', serif";

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
      marginTopMm: DEFAULT_BOOKLET_MARGIN_MM,
      marginBottomMm: DEFAULT_BOOKLET_MARGIN_MM,
      marginLeftMm: DEFAULT_BOOKLET_MARGIN_MM,
      marginRightMm: DEFAULT_BOOKLET_MARGIN_MM,
      sectionGapMm: DEFAULT_SECTION_GAP_AFTER_MM,
      gapTolerancePx: GAP_FLEX_PX,
      marginTolerancePx: MARGIN_TOLERANCE_PX,
      minOrphanLines: 3,
      descClipPx: 3,
      ascClipPx: 3,
      dropCapOffsetEm: 0.05,
      previewDisplay: 'scroll',
      fontFamilyKey: BOOKLET_DEFAULT_FONT,
      rubricColor: '#8b1538',
    },
    blocks: [],
  };

  function getDefaultState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      projectTitle: '',
      settings: {
        pageSize: 'A4',
        marginMm: DEFAULT_BOOKLET_MARGIN_MM,
        marginTopMm: DEFAULT_BOOKLET_MARGIN_MM,
        marginBottomMm: DEFAULT_BOOKLET_MARGIN_MM,
        marginLeftMm: DEFAULT_BOOKLET_MARGIN_MM,
        marginRightMm: DEFAULT_BOOKLET_MARGIN_MM,
        sectionGapMm: DEFAULT_SECTION_GAP_AFTER_MM,
        gapTolerancePx: GAP_FLEX_PX,
        marginTolerancePx: MARGIN_TOLERANCE_PX,
        minOrphanLines: 3,
        descClipPx: 3,
        ascClipPx: 3,
        dropCapOffsetEm: 0.05,
        previewDisplay: 'scroll',
        fontFamilyKey: BOOKLET_DEFAULT_FONT,
        rubricColor: '#8b1538',
      },
      blocks: [],
    };
  }

  function hasUnsavedWork() {
    return state.blocks.length > 0 || (state.projectTitle && state.projectTitle.trim() !== '');
  }

  function resetToNewProject() {
    state = getDefaultState();
    selectedBlockId = null;
    applyCssVars();
    syncControlsFromState();
    scheduleAutosave();
    renderBlockList();
    renderEditor();
    scheduleRenderPreview();
  }

  function getSetting(key, fallback) {
    var v = state.settings[key];
    return v != null && Number.isFinite(Number(v)) ? Number(v) : fallback;
  }

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
  let layoutStale = false;
  let autoRefresh = true;
  let scrollToBlockAfterRender = false;

  function markLayoutStale() {
    layoutStale = true;
    var btn = document.getElementById('btnRefreshLayout');
    if (btn) btn.classList.add('btn-warning');
    if (btn) btn.classList.remove('btn-primary');
    if (autoRefresh) scheduleRenderPreview();
  }

  function markLayoutFresh() {
    layoutStale = false;
    var btn = document.getElementById('btnRefreshLayout');
    if (btn) btn.classList.remove('btn-warning');
    if (btn) btn.classList.add('btn-primary');
    clearPreviewHiddenOverlays();
  }

  function syncPreviewHiddenOverlays() {
    var root = document.getElementById('previewPages');
    if (!root) return;
    var hiddenIds = {};
    state.blocks.forEach(function (b) { if (b.hidden) hiddenIds[b.id] = true; });
    root.querySelectorAll('[data-block-id]').forEach(function (el) {
      el.classList.toggle('booklet-preview-hidden', !!hiddenIds[el.dataset.blockId]);
    });
  }

  function clearPreviewHiddenOverlays() {
    var root = document.getElementById('previewPages');
    if (!root) return;
    root.querySelectorAll('.booklet-preview-hidden').forEach(function (el) {
      el.classList.remove('booklet-preview-hidden');
    });
  }

  function scheduleRenderPreview() {
    if (renderPreviewTimer) clearTimeout(renderPreviewTimer);
    renderPreviewTimer = setTimeout(function () {
      renderPreviewTimer = null;
      renderPreview();
      markLayoutFresh();
    }, 250);
  }

  function deferRenderPreview() {
    markLayoutStale();
  }

  function scrollPreviewToBlock(blockId) {
    if (!blockId) return;
    var display = state.settings.previewDisplay;
    if (display === 'booklet') {
      var pageIdx = -1;
      for (var i = 0; i < exportPageElements.length; i++) {
        if (exportPageElements[i].querySelector('[data-block-id="' + blockId + '"]')) {
          pageIdx = i;
          break;
        }
      }
      if (pageIdx < 0) return;
      for (var s = 0; s < bookletSpreadViews.length; s++) {
        var v = bookletSpreadViews[s];
        if (v.left === pageIdx || v.right === pageIdx) {
          bookletSpreadIndex = s;
          var host = document.querySelector('.booklet-spread-host');
          if (host) {
            updateBookletSpreadDisplay(host, exportPageElements, bookletSpreadViews, s);
            scaleBookletSpread(host);
            if (host._syncNav) host._syncNav();
          }
          break;
        }
      }
    } else {
      var root = document.getElementById('previewPages');
      if (!root) return;
      var target = root.querySelector('[data-block-id="' + blockId + '"]');
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
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
    footer.style.textAlign = 'center';
    const credits = collectCatalogueEditionCredits(state.blocks);
    var creditsSuffix = '';
    if (credits.length) {
      creditsSuffix = ' Edition credits: ' + escapeHtml(credits.join(', ')) + '.';
    }
    footer.innerHTML = 'Generated at <a href="https://polyphonydatabase.com" style="color:#6c757d;text-decoration:underline">PolyphonyDatabase.com</a>' + creditsSuffix;
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

  function getBookletMarginLeftMm() {
    return getSetting('marginLeftMm', DEFAULT_BOOKLET_MARGIN_MM);
  }
  function getBookletMarginRightMm() {
    return getSetting('marginRightMm', DEFAULT_BOOKLET_MARGIN_MM);
  }
  function getBookletMarginTopMm() {
    return getSetting('marginTopMm', DEFAULT_BOOKLET_MARGIN_MM);
  }
  function getBookletMarginBottomMm() {
    return getSetting('marginBottomMm', DEFAULT_BOOKLET_MARGIN_MM);
  }

  function applyCssVars() {
    const root = document.documentElement;
    root.style.setProperty('--booklet-margin-left-mm', String(getBookletMarginLeftMm()));
    root.style.setProperty('--booklet-margin-right-mm', String(getBookletMarginRightMm()));
    root.style.setProperty('--booklet-margin-top-mm', String(getBookletMarginTopMm()));
    root.style.setProperty('--booklet-margin-bottom-mm', String(getBookletMarginBottomMm()));
    root.style.setProperty('--booklet-font-scale', '1');
    const fk = state.settings.fontFamilyKey || BOOKLET_DEFAULT_FONT;
    loadGoogleFont(fk);
    root.style.setProperty('--booklet-body-font', fontStackFor(fk));
    const rc = state.settings.rubricColor || '#8b1538';
    root.style.setProperty('--booklet-rubric-color', /^#[0-9a-f]{6}$/i.test(rc) ? rc : '#8b1538');
    var dco = Number(state.settings.dropCapOffsetEm);
    root.style.setProperty('--booklet-drop-cap-offset', (Number.isFinite(dco) ? dco : 0.05) + 'em');
  }

  function getContentWidthPx() {
    const pageW = state.settings.pageSize === 'A5' ? 148 : 210;
    const ml = getBookletMarginLeftMm();
    const mr = getBookletMarginRightMm();
    return Math.max(200, mmToPx(pageW - ml - mr));
  }

  function getMaxPageBodyHeightPx() {
    const pageH = state.settings.pageSize === 'A5' ? 210 : 297;
    const mt = getBookletMarginTopMm();
    const mb = getBookletMarginBottomMm();
    return Math.max(120, mmToPx(pageH - mt - mb) - 2);
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
    const fw = st.match(/font-weight\s*:\s*([^;]+)/i);
    if (fw) {
      var vw = fw[1].trim().toLowerCase();
      if (/^(normal|bold|[1-9]00)$/.test(vw)) {
        parts.push('font-weight:' + vw);
      }
    }
    const fs = st.match(/font-style\s*:\s*([^;]+)/i);
    if (fs) {
      var vs = fs[1].trim().toLowerCase();
      if (/^(normal|italic|oblique)$/.test(vs)) {
        parts.push('font-style:' + vs);
      }
    }
    const td = st.match(/text-decoration(?:-line)?\s*:\s*([^;]+)/i);
    if (td) {
      var vd = td[1].trim().toLowerCase();
      if (/^(none|underline|line-through|overline)$/.test(vd)) {
        parts.push('text-decoration:' + vd);
      }
    }
    const fv = st.match(/font-variant\s*:\s*([^;]+)/i);
    if (fv) {
      var vv = fv[1].trim().toLowerCase();
      if (/^(normal|small-caps)$/.test(vv)) {
        parts.push('font-variant:' + vv);
      }
    }
    return parts.join(';');
  }

  /**
   * Safe subset for rubric/reading/translation: b, i, u, br, lists, span[style=color].
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

    var liturgicalRe = /\\V\.|\\R\.|\\A\.|\\[+]|℣|℟|✠/g;
    var liturgicalMap = {
      '\\V.': 'v', '\\R.': 'r', '\\A.': 'a', '\\+': '\u2720',
      '\u2123': 'v', '\u211F': 'r', '\u2720': '\u2720'
    };
    function expandLiturgical(text) {
      if (!liturgicalRe.test(text)) return document.createTextNode(text);
      liturgicalRe.lastIndex = 0;
      var frag = document.createDocumentFragment();
      var last = 0;
      var m;
      while ((m = liturgicalRe.exec(text)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var sp = document.createElement('span');
        sp.className = 'versiculum';
        sp.textContent = liturgicalMap[m[0]] || m[0];
        frag.appendChild(sp);
        last = liturgicalRe.lastIndex;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      return frag;
    }

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return expandLiturgical(node.textContent);
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
        var cls = (node.getAttribute('class') || '').trim();
        if (cls === 'versiculum') {
          const el = document.createElement('span');
          el.className = 'versiculum';
          appendChildren(el, node);
          return el;
        }
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
        const el = document.createElement(tag);
        if (safeStyle) {
          el.setAttribute('style', safeStyle);
        }
        appendChildren(el, node);
        return el;
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

  var versiculumReverseMap = { v: '\\V.', r: '\\R.', a: '\\A.', '+': '\\+', '\u2720': '\\+' };
  function initialRichHtmlForEditor(stored) {
    const s = stored || '';
    if (!s.trim()) return '<br>';
    if (!/<[a-z][\s\S]*>/i.test(s)) {
      return escapeHtml(s).replace(/\r\n|\r|\n/g, '<br>');
    }
    const w = document.createElement('div');
    w.appendChild(sanitizeToFragment(s));
    w.querySelectorAll('.versiculum').forEach(function(sp) {
      var text = (sp.textContent || '').trim();
      var code = versiculumReverseMap[text] || text;
      sp.replaceWith(document.createTextNode(code));
    });
    const h = w.innerHTML;
    return h.trim() ? h : '<br>';
  }

  function translationHasContent(html) {
    const w = document.createElement('div');
    w.appendChild(sanitizeToFragment(html));
    return (w.textContent || '').trim().length > 0;
  }

  function splitTranslationLines(text) {
    if (!text || !String(text).trim()) return [];
    return String(text).split('\n');
  }

  function renderSimpleMarkup(text) {
    return escapeHtml(text)
      .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      .replace(/\\V\./g, '<span class="versiculum">v</span>')
      .replace(/\\R\./g, '<span class="versiculum">r</span>')
      .replace(/\\A\./g, '<span class="versiculum">a</span>')
      .replace(/\\[+]/g, '<span class="versiculum">\u2720</span>')
      .replace(/\n+/g, '<br>');
  }

  function insertTextBoundaryMarkers(el) {
    el.querySelectorAll('br').forEach(function (br) {
      br.parentNode.insertBefore(document.createTextNode(' '), br);
    });
    el.querySelectorAll('div, p, li').forEach(function (blk) {
      blk.parentNode.insertBefore(document.createTextNode(' '), blk);
    });
  }

  function stripTagsForPreview(html) {
    const w = document.createElement('div');
    w.appendChild(sanitizeToFragment(html));
    insertTextBoundaryMarkers(w);
    let t = (w.textContent || '').replace(/\s+/g, ' ').trim();
    return t.length > 48 ? t.slice(0, 48) + '…' : t;
  }

  function plainTextFromHtml(html) {
    const w = document.createElement('div');
    w.appendChild(sanitizeToFragment(html));
    insertTextBoundaryMarkers(w);
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
      return { icon: '', color: '', label: 'Page break', noIcon: true, itemBg: '#e9ecef' };
    }
    if (t === 'spacer') {
      return { icon: '', color: '', label: 'Spacer', noIcon: true, itemBg: '#f0f4f8' };
    }
    if (t === 'hr') {
      return { icon: '', color: '', label: 'Horizontal rule', noIcon: true, itemBg: '#f0f4f8' };
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
    if (b.type === 'spacer') {
      return 'Spacer (' + (b.heightMm || 10) + 'mm)';
    }
    if (b.type === 'hr') {
      return 'Horizontal rule';
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

  function applyRichFontFamily(ed, familyKey, onChange) {
    ed.focus();
    try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) { onChange(); return; }
    if (familyKey) loadGoogleFont(familyKey);
    const span = document.createElement('span');
    span.style.fontFamily = familyKey ? fontStackFor(familyKey) : 'inherit';
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

  function toggleRichSmallCaps(ed, onChange) {
    ed.focus();
    try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) { onChange(); return; }

    var ancestor = range.commonAncestorContainer;
    if (ancestor.nodeType === Node.TEXT_NODE) ancestor = ancestor.parentElement;
    var existing = ancestor && ancestor.closest && ancestor.closest('span[style*="font-variant"]');
    if (existing && existing !== ed && ed.contains(existing)) {
      existing.style.fontVariant = '';
      if (!existing.getAttribute('style')?.trim()) existing.removeAttribute('style');
    } else {
      const span = document.createElement('span');
      span.style.fontVariant = 'small-caps';
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
    }
    onChange();
  }

  function getAncestorOl(ed) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var node = sel.getRangeAt(0).startContainer;
    while (node && node !== ed) {
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'OL') return node;
      node = node.parentNode;
    }
    return null;
  }

  function syncListStartInput(inp, ed) {
    var ol = getAncestorOl(ed);
    if (ol) {
      inp.value = ol.getAttribute('start') || '1';
      inp.disabled = false;
    } else {
      inp.value = '1';
      inp.disabled = true;
    }
  }

  function bindRichToolbar(toolbarRoot, ed, onChange) {
    let savedRange = null;

    var saveEdSelection = function () {
      var sel = window.getSelection();
      if (sel.rangeCount > 0 && ed.contains(sel.anchorNode) && ed.contains(sel.focusNode)) {
        try { savedRange = sel.getRangeAt(0).cloneRange(); } catch (_) {}
      }
    };
    ed.addEventListener('keyup', saveEdSelection);
    ed.addEventListener('mouseup', saveEdSelection);
    document.addEventListener('selectionchange', function () {
      if (!document.contains(ed)) return;
      saveEdSelection();
    });

    toolbarRoot.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION' ||
          e.target.closest('select')) return;
      // Allow inputs (e.g. the list-start number field) to receive focus normally.
      if (e.target.tagName === 'INPUT' || e.target.closest('input')) return;
      e.preventDefault();
    }, false);

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
          } else if (cmd === 'smallCaps') {
            toggleRichSmallCaps(ed, function () {});
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
    const familySel = toolbarRoot.querySelector('[data-rich-family-select]');
    if (familySel) {
      familySel.addEventListener('change', function () {
        const v = familySel.value;
        if (v === '') return;
        restoreSelection();
        applyRichFontFamily(ed, v === 'inherit' ? '' : v, onChange);
        familySel.value = '';
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
    var listStartInp = toolbarRoot.querySelector('.booklet-rich-list-start');
    if (listStartInp) {
      var trackedOl = null;
      function updateListStart() {
        var ol = getAncestorOl(ed);
        trackedOl = ol;
        if (ol) {
          listStartInp.value = ol.getAttribute('start') || '1';
          listStartInp.disabled = false;
        } else {
          listStartInp.value = '1';
          listStartInp.disabled = true;
        }
      }
      ed.addEventListener('keyup', updateListStart);
      ed.addEventListener('mouseup', updateListStart);
      // Use the stored OL reference — by the time 'change' fires the editor
      // selection is gone because focus moved to this input.
      listStartInp.addEventListener('change', function () {
        var n = parseInt(listStartInp.value, 10);
        if (!Number.isFinite(n) || n < 1) return;
        if (!trackedOl) return;
        trackedOl.setAttribute('start', String(n));
        onChange();
      });
    }
    var richInsertShortcodeMap = { v: '\\V.', r: '\\R.', a: '\\A.', '+': '\\+' };
    toolbarRoot.querySelectorAll('[data-rich-insert]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        restoreSelection();
        var glyph = btn.getAttribute('data-rich-insert');
        var code = richInsertShortcodeMap[glyph] || glyph;
        try {
          document.execCommand('insertText', false, code);
        } catch (_) {}
        onChange();
      });
    });
    toolbarRoot.querySelectorAll('[data-rich-insert-text]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        restoreSelection();
        var txt = btn.getAttribute('data-rich-insert-text');
        try {
          document.execCommand('insertText', false, txt);
        } catch (_) {}
        onChange();
      });
    });
    toolbarRoot.querySelectorAll('[data-toggle-special]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tgt = document.getElementById(btn.getAttribute('data-toggle-special'));
        if (!tgt) return;
        var icon = btn.querySelector('i');
        if (tgt.classList.contains('d-none')) {
          tgt.classList.remove('d-none');
          tgt.classList.add('d-flex');
          if (icon) { icon.classList.remove('bi-chevron-right'); icon.classList.add('bi-chevron-down'); }
        } else {
          tgt.classList.add('d-none');
          tgt.classList.remove('d-flex');
          if (icon) { icon.classList.remove('bi-chevron-down'); icon.classList.add('bi-chevron-right'); }
        }
      });
    });
    ed.addEventListener('input', onChange);
    ed.addEventListener('blur', onChange);
  }

  function makeBookletChantContext(chantBlock) {
    const b = chantBlock || {};
    var ctxt = new exsurge.ChantContext(exsurge.TextMeasuringStrategy.Canvas);
    ctxt.condenseLineAmount = 1;
    const glyphMult = Number(b.chantGlyphScale) || 1.4;
    ctxt.scaleDefs = false;
    ctxt.setGlyphScaling((1 / 16) * glyphMult);
    const lyricPx = Number(b.chantNeumeSize) || 23;
    const glyphRatio = glyphMult / 1.4;
    ctxt.setFont(CHANT_TEXT_FONT, (lyricPx / 0.9) * glyphRatio);
    const hSpacing = Number(b.chantHorizSpacing) || 1.0;
    ctxt.interSyllabicMultiplier = 2.5 * hSpacing;
    ctxt.minLyricWordSpacing *= hSpacing;
    const vSpacing = Number(b.chantVertSpacing) || 1.0;
    ctxt.spaceBetweenSystems = 1.5 * vSpacing;
    ctxt.minSpaceAboveStaff = 2 * vSpacing;
    ctxt.minSpaceBelowStaff = 1 * vSpacing;
    const dropCapScale = Number(b.chantDropCapScale) || 1;
    if (dropCapScale !== 1) {
      ctxt.textStyles.dropCap.size = Math.round(ctxt.textStyles.dropCap.size * dropCapScale);
      ctxt.textStyles.dropCap.padding = 1 * dropCapScale;
    }
    if (ctxt.dropCapTextSize !== undefined) {
      ctxt.dropCapTextSize = ctxt.textStyles.dropCap.size;
    }
    const annotSizeAdj = Number(b.chantAnnotationSizeAdj) || 0;
    if (annotSizeAdj !== 0) {
      ctxt.textStyles.annotation.size = Math.max(1, Math.round(ctxt.textStyles.annotation.size + annotSizeAdj));
    }
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
    var titlePt = (b.titleFontSizePt || 11) + 'pt';
    var srcPt = (b.sourceFontSizePt || 9) + 'pt';
    if (!t && sref) {
      const solo = document.createElement('div');
      solo.className = 'fst-italic text-muted mb-1 booklet-section-heading-source';
      solo.style.textAlign = 'right';
      solo.style.fontSize = srcPt;
      solo.textContent = sref;
      wrap.appendChild(solo);
      return;
    }
    const row = document.createElement('div');
    row.className =
      'booklet-section-heading d-flex justify-content-between align-items-baseline gap-2 flex-wrap mb-1';
    const left = document.createElement('div');
    left.className = 'fw-bold booklet-section-heading-title';
    left.style.fontSize = titlePt;
    left.textContent = t;
    row.appendChild(left);
    if (sref) {
      const right = document.createElement('div');
      right.className = 'fst-italic text-muted booklet-section-heading-source';
      right.style.textAlign = 'right';
      right.style.fontSize = srcPt;
      right.textContent = sref;
      row.appendChild(right);
    }
    wrap.appendChild(row);
  }

  function stripLegacyBookletSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    delete settings.fontScale;
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
      if (b.type === 'spacer') {
        const o = { ...b };
        if (o.hidden === undefined) o.hidden = false;
        if (o.heightMm == null) o.heightMm = 10;
        return o;
      }
      if (b.type === 'hr') {
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
        if (o.bodyFontSizePt == null) o.bodyFontSizePt = 11;
        if (o.lineHeightPt == null) o.lineHeightPt = 16;
        if (o.titleFontSizePt == null) o.titleFontSizePt = 11;
        if (o.sourceFontSizePt == null) o.sourceFontSizePt = 9;
      }
      if (o.type === 'reading') {
        if (o.translationFontSizePt == null) o.translationFontSizePt = 11;
        if (o.dropCapOriginal === undefined) o.dropCapOriginal = !!o.useDropCap;
        if (o.dropCapTranslation === undefined) o.dropCapTranslation = false;
        delete o.useDropCap;
      }
      if (o.type === 'chant_gabc') {
        const cd = chantD || {};
        o.chantNeumeSize =
          o.chantNeumeSize != null
            ? (Number(o.chantNeumeSize) || 23)
            : (Number(cd.chantNeumeSize) || 23);
        o.chantGlyphScale =
          o.chantGlyphScale != null
            ? (Number(o.chantGlyphScale) || 1.4)
            : 1.4;
        o.chantStaffColor = o.chantStaffColor != null ? String(o.chantStaffColor) : cd.chantStaffColor || '';
        if (o.chantHorizSpacing == null) {
          if (o.chantLyricTight != null) {
            o.chantHorizSpacing = (Number(o.chantLyricTight) || 1.1) / 1.1;
          } else {
            o.chantHorizSpacing = 1.0;
          }
        } else {
          o.chantHorizSpacing = Number(o.chantHorizSpacing) || 1.0;
        }
        if (o.chantVertSpacing == null) {
          o.chantVertSpacing = 1.0;
        } else {
          o.chantVertSpacing = Number(o.chantVertSpacing) || 1.0;
        }
        if (o.chantLineGap == null) {
          o.chantLineGap = 1.0;
        } else {
          o.chantLineGap = Number(o.chantLineGap) || 1.0;
        }
        delete o.chantLyricTight;
        delete o.chantSystemGap;
        delete o.chantLinePadTop;
        o.chantDropCapScale =
          o.chantDropCapScale != null
            ? (Number(o.chantDropCapScale) || 1)
            : (Number(cd.chantDropCapScale) || 1);
        if (o.chantUseDropCap === undefined) o.chantUseDropCap = true;
        if (o.chantLyricLanguage !== 'english') o.chantLyricLanguage = 'latin';
        o.chantTextFont = 'crimson';
        if (o.chantRubricColor === undefined) o.chantRubricColor = '';
        else {
          const cr = String(o.chantRubricColor).trim();
          o.chantRubricColor = /^#[0-9a-f]{6}$/i.test(cr) ? cr : '';
        }
        o.chantAnnotationSizeAdj =
          o.chantAnnotationSizeAdj != null ? (Number(o.chantAnnotationSizeAdj) || 0) : 0;
        o.chantAnnotationYAdj =
          o.chantAnnotationYAdj != null ? (Number(o.chantAnnotationYAdj) || 0) : 0;
        if (o.chantTranslation === undefined) o.chantTranslation = '';
        if (o.chantTranslationLeftPct == null) o.chantTranslationLeftPct = 60;
        if (o.chantTranslationGapMm == null) o.chantTranslationGapMm = 4;
        if (o.chantTranslationBorder === undefined) o.chantTranslationBorder = false;
        if (o.chantTranslationFontSizePt == null) o.chantTranslationFontSizePt = 11;
        if (!o.chantTranslationVAlign) o.chantTranslationVAlign = 'middle';
        if (!o.chantTranslationTextAlign) o.chantTranslationTextAlign = 'left';
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
        o.titleFontKey = o.titleFontKey
          ? (BOOKLET_FONT_STACKS[o.titleFontKey] != null ? o.titleFontKey : migrateFontKey(o.titleFontKey))
          : '';
        const tc = String(o.titleTextColor || '#212529').trim();
        o.titleTextColor = /^#[0-9a-f]{6}$/i.test(tc) ? tc : '#212529';
        const lc = String(o.titleLineColor || '#adb5bd').trim();
        o.titleLineColor = /^#[0-9a-f]{6}$/i.test(lc) ? lc : '#adb5bd';
        if (o.titleFontSizePt == null) o.titleFontSizePt = 11;
        if (o.titleBold === undefined) o.titleBold = false;
        if (o.titleItalic === undefined) o.titleItalic = false;
        if (o.titleSmallCaps === undefined) o.titleSmallCaps = true;
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
    if (parsed.settings.splitClipPx != null && parsed.settings.descClipPx == null) {
      parsed.settings.descClipPx = parsed.settings.splitClipPx;
      parsed.settings.ascClipPx = parsed.settings.splitClipPx;
      delete parsed.settings.splitClipPx;
    }
    parsed.settings.previewDisplay =
      parsed.settings.previewDisplay === 'booklet' ? 'booklet' : 'scroll';
    parsed.settings.fontFamilyKey = migrateFontKey(parsed.settings.fontFamilyKey);
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
      parsed.settings.fontFamilyKey = BOOKLET_DEFAULT_FONT;
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
      parsed.settings.fontFamilyKey = BOOKLET_DEFAULT_FONT;
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
      parsed.settings.fontFamilyKey = BOOKLET_DEFAULT_FONT;
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
    const sf = document.getElementById('selBookletFont');
    const pt = document.getElementById('inpProjectTitle');
    if (sz) sz.value = state.settings.pageSize;
    if (sf) sf.value = state.settings.fontFamilyKey || BOOKLET_DEFAULT_FONT;
    if (pt) pt.value = state.projectTitle != null ? state.projectTitle : '';
    var syncNum = function (id, key, fallback) {
      var el = document.getElementById(id);
      if (el) el.value = String(getSetting(key, fallback));
    };
    syncNum('inpMarginTop', 'marginTopMm', DEFAULT_BOOKLET_MARGIN_MM);
    syncNum('inpMarginBottom', 'marginBottomMm', DEFAULT_BOOKLET_MARGIN_MM);
    syncNum('inpMarginLeft', 'marginLeftMm', DEFAULT_BOOKLET_MARGIN_MM);
    syncNum('inpMarginRight', 'marginRightMm', DEFAULT_BOOKLET_MARGIN_MM);
    syncNum('inpSectionGap', 'sectionGapMm', DEFAULT_SECTION_GAP_AFTER_MM);
    syncNum('inpGapTolerance', 'gapTolerancePx', GAP_FLEX_PX);
    syncNum('inpMarginTolerance', 'marginTolerancePx', MARGIN_TOLERANCE_PX);
    syncNum('inpOrphanLines', 'minOrphanLines', 3);
    syncNum('inpDescClipPx', 'descClipPx', 3);
    syncNum('inpAscClipPx', 'ascClipPx', 3);
    syncNum('inpDropCapOffset', 'dropCapOffsetEm', 0.05);
    var pdGrp = document.getElementById('btnGroupPreviewDisplay');
    if (pdGrp) {
      var cur = state.settings.previewDisplay === 'booklet' ? 'booklet' : 'scroll';
      pdGrp.querySelectorAll('[data-view]').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-view') === cur);
      });
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

  function renderChantGabcToLines(gabcRaw, widthPx, chantBlock, fullWidthPx) {
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
              annotationArray[0],
              annotationArray[1]
            );
          } else if (header.annotation) {
            score.annotation = new exsurge.Annotations(ctxt, header.annotation);
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
      var annotYAdj = Number(cb.chantAnnotationYAdj) || 0;
      var vSpacingGapPx = ctxt.staffInterval * 0.5 * (Number(cb.chantLineGap != null ? cb.chantLineGap : 1.0));

      var hasTranslation = fullWidthPx && translationHasContent(cb.chantTranslation);
      var transLines = hasTranslation ? splitTranslationLines(cb.chantTranslation) : [];
      var ctLeftPct, ctRightPct, ctHalfGapMm, ctTransFontPt, ctShowBorder, ctTransVAlign, ctTransTextAlign;
      if (hasTranslation) {
        ctLeftPct = Math.min(80, Math.max(20, parseInt(cb.chantTranslationLeftPct, 10) || 60));
        ctRightPct = 100 - ctLeftPct;
        ctHalfGapMm = (Math.min(20, Math.max(0, parseInt(cb.chantTranslationGapMm, 10) || 4))) / 2;
        ctTransFontPt = cb.chantTranslationFontSizePt || 11;
        ctShowBorder = !!cb.chantTranslationBorder;
        ctTransVAlign = cb.chantTranslationVAlign || 'middle';
        ctTransTextAlign = cb.chantTranslationTextAlign || 'left';
      }

      var offscreen = document.createElement('div');
      offscreen.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden';
      document.body.appendChild(offscreen);

      var svgs = temp.querySelectorAll('svg');
      svgs.forEach(function (svg, svgIdx) {
        svg.setAttribute('overflow', 'visible');
        svg.style.overflow = 'visible';
        svg.querySelectorAll('text.annotation').forEach(function (ann) {
          var cy = parseFloat(ann.getAttribute('y'));
          if (Number.isFinite(cy)) ann.setAttribute('y', (cy - 6 - annotYAdj) + '');
        });
        offscreen.appendChild(svg);
        var gEl = svg.querySelector('g.chantLine');
        if (gEl) {
          gEl.setAttribute('transform', 'translate(0,0)');
          try {
            var bbox = gEl.getBBox();
            var margin = 2;
            var vx = bbox.x - margin;
            var vy = bbox.y - margin;
            var vw = bbox.width + margin * 2;
            var vh = bbox.height + margin * 2;
            var lyricEls = svg.querySelectorAll('text.lyric');
            var dropCapEl = svg.querySelector('text.dropCap');
            if (dropCapEl && lyricEls.length) {
              var maxLyricY = -Infinity;
              lyricEls.forEach(function (ly) {
                var lyY = parseFloat(ly.getAttribute('y'));
                if (Number.isFinite(lyY) && lyY > maxLyricY) maxLyricY = lyY;
              });
              if (Number.isFinite(maxLyricY)) {
                var lyricFontSize = parseFloat(window.getComputedStyle(lyricEls[0]).fontSize) || 17;
                var trimmedBottom = maxLyricY + lyricFontSize * 0.35;
                if (trimmedBottom < bbox.y + bbox.height) {
                  vh = trimmedBottom - vy;
                }
              }
            }
            if (!lyricEls.length) {
              var lyricPad = ctxt.staffInterval * 3;
              vh = Math.max(vh, bbox.height + margin * 2 + lyricPad);
            }
            svg.setAttribute('viewBox', vx + ' ' + vy + ' ' + vw + ' ' + vh);
            svg.setAttribute('width', vw);
            svg.setAttribute('height', vh);
          } catch (e) { /* getBBox can fail if SVG is empty */ }
        }
        offscreen.removeChild(svg);
        const line = document.createElement('div');
        line.className = 'booklet-chant-line';
        line.style.overflow = 'visible';
        line.style.marginBottom = vSpacingGapPx + 'px';

        if (hasTranslation) {
          var transHtml = '';
          if (svgIdx < svgs.length - 1) {
            transHtml = transLines[svgIdx] || '';
          } else {
            transHtml = transLines.slice(svgIdx).join('\n');
          }
          var table = document.createElement('table');
          table.className = 'booklet-chant-parallel';
          var tr = document.createElement('tr');
          var tdL = document.createElement('td');
          tdL.style.width = ctLeftPct + '%';
          tdL.style.paddingRight = ctHalfGapMm + 'mm';
          if (ctShowBorder) tdL.style.borderRight = '1px solid #adb5bd';
          tdL.appendChild(svg);
          var tdR = document.createElement('td');
          tdR.style.width = ctRightPct + '%';
          tdR.style.paddingLeft = ctHalfGapMm + 'mm';
          tdR.style.verticalAlign = ctTransVAlign;
          var transDiv = document.createElement('div');
          transDiv.className = 'booklet-richtext chant-translation';
          transDiv.style.fontSize = ctTransFontPt + 'pt';
          transDiv.style.textAlign = ctTransTextAlign;
          transDiv.innerHTML = renderSimpleMarkup(transHtml);
          tdR.appendChild(transDiv);
          tr.appendChild(tdL);
          tr.appendChild(tdR);
          table.appendChild(tr);
          line.appendChild(table);
        } else {
          line.appendChild(svg);
        }
        lines.push(line);
      });
      document.body.removeChild(offscreen);
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

  function loadInlineGoogleFonts(root) {
    root.querySelectorAll('span[style*="font-family"]').forEach(function (el) {
      var m = el.style.fontFamily.match(/^['"]?([^'",]+)/);
      if (m && BOOKLET_FONT_STACKS[m[1].trim()] != null) loadGoogleFont(m[1].trim());
    });
  }

  function buildStaticSectionEl(b) {
    const wrap = document.createElement('div');
    wrap.className = 'booklet-section';
    wrap.dataset.blockId = b.id;
    if (b.type === 'rubric') {
      appendSectionHeading(wrap, b);
      const p = document.createElement('div');
      p.className = 'rubric booklet-richtext';
      p.style.color = b.rubricColor || '#8b1538';
      p.style.fontSize = (b.bodyFontSizePt || 11) + 'pt';
      p.style.lineHeight = (b.lineHeightPt || 16) + 'pt';
      p.appendChild(sanitizeToFragment(b.text || ''));
      p.querySelectorAll('span[style]').forEach(function (s) {
        s.style.removeProperty('color');
        if (!s.getAttribute('style')?.trim()) s.removeAttribute('style');
      });
      wrap.appendChild(p);
    } else if (b.type === 'reading') {
      var _lhPt = (b.lineHeightPt || 16) + 'pt';
      if (translationHasContent(b.translation)) {
        appendSectionHeading(wrap, b);
        const leftPct = Math.min(80, Math.max(20, parseFloat(b.parallelLeftPct) || 50));
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
        innerL.className = 'booklet-richtext reading' + (b.dropCapOriginal ? ' booklet-drop-cap' : '');
        innerL.style.fontSize = (b.bodyFontSizePt || 11) + 'pt';
        innerL.style.lineHeight = _lhPt;
        innerL.appendChild(sanitizeToFragment(b.text || ''));
        const innerR = document.createElement('div');
        innerR.className = 'booklet-richtext reading' + (b.dropCapTranslation ? ' booklet-drop-cap' : '');
        innerR.style.fontSize = (b.translationFontSizePt || 11) + 'pt';
        innerR.style.lineHeight = _lhPt;
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
        p.className = 'reading booklet-richtext' + (b.dropCapOriginal ? ' booklet-drop-cap' : '');
        p.style.fontSize = (b.bodyFontSizePt || 11) + 'pt';
        p.style.lineHeight = _lhPt;
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
      if (b.titleFontSizePt) textEl.style.fontSize = b.titleFontSizePt + 'pt';
      if (b.titleBold) textEl.style.fontWeight = 'bold';
      if (b.titleItalic) textEl.style.fontStyle = 'italic';
      if (b.titleSmallCaps !== false) textEl.style.fontVariant = 'small-caps';
      else textEl.style.fontVariant = 'normal';
      const fk = (b.titleFontKey && BOOKLET_FONT_STACKS[b.titleFontKey] != null)
          ? b.titleFontKey
          : (state.settings.fontFamilyKey || BOOKLET_DEFAULT_FONT);
      loadGoogleFont(fk);
      textEl.style.fontFamily = fontStackFor(fk);
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
    loadInlineGoogleFonts(wrap);
    return wrap;
  }

  function blockSectionGapAfterMm(b) {
    return getSetting('sectionGapMm', DEFAULT_SECTION_GAP_AFTER_MM);
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
      if (b.type === 'spacer') {
        var hMm = parseBoundedNumber(b.heightMm, -100, 100, 10);
        var hPx = mmToPx(hMm);
        var spacerEl = document.createElement('div');
        spacerEl.className = 'booklet-spacer';
        spacerEl.dataset.blockId = b.id;
        if (hPx < 0) {
          spacerEl.style.height = '0px';
          spacerEl.dataset.spacerMb = String(hPx);
        } else {
          spacerEl.style.height = hPx + 'px';
        }
        out.push({ t: 'flow', el: spacerEl, splittable: false, gapMm: 0, fixedHeightPx: hPx });
        continue;
      }
      if (b.type === 'hr') {
        var hrEl = document.createElement('div');
        hrEl.className = 'booklet-title-rule booklet-hr';
        hrEl.dataset.blockId = b.id;
        var hrLine = document.createElement('span');
        hrLine.className = 'booklet-title-rule-line';
        hrLine.setAttribute('aria-hidden', 'true');
        var hrLineColor = String(b.hrLineColor || '').trim();
        hrLine.style.backgroundColor = /^#[0-9a-f]{6}$/i.test(hrLineColor) ? hrLineColor : '#adb5bd';
        hrEl.appendChild(hrLine);
        out.push({ t: 'flow', el: hrEl, splittable: false, gapMm: blockSectionGapAfterMm(b) });
        continue;
      }
      var gapAfter = blockSectionGapAfterMm(b);
      var splittable = (b.type === 'rubric' || b.type === 'reading');
      if (b.type === 'chant_gabc') {
        var chantW = w;
        var chantFullW = null;
        if (translationHasContent(b.chantTranslation)) {
          var ctLPct = Math.min(80, Math.max(20, parseInt(b.chantTranslationLeftPct, 10) || 60));
          var ctGapPx = mmToPx(Math.min(20, Math.max(0, parseInt(b.chantTranslationGapMm, 10) || 4)));
          chantW = Math.round(w * ctLPct / 100 - ctGapPx / 2);
          chantFullW = w;
        }
        var lines = renderChantGabcToLines(b.gabc || '', chantW, b, chantFullW);
        var chantStaffInterval = 100 * (1 / 16) * (Number(b.chantGlyphScale) || 1.4);
        var chantVGapPx = chantStaffInterval * 0.5 * (Number(b.chantLineGap != null ? b.chantLineGap : 1.0));
        for (var li = 0; li < lines.length; li++) {
          lines[li].dataset.blockId = b.id;
          var isLast = li === lines.length - 1;
          var flowItem = { t: 'flow', el: lines[li], splittable: false, gapMm: isLast ? gapAfter : 0 };
          if (li > 0) flowItem.internalGapPx = chantVGapPx;
          out.push(flowItem);
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

  function ensureMeasurePageContext(mount, widthPx) {
    var ctx = mount._pageCtx;
    if (!ctx) {
      var page = document.createElement('div');
      page.className = 'booklet-page';
      page.dataset.size = state.settings.pageSize || 'A4';
      page.style.cssText = 'position:static;width:auto;height:auto;min-height:0;max-height:none;margin:0;padding:0;box-shadow:none;overflow:visible;';
      var inner = document.createElement('div');
      inner.className = 'page-inner-flow';
      var body = document.createElement('div');
      body.className = 'booklet-page-body';
      inner.appendChild(body);
      page.appendChild(inner);
      ctx = { page: page, body: body };
      mount._pageCtx = ctx;
    }
    ctx.page.dataset.size = state.settings.pageSize || 'A4';
    ctx.body.style.width = widthPx + 'px';
    return ctx;
  }

  function measureInContext(el, widthPx) {
    var mount = document.getElementById('bookletMeasureMount');
    if (!mount) {
      var c = el.cloneNode(true);
      c.style.cssText = 'visibility:hidden;position:absolute;width:' + widthPx + 'px;';
      document.body.appendChild(c);
      var h = c.getBoundingClientRect().height;
      c.remove();
      return h || 1;
    }
    mount.innerHTML = '';
    mount.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;overflow:visible;';
    var ctx = ensureMeasurePageContext(mount, widthPx);
    ctx.body.innerHTML = '';
    var clone = el.cloneNode(true);
    ctx.body.appendChild(clone);
    mount.appendChild(ctx.page);
    var h = clone.getBoundingClientRect().height;
    mount.removeChild(ctx.page);
    ctx.body.innerHTML = '';
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

  function createClippedView(el, fromPx, toPx, widthPx, clipClass, lineHPx) {
    var isTop = clipClass === 'booklet-clip-top';
    var isMid = clipClass === 'booklet-clip-mid';
    var isBot = clipClass === 'booklet-clip-bottom';
    var descClip = getSetting('descClipPx', 3);
    var ascClip = getSetting('ascClipPx', 3);
    var extraBot = (isMid || isBot) ? descClip : 0;
    var container = document.createElement('div');
    container.className = 'booklet-clip-container' + (clipClass ? ' ' + clipClass : '');
    container.style.width = '100%';
    container.style.height = (toPx - fromPx + extraBot) + 'px';
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
    if ((isMid || isBot) && descClip > 0) {
      var coverTop = document.createElement('div');
      coverTop.style.cssText = 'position:absolute;top:0;left:0;right:0;height:' + descClip + 'px;background:#fff;z-index:1;';
      container.appendChild(coverTop);
    }
    if ((isTop || isMid) && ascClip > 0) {
      var coverBot = document.createElement('div');
      coverBot.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:' + ascClip + 'px;background:#fff;z-index:1;';
      container.appendChild(coverBot);
    }
    return container;
  }

  function getElementLineHeightPx(el) {
    var rt = el.querySelector('.booklet-richtext');
    if (rt && rt.style.lineHeight) {
      var val = parseFloat(rt.style.lineHeight);
      if (Number.isFinite(val) && val > 0) {
        if (rt.style.lineHeight.indexOf('pt') >= 0) return val * 96 / 72;
        return val;
      }
    }
    return LINE_H_PX;
  }

  function paginateFlow(flowItems, widthPx, pageHPx, lastPageReservePx) {
    var pages = [];
    var curEls = [];
    var curHeights = [];
    var curGaps = [];
    var curGapFlex = [];
    var gapFlexPx = getSetting('gapTolerancePx', GAP_FLEX_PX);
    var marginTolPx = getSetting('marginTolerancePx', MARGIN_TOLERANCE_PX);
    var defaultGapMm = getSetting('sectionGapMm', DEFAULT_SECTION_GAP_AFTER_MM);
    var pendingGapMm = defaultGapMm;
    var minOrphan = getSetting('minOrphanLines', 3);

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
        delta = nf > 0 ? -Math.min(gapFlexPx, (ideal - pageHPx) / nf) : 0;
      } else if (ideal < pageHPx) {
        delta = nf > 0 ? Math.min(gapFlexPx, (pageHPx - ideal) / nf) : 0;
      }
      var adjusted = calcContent(delta);
      var padBot = Math.max(-marginTolPx, pageHPx - adjusted);
      pushPage(curEls, buildAdjGaps(delta), 0, padBot);
    }

    function flushPage() {
      finalizePage();
      curEls = [];
      curHeights = [];
      curGaps = [];
      curGapFlex = [];
      pendingGapMm = defaultGapMm;
    }

    function bestLineSnap(avail, maxAvail, headerOffset, footerOffset, lineHPx) {
      var lh = lineHPx || LINE_H_PX;
      var off = headerOffset || 0;
      var bot = footerOffset || 0;
      var textAvail = avail - off - bot;
      if (textAvail < lh) return { h: avail, borrow: 0 };
      var fn = Math.floor(textAvail / lh);
      var fh = off + fn * lh + bot;
      var ch = off + (fn + 1) * lh + bot;
      if (ch <= maxAvail) return { h: ch, borrow: Math.max(0, ch - avail) };
      if (fh > off + bot) return { h: fh, borrow: 0 };
      return { h: avail, borrow: 0 };
    }

    function measureBlockOffsets(el, widthPx) {
      var mount = document.getElementById('bookletMeasureMount');
      if (!mount) return { header: 0, footer: 0 };
      mount.innerHTML = '';
      mount.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;overflow:visible;';
      var ctx = ensureMeasurePageContext(mount, widthPx);
      ctx.body.innerHTML = '';
      var clone = el.cloneNode(true);
      ctx.body.appendChild(clone);
      mount.appendChild(ctx.page);
      var richtext = clone.querySelector('.booklet-richtext');
      var header = 0;
      var footer = 0;
      if (richtext) {
        var richRect = richtext.getBoundingClientRect();
        var cloneRect = clone.getBoundingClientRect();
        header = richRect.top - cloneRect.top;
        var cloneH = cloneRect.height;
        var rtBottom = header + richRect.height;
        footer = Math.max(0, cloneH - rtBottom);
      }
      mount.removeChild(ctx.page);
      ctx.body.innerHTML = '';
      mount.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;width:1px;height:1px;overflow:hidden;';
      return { header: header, footer: footer };
    }

    function splitContinuation(el, totalH, startOffset, w) {
      var elLh = getElementLineHeightPx(el);
      var minOrphanH = minOrphan * elLh;
      var offset = startOffset;
      while (offset < totalH) {
        var rem = totalH - offset;
        var snap = bestLineSnap(pageHPx, pageHPx + marginTolPx, 0, 0, elLh);
        if (rem <= snap.h) {
          curEls = [createClippedView(el, offset, totalH, w, 'booklet-clip-bottom', elLh)];
          curHeights = [rem];
          curGaps = [0];
          curGapFlex = [false];
          break;
        }
        var sliceH = snap.h;
        var afterRem = totalH - offset - sliceH;
        if (afterRem > 0 && afterRem < minOrphanH && sliceH > minOrphanH) {
          var pullLines = minOrphan - Math.max(0, Math.floor(afterRem / elLh));
          sliceH = Math.max(elLh, sliceH - pullLines * elLh);
        }
        var cls = offset === 0 ? 'booklet-clip-top' : 'booklet-clip-mid';
        var clip = createClippedView(el, offset, offset + sliceH, w, cls, elLh);
        var padBot = Math.max(-marginTolPx, pageHPx - sliceH);
        pushPage([clip], [0], 0, padBot);
        offset += sliceH;
      }
    }

    function placeOnNewPage(el, h, splittable, w) {
      if (h <= pageHPx + marginTolPx || !splittable) {
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
      var h = (item.fixedHeightPx != null) ? item.fixedHeightPx : measureInContext(el, widthPx);
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

      var minGap = gapFlex ? Math.max(0, gap - gapFlexPx) : gap;
      var minTotal = calcContent(-gapFlexPx) + minGap + h;

      if (minTotal <= pageHPx + marginTolPx) {
        curEls.push(el);
        curHeights.push(h);
        curGaps.push(gap);
        curGapFlex.push(gapFlex);
      }
      else if (item.splittable && curEls.length > 0) {
        var minAbove = calcContent(-gapFlexPx) + minGap;
        var maxRemaining = pageHPx + marginTolPx - minAbove;

        if (maxRemaining >= 60) {
          var offsets = measureBlockOffsets(el, widthPx);
          var elLineH = getElementLineHeightPx(el);
          var minOrphanH = minOrphan * elLineH;
          var deltas = [-gapFlexPx, 0, gapFlexPx];
          var best = null;

          for (var d = 0; d < deltas.length; d++) {
            var dt = deltas[d];
            var above = calcContent(dt) + (gapFlex ? Math.max(0, gap + dt) : gap);
            var avail = pageHPx - above;
            var maxA = pageHPx + marginTolPx - above;
            if (maxA < 20) continue;

            var snap = bestLineSnap(Math.max(0, avail), Math.max(0, maxA), offsets.header, offsets.footer, elLineH);
            if (snap.h < 20) continue;
            var splitH = Math.min(snap.h, h);
            var textInFirst = splitH - (offsets.header || 0) - (offsets.footer || 0);
            var remainder = h - splitH;
            if (textInFirst < minOrphanH && splitH < h) continue;
            if (remainder > 0 && remainder < minOrphanH) continue;
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
            var clipTop = createClippedView(el, 0, best.splitH, widthPx, 'booklet-clip-top', elLineH);
            var adjGaps = buildAdjGaps(best.dt);
            adjGaps.push(best.gAdj);
            var els = curEls.slice();
            els.push(clipTop);
            var padBot = Math.max(-marginTolPx, pageHPx - best.total);
            pushPage(els, adjGaps, 0, padBot);

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

    if (curEls.length) {
      if (lastPageReservePx > 0) pageHPx -= lastPageReservePx;
      flushPage();
    }
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
    var vp = host.querySelector('.booklet-spread-viewport');
    var vpW = vp ? vp.clientWidth : host.clientWidth;
    var slotW = Math.floor((vpW - 2) / 2);
    var vpH = vp ? vp.clientHeight : host.clientHeight;
    var slotH = Math.max(vpH - 4, 100);
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
    host._syncNav = syncNavButtons;

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
    if (document.fonts) {
      var _ff = fontStackFor(state.settings.fontFamilyKey || BOOKLET_DEFAULT_FONT);
      try { await document.fonts.load('400 12pt ' + _ff); } catch(e){}
      try { await document.fonts.load('italic 400 12pt ' + _ff); } catch(e){}
      try { await document.fonts.load('600 12pt ' + _ff); } catch(e){}
      await document.fonts.ready;
    }
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

    // Fade existing pages in-place while the new layout is computed.
    // This avoids replacing root content (which would reset scrollTop to 0)
    // before the new content is ready.
    var savedScrollTop = root.scrollTop;
    root.classList.add('booklet-preview--rebuilding');

    var flow;
    try {
      flow = await buildFlowList();
    } catch (e) {
      console.error(e);
      root.classList.remove('booklet-preview--rebuilding');
      root.innerHTML = '<p class="text-danger small">Layout error: ' + escapeHtml(e.message || String(e)) + '</p>';
      return;
    }
    if (myTok !== previewToken) {
      root.classList.remove('booklet-preview--rebuilding');
      return;
    }

    var widthPx = getContentWidthPx();
    var pageHPx = getMaxPageBodyHeightPx();
    var marginTopPx = mmToPx(getBookletMarginTopMm());
    var marginBotPx = mmToPx(getBookletMarginBottomMm());
    var pageResults = paginateFlow(flow, widthPx, pageHPx, BOOKLET_FOOTER_RESERVE_PX);

    var pageDivs = pageResults.map(function (pg) {
      var page = document.createElement('div');
      page.className = 'booklet-page';
      page.dataset.size = size;
      if (pg.padTopAdjust || pg.padBottomAdjust) {
        page.style.paddingTop = (marginTopPx + (pg.padTopAdjust || 0)) + 'px';
        page.style.paddingBottom = (marginBotPx + (pg.padBottomAdjust || 0)) + 'px';
      }
      var inner = document.createElement('div');
      inner.className = 'page-inner-flow';
      var body = document.createElement('div');
      body.className = 'booklet-page-body';
      pg.elements.forEach(function (el, idx) {
        el.style.marginTop = (pg.adjustedGaps[idx] || 0) + 'px';
        el.style.marginBottom = (el.dataset && el.dataset.spacerMb) ? el.dataset.spacerMb + 'px' : '0';
        body.appendChild(el);
      });
      inner.appendChild(body);
      page.appendChild(inner);
      return page;
    });

    // Now swap content. root still has its old pages so scrollTop is preserved.
    root.innerHTML = '';
    root.classList.remove('booklet-preview--rebuilding');

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

    if (selectedBlockId && scrollToBlockAfterRender) {
      scrollToBlockAfterRender = false;
      setTimeout(function () { scrollPreviewToBlock(selectedBlockId); }, 150);
    } else {
      scrollToBlockAfterRender = false;
      // Restore scroll after the browser has reflowed the new content.
      requestAnimationFrame(function () { root.scrollTop = savedScrollTop; });
    }

  }

  function switchDisplayMode() {
    var root = document.getElementById('previewPages');
    var store = document.getElementById('bookletPageStore');
    if (!root) return;
    if (!exportPageElements || !exportPageElements.length) {
      return;
    }
    var prevHost = root.querySelector('.booklet-spread-host');
    if (prevHost && prevHost._bookletCleanup) prevHost._bookletCleanup();
    root.innerHTML = '';
    if (store) store.innerHTML = '';
    var display = state.settings.previewDisplay === 'booklet' ? 'booklet' : 'scroll';
    if (display === 'scroll') {
      exportPageElements.forEach(function (p) { root.appendChild(p); });
    } else {
      exportPageElements.forEach(function (p) { store.appendChild(p); });
      mountBookletSpreadUi(root, exportPageElements);
    }
  }

  var _richToolbarId = 0;
  function richToolbarHtml(tbClass) {
    var uid = 'richSpecial' + (++_richToolbarId);
    var fontOpts = '<option value="" selected>Font\u2026</option><option value="inherit">Default</option>';
    var groups = { Serif: [], 'Sans-serif': [], Monospace: [] };
    Object.keys(BOOKLET_FONTS).forEach(function (f) {
      var cat = BOOKLET_FONTS[f];
      var label = cat === 'serif' ? 'Serif' : cat === 'sans-serif' ? 'Sans-serif' : 'Monospace';
      groups[label].push(f);
    });
    Object.keys(groups).forEach(function (label) {
      if (!groups[label].length) return;
      fontOpts += '<optgroup label="' + label + '">';
      groups[label].forEach(function (f) { fontOpts += '<option value="' + f + '">' + f + '</option>'; });
      fontOpts += '</optgroup>';
    });
    return '<div class="booklet-rich-toolbar ' + tbClass + '">' +
      '<div class="d-flex flex-wrap align-items-center" style="gap:2px 6px">' +
        '<div class="btn-group btn-group-sm" role="group">' +
          '<button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="bold" title="Bold"><strong>B</strong></button>' +
          '<button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="italic" title="Italic"><em>I</em></button>' +
          '<button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="underline" title="Underline"><u>U</u></button>' +
          '<button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="smallCaps" title="Small caps" style="font-variant:small-caps;font-size:0.68rem;line-height:1.5">Sc</button>' +
        '</div>' +
        '<div class="btn-group btn-group-sm" role="group">' +
          '<button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="justifyLeft" title="Align left"><i class="bi bi-text-left"></i></button>' +
          '<button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="justifyCenter" title="Centre"><i class="bi bi-text-center"></i></button>' +
          '<button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="justifyRight" title="Align right"><i class="bi bi-text-right"></i></button>' +
          '<button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="justifyFull" title="Justify"><i class="bi bi-justify"></i></button>' +
        '</div>' +
        '<div class="btn-group btn-group-sm" role="group">' +
          '<button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="insertOrderedList" title="Numbered list"><i class="bi bi-list-ol"></i></button>' +
          '<button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="insertUnorderedList" title="Bullet list"><i class="bi bi-list-ul"></i></button>' +
        '</div>' +
        '<div class="d-flex align-items-center btn-group-sm" style="gap:2px" title="Set start number of the current numbered list">' +
          '<label class="text-muted" style="font-size:0.6rem;white-space:nowrap">Start #</label>' +
          '<input type="number" min="1" max="9999" step="1" value="1" class="form-control form-control-sm py-0 booklet-rich-list-start" style="width:3.2rem;height:1.55rem;font-size:0.7rem">' +
        '</div>' +
      '</div>' +
      '<div class="d-flex flex-wrap align-items-center" style="gap:2px 4px">' +
        '<input type="color" class="booklet-rich-color-pick" value="#212529" title="Text colour" style="width:1.55rem;height:1.55rem;padding:1px;border-radius:3px">' +
        '<button type="button" class="btn btn-sm btn-outline-secondary py-0 px-1" style="font-size:0.6rem;line-height:1.3;height:1.55rem" data-toggle-special="' + uid + '" title="Special characters">' +
          '<i class="bi bi-chevron-right" style="font-size:0.5rem"></i> \u266D' +
        '</button>' +
      '</div>' +
      '<div class="d-none flex-wrap align-items-center" style="gap:2px 4px" id="' + uid + '">' +
        '<div class="btn-group btn-group-sm" role="group">' +
          '<button type="button" class="btn btn-light border py-0 px-1 versiculum" data-rich-insert="v" title="Versicle (\\V.)">v</button>' +
          '<button type="button" class="btn btn-light border py-0 px-1 versiculum" data-rich-insert="r" title="Response (\\R.)">r</button>' +
          '<button type="button" class="btn btn-light border py-0 px-1 versiculum" data-rich-insert="a" title="Antiphon (\\A.)">a</button>' +
          '<button type="button" class="btn btn-light border py-0 px-1" data-rich-insert="+" title="Maltese Cross (\\+)">\u2720</button>' +
          '<button type="button" class="btn btn-light border py-0 px-1" data-rich-insert-text="\u2020" title="Dagger">\u2020</button>' +
          '<button type="button" class="btn btn-light border py-0 px-1" data-rich-insert-text="*" title="Asterisk">*</button>' +
        '</div>' +
        '<div class="btn-group btn-group-sm" role="group" title="Latin ligatures (best with Gentium Plus, Cardo, or EB Garamond)">' +
          '<button type="button" class="btn btn-light border py-0 px-1" data-rich-insert-text="\u00E6" title="ae ligature">\u00E6</button>' +
          '<button type="button" class="btn btn-light border py-0 px-1" data-rich-insert-text="\u0153" title="oe ligature">\u0153</button>' +
          '<button type="button" class="btn btn-light border py-0 px-1" data-rich-insert-text="\u01FD" title="ae with acute">\u01FD</button>' +
          '<button type="button" class="btn btn-light border py-0 px-1" data-rich-insert-text="\u0153\u0301" title="oe with acute">\u0153\u0301</button>' +
          '<button type="button" class="btn btn-light border py-0 px-1" data-rich-insert-text="\u00C6" title="AE">\u00C6</button>' +
          '<button type="button" class="btn btn-light border py-0 px-1" data-rich-insert-text="\u0152" title="OE">\u0152</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function editorLayoutPanelHtml(b, showGap, showFont) {
    const fs = b.fontScale != null ? b.fontScale : DEFAULT_BLOCK_FONT_SCALE;
    if (!showFont) return '';
    return `
        <div class="border rounded booklet-layout-compact bg-light small mb-1">
          <label class="form-label small mb-0">Text size (&times; body)</label>
          <input type="range" class="form-range" id="edBlockFontScale" min="0.75" max="1.5" step="0.05" value="${fs}">
        </div>`;
  }

  function wireEditorSectionLayout(panel, b, showGap, showFont) {
    const fsEl = panel.querySelector('#edBlockFontScale');
    const push = () => {
      if (showFont && fsEl) {
        const f = parseFloat(fsEl.value);
        b.fontScale = Number.isFinite(f)
          ? Math.min(1.5, Math.max(0.75, f))
          : DEFAULT_BLOCK_FONT_SCALE;
      }
      scheduleAutosave();
      markLayoutStale();
      renderBlockList();
    };
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
    markLayoutStale();
  }

  var INSERT_MENU_ITEMS = [
    { type: 'rubric', icon: 'bi-person-arms-up', label: 'Rubric' },
    { type: 'reading', icon: 'bi-text-paragraph', label: 'Text' },
    { type: 'title', icon: 'bi-text-center', label: 'Title rule' },
    { type: 'chant_gabc', icon: 'bi-music-note-beamed', label: 'Chant (GABC)' },
    { type: 'image', icon: 'bi-image', label: 'Image' },
    { type: 'edition_pdf', icon: 'bi-file-earmark-pdf', label: 'Polyphony edition PDF' },
    { type: 'page_break', icon: 'bi-file-earmark-break', label: 'Force page break' },
    { type: 'spacer', icon: 'bi-arrows-expand', label: 'Vertical spacer' },
    { type: 'hr', icon: 'bi-hr', label: 'Horizontal rule' },
  ];

  function createInsertZone(insertIdx) {
    var zone = document.createElement('div');
    zone.className = 'booklet-insert-zone';
    zone.dataset.insertIdx = insertIdx;
    var line = document.createElement('div');
    line.className = 'booklet-insert-line';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'booklet-insert-btn';
    btn.innerHTML = '<i class="bi bi-plus-circle-fill"></i>';
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var existing = document.querySelector('.booklet-insert-menu');
      if (existing) {
        existing.closest('.booklet-insert-zone')?.classList.remove('menu-open');
        existing.remove();
      }
      var blockList = document.getElementById('blockList');
      zone.classList.add('menu-open');
      if (blockList) blockList.classList.add('insert-zones-suppressed');
      var menu = document.createElement('div');
      menu.className = 'booklet-insert-menu';
      function closeMenu() {
        if (menu.parentNode) menu.remove();
        zone.classList.remove('menu-open');
        if (blockList) blockList.classList.remove('insert-zones-suppressed');
        document.removeEventListener('mousedown', outsideDismiss, true);
      }
      function outsideDismiss(e) {
        var inMenu = menu.contains(e.target);
        var inBtn = btn.contains(e.target);
        if (inMenu || inBtn) return;
        closeMenu();
      }
      INSERT_MENU_ITEMS.forEach(function (item) {
        var mb = document.createElement('button');
        mb.type = 'button';
        mb.innerHTML = '<i class="bi ' + item.icon + ' me-2"></i>' + item.label;
        mb.addEventListener('click', function (e) {
          e.stopPropagation();
          closeMenu();
          addBlock(item.type, insertIdx);
        });
        menu.appendChild(mb);
      });
      var btnRect = btn.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.left = Math.max(0, btnRect.left + btnRect.width / 2 - 100) + 'px';
      menu.style.top = (btnRect.bottom + 4) + 'px';
      menu.style.transform = 'none';
      document.body.appendChild(menu);
      var menuRect = menu.getBoundingClientRect();
      if (menuRect.bottom > window.innerHeight - 8) {
        menu.style.top = Math.max(0, btnRect.top - menuRect.height - 4) + 'px';
      }
      setTimeout(function () {
        if (!menu.parentNode) {
          closeMenu();
          return;
        }
        document.addEventListener('mousedown', outsideDismiss, true);
      }, 0);
    });
    line.appendChild(btn);
    zone.appendChild(line);
    return zone;
  }

  var _blockListRenderSuppressed = false;
  var _blockListRenderPending = false;
  function renderBlockList() {
    if (_blockListRenderSuppressed) { _blockListRenderPending = true; return; }
    const el = document.getElementById('blockList');
    if (!el) return;
    el.innerHTML = '';
    var topDropdown = document.querySelector('#bookletSidebar > .dropdown');
    if (topDropdown) topDropdown.style.display = state.blocks.length ? 'none' : '';
    state.blocks.forEach((b, idx) => {
      el.appendChild(createInsertZone(idx));
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
        requestAnimationFrame(function () {
          el.classList.add('block-list-dragging');
        });
      });
      div.addEventListener('dragend', function () {
        div.classList.remove('dragging');
        el.classList.remove('block-list-dragging');
        el.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(function (d) {
          d.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        el.querySelectorAll('.booklet-insert-zone.drag-over-zone').forEach(function (d) {
          d.classList.remove('drag-over-zone');
        });
      });

      if (meta.noIcon) {
        div.style.background = meta.itemBg || '#e9ecef';
        div.style.justifyContent = 'center';
        div.style.fontStyle = 'italic';
        div.style.color = '#6c757d';
        div.style.fontSize = '0.65rem';
        div.style.borderStyle = 'dashed';
      }

      var badge = null;
      if (!meta.noIcon) {
        badge = document.createElement('span');
        badge.className = 'booklet-block-type-badge';
        badge.style.backgroundColor = meta.color;
        badge.title = meta.label;
        badge.setAttribute('aria-hidden', 'true');
        var ic = document.createElement('i');
        ic.className = 'bi ' + meta.icon;
        badge.appendChild(ic);
      }

      var textEl = document.createElement('span');
      textEl.className = 'booklet-block-preview-text';
      textEl.textContent = meta.noIcon ? ('— ' + line + ' —') : line;
      if (b.type === 'title' && b.titleSmallCaps !== false) textEl.style.fontVariant = 'small-caps';

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
        markLayoutStale();
        syncPreviewHiddenOverlays();
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
        markLayoutStale();
      });
      actions.appendChild(vis);
      actions.appendChild(dup);
      actions.appendChild(rm);

      if (badge) div.appendChild(badge);
      div.appendChild(textEl);
      div.appendChild(actions);
      div.addEventListener('click', function (e) {
        if (e.target.closest('.booklet-block-actions')) return;
        selectedBlockId = b.id;
        var edP = document.getElementById('bookletEditorPane');
        if (edP) edP.classList.remove('booklet-pane-editor--collapsed');
        renderBlockList();
        renderEditor();
        scrollToBlockAfterRender = true;
        setTimeout(function () { scrollPreviewToBlock(b.id); }, 100);
      });
      row.appendChild(div);

      el.appendChild(row);
    });
    if (state.blocks.length) {
      el.appendChild(createInsertZone(state.blocks.length));
    }

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
        '<p class="small text-muted mb-0" title="The following section will begin on a new page in the on-screen preview and in the downloaded PDF.">Starts a new page after the previous section.</p>';
      return;
    }
    if (b.type === 'spacer') {
      var sh = b.heightMm != null ? b.heightMm : 10;
      panel.innerHTML =
        '<label class="form-label small mb-1">Spacer height (mm)</label>' +
        '<input type="number" class="form-control form-control-sm" id="edSpacerHeight" min="-100" max="100" step="1" value="' + sh + '">' +
        '<p class="small text-muted mt-1 mb-0">Unbreakable vertical space. Use a negative value to tighten the gap between blocks (pulls the following block up).</p>';
      var inp = panel.querySelector('#edSpacerHeight');
      if (inp) inp.addEventListener('change', function () {
        b.heightMm = parseBoundedNumber(inp.value, -100, 100, 10);
        scheduleAutosave();
        markLayoutStale();
        renderBlockList();
      });
      return;
    }
    if (b.type === 'hr') {
      var hlc = /^#[0-9a-f]{6}$/i.test(String(b.hrLineColor || '').trim()) ? String(b.hrLineColor).trim() : '#adb5bd';
      panel.innerHTML =
        '<label class="form-label small mb-1" for="edHrColor">Rule colour</label>' +
        '<input type="color" id="edHrColor" class="form-control form-control-color w-100 mb-2" value="' + escapeAttr(hlc) + '">' +
        '<p class="small text-muted mb-0">Full-width horizontal rule — same style as a title rule but with no text.</p>';
      var hrColorInp = panel.querySelector('#edHrColor');
      if (hrColorInp) hrColorInp.addEventListener('input', function () {
        var cv = hrColorInp.value;
        b.hrLineColor = /^#[0-9a-f]{6}$/i.test(cv) ? cv : '#adb5bd';
        scheduleAutosave();
        markLayoutStale();
      });
      return;
    }
    if (b.type === 'title') {
      const tfk = b.titleFontKey != null ? String(b.titleFontKey) : '';
      const fontOpts =
        '<option value=""' +
        (tfk === '' ? ' selected' : '') +
        '>Same as booklet body</option>' +
        Object.keys(BOOKLET_FONTS)
          .map(function (k) {
            return (
              '<option value="' +
              escapeAttr(k) +
              '"' +
              (tfk === k ? ' selected' : '') +
              '>' +
              escapeHtml(k) +
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
        <label class="form-label small mb-1" for="edTitleText">Title text</label>
        <input type="text" class="form-control form-control-sm mb-2" id="edTitleText" value="${escapeAttr(b.text || '')}" placeholder="e.g. Kyrie">
        <div class="d-flex flex-wrap align-items-end gap-2 mb-2">
          <label class="d-flex flex-column gap-0" style="width:4.5rem"><span class="form-label small mb-0">Size pt</span>
            <input type="number" class="form-control form-control-sm" id="edTitleSizePt" min="6" max="36" step="0.5" value="${b.titleFontSizePt || 11}"></label>
          <div>
            <span class="form-label small mb-0 d-block">Style</span>
            <div class="btn-group btn-group-sm">
              <button type="button" class="btn btn-light border py-0 px-1 ${b.titleBold ? 'active' : ''}" id="btnTitleBold" title="Bold"><strong>B</strong></button>
              <button type="button" class="btn btn-light border py-0 px-1 ${b.titleItalic ? 'active' : ''}" id="btnTitleItalic" title="Italic"><em>I</em></button>
              <button type="button" class="btn btn-light border py-0 px-1 ${b.titleSmallCaps !== false ? 'active' : ''}" id="btnTitleSC" title="Small caps" style="font-variant:small-caps;font-size:0.72rem">Sc</button>
            </div>
          </div>
        </div>
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
        var pts = parseFloat(panel.querySelector('#edTitleSizePt').value);
        b.titleFontSizePt = Number.isFinite(pts) ? Math.min(36, Math.max(6, pts)) : 11;
        b.titleBold = panel.querySelector('#btnTitleBold').classList.contains('active');
        b.titleItalic = panel.querySelector('#btnTitleItalic').classList.contains('active');
        b.titleSmallCaps = panel.querySelector('#btnTitleSC').classList.contains('active');
        const tc = panel.querySelector('#edTitleTextCol').value;
        b.titleTextColor = /^#[0-9a-f]{6}$/i.test(tc) ? tc : '#212529';
        const lc = panel.querySelector('#edTitleLineCol').value;
        b.titleLineColor = /^#[0-9a-f]{6}$/i.test(lc) ? lc : '#adb5bd';
        scheduleAutosave();
        markLayoutStale();
        renderBlockList();
      };
      panel.querySelector('#edTitleText').addEventListener('input', syncTitle);
      panel.querySelector('#edTitleSizePt').addEventListener('input', syncTitle);
      panel.querySelector('#edTitleFont').addEventListener('change', syncTitle);
      panel.querySelector('#edTitleTextCol').addEventListener('input', syncTitle);
      panel.querySelector('#edTitleLineCol').addEventListener('input', syncTitle);
      ['btnTitleBold', 'btnTitleItalic', 'btnTitleSC'].forEach(function(id) {
        var btn = panel.querySelector('#' + id);
        if (btn) btn.addEventListener('click', function() {
          btn.classList.toggle('active');
          syncTitle();
        });
      });
      wireEditorSectionLayout(panel, b, true, false);
      return;
    }
    if (b.type === 'rubric') {
      panel.innerHTML = `
        ${editorLayoutPanelHtml(b, true, false)}
        <div class="d-flex flex-wrap align-items-end gap-2 mb-1">
          <label class="d-flex flex-column gap-0" style="width:3.25rem"><span class="form-label small mb-0">Colour</span>
            <input type="color" id="edRubricColor" class="form-control form-control-color form-control-sm" value="${escapeAttr(b.rubricColor || '#8b1538')}"></label>
          <label class="d-flex flex-column gap-0" style="width:4.5rem"><span class="form-label small mb-0">Font pt</span>
            <input type="number" class="form-control form-control-sm" id="edRubricBodySize" min="6" max="36" step="0.5" value="${b.bodyFontSizePt || 11}"></label>
          <label class="d-flex flex-column gap-0" style="width:5rem"><span class="form-label small mb-0">Leading pt</span>
            <input type="number" class="form-control form-control-sm" id="edRubricLineHeight" min="6" max="50" step="0.5" value="${b.lineHeightPt || 16}"></label>
        </div>
        <label class="form-label small mb-0">Rubric text</label>
        ${richToolbarHtml('rubric-tb')}
        <div class="form-control form-control-sm booklet-rich-ed" contenteditable="true" id="edRichRubric"></div>
      `;
      const ed = panel.querySelector('#edRichRubric');
      ed.innerHTML = initialRichHtmlForEditor(b.text);
      const pushMeta = () => {
        var bs = parseFloat(panel.querySelector('#edRubricBodySize').value);
        b.bodyFontSizePt = Number.isFinite(bs) ? Math.min(36, Math.max(6, bs)) : 11;
        var lh = parseFloat(panel.querySelector('#edRubricLineHeight').value);
        b.lineHeightPt = Number.isFinite(lh) ? Math.min(50, Math.max(6, lh)) : 16;
        scheduleAutosave();
        markLayoutStale();
        renderBlockList();
      };
      panel.querySelector('#edRubricBodySize').addEventListener('input', pushMeta);
      panel.querySelector('#edRubricLineHeight').addEventListener('input', pushMeta);
      var rcInp = panel.querySelector('#edRubricColor');
      if (rcInp) rcInp.addEventListener('input', function () {
        var v = rcInp.value;
        b.rubricColor = /^#[0-9a-f]{6}$/i.test(v) ? v : '#8b1538';
        scheduleAutosave();
        markLayoutStale();
      });
      wireEditorSectionLayout(panel, b, true, false);
      const push = () => {
        b.text = ed.innerHTML;
        scheduleAutosave();
        markLayoutStale();
        renderBlockList();
      };
      bindRichToolbar(panel.querySelector('.rubric-tb'), ed, push);
    } else if (b.type === 'reading') {
      const split = b.parallelLeftPct != null ? b.parallelLeftPct : 50;
      const gap = b.parallelGapMm != null ? b.parallelGapMm : 4;
      panel.innerHTML = `
        ${editorLayoutPanelHtml(b, true, false)}
        <div class="row g-1 mb-1">
          <div class="col"><label class="form-label small mb-0">Section title <span class="text-muted">(opt.)</span></label>
            <input type="text" class="form-control form-control-sm" id="edReadSecTitle" value="${escapeAttr(b.sectionTitle || '')}" placeholder="Bold heading"></div>
          <div class="col-auto" style="width:4.5rem"><label class="form-label small mb-0">Size</label>
            <input type="number" class="form-control form-control-sm" id="edReadTitleSize" min="6" max="36" step="0.5" value="${b.titleFontSizePt || 11}"></div>
        </div>
        <div class="row g-1 mb-1">
          <div class="col"><label class="form-label small mb-0">Source ref <span class="text-muted">(opt.)</span></label>
            <input type="text" class="form-control form-control-sm" id="edReadSecSource" value="${escapeAttr(b.sectionSourceRef || '')}" placeholder="Italic, right"></div>
          <div class="col-auto" style="width:4.5rem"><label class="form-label small mb-0">Size</label>
            <input type="number" class="form-control form-control-sm" id="edReadSourceSize" min="6" max="36" step="0.5" value="${b.sourceFontSizePt || 9}"></div>
        </div>
        <div class="d-flex flex-wrap align-items-end gap-2 mb-1">
          <label class="d-flex flex-column gap-0" style="width:5rem"><span class="form-label small mb-0">Leading pt</span>
            <input type="number" class="form-control form-control-sm" id="edReadLineHeight" min="6" max="50" step="0.5" value="${b.lineHeightPt || 16}"></label>
        </div>
        <hr class="my-1"><div class="d-flex align-items-center gap-1 mb-1"><small class="fw-semibold text-muted">Original</small>
          <div class="form-check form-check-inline ms-2 mb-0">
            <input class="form-check-input" type="checkbox" id="chkDropCapOrig" ${b.dropCapOriginal ? 'checked' : ''}>
            <label class="form-check-label small" for="chkDropCapOrig">Drop cap</label>
          </div>
          <label class="ms-auto d-flex align-items-center gap-1"><small class="text-muted">pt</small>
            <input type="number" class="form-control form-control-sm" id="edReadOrigSize" min="6" max="36" step="0.5" value="${b.bodyFontSizePt || 11}" style="width:4rem"></label>
        </div>
        ${richToolbarHtml('read-tb-orig')}
        <div class="form-control form-control-sm booklet-rich-ed mb-1" contenteditable="true" id="edReadOrig"></div>
        <hr class="my-1"><div class="d-flex align-items-center gap-1 mb-1"><small class="fw-semibold text-muted">Translation</small><small class="text-muted">(parallel when filled)</small>
          <div class="form-check form-check-inline ms-2 mb-0">
            <input class="form-check-input" type="checkbox" id="chkDropCapTrans" ${b.dropCapTranslation ? 'checked' : ''}>
            <label class="form-check-label small" for="chkDropCapTrans">Drop cap</label>
          </div>
          <label class="ms-auto d-flex align-items-center gap-1"><small class="text-muted">pt</small>
            <input type="number" class="form-control form-control-sm" id="edReadTransSize" min="6" max="36" step="0.5" value="${b.translationFontSizePt || 11}" style="width:4rem"></label>
        </div>
        ${richToolbarHtml('read-tb-trans')}
        <div class="form-control form-control-sm booklet-rich-ed mb-1" contenteditable="true" id="edReadTrans"></div>
        <hr class="my-1">
        <div id="readParallelOpts" class="border rounded p-2 bg-light small">
          <div class="d-flex align-items-center gap-2 mb-1">
            <label class="form-label small mb-0">Column split <span class="text-muted">(original %)</span></label>
            <input type="number" class="form-control form-control-sm ms-auto" id="inpReadSplitNum" min="20" max="80" step="0.25" value="${split}" style="width:5rem">
          </div>
          <input type="range" class="form-range" id="rngReadSplit" min="20" max="80" step="0.25" value="${split}">
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
        var ts = parseFloat(panel.querySelector('#edReadTitleSize').value);
        b.titleFontSizePt = Number.isFinite(ts) ? Math.min(36, Math.max(6, ts)) : 11;
        var srs = parseFloat(panel.querySelector('#edReadSourceSize').value);
        b.sourceFontSizePt = Number.isFinite(srs) ? Math.min(36, Math.max(6, srs)) : 9;
        var lh = parseFloat(panel.querySelector('#edReadLineHeight').value);
        b.lineHeightPt = Number.isFinite(lh) ? Math.min(50, Math.max(6, lh)) : 16;
        var os = parseFloat(panel.querySelector('#edReadOrigSize').value);
        b.bodyFontSizePt = Number.isFinite(os) ? Math.min(36, Math.max(6, os)) : 11;
        var trs = parseFloat(panel.querySelector('#edReadTransSize').value);
        b.translationFontSizePt = Number.isFinite(trs) ? Math.min(36, Math.max(6, trs)) : 11;
        b.dropCapOriginal = !!panel.querySelector('#chkDropCapOrig')?.checked;
        b.dropCapTranslation = !!panel.querySelector('#chkDropCapTrans')?.checked;
        scheduleAutosave();
        markLayoutStale();
        renderBlockList();
      };
      rst.addEventListener('input', pushMetaRead);
      rss.addEventListener('input', pushMetaRead);
      panel.querySelector('#edReadTitleSize').addEventListener('input', pushMetaRead);
      panel.querySelector('#edReadSourceSize').addEventListener('input', pushMetaRead);
      panel.querySelector('#edReadLineHeight').addEventListener('input', pushMetaRead);
      panel.querySelector('#edReadOrigSize').addEventListener('input', pushMetaRead);
      panel.querySelector('#edReadTransSize').addEventListener('input', pushMetaRead);
      panel.querySelector('#chkDropCapOrig')?.addEventListener('change', pushMetaRead);
      panel.querySelector('#chkDropCapTrans')?.addEventListener('change', pushMetaRead);
      const push = () => {
        b.text = edO.innerHTML;
        b.translation = edT.innerHTML;
        scheduleAutosave();
        markLayoutStale();
        renderBlockList();
      };
      bindRichToolbar(panel.querySelector('.read-tb-orig'), edO, push);
      bindRichToolbar(panel.querySelector('.read-tb-trans'), edT, push);
      const rng = panel.querySelector('#rngReadSplit');
      const splitNum = panel.querySelector('#inpReadSplitNum');
      const chk = panel.querySelector('#chkReadBorder');
      const ig = panel.querySelector('#inpReadGap');
      const syncParallel = (source) => {
        var raw = parseFloat((source === 'num' ? splitNum : rng).value);
        b.parallelLeftPct = Number.isFinite(raw) ? Math.min(80, Math.max(20, raw)) : 50;
        if (source !== 'num' && splitNum) splitNum.value = b.parallelLeftPct;
        if (source !== 'rng' && rng) rng.value = b.parallelLeftPct;
        b.parallelBorder = !!chk.checked;
        let ggm = parseInt(ig.value, 10);
        if (!Number.isFinite(ggm)) {
          ggm = b.parallelGapMm != null ? b.parallelGapMm : 4;
        }
        b.parallelGapMm = Math.min(20, Math.max(0, ggm));
        scheduleAutosave();
        markLayoutStale();
      };
      rng.addEventListener('input', function() { syncParallel('rng'); });
      splitNum.addEventListener('change', function() { syncParallel('num'); });
      chk.addEventListener('change', function() { syncParallel(); });
      ig.addEventListener('input', function() { syncParallel(); });
      wireEditorSectionLayout(panel, b, true, false);
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
        markLayoutStale();
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
        markLayoutStale();
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
        markLayoutStale();
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
      const chs = b.chantHorizSpacing != null ? b.chantHorizSpacing : 1.0;
      const cvs = b.chantVertSpacing != null ? b.chantVertSpacing : 1.0;
      const clg = b.chantLineGap != null ? b.chantLineGap : 1.0;
      const cd = b.chantDropCapScale != null ? b.chantDropCapScale : 1;
      const cas = b.chantAnnotationSizeAdj != null ? b.chantAnnotationSizeAdj : 0;
      const cay = b.chantAnnotationYAdj != null ? b.chantAnnotationYAdj : 0;
      const csc = String(b.chantStaffColor || '').trim();
      const cscVal = /^#[0-9a-f]{6}$/i.test(csc) ? csc : '#000000';
      const crc = String(b.chantRubricColor || '').trim();
      const crcVal = /^#[0-9a-f]{6}$/i.test(crc) ? crc : '#000000';
      const clang = b.chantLyricLanguage === 'english' ? 'english' : 'latin';
      const ctSplit = b.chantTranslationLeftPct != null ? b.chantTranslationLeftPct : 60;
      const ctGap = b.chantTranslationGapMm != null ? b.chantTranslationGapMm : 4;
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
            <div class="d-flex align-items-center mb-1"><span style="min-width:5.5rem">Lyric size</span><span class="text-muted me-1" style="min-width:2rem;text-align:right" data-chant-val="chantNeumeSize">${cn}</span><input type="range" class="form-range flex-grow-1 ms-1" data-chant-num="chantNeumeSize" min="8" max="40" step="1" value="${cn}"></div>
            <div class="d-flex align-items-center mb-1"><span style="min-width:5.5rem">Music scale</span><span class="text-muted me-1" style="min-width:2rem;text-align:right" data-chant-val="chantGlyphScale">${cg}</span><input type="range" class="form-range flex-grow-1 ms-1" data-chant-num="chantGlyphScale" min="0.5" max="3.0" step="0.05" value="${cg}"></div>
            <div class="d-flex align-items-center mb-1"><span style="min-width:5.5rem">Horiz. spacing</span><span class="text-muted me-1" style="min-width:2rem;text-align:right" data-chant-val="chantHorizSpacing">${chs}</span><input type="range" class="form-range flex-grow-1 ms-1" data-chant-num="chantHorizSpacing" min="0.5" max="2.0" step="0.05" value="${chs}"></div>
            <div class="d-flex align-items-center mb-1"><span style="min-width:5.5rem">Staff spacing</span><span class="text-muted me-1" style="min-width:2rem;text-align:right" data-chant-val="chantVertSpacing">${cvs}</span><input type="range" class="form-range flex-grow-1 ms-1" data-chant-num="chantVertSpacing" min="0.5" max="2.0" step="0.05" value="${cvs}"></div>
            <div class="d-flex align-items-center mb-1"><span style="min-width:5.5rem">Line gap</span><span class="text-muted me-1" style="min-width:2rem;text-align:right" data-chant-val="chantLineGap">${clg}</span><input type="range" class="form-range flex-grow-1 ms-1" data-chant-num="chantLineGap" min="0.0" max="3.0" step="0.05" value="${clg}"></div>
            <div class="d-flex align-items-center mb-1"><span style="min-width:5.5rem">Drop cap scale</span><span class="text-muted me-1" style="min-width:2rem;text-align:right" data-chant-val="chantDropCapScale">${cd}</span><input type="range" class="form-range flex-grow-1 ms-1" data-chant-num="chantDropCapScale" min="0.3" max="2.0" step="0.05" value="${cd}"></div>
            <div class="d-flex align-items-center mb-1"><span style="min-width:5.5rem">Annot. size adj.</span><input type="number" class="form-control form-control-sm ms-auto" style="width:4rem" data-chant-num="chantAnnotationSizeAdj" step="1" value="${cas}"></div>
            <div class="d-flex align-items-center mb-1"><span style="min-width:5.5rem">Annot. vert. pos.</span><input type="number" class="form-control form-control-sm ms-auto" style="width:4rem" data-chant-num="chantAnnotationYAdj" step="1" value="${cay}"></div>
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
        <div class="row g-1 mb-0 mt-2">
          <div class="col"><label class="form-label small mb-0">Translation <span class="text-muted">(one line per chant system; *bold* _italic_)</span></label></div>
          <div class="col-auto" style="width:5.5rem"><label class="form-label small mb-0">Font pt</label>
            <input type="number" class="form-control form-control-sm" id="edChantTransSize" step="0.5" value="${b.chantTranslationFontSizePt || 11}"></div>
        </div>
        <textarea class="form-control form-control-sm font-monospace mb-2" rows="4" id="edChantTrans">${escapeHtml(b.chantTranslation || '')}</textarea>
        <div id="chantParallelOpts" class="border rounded p-2 bg-light small">
          <label class="form-label small mb-1">Column split <span class="text-muted">(chant width %)</span></label>
          <input type="range" class="form-range" id="rngChantSplit" min="20" max="80" step="1" value="${ctSplit}">
          <div class="d-flex justify-content-between"><span>20%</span><span id="chantSplitVal">${ctSplit}%</span><span>80%</span></div>
          <div class="form-check mt-2">
            <input class="form-check-input" type="checkbox" id="chkChantBorder" ${b.chantTranslationBorder ? 'checked' : ''}>
            <label class="form-check-label" for="chkChantBorder">Vertical line between columns</label>
          </div>
          <label class="form-label small mb-0 mt-2">Space between columns (mm)</label>
          <input type="number" class="form-control form-control-sm" id="inpChantGap" min="0" max="20" value="${ctGap}">
          <label class="form-label small mb-0 mt-2">Translation vert. align</label>
          <select id="selChantTransVAlign" class="form-select form-select-sm">
            <option value="middle"${(b.chantTranslationVAlign || 'middle') === 'middle' ? ' selected' : ''}>Middle</option>
            <option value="top"${b.chantTranslationVAlign === 'top' ? ' selected' : ''}>Top</option>
            <option value="bottom"${b.chantTranslationVAlign === 'bottom' ? ' selected' : ''}>Bottom</option>
          </select>
          <label class="form-label small mb-0 mt-2">Translation text align</label>
          <select id="selChantTransTextAlign" class="form-select form-select-sm">
            <option value="left"${(b.chantTranslationTextAlign || 'left') === 'left' ? ' selected' : ''}>Left</option>
            <option value="right"${b.chantTranslationTextAlign === 'right' ? ' selected' : ''}>Right</option>
            <option value="justify"${b.chantTranslationTextAlign === 'justify' ? ' selected' : ''}>Justify</option>
          </select>
        </div>
      `;
      const ta = panel.querySelector('#edGabc');
      ta.addEventListener('input', () => {
        b.gabc = ta.value;
        scheduleAutosave();
        markLayoutStale();
        renderBlockList();
      });
      wireEditorSectionLayout(panel, b, true, false);
      var chkUseDropCap = panel.querySelector('#edChantUseDropCap');
      chkUseDropCap?.addEventListener('change', function () {
        b.chantUseDropCap = !!chkUseDropCap.checked;
        scheduleAutosave();
        markLayoutStale();
        renderBlockList();
      });
      panel.querySelector('#edChantLyricLang')?.addEventListener('change', function () {
        b.chantLyricLanguage =
          panel.querySelector('#edChantLyricLang').value === 'english' ? 'english' : 'latin';
        scheduleAutosave();
        markLayoutStale();
        renderBlockList();
      });
      panel.querySelectorAll('[data-chant-num]').forEach(function (inp) {
        var prop = inp.dataset.chantNum;
        var valSpan = panel.querySelector('[data-chant-val="' + prop + '"]');
        var handler = function () {
          var v = parseFloat(inp.value);
          if (Number.isFinite(v)) {
            var mn = parseFloat(inp.min), mx = parseFloat(inp.max);
            if (Number.isFinite(mn)) v = Math.max(mn, v);
            if (Number.isFinite(mx)) v = Math.min(mx, v);
            b[prop] = v;
            inp.value = b[prop];
            if (valSpan) valSpan.textContent = b[prop];
          }
          scheduleAutosave();
          markLayoutStale();
          renderBlockList();
        };
        inp.addEventListener('input', handler);
        inp.addEventListener('change', handler);
      });
      panel.querySelector('#edChantStaff')?.addEventListener('input', () => {
        const cv = panel.querySelector('#edChantStaff').value;
        b.chantStaffColor = /^#[0-9a-f]{6}$/i.test(cv) ? cv : '';
        scheduleAutosave();
        markLayoutStale();
        renderBlockList();
      });
      panel.querySelector('#edChantStaffDef')?.addEventListener('click', () => {
        b.chantStaffColor = '';
        scheduleAutosave();
        markLayoutStale();
        renderBlockList();
      });
      panel.querySelector('#edChantRubric')?.addEventListener('input', () => {
        const cv = panel.querySelector('#edChantRubric').value;
        b.chantRubricColor = /^#[0-9a-f]{6}$/i.test(cv) ? cv : '';
        scheduleAutosave();
        markLayoutStale();
        renderBlockList();
      });
      panel.querySelector('#edChantRubricDef')?.addEventListener('click', () => {
        b.chantRubricColor = '';
        const inp = panel.querySelector('#edChantRubric');
        if (inp) inp.value = '#000000';
        scheduleAutosave();
        markLayoutStale();
        renderBlockList();
      });
      const edChantTrans = panel.querySelector('#edChantTrans');
      if (edChantTrans) {
        edChantTrans.addEventListener('input', () => {
          b.chantTranslation = edChantTrans.value;
          scheduleAutosave();
          markLayoutStale();
          renderBlockList();
        });
        panel.querySelector('#edChantTransSize')?.addEventListener('input', () => {
          var ts = parseFloat(panel.querySelector('#edChantTransSize').value);
          b.chantTranslationFontSizePt = Number.isFinite(ts) ? ts : 11;
          scheduleAutosave();
          markLayoutStale();
          renderBlockList();
        });
        const ctRng = panel.querySelector('#rngChantSplit');
        const ctRv = panel.querySelector('#chantSplitVal');
        const ctChk = panel.querySelector('#chkChantBorder');
        const ctIg = panel.querySelector('#inpChantGap');
        const syncChantParallel = () => {
          b.chantTranslationLeftPct = parseInt(ctRng.value, 10) || 60;
          if (ctRv) ctRv.textContent = b.chantTranslationLeftPct + '%';
          b.chantTranslationBorder = !!ctChk.checked;
          let ggm = parseInt(ctIg.value, 10);
          if (!Number.isFinite(ggm)) {
            ggm = b.chantTranslationGapMm != null ? b.chantTranslationGapMm : 4;
          }
          b.chantTranslationGapMm = Math.min(20, Math.max(0, ggm));
          scheduleAutosave();
          markLayoutStale();
          renderBlockList();
        };
        ctRng.addEventListener('input', syncChantParallel);
        ctChk.addEventListener('change', syncChantParallel);
        ctIg.addEventListener('input', syncChantParallel);
        const ctVA = panel.querySelector('#selChantTransVAlign');
        const ctTA = panel.querySelector('#selChantTransTextAlign');
        const syncTransAlign = () => {
          b.chantTranslationVAlign = ctVA.value || 'middle';
          b.chantTranslationTextAlign = ctTA.value || 'left';
          scheduleAutosave();
          markLayoutStale();
          renderBlockList();
        };
        ctVA.addEventListener('change', syncTransAlign);
        ctTA.addEventListener('change', syncTransAlign);
      }
    } else if (b.type === 'jgabc_propers') {
      panel.innerHTML =
        '<p class="small text-muted">Replace this block with <strong>Chant (paste GABC)</strong> or reload after migration.</p>';
    }
  }

  function addBlock(type, insertIndex) {
    const b = { id: uid(), type };
    if (type === 'rubric') {
      b.text = '';
      b.sectionTitle = '';
      b.sectionSourceRef = '';
      b.rubricColor = '#8b1538';
      b.bodyFontSizePt = 11;
      b.lineHeightPt = 16;
      b.titleFontSizePt = 11;
      b.sourceFontSizePt = 9;
    }
    if (type === 'reading') {
      b.text = '';
      b.translation = '';
      b.parallelLeftPct = 50;
      b.parallelBorder = false;
      b.parallelGapMm = 4;
      b.sectionTitle = '';
      b.sectionSourceRef = '';
      b.bodyFontSizePt = 11;
      b.translationFontSizePt = 11;
      b.lineHeightPt = 16;
      b.titleFontSizePt = 11;
      b.sourceFontSizePt = 9;
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
      b.chantHorizSpacing = 1.0;
      b.chantVertSpacing = 1.0;
      b.chantLineGap = 1.0;
      b.chantDropCapScale = 1;
      b.chantUseDropCap = true;
      b.chantLyricLanguage = 'latin';
      b.chantTextFont = 'crimson';
      b.chantRubricColor = '';
      b.chantAnnotationSizeAdj = 0;
      b.chantAnnotationYAdj = 0;
      b.chantTranslation = '';
      b.chantTranslationLeftPct = 60;
      b.chantTranslationGapMm = 4;
      b.chantTranslationBorder = false;
      b.chantTranslationFontSizePt = 11;
      b.chantTranslationVAlign = 'middle';
      b.chantTranslationTextAlign = 'left';
    }
    if (type === 'spacer') {
      b.heightMm = 10;
    }
    if (type === 'hr') {
      b.hrLineColor = '#adb5bd';
    }
    if (type !== 'page_break' && type !== 'spacer' && type !== 'hr') {
      b.hidden = false;
    } else {
      b.hidden = false;
    }
    if (type === 'rubric' || type === 'reading') {
      b.fontScale = DEFAULT_BLOCK_FONT_SCALE;
    }
    if (insertIndex != null && insertIndex >= 0 && insertIndex <= state.blocks.length) {
      state.blocks.splice(insertIndex, 0, b);
    } else {
      state.blocks.push(b);
    }
    selectedBlockId = b.id;
    var edP = document.getElementById('bookletEditorPane');
    if (edP) edP.classList.remove('booklet-pane-editor--collapsed');
    scheduleAutosave();
    renderBlockList();
    renderEditor();
    markLayoutStale();
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
            markLayoutStale();
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
    markLayoutStale();
  }

  function removeSelectedBlock() {
    if (!selectedBlockId) return;
    state.blocks = state.blocks.filter((x) => x.id !== selectedBlockId);
    selectedBlockId = null;
    scheduleAutosave();
    renderBlockList();
    renderEditor();
    markLayoutStale();
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
      '--booklet-margin-left-mm',
      '--booklet-margin-right-mm',
      '--booklet-margin-top-mm',
      '--booklet-margin-bottom-mm',
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
   * Full HTML document for headless Chromium. Google Font <link> tags injected
   * by loadGoogleFont() are automatically picked up, so preview and PDF use
   * the exact same typefaces — no system-font dependency on the server.
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
        body: JSON.stringify({ html: mh.html, pageSize: state.settings.pageSize === 'A5' ? 'A5' : 'A4', manifest: mh.manifest, title: state.projectTitle || '' }),
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

    var blockListEl = document.getElementById('blockList');
    if (blockListEl) {
      blockListEl.addEventListener('mousedown', function (e) {
        if (e.target.closest('.booklet-insert-menu')) return;
        var active = document.activeElement;
        if (active && active.getAttribute('contenteditable') === 'true' && !blockListEl.contains(active)) {
          _blockListRenderSuppressed = true;
          active.blur();
          setTimeout(function () {
            _blockListRenderSuppressed = false;
            if (_blockListRenderPending) {
              _blockListRenderPending = false;
              renderBlockList();
            }
          }, 300);
        }
      });
      blockListEl.addEventListener('dragover', function (ev) {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'move';
        blockListEl.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(function (d) {
          d.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        blockListEl.querySelectorAll('.booklet-insert-zone.drag-over-zone').forEach(function (d) {
          d.classList.remove('drag-over-zone');
        });

        var zone = ev.target.closest('.booklet-insert-zone');
        if (zone) {
          zone.classList.add('drag-over-zone');
          return;
        }

        var target = ev.target.closest('.block-list-item');
        if (target && !target.classList.contains('dragging')) {
          var row = target.closest('.booklet-block-row');
          if (!row) return;
          var rect = target.getBoundingClientRect();
          var midY = rect.top + rect.height / 2;
          var adjacentZone = ev.clientY < midY ? row.previousElementSibling : row.nextElementSibling;
          if (adjacentZone && adjacentZone.classList.contains('booklet-insert-zone')) {
            adjacentZone.classList.add('drag-over-zone');
          } else if (ev.clientY < midY) {
            target.classList.add('drag-over-top');
          } else {
            target.classList.add('drag-over-bottom');
          }
        }
      });

      blockListEl.addEventListener('drop', function (ev) {
        ev.preventDefault();
        var draggedId = ev.dataTransfer.getData('text/plain');
        if (!draggedId) return;
        var fromIdx = state.blocks.findIndex(function (x) { return x.id === draggedId; });
        if (fromIdx < 0) return;

        var toIdx = -1;
        var zone = ev.target.closest('.booklet-insert-zone');
        if (zone) {
          toIdx = parseInt(zone.dataset.insertIdx, 10);
        } else {
          var target = ev.target.closest('.block-list-item');
          if (!target || target.classList.contains('dragging')) return;
          var row = target.closest('.booklet-block-row');
          if (!row) return;
          var rect = target.getBoundingClientRect();
          var midY = rect.top + rect.height / 2;
          var adjacentZone = ev.clientY < midY ? row.previousElementSibling : row.nextElementSibling;
          if (adjacentZone && adjacentZone.classList.contains('booklet-insert-zone') && adjacentZone.dataset.insertIdx != null) {
            toIdx = parseInt(adjacentZone.dataset.insertIdx, 10);
          } else {
            var targetId = target.dataset.blockId;
            if (!targetId || draggedId === targetId) return;
            toIdx = state.blocks.findIndex(function (x) { return x.id === targetId; });
            if (toIdx < 0) return;
            if (ev.clientY >= midY) toIdx = Math.min(toIdx + 1, state.blocks.length);
          }
        }

        if (isNaN(toIdx) || toIdx < 0) return;
        var moved = state.blocks.splice(fromIdx, 1)[0];
        if (fromIdx < toIdx) toIdx--;
        state.blocks.splice(toIdx, 0, moved);
        scheduleAutosave();
        renderBlockList();
        markLayoutStale();
      });
    }

    document.getElementById('selPageSize')?.addEventListener('change', (e) => {
      state.settings.pageSize = e.target.value;
      scheduleAutosave();
      scheduleRenderPreview();
    });
    document.getElementById('btnGroupPreviewDisplay')?.addEventListener('click', (e) => {
      var btn = e.target.closest('[data-view]');
      if (!btn) return;
      var mode = btn.getAttribute('data-view');
      state.settings.previewDisplay = mode === 'booklet' ? 'booklet' : 'scroll';
      syncControlsFromState();
      scheduleAutosave();
      switchDisplayMode();
    });
    var layoutPanel = document.getElementById('layoutSettingsPanel');
    var layoutBtn = document.getElementById('btnLayoutToggle');
    if (layoutPanel && layoutBtn) {
      layoutPanel.addEventListener('shown.bs.collapse', function() { layoutBtn.classList.add('active'); });
      layoutPanel.addEventListener('hidden.bs.collapse', function() { layoutBtn.classList.remove('active'); });
    }
    document.getElementById('inpProjectTitle')?.addEventListener('input', (e) => {
      state.projectTitle = e.target.value;
      scheduleAutosave();
    });
    document.getElementById('selBookletFont')?.addEventListener('change', (e) => {
      const k = e.target.value.trim();
      state.settings.fontFamilyKey = k || BOOKLET_DEFAULT_FONT;
      applyCssVars();
      scheduleAutosave();
      markLayoutStale();
    });
    
    function bindLayoutSetting(id, key, min, max, fallback) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', function () {
        var raw = parseFloat(String(el.value).trim().replace(',', '.'));
        state.settings[key] = Number.isFinite(raw) ? Math.min(max, Math.max(min, Math.round(raw))) : fallback;
        el.value = String(state.settings[key]);
        applyCssVars();
        scheduleAutosave();
        markLayoutStale();
      });
    }
    bindLayoutSetting('inpMarginTop', 'marginTopMm', 4, 50, DEFAULT_BOOKLET_MARGIN_MM);
    bindLayoutSetting('inpMarginBottom', 'marginBottomMm', 4, 50, DEFAULT_BOOKLET_MARGIN_MM);
    bindLayoutSetting('inpMarginLeft', 'marginLeftMm', 4, 50, DEFAULT_BOOKLET_MARGIN_MM);
    bindLayoutSetting('inpMarginRight', 'marginRightMm', 4, 50, DEFAULT_BOOKLET_MARGIN_MM);
    bindLayoutSetting('inpSectionGap', 'sectionGapMm', 0, 40, DEFAULT_SECTION_GAP_AFTER_MM);
    bindLayoutSetting('inpGapTolerance', 'gapTolerancePx', 0, 20, GAP_FLEX_PX);
    bindLayoutSetting('inpMarginTolerance', 'marginTolerancePx', 0, 30, MARGIN_TOLERANCE_PX);
    bindLayoutSetting('inpOrphanLines', 'minOrphanLines', 1, 10, 3);
    bindLayoutSetting('inpDescClipPx', 'descClipPx', 0, 10, 3);
    bindLayoutSetting('inpAscClipPx', 'ascClipPx', 0, 10, 3);
    (function() {
      var dcEl = document.getElementById('inpDropCapOffset');
      if (!dcEl) return;
      dcEl.addEventListener('change', function () {
        var raw = parseFloat(String(dcEl.value).trim().replace(',', '.'));
        state.settings.dropCapOffsetEm = Number.isFinite(raw) ? Math.min(0.5, Math.max(-0.2, raw)) : 0.05;
        dcEl.value = String(state.settings.dropCapOffsetEm);
        applyCssVars();
        scheduleAutosave();
        markLayoutStale();
      });
    })();

    
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

    (function bindNewProject() {
      var modalEl = document.getElementById('modalNewProject');
      if (!modalEl) return;
      var modal = new bootstrap.Modal(modalEl);

      document.getElementById('btnNewProject')?.addEventListener('click', function () {
        if (hasUnsavedWork()) {
          modal.show();
        } else {
          resetToNewProject();
        }
      });

      document.getElementById('btnNewProjectDiscard')?.addEventListener('click', function () {
        modal.hide();
        resetToNewProject();
      });

      document.getElementById('btnNewProjectSave')?.addEventListener('click', async function () {
        modal.hide();
        await downloadJson();
        resetToNewProject();
      });
    })();
    document.getElementById('btnRefreshLayout')?.addEventListener('click', () => {
      scheduleRenderPreview();
    });
    document.getElementById('chkAutoRefresh')?.addEventListener('change', function () {
      autoRefresh = !!this.checked;
    });
    document.getElementById('chkDebugLayout')?.addEventListener('change', function () {
      var pp = document.getElementById('previewPages');
      if (pp) {
        if (this.checked) pp.classList.add('booklet-debug');
        else pp.classList.remove('booklet-debug');
      }
    });

    function setupPaneCollapse(collapseId, paneId, collapsedClass, expandSide) {
      var btn = document.getElementById(collapseId);
      var pane = document.getElementById(paneId);
      if (!btn || !pane) return;
      var expandBtn = null;
      btn.addEventListener('click', function () {
        pane.classList.add(collapsedClass);
        if (!expandBtn) {
          expandBtn = document.createElement('button');
          expandBtn.type = 'button';
          expandBtn.className = 'booklet-pane-expand-btn';
          expandBtn.title = 'Expand pane';
          expandBtn.innerHTML = expandSide === 'left'
            ? '<i class="bi bi-chevron-bar-right"></i>'
            : '<i class="bi bi-chevron-bar-left"></i>';
          expandBtn.addEventListener('click', function () {
            pane.classList.remove(collapsedClass);
            expandBtn.remove();
            var host = document.querySelector('.booklet-spread-host');
            if (host) setTimeout(function () { scaleBookletSpread(host); }, 100);
          });
        }
        var preview = document.querySelector('.booklet-pane-preview');
        if (expandSide === 'left' && preview) {
          preview.insertBefore(expandBtn, preview.firstChild);
        } else if (preview) {
          preview.appendChild(expandBtn);
        }
        var host = document.querySelector('.booklet-spread-host');
        if (host) setTimeout(function () { scaleBookletSpread(host); }, 100);
      });
    }
    setupPaneCollapse('btnCollapseList', 'bookletSidebar', 'booklet-pane-list--collapsed', 'left');

    var closeEdBtn = document.getElementById('btnCloseEditor');
    var edPane = document.getElementById('bookletEditorPane');
    if (closeEdBtn && edPane) {
      closeEdBtn.addEventListener('click', function () {
        edPane.classList.add('booklet-pane-editor--collapsed');
        selectedBlockId = null;
        renderBlockList();
        var host = document.querySelector('.booklet-spread-host');
        if (host) setTimeout(function () { scaleBookletSpread(host); }, 100);
      });
    }
  }

  loadAutosave();
  applyCssVars();
  syncControlsFromState();
  bindUi();
  renderBlockList();
  renderEditor();
  scheduleRenderPreview();
})();
