(function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = 'liturgyBooklet_autosave_v1';

  /** @type {{ schemaVersion: number, settings: object, blocks: object[] }} */
  let state = {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      pageSize: 'A4',
      marginMm: 15,
      fontScale: 1,
      viewMode: 'page',
    },
    blocks: [],
  };

  let selectedBlockId = null;
  let autosaveTimer = null;

  function uid() {
    return 'b_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  }

  function applyCssVars() {
    const root = document.documentElement;
    root.style.setProperty('--booklet-margin-mm', String(state.settings.marginMm));
    root.style.setProperty('--booklet-font-scale', String(state.settings.fontScale));
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
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.schemaVersion === SCHEMA_VERSION && Array.isArray(parsed.blocks)) {
        state = parsed;
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
    if (sz) sz.value = state.settings.pageSize;
    if (m) m.value = String(state.settings.marginMm);
    if (fs) fs.value = String(state.settings.fontScale);
  }

  function renderBlockList() {
    const el = document.getElementById('blockList');
    if (!el) return;
    el.innerHTML = '';
    state.blocks.forEach((b, idx) => {
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
                : b.type === 'jgabc_propers'
                  ? 'Mass propers (jgabc)'
                  : b.type;
      const preview =
        b.type === 'rubric' || b.type === 'reading'
          ? (b.text || '').slice(0, 48) + ((b.text || '').length > 48 ? '…' : '')
          : b.type === 'edition_pdf'
            ? (b.url || '').slice(0, 40)
            : b.type === 'jgabc_propers'
              ? (b.hash || '(default propers)').slice(0, 40)
              : b.type === 'image'
                ? '(image)'
                : '';
      div.textContent = `${idx + 1}. ${label}: ${preview}`;
      div.dataset.id = b.id;
      div.addEventListener('click', () => {
        selectedBlockId = b.id;
        renderBlockList();
        renderEditor();
      });
      el.appendChild(div);
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
    if (b.type === 'rubric' || b.type === 'reading') {
      panel.innerHTML = `
        <label class="form-label small mb-1">${b.type === 'rubric' ? 'Rubric' : 'Text'}</label>
        <textarea class="form-control form-control-sm" rows="6" id="edField">${escapeHtml(b.text || '')}</textarea>
      `;
      const ta = panel.querySelector('#edField');
      ta.addEventListener('input', () => {
        b.text = ta.value;
        scheduleAutosave();
        renderPreview();
        renderBlockList();
      });
    } else if (b.type === 'image') {
      panel.innerHTML = `
        <p class="small">Image is stored in the project file as base64 (can make large files).</p>
        <button type="button" class="btn btn-sm btn-outline-primary" id="edReplaceImg">Replace image</button>
      `;
      panel.querySelector('#edReplaceImg').addEventListener('click', () => pickImageForBlock(b.id));
    } else if (b.type === 'edition_pdf') {
      panel.innerHTML = `
        <label class="form-label small mb-1">PDF URL (from Polyphony catalogue)</label>
        <input type="url" class="form-control form-control-sm mb-2" id="edUrl" value="${escapeAttr(b.url || '')}" placeholder="https://...">
        <label class="form-label small mb-1">Catalogue edition ID (optional)</label>
        <input type="text" class="form-control form-control-sm mb-2" id="edCatId" value="${escapeAttr(b.catalogueEditionId != null ? String(b.catalogueEditionId) : '')}" placeholder="e.g. database id for templates">
        <label class="form-label small mb-1">Label (optional)</label>
        <input type="text" class="form-control form-control-sm" id="edTitle" value="${escapeAttr(b.title || '')}">
      `;
      const u = panel.querySelector('#edUrl');
      const c = panel.querySelector('#edCatId');
      const t = panel.querySelector('#edTitle');
      u.addEventListener('input', () => {
        b.url = u.value.trim();
        scheduleAutosave();
        renderPreview();
        renderBlockList();
      });
      c.addEventListener('input', () => {
        const v = c.value.trim();
        b.catalogueEditionId = v === '' ? null : v;
        scheduleAutosave();
      });
      t.addEventListener('input', () => {
        b.title = t.value;
        scheduleAutosave();
        renderPreview();
      });
    } else if (b.type === 'jgabc_propers') {
      panel.innerHTML = `
        <p class="small text-muted">Optional: paste a fragment from the propers tool (starts with <code>#</code>) to restore selections. The embedded tool below updates this when possible.</p>
        <textarea class="form-control form-control-sm font-monospace" rows="3" id="edHash">${escapeHtml(b.hash || '')}</textarea>
        <a href="/vendor/jgabc/propers.html" target="_blank" rel="noopener" class="small d-inline-block mt-2">Open full propers in new tab</a>
      `;
      const h = panel.querySelector('#edHash');
      const applyHash = () => {
        b.hash = h.value.trim();
        scheduleAutosave();
        renderPreview();
        renderBlockList();
      };
      h.addEventListener('input', applyHash);
      h.addEventListener('change', applyHash);
    }
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

  function renderPreview() {
    const root = document.getElementById('previewPages');
    if (!root) return;
    root.innerHTML = '';
    const size = state.settings.pageSize;
    state.blocks.forEach((b) => {
      const page = document.createElement('div');
      page.className = 'booklet-page';
      page.dataset.size = size;
      const inner = document.createElement('div');
      inner.className = 'page-inner';

      if (b.type === 'rubric') {
        const p = document.createElement('p');
        p.className = 'rubric';
        p.textContent = b.text || '';
        inner.appendChild(p);
      } else if (b.type === 'reading') {
        const p = document.createElement('div');
        p.className = 'reading';
        p.textContent = b.text || '';
        inner.appendChild(p);
      } else if (b.type === 'image') {
        if (b.dataBase64 && b.mime) {
          const img = document.createElement('img');
          img.className = 'user-img';
          img.src = `data:${b.mime};base64,${b.dataBase64}`;
          img.alt = 'User image';
          inner.appendChild(img);
        } else {
          const p = document.createElement('p');
          p.className = 'text-muted small';
          p.textContent = 'No image yet — select this section and click Replace image.';
          inner.appendChild(p);
        }
      } else if (b.type === 'edition_pdf') {
        const cap = document.createElement('div');
        cap.className = 'small text-muted mb-2';
        cap.textContent = b.title || 'Polyphony edition';
        inner.appendChild(cap);
        if (b.url) {
          const iframe = document.createElement('iframe');
          iframe.className = 'edition-frame';
          iframe.src = b.url;
          iframe.title = 'Edition PDF';
          inner.appendChild(iframe);
        } else {
          const em = document.createElement('p');
          em.className = 'text-muted small';
          em.textContent = 'Add a PDF URL in the editor.';
          inner.appendChild(em);
        }
      } else if (b.type === 'jgabc_propers') {
        const cap = document.createElement('div');
        cap.className = 'small text-muted mb-2';
        cap.textContent = 'Mass propers (jgabc) — use the tool below; PDF snapshot may not capture all iframe detail.';
        inner.appendChild(cap);
        const iframe = document.createElement('iframe');
        iframe.className = 'jgabc-frame';
        iframe.sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox';
        const hash = (b.hash || '').replace(/^#/, '');
        iframe.src = '/vendor/jgabc/propers.html' + (hash ? '#' + hash : '');
        iframe.title = 'jgabc Mass Propers';
        iframe.addEventListener('load', () => {
          try {
            const h = iframe.contentWindow && iframe.contentWindow.location && iframe.contentWindow.location.hash;
            if (h && h !== (b.hash || '')) {
              b.hash = h;
              scheduleAutosave();
              renderBlockList();
            }
          } catch (e) {
            /* ignore */
          }
        });
        inner.appendChild(iframe);
      }

      page.appendChild(inner);
      root.appendChild(page);
    });

    if (state.blocks.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'booklet-page';
      hint.dataset.placeholder = 'true';
      hint.dataset.size = size;
      const inner = document.createElement('div');
      inner.className = 'page-inner text-muted text-center py-5';
      inner.innerHTML =
        '<p>Add sections from <strong>Add section</strong> above.</p><p class="small">Use <strong>Save project</strong> to download a JSON file you can reload later. Polyphony PDFs are stored as URLs only.</p>';
      hint.appendChild(inner);
      root.appendChild(hint);
    }
  }

  function addBlock(type) {
    const b = { id: uid(), type };
    if (type === 'rubric' || type === 'reading') b.text = '';
    if (type === 'image') {
      b.mime = 'image/png';
      b.dataBase64 = '';
      setTimeout(() => pickImageForBlock(b.id), 0);
    }
    if (type === 'edition_pdf') {
      b.url = '';
      b.title = '';
      b.catalogueEditionId = null;
    }
    if (type === 'jgabc_propers') b.hash = '';
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
    a.download = 'liturgy-booklet-project.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function loadJsonFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) {
          alert('Invalid or unsupported project file (expected schema version ' + SCHEMA_VERSION + ').');
          return;
        }
        if (!Array.isArray(parsed.blocks)) {
          alert('Invalid project: missing blocks array.');
          return;
        }
        state = parsed;
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
    const pages = document.querySelectorAll('#previewPages .booklet-page:not([data-placeholder])');
    if (!pages.length) {
      alert('Add at least one section before downloading a PDF.');
      return;
    }
    if (typeof html2canvas === 'undefined' || typeof PDFLib === 'undefined') {
      alert('PDF libraries failed to load. Check your network connection.');
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
          allowTaint: false,
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
      a.download = 'liturgy-booklet.pdf';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      console.error(e);
      alert('PDF export failed. If an edition PDF is cross-origin, try removing that section or use Print instead.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = oldText;
      }
    }
  }

  function bindUi() {
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
    });
    document.getElementById('rngFontScale')?.addEventListener('input', (e) => {
      state.settings.fontScale = parseFloat(e.target.value) || 1;
      applyCssVars();
      scheduleAutosave();
      renderPreview();
    });

    document.getElementById('addRubric')?.addEventListener('click', (e) => {
      e.preventDefault();
      addBlock('rubric');
    });
    document.getElementById('addReading')?.addEventListener('click', (e) => {
      e.preventDefault();
      addBlock('reading');
    });
    document.getElementById('addImage')?.addEventListener('click', (e) => {
      e.preventDefault();
      addBlock('image');
    });
    document.getElementById('addEdition')?.addEventListener('click', (e) => {
      e.preventDefault();
      addBlock('edition_pdf');
    });
    document.getElementById('addJgabc')?.addEventListener('click', (e) => {
      e.preventDefault();
      addBlock('jgabc_propers');
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
