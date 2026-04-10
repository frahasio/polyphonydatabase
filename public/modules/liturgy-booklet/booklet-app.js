(function () {
  'use strict';

  const SCHEMA_VERSION = 7;
  const STORAGE_KEY = 'liturgyBooklet_autosave_v7';
  const BOOKLET_MARGIN_MM = 16;
  const DEFAULT_SECTION_GAP_AFTER_MM = 8;
  const DEFAULT_BLOCK_FONT_SCALE = 1;
  /** Extra vertical room when packing pages (measurement vs rendered chant lines). */
  const BOOKLET_PAGE_PACK_SLACK_PX = 14;

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
    inner.style.display = 'flex';
    inner.style.flexDirection = 'column';
    inner.style.minHeight = '100%';
    const old = inner.querySelector('.booklet-export-footer');
    if (old) old.remove();
    const footer = document.createElement('div');
    footer.className = 'booklet-export-footer';
    footer.style.marginTop = 'auto';
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

  function applyCssVars() {
    const root = document.documentElement;
    root.style.setProperty('--booklet-margin-mm', String(BOOKLET_MARGIN_MM));
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
    return Math.max(200, mmToPx(pageW - 2 * BOOKLET_MARGIN_MM));
  }

  function getMaxPageBodyHeightPx() {
    const pageH = state.settings.pageSize === 'A5' ? 210 : 297;
    return Math.max(120, mmToPx(pageH - 2 * BOOKLET_MARGIN_MM));
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
      if (tag === 'p' || tag === 'div') {
        const st = node.getAttribute('style') || '';
        const am = st.match(/text-align\s*:\s*([^;]+)/i);
        let ta = '';
        if (am) {
          const v = am[1].trim().toLowerCase();
          if (v === 'left' || v === 'right' || v === 'center' || v === 'justify') ta = v;
        }
        if (ta) {
          const el = document.createElement(tag);
          el.setAttribute('style', 'text-align:' + ta);
          appendChildren(el, node);
          return el;
        }
        const f = document.createDocumentFragment();
        appendChildren(f, node);
        return f;
      }
      if (tag === 'font') {
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
      return { icon: 'bi-chat-square-text', color: '#8b1538', label: 'Rubric' };
    }
    if (t === 'reading') {
      return { icon: 'bi-text-paragraph', color: '#0d6efd', label: 'Reading / prayer' };
    }
    if (t === 'chant_gabc') {
      return { icon: 'bi-music-note-beamed', color: '#6f42c1', label: 'Chant (GABC)' };
    }
    if (t === 'image') {
      return { icon: 'bi-image', color: '#198754', label: 'Image' };
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
      return parts.length ? parts.join(' · ') : 'Empty reading';
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
    if (b.type === 'page_break') {
      return 'Page break';
    }
    if (b.type === 'jgabc_propers') {
      return 'Legacy propers — replace with GABC';
    }
    return String(b.type || '');
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
          } else if (
            cmd === 'justifyLeft' ||
            cmd === 'justifyCenter' ||
            cmd === 'justifyRight' ||
            cmd === 'justifyFull'
          ) {
            document.execCommand(cmd, false, null);
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

  function makeBookletChantContext(chantBlock) {
    const b = chantBlock || {};
    var ctxt = new exsurge.ChantContext(exsurge.TextMeasuringStrategy.Canvas);
    ctxt.condenseLineAmount = 1;
    ctxt.setGlyphScaling(1 / 16);
    const neumePx = Math.min(28, Math.max(12, Number(b.chantNeumeSize) || 19.2));
    const tfk = normalizeChantTextFontKey(b.chantTextFont);
    ctxt.setFont(CHANT_TEXT_FONT_STACKS[tfk], neumePx / 0.9);
    ctxt.spaceBetweenSystems = Math.min(24, Math.max(0, Number(b.chantSystemGap) || 4));
    const dropCapScale = Math.min(1.6, Math.max(0.5, Number(b.chantDropCapScale) || 1));
    ctxt.textStyles.dropCap.size = Math.round((neumePx / 19.2) * 64 * dropCapScale);
    ctxt.textStyles.annotation.size = Math.round((neumePx / 19.2) * 12.8);
    const tight = Math.min(1.5, Math.max(0.35, Number(b.chantLyricTight) || 0.7));
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
    delete settings.marginMm;
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

  function normalizeBlocksV7(blocks, legSettings, applyLegacySpacingAndChant) {
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
          o.sectionGapAfterMm = Math.min(30, Math.max(0, Number(o.sectionGapAfterMm)));
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
        o.sectionGapAfterMm = Math.min(30, Math.max(0, Number(o.sectionGapAfterMm)));
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
            ? Math.min(28, Math.max(12, Number(o.chantNeumeSize)))
            : Math.min(28, Math.max(12, Number(cd.chantNeumeSize) || 19.2));
        o.chantStaffColor = o.chantStaffColor != null ? String(o.chantStaffColor) : cd.chantStaffColor || '';
        o.chantLinePadTop =
          o.chantLinePadTop != null
            ? Math.min(20, Math.max(0, Number(o.chantLinePadTop)))
            : Math.min(20, Math.max(0, Number(cd.chantLinePadTop) || 6));
        o.chantLyricTight =
          o.chantLyricTight != null
            ? Math.min(1.5, Math.max(0.35, Number(o.chantLyricTight)))
            : Math.min(1.5, Math.max(0.35, Number(cd.chantLyricTight) || 0.7));
        o.chantSystemGap =
          o.chantSystemGap != null
            ? Math.min(24, Math.max(0, Number(o.chantSystemGap)))
            : Math.min(24, Math.max(0, Number(cd.chantSystemGap) || 4));
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
      if (o.type === 'image' && o.label === undefined) o.label = '';
      return o;
    });
  }

  function finalizeProjectV7(parsed, applyLegacySpacingAndChant) {
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
    parsed.blocks = normalizeBlocksV7(parsed.blocks, parsed.settings, applyLegacySpacingAndChant);
    return parsed;
  }

  function migrateProject(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    const v = parsed.schemaVersion || 1;
    if (v >= SCHEMA_VERSION) {
      return finalizeProjectV7(parsed, false);
    }
    const applyLegacy = true;
    if (v === 6) {
      return finalizeProjectV7(parsed, applyLegacy);
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
      return finalizeProjectV7(parsed, applyLegacy);
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
      return finalizeProjectV7(parsed, applyLegacy);
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
      return finalizeProjectV7(parsed, applyLegacy);
    }
    if (v === 2) {
      parsed.projectTitle = '';
      parsed.settings = parsed.settings || {};
      parsed.settings.previewDisplay = 'scroll';
      parsed.settings.fontFamilyKey = 'georgia';
      parsed.settings.rubricColor = '#8b1538';
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
      return finalizeProjectV7(parsed, applyLegacy);
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
      return finalizeProjectV7(parsed, applyLegacy);
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
      const padTop = Math.min(20, Math.max(0, Number(cb.chantLinePadTop) || 6));
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
      const maxBodyPx = getMaxPageBodyHeightPx();
      const marginPx = mmToPx(BOOKLET_MARGIN_MM);
      const bleedWidthPx = widthPx + 2 * marginPx;
      for (let pNum = first; pNum <= last; pNum++) {
        const page = await pdf.getPage(pNum);
        const base = page.getViewport({ scale: 1 });
        const scale = bleedWidthPx / base.width;
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const img = document.createElement('img');
        img.src = canvas.toDataURL('image/png');
        img.alt = 'PDF page ' + pNum;
        img.style.objectPosition = 'top center';
        const unit = document.createElement('div');
        unit.className = 'booklet-pdf-page-unit booklet-pdf-bleed';
        unit.style.height = maxBodyPx + 'px';
        unit.style.maxHeight = maxBodyPx + 'px';
        unit.style.overflow = 'hidden';
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

  function blockSectionGapAfterMm(b) {
    const g = Number(b.sectionGapAfterMm);
    return Number.isFinite(g) ? Math.min(30, Math.max(0, g)) : DEFAULT_SECTION_GAP_AFTER_MM;
  }

  async function buildFlowList() {
    const w = getContentWidthPx();
    const out = [];
    for (const b of state.blocks) {
      if (b.hidden) continue;
      if (b.type === 'page_break') {
        out.push({ t: 'break' });
        continue;
      }
      const gapAfter = blockSectionGapAfterMm(b);
      if (b.type === 'chant_gabc') {
        const lines = renderChantGabcToLines(b.gabc || '', w, b);
        const last = lines.length - 1;
        lines.forEach(function (el, i) {
          const isLast = i === last;
          out.push({
            t: 'line',
            el: el,
            internalLineBreak: !isLast,
            afterInternalPx: 3,
            sectionGapAfterMm: isLast ? gapAfter : undefined,
          });
        });
        continue;
      }
      if (b.type === 'edition_pdf') {
        const units = await renderEditionPageUnits(b, w);
        const uLast = units.length - 1;
        units.forEach(function (el, i) {
          const isLast = i === uLast;
          out.push({
            t: 'flow',
            el: el,
            internalLineBreak: !isLast,
            afterInternalPx: 2,
            sectionGapAfterMm: isLast ? gapAfter : undefined,
          });
        });
        continue;
      }
      out.push({
        t: 'flow',
        el: buildStaticSectionEl(b),
        sectionGapAfterMm: gapAfter,
      });
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
    const maxH = getMaxPageBodyHeightPx() + BOOKLET_PAGE_PACK_SLACK_PX;
    const defaultGapMm = DEFAULT_SECTION_GAP_AFTER_MM;
    const gapLine = 3;
    const pages = [];
    let page = [];
    let curH = 0;
    let lastWasLine = false;
    let pendingGapMm = defaultGapMm;

    function flush() {
      if (page.length) pages.push(page);
      page = [];
      curH = 0;
      lastWasLine = false;
    }

    for (const it of items) {
      if (it.t === 'break') {
        flush();
        pendingGapMm = defaultGapMm;
        continue;
      }
      const isLine = it.t === 'line';
      const el = it.el;
      const h = measureElHeight(el, widthPx);
      let gap = 0;
      if (page.length) {
        if (isLine && lastWasLine && it.internalLineBreak) {
          gap = it.afterInternalPx != null ? it.afterInternalPx : gapLine;
        } else {
          gap = mmToPx(pendingGapMm);
        }
      }
      if (page.length && curH + gap + h > maxH) {
        flush();
        page.push(el);
        curH = h;
        lastWasLine = isLine;
        if (!it.internalLineBreak) {
          pendingGapMm = it.sectionGapAfterMm != null ? it.sectionGapAfterMm : defaultGapMm;
        }
        continue;
      }
      if (page.length) curH += gap;
      page.push(el);
      curH += h;
      lastWasLine = isLine;
      if (!it.internalLineBreak) {
        pendingGapMm = it.sectionGapAfterMm != null ? it.sectionGapAfterMm : defaultGapMm;
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

  function cloneSpreadPageOrNull(pageDivs, numReal, idx) {
    if (idx >= 0 && idx < numReal) return pageDivs[idx].cloneNode(true);
    return null;
  }

  /**
   * Spread clones sometimes report tiny heights before SVG/text layout; prefer #bookletPageStore
   * source pages when data-booklet-page-source-index is set.
   */
  function spreadPageNaturalSize(pg) {
    const store = document.getElementById('bookletPageStore');
    const idxStr = pg.dataset.bookletPageSourceIndex;
    if (store && idxStr != null && idxStr !== '') {
      const i = parseInt(idxStr, 10);
      if (!isNaN(i) && i >= 0 && i < store.children.length) {
        const src = store.children[i];
        if (src && src.classList && src.classList.contains('booklet-page')) {
          const br = src.getBoundingClientRect();
          return {
            w: Math.max(1, src.offsetWidth, src.scrollWidth, br.width),
            h: Math.max(1, src.offsetHeight, src.scrollHeight, br.height),
          };
        }
      }
    }
    const br = pg.getBoundingClientRect();
    return {
      w: Math.max(1, pg.offsetWidth, pg.scrollWidth, br.width),
      h: Math.max(1, pg.offsetHeight, pg.scrollHeight, br.height),
    };
  }

  function scaleBookletSpread(host) {
    const slots = host.querySelectorAll('.booklet-spread-slot');
    if (slots.length !== 2) return;
    const slotW = slots[0].clientWidth;
    const slotH = slots[0].clientHeight;
    if (slotW <= 0 || slotH <= 0) return;
    const outers = [];
    const inners = [];
    const pgs = [];
    slots.forEach(function (slot) {
      const outer = slot.querySelector('.booklet-scale-outer');
      const inner = outer && outer.querySelector('.booklet-scale-inner');
      const pg = inner && inner.querySelector('.booklet-page');
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
    const has0 = !!pgs[0];
    const has1 = !!pgs[1];
    if (!has0 && !has1) return;
    const box0 = has0 ? spreadPageNaturalSize(pgs[0]) : { w: 1, h: 1 };
    const box1 = has1 ? spreadPageNaturalSize(pgs[1]) : { w: 1, h: 1 };
    let sc = 1;
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
    const scaledH = [];
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
        'Sheet ' + (index + 1) + ' / ' + views.length + ' (print order; padded to ' + Math.ceil(n / 4) * 4 + ' pp.)';
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

    appendCreditsFooterToLastPage(pageDivs);
    exportPageElements = pageDivs;

    const display = state.settings.previewDisplay === 'booklet' ? 'booklet' : 'scroll';

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

  function richAlignToolbarHtml() {
    return `
          <div class="btn-group btn-group-sm flex-wrap mb-1" role="group">
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="justifyLeft" title="Align left">L</button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="justifyCenter" title="Centre">C</button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="justifyRight" title="Align right">R</button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="justifyFull" title="Justify">J</button>
          </div>`;
  }

  function editorLayoutPanelHtml(b, showGap, showFont) {
    const gap = b.sectionGapAfterMm != null ? b.sectionGapAfterMm : DEFAULT_SECTION_GAP_AFTER_MM;
    const fs = b.fontScale != null ? b.fontScale : DEFAULT_BLOCK_FONT_SCALE;
    return `
        <div class="border rounded booklet-layout-compact bg-light small mb-1">
          <div class="form-check form-switch mb-1">
            <input class="form-check-input" type="checkbox" id="edBlockHidden" ${b.hidden ? 'checked' : ''}>
            <label class="form-check-label" for="edBlockHidden">Hidden in preview / PDF</label>
          </div>
          ${
            showGap
              ? `<label class="form-label small mb-0">Space after this section (mm)</label>
          <input type="number" class="form-control form-control-sm mb-0" id="edBlockGap" min="0" max="30" value="${gap}">`
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
    const hid = panel.querySelector('#edBlockHidden');
    const gapEl = panel.querySelector('#edBlockGap');
    const fsEl = panel.querySelector('#edBlockFontScale');
    const push = () => {
      if (hid) b.hidden = !!hid.checked;
      if (showGap && gapEl) {
        const g = parseInt(gapEl.value, 10);
        b.sectionGapAfterMm = Number.isFinite(g)
          ? Math.min(30, Math.max(0, g))
          : DEFAULT_SECTION_GAP_AFTER_MM;
      }
      if (showFont && fsEl) {
        const f = parseFloat(fsEl.value);
        b.fontScale = Number.isFinite(f)
          ? Math.min(1.5, Math.max(0.75, f))
          : DEFAULT_BLOCK_FONT_SCALE;
      }
      scheduleAutosave();
      renderPreview();
      renderBlockList();
    };
    hid?.addEventListener('change', push);
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
    renderPreview();
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

      const vis = document.createElement('button');
      vis.type = 'button';
      vis.className = 'btn btn-outline-secondary';
      vis.title = b.hidden ? 'Show in booklet' : 'Hide from booklet';
      vis.innerHTML = b.hidden
        ? '<i class="bi bi-eye-slash" aria-hidden="true"></i>'
        : '<i class="bi bi-eye" aria-hidden="true"></i>';
      vis.addEventListener('click', (ev) => {
        ev.stopPropagation();
        b.hidden = !b.hidden;
        scheduleAutosave();
        renderBlockList();
        renderPreview();
      });

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
      div.className =
        'block-list-item' +
        (b.id === selectedBlockId ? ' active' : '') +
        (b.hidden ? ' opacity-50' : '');
      div.dataset.id = b.id;
      div.title = meta.label + ' — ' + line;
      div.setAttribute('aria-label', meta.label + ': ' + line);

      const badge = document.createElement('span');
      badge.className = 'booklet-block-type-badge';
      badge.style.backgroundColor = meta.color;
      badge.title = meta.label;
      badge.setAttribute('aria-hidden', 'true');
      const ic = document.createElement('i');
      ic.className = 'bi ' + meta.icon;
      badge.appendChild(ic);

      const textEl = document.createElement('span');
      textEl.className = 'booklet-block-preview-text';
      textEl.textContent = line;

      div.appendChild(badge);
      div.appendChild(textEl);
      div.addEventListener('click', () => {
        selectedBlockId = b.id;
        renderBlockList();
        renderEditor();
      });
      row.appendChild(vis);
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
    if (b.type === 'rubric') {
      panel.innerHTML = `
        ${editorLayoutPanelHtml(b, true, true)}
        <label class="form-label small mb-1" title="Optional bold line above the rubric body.">Title <span class="text-muted">(optional)</span></label>
        <input type="text" class="form-control form-control-sm mb-1" id="edRubricSecTitle" value="${escapeAttr(b.sectionTitle || '')}" placeholder="Bold, left-aligned above rubric">
        <label class="form-label small mb-1" title="Optional italic line, right-aligned under the title.">Source reference <span class="text-muted">(optional)</span></label>
        <input type="text" class="form-control form-control-sm mb-1" id="edRubricSecSource" value="${escapeAttr(b.sectionSourceRef || '')}" placeholder="Italic, right — e.g. rubric source">
        <label class="form-label small mb-0" title="Bold, italic, underline, alignment, and text colour are reflected in the preview and PDF.">Rubric text</label>
        <div class="booklet-rich-toolbar rubric-tb">
          <div class="btn-group btn-group-sm flex-wrap mb-1" role="group">
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="bold" title="Bold"><strong>B</strong></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="italic" title="Italic"><em>I</em></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="underline" title="Underline"><u>U</u></button>
          </div>
          ${richAlignToolbarHtml()}
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
      wireEditorSectionLayout(panel, b, true, true);
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
        ${editorLayoutPanelHtml(b, true, true)}
        <label class="form-label small mb-1" title="Optional bold heading above both columns.">Section title <span class="text-muted">(optional)</span></label>
        <input type="text" class="form-control form-control-sm mb-1" id="edReadSecTitle" value="${escapeAttr(b.sectionTitle || '')}" placeholder="Bold, left above both columns">
        <label class="form-label small mb-1" title="Optional italic reference, right-aligned.">Source reference <span class="text-muted">(optional)</span></label>
        <input type="text" class="form-control form-control-sm mb-1" id="edReadSecSource" value="${escapeAttr(b.sectionSourceRef || '')}" placeholder="Italic, right — e.g. John 3:16">
        <label class="form-label small mb-0" title="Primary column; formatting applies in preview and PDF.">Original</label>
        <div class="booklet-rich-toolbar read-tb-orig">
          <div class="btn-group btn-group-sm flex-wrap mb-1" role="group">
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="bold" title="Bold"><strong>B</strong></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="italic" title="Italic"><em>I</em></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="underline" title="Underline"><u>U</u></button>
          </div>
          ${richAlignToolbarHtml()}
          <div class="btn-group btn-group-sm flex-wrap mb-1" role="group">
            <button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="foreColor" data-color="#212529" title="Black" style="color:#212529">A</button>
            <button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="foreColor" data-color="#8b1538" title="Burgundy" style="color:#8b1538">A</button>
            <button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="foreColor" data-color="#0d6efd" title="Blue" style="color:#0d6efd">A</button>
            <button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="foreColor" data-color="#198754" title="Green" style="color:#198754">A</button>
            <button type="button" class="btn btn-light border py-0 px-1" data-rich-cmd="foreColor" data-color="#6f42c1" title="Purple" style="color:#6f42c1">A</button>
          </div>
        </div>
        <div class="form-control form-control-sm booklet-rich-ed mb-2" contenteditable="true" id="edReadOrig"></div>
        <label class="form-label small mb-0" title="When this field has text, the preview uses two parallel columns (original and translation) with the split and spacing you set below.">Translation <span class="text-muted">(parallel when filled)</span></label>
        <div class="booklet-rich-toolbar read-tb-trans">
          <div class="btn-group btn-group-sm flex-wrap mb-1" role="group">
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="bold" title="Bold"><strong>B</strong></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="italic" title="Italic"><em>I</em></button>
            <button type="button" class="btn btn-light border py-0 px-2" data-rich-cmd="underline" title="Underline"><u>U</u></button>
          </div>
          ${richAlignToolbarHtml()}
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
        let ggm = parseInt(ig.value, 10);
        if (!Number.isFinite(ggm)) {
          ggm = b.parallelGapMm != null ? b.parallelGapMm : 4;
        }
        b.parallelGapMm = Math.min(20, Math.max(0, ggm));
        scheduleAutosave();
        renderPreview();
      };
      rng.addEventListener('input', syncParallel);
      chk.addEventListener('change', syncParallel);
      ig.addEventListener('input', syncParallel);
      wireEditorSectionLayout(panel, b, true, true);
    } else if (b.type === 'image') {
      panel.innerHTML = `
        ${editorLayoutPanelHtml(b, true, false)}
        <label class="form-label small mb-1" title="Shown only in the left section list, not on booklet pages. The image is stored as base64 inside the project JSON.">Section list name</label>
        <input type="text" class="form-control form-control-sm mb-1" id="edImgLabel" value="${escapeAttr(b.label || '')}" placeholder="e.g. Cover, Map — not shown in booklet">
        <button type="button" class="btn btn-sm btn-outline-primary" id="edReplaceImg">Replace image</button>
      `;
      const li = panel.querySelector('#edImgLabel');
      li.addEventListener('input', () => {
        b.label = li.value;
        scheduleAutosave();
        renderBlockList();
      });
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
      wireEditorSectionLayout(panel, b, true, false);
    } else if (b.type === 'chant_gabc') {
      const cn = b.chantNeumeSize != null ? b.chantNeumeSize : 19.2;
      const cl = b.chantLinePadTop != null ? b.chantLinePadTop : 6;
      const ct = b.chantLyricTight != null ? b.chantLyricTight : 0.7;
      const cs = b.chantSystemGap != null ? b.chantSystemGap : 4;
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
        <details class="small border rounded px-2 py-1 mt-1 bg-light">
          <summary class="fw-semibold user-select-none" title="Exsurge layout engine. GABC initial-style: 0; disables the drop cap when the drop-cap checkbox is on. Original repo linked under Advanced.">Exsurge options (this section)</summary>
          <div class="mt-2 pb-1">
          <div class="form-check mb-2">
            <input class="form-check-input" type="checkbox" id="edChantUseDropCap" ${b.chantUseDropCap !== false ? 'checked' : ''}>
            <label class="form-check-label" for="edChantUseDropCap" title="When off, no drop cap (overrides GABC except initial-style: 0). When on, initial-style: 0 in GABC still removes it.">Drop cap</label>
          </div>
          <label class="form-label mb-0" style="font-size:0.74rem" title="Latin vs English syllabification for underlay (Exsurge Language classes).">Lyric language</label>
          <select id="edChantLyricLang" class="form-select form-select-sm mb-2">
            <option value="latin"${clang === 'latin' ? ' selected' : ''}>Latin syllabification</option>
            <option value="english"${clang === 'english' ? ' selected' : ''}>English syllabification</option>
          </select>
          <label class="form-label mb-0" style="font-size:0.74rem" title="Font for chant text and neumes in this section (Exsurge setFont).">Text &amp; note font</label>
          <select id="edChantTextFont" class="form-select form-select-sm mb-2">${chantFontOpts}</select>
          <div class="mb-1">
            <div class="d-flex align-items-center justify-content-between gap-1">
              <span class="text-truncate" style="font-size:0.74rem;max-width:58%" title="Staff / neume size (px scale).">Neume scale</span>
              <input type="number" class="form-control form-control-sm" style="width:4.35rem" id="edChantNeumeNum" min="12" max="28" step="0.2" value="${(Math.round(cn * 10) / 10).toFixed(1)}">
            </div>
            <input type="range" class="form-range mt-0" id="edChantNeume" min="12" max="28" step="0.2" value="${cn}">
          </div>
          <div class="mb-1">
            <div class="d-flex align-items-center justify-content-between gap-1">
              <span class="text-truncate" style="font-size:0.74rem;max-width:58%" title="Vertical gap between systems (0 is valid).">System gap</span>
              <input type="number" class="form-control form-control-sm" style="width:4.35rem" id="edChantSysGapNum" min="0" max="24" step="0.5" value="${(Math.round(cs * 10) / 10).toFixed(1)}">
            </div>
            <input type="range" class="form-range mt-0" id="edChantSysGap" min="0" max="24" step="0.5" value="${cs}">
          </div>
          <div class="mb-1">
            <div class="d-flex align-items-center justify-content-between gap-1">
              <span class="text-truncate" style="font-size:0.74rem;max-width:58%" title="Multiplies Exsurge min lyric word spacing (smaller = tighter).">Lyric tightness</span>
              <input type="number" class="form-control form-control-sm" style="width:4.35rem" id="edChantTightNum" min="0.35" max="1.5" step="0.05" value="${(Math.round(ct * 100) / 100).toFixed(2)}">
            </div>
            <input type="range" class="form-range mt-0" id="edChantTight" min="0.35" max="1.5" step="0.05" value="${ct}">
          </div>
          <div class="mb-1">
            <div class="d-flex align-items-center justify-content-between gap-1">
              <span class="text-truncate" style="font-size:0.74rem;max-width:58%" title="Extra space above each staff line in the preview (0 is valid).">Line pad (px)</span>
              <input type="number" class="form-control form-control-sm" style="width:4.35rem" id="edChantPadNum" min="0" max="20" step="1" value="${cl}">
            </div>
            <input type="range" class="form-range mt-0" id="edChantPad" min="0" max="20" step="1" value="${cl}">
          </div>
          <div class="mb-1">
            <div class="d-flex align-items-center justify-content-between gap-1">
              <span class="text-truncate" style="font-size:0.74rem;max-width:58%" title="Relative size of the drop cap when enabled.">Drop cap ×</span>
              <input type="number" class="form-control form-control-sm" style="width:4.35rem" id="edChantDropCapNum" min="0.5" max="1.6" step="0.05" value="${(Math.round(cd * 100) / 100).toFixed(2)}" ${b.chantUseDropCap === false ? 'disabled' : ''}>
            </div>
            <input type="range" class="form-range mt-0" id="edChantDropCap" min="0.5" max="1.6" step="0.05" value="${cd}" ${b.chantUseDropCap === false ? 'disabled' : ''}>
          </div>
          <label class="form-label mb-0" style="font-size:0.74rem" title="Exsurge staff lines; leave GABC default when unset.">Staff lines</label>
          <div class="d-flex align-items-center gap-2 mb-1">
            <input type="color" id="edChantStaff" class="form-control form-control-color" value="${escapeAttr(cscVal)}">
            <button type="button" class="btn btn-sm btn-outline-secondary" id="edChantStaffDef" title="Clear override; use staff colour from GABC header if present.">GABC default</button>
          </div>
          <label class="form-label mb-0" style="font-size:0.74rem" title="Asterisks, verse numbers, rubric text in chant (Exsurge setRubricColor). Default is black.">Rubric / verse marks</label>
          <div class="d-flex align-items-center gap-2 mb-0">
            <input type="color" id="edChantRubric" class="form-control form-control-color" value="${escapeAttr(crcVal)}">
            <button type="button" class="btn btn-sm btn-outline-secondary" id="edChantRubricDef" title="Use black (Exsurge default for this booklet).">Black</button>
          </div>
          </div>
        </details>
      `;
      const ta = panel.querySelector('#edGabc');
      ta.addEventListener('input', () => {
        b.gabc = ta.value;
        scheduleAutosave();
        renderPreview();
        renderBlockList();
      });
      wireEditorSectionLayout(panel, b, true, false);
      const chkUseDropCap = panel.querySelector('#edChantUseDropCap');
      const rngDropCap = panel.querySelector('#edChantDropCap');
      const numDropCap = panel.querySelector('#edChantDropCapNum');
      chkUseDropCap?.addEventListener('change', function () {
        b.chantUseDropCap = !!chkUseDropCap.checked;
        if (rngDropCap) rngDropCap.disabled = !b.chantUseDropCap;
        if (numDropCap) numDropCap.disabled = !b.chantUseDropCap;
        if (b.chantUseDropCap && rngDropCap && numDropCap) {
          const d = b.chantDropCapScale != null ? b.chantDropCapScale : 1;
          rngDropCap.value = String(d);
          numDropCap.value = (Math.round(d * 100) / 100).toFixed(2);
        }
        scheduleAutosave();
        renderPreview();
        renderBlockList();
      });
      panel.querySelector('#edChantLyricLang')?.addEventListener('change', function () {
        b.chantLyricLanguage =
          panel.querySelector('#edChantLyricLang').value === 'english' ? 'english' : 'latin';
        scheduleAutosave();
        renderPreview();
        renderBlockList();
      });
      panel.querySelector('#edChantTextFont')?.addEventListener('change', function () {
        b.chantTextFont = normalizeChantTextFontKey(panel.querySelector('#edChantTextFont').value);
        scheduleAutosave();
        renderPreview();
        renderBlockList();
      });
      const chantApplyFromDom = function () {
        const fbN = b.chantNeumeSize != null ? b.chantNeumeSize : 19.2;
        b.chantNeumeSize = parseBoundedNumber(panel.querySelector('#edChantNeume').value, 12, 28, fbN);
        const fbG = b.chantSystemGap != null ? b.chantSystemGap : 4;
        b.chantSystemGap = parseBoundedNumber(panel.querySelector('#edChantSysGap').value, 0, 24, fbG);
        const fbT = b.chantLyricTight != null ? b.chantLyricTight : 0.7;
        b.chantLyricTight = parseBoundedNumber(panel.querySelector('#edChantTight').value, 0.35, 1.5, fbT);
        const fbP = b.chantLinePadTop != null ? b.chantLinePadTop : 6;
        b.chantLinePadTop = parseBoundedNumber(panel.querySelector('#edChantPad').value, 0, 20, fbP);
        if (rngDropCap && !rngDropCap.disabled) {
          const fbD = b.chantDropCapScale != null ? b.chantDropCapScale : 1;
          b.chantDropCapScale = parseBoundedNumber(rngDropCap.value, 0.5, 1.6, fbD);
        }
        panel.querySelector('#edChantNeumeNum').value = (Math.round(b.chantNeumeSize * 10) / 10).toFixed(1);
        panel.querySelector('#edChantSysGapNum').value = (Math.round(b.chantSystemGap * 10) / 10).toFixed(1);
        panel.querySelector('#edChantTightNum').value = (Math.round(b.chantLyricTight * 100) / 100).toFixed(2);
        panel.querySelector('#edChantPadNum').value = String(Math.round(b.chantLinePadTop));
        if (numDropCap && !numDropCap.disabled) {
          numDropCap.value = (Math.round(b.chantDropCapScale * 100) / 100).toFixed(2);
        }
        scheduleAutosave();
        renderPreview();
        renderBlockList();
      };
      function wireChantPair(rangeId, numId, min, max, toNumStr) {
        const rEl = panel.querySelector(rangeId);
        const nEl = panel.querySelector(numId);
        if (!rEl || !nEl) return;
        rEl.addEventListener('input', function () {
          const prev = parseBoundedNumber(nEl.value, min, max, parseBoundedNumber(rEl.value, min, max, min));
          const v = parseBoundedNumber(rEl.value, min, max, prev);
          nEl.value = toNumStr(v);
          chantApplyFromDom();
        });
        nEl.addEventListener('input', function () {
          const raw = String(nEl.value).trim();
          if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return;
          const n = parseFloat(raw.replace(',', '.'));
          if (!Number.isFinite(n)) return;
          const v = Math.min(max, Math.max(min, n));
          rEl.value = String(v);
          chantApplyFromDom();
        });
        nEl.addEventListener('change', function () {
          const prev = parseBoundedNumber(rEl.value, min, max, min);
          const v = parseBoundedNumber(nEl.value, min, max, prev);
          rEl.value = String(v);
          nEl.value = toNumStr(v);
          chantApplyFromDom();
        });
      }
      wireChantPair('#edChantNeume', '#edChantNeumeNum', 12, 28, function (v) {
        return (Math.round(v * 10) / 10).toFixed(1);
      });
      wireChantPair('#edChantSysGap', '#edChantSysGapNum', 0, 24, function (v) {
        return (Math.round(v * 10) / 10).toFixed(1);
      });
      wireChantPair('#edChantTight', '#edChantTightNum', 0.35, 1.5, function (v) {
        return (Math.round(v * 100) / 100).toFixed(2);
      });
      wireChantPair('#edChantPad', '#edChantPadNum', 0, 20, function (v) {
        return String(Math.round(v));
      });
      wireChantPair('#edChantDropCap', '#edChantDropCapNum', 0.5, 1.6, function (v) {
        return (Math.round(v * 100) / 100).toFixed(2);
      });
      panel.querySelector('#edChantStaff')?.addEventListener('input', () => {
        const cv = panel.querySelector('#edChantStaff').value;
        b.chantStaffColor = /^#[0-9a-f]{6}$/i.test(cv) ? cv : '';
        scheduleAutosave();
        renderPreview();
        renderBlockList();
      });
      panel.querySelector('#edChantStaffDef')?.addEventListener('click', () => {
        b.chantStaffColor = '';
        scheduleAutosave();
        renderPreview();
        renderBlockList();
      });
      panel.querySelector('#edChantRubric')?.addEventListener('input', () => {
        const cv = panel.querySelector('#edChantRubric').value;
        b.chantRubricColor = /^#[0-9a-f]{6}$/i.test(cv) ? cv : '';
        scheduleAutosave();
        renderPreview();
        renderBlockList();
      });
      panel.querySelector('#edChantRubricDef')?.addEventListener('click', () => {
        b.chantRubricColor = '';
        const inp = panel.querySelector('#edChantRubric');
        if (inp) inp.value = '#000000';
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
    if (type === 'chant_gabc') {
      b.gabc = '';
      b.chantNeumeSize = 19.2;
      b.chantStaffColor = '';
      b.chantLinePadTop = 6;
      b.chantLyricTight = 0.7;
      b.chantSystemGap = 4;
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

    const btn = document.getElementById('btnDownloadPdf');
    const oldText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Building…';
    }

    try {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
      const html = buildBookletServerPdfHtml(pages);
      const r = await fetch('/api/booklet/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          html,
          pageSize: state.settings.pageSize === 'A5' ? 'A5' : 'A4',
        }),
      });
      if (!r.ok) {
        let msg = 'PDF export failed.';
        try {
          const j = await r.json();
          if (j && j.error) msg = j.error;
        } catch (parseErr) {
          /* ignore */
        }
        alert(msg);
        return;
      }
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = safeFilenameBase(state.projectTitle, 'liturgy-booklet') + '.pdf';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      console.error(e);
      alert('PDF export failed (network or server error).');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = oldText;
      }
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
  }

  loadAutosave();
  applyCssVars();
  syncControlsFromState();
  bindUi();
  renderBlockList();
  renderEditor();
  renderPreview();
})();
