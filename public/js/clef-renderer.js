/**
 * Dynamic SVG clef renderer.
 * Loads clef shapes from SVG files in /svg/clefs/, renders them on a CSS staff.
 *
 * All clefs are rendered at a consistent width (PRIMARY_WIDTH / SECONDARY_WIDTH).
 * Adjust each SVG file's viewBox padding to control relative glyph size.
 */
(function() {
  'use strict';

  const STAFF_HEIGHT = 40;
  const LINE_SPACING = STAFF_HEIGHT / 4;
  const PRIMARY_WIDTH = 16;
  const SECONDARY_WIDTH = 11;
  const SECONDARY_COLOR = '#0d6efd';

  function lineY(n) {
    return STAFF_HEIGHT - (n - 1) * LINE_SPACING;
  }

  const CLEF_DEFS = {
    g:  { svgFile: '/svg/clefs/g-clef.svg',    anchorRatio: 0.85,
          viewBox: '0 0 20 44', path: 'M10 44c-1-3-3-6-3-9 0-5 3-8 5-10L8 6C6 2 8 0 10 0s4 2 2 6l-4 19c3-2 7-1 7 4 0 4-2 6-4 7 1 3 0 6-1 8z' },
    f:  { svgFile: '/svg/clefs/f-clef.svg',     anchorRatio: 0.50,
          viewBox: '0 0 20 28', path: 'M0 8c8-12 18-4 14 4-3 6-9 6-12 4M16 6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M16 12a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3' },
    c1: { svgFile: '/svg/clefs/c1-clef.svg',    anchorRatio: 0.695,
          viewBox: '0 0 18 32', path: 'M0 0h3v32H0zM5 0h2v32H5zM9 10c4 0 7 3 7 6s-3 6-7 6M9 10v12' },
    c2: { svgFile: '/svg/clefs/c2-clef.svg',    anchorRatio: 0.57,
          viewBox: '0 0 18 32', path: 'M0 0h3v32H0zM5 0h2v32H5zM9 10c4 0 7 3 7 6s-3 6-7 6M9 10v12' },
    c3: { svgFile: '/svg/clefs/c3-clef.svg',    anchorRatio: 0.50,
          viewBox: '0 0 18 32', path: 'M0 0h3v32H0zM5 0h2v32H5zM9 10c4 0 7 3 7 6s-3 6-7 6M9 10v12' },
    c4: { svgFile: '/svg/clefs/c4-clef.svg',    anchorRatio: 0.42,
          viewBox: '0 0 18 32', path: 'M0 0h3v32H0zM5 0h2v32H5zM9 10c4 0 7 3 7 6s-3 6-7 6M9 10v12' },
    c5: { svgFile: '/svg/clefs/c5-clef.svg',    anchorRatio: 0.295,
          viewBox: '0 0 18 32', path: 'M0 0h3v32H0zM5 0h2v32H5zM9 10c4 0 7 3 7 6s-3 6-7 6M9 10v12' },
    d:  { svgFile: '/svg/clefs/d-clef.svg',     anchorRatio: 0.57, fillRule: 'evenodd',
          viewBox: '0 0 10 15', path: 'M2.5 0C7 0 9.5 2.5 9.5 6.5C9.5 10.5 7.5 14 5 14C2 14 0.5 11.5 0.5 8.5C0.5 5 3 3.5 5.5 3.5C6.5 3.5 7 4 7 5L7 3C7 1.5 5.5 1 3.5 1Z M5 5.5C3 5.5 2.5 7 2.5 8.5C2.5 10.5 3.5 12 5 12C7 12 7.5 10.5 7.5 8.5C7.5 7 7 5.5 5 5.5Z' },
    x:  { svgFile: '/svg/clefs/x-clef.svg',     anchorRatio: 0.50,
          viewBox: '0 0 10 10', path: 'M1 0L5 4L9 0L10 1L6 5L10 9L9 10L5 6L1 10L0 9L4 5L0 1Z' },
    y:  { svgFile: '/svg/clefs/gamma-clef.svg',  anchorRatio: 0.30,
          viewBox: '0 0 10 14', path: 'M0 0L10 0L10 2C10 2.5 9.5 2.8 9 2.8L2.2 2.8L2.2 12.5C2.2 13.4 1.7 14 1.1 14C0.5 14 0 13.4 0 12.5Z' }
  };

  const TEXT_INSTRUMENTS = { org: 'Org', bc: 'B.c.', lut: 'Lut' };

  // --- SVG file loading & cache ---
  const svgCache = {};
  let _preloaded = false;

  async function loadSvgData(key) {
    if (svgCache[key]) return svgCache[key];
    const def = CLEF_DEFS[key];
    if (!def || !def.svgFile) return null;
    try {
      const r = await fetch(def.svgFile);
      if (!r.ok) return null;
      const doc = new DOMParser().parseFromString(await r.text(), 'image/svg+xml');
      const svgEl = doc.querySelector('svg');
      const pathEl = doc.querySelector('path');
      if (svgEl && pathEl) {
        svgCache[key] = {
          viewBox: svgEl.getAttribute('viewBox'),
          path: pathEl.getAttribute('d'),
          fillRule: pathEl.getAttribute('fill-rule') || null
        };
        return svgCache[key];
      }
    } catch (e) { /* use fallback */ }
    return null;
  }

  async function preloadClefs() {
    if (_preloaded) return;
    const keys = Object.keys(CLEF_DEFS).filter(k => CLEF_DEFS[k].svgFile);
    await Promise.all(keys.map(loadSvgData));
    _preloaded = true;
  }

  // --- Helpers ---

  function getClefKey(family, line) {
    if (family === 'c' && line >= 1 && line <= 5) return 'c' + line;
    return family;
  }

  function getClefData(key) {
    const def = CLEF_DEFS[key];
    if (!def) return null;
    const cached = svgCache[key];
    return {
      viewBox:     cached ? cached.viewBox : def.viewBox,
      path:        cached ? cached.path    : def.path,
      fillRule:    cached ? cached.fillRule : (def.fillRule || null),
      anchorRatio: def.anchorRatio,
      strokeOnly:  def.strokeOnly || false,
      fromFile:    !!cached
    };
  }

  function parseClefCode(code) {
    if (!code) return [];
    return code.split('/').map(part => {
      part = part.trim().toLowerCase();
      if (TEXT_INSTRUMENTS[part]) return { type: 'text', label: TEXT_INSTRUMENTS[part] };
      const match = part.match(/^([a-z]+)(\d)$/);
      if (match) return { type: 'clef', family: match[1], line: parseInt(match[2]) };
      return null;
    }).filter(Boolean);
  }

  /** All primary clefs rendered at PRIMARY_WIDTH; secondary at SECONDARY_WIDTH. */
  function clefWidth(isPrimary) {
    return isPrimary ? PRIMARY_WIDTH : SECONDARY_WIDTH;
  }

  // --- SVG construction ---

  function createStaffSVG(width) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${STAFF_HEIGHT}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', STAFF_HEIGHT);
    svg.style.display = 'block';
    svg.style.overflow = 'visible';

    for (let i = 1; i <= 5; i++) {
      const y = lineY(i);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', 0);
      line.setAttribute('y1', y);
      line.setAttribute('x2', width);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', '#999');
      line.setAttribute('stroke-width', '0.8');
      svg.appendChild(line);
    }
    return svg;
  }

  function placeClefOnStaff(svg, clefInfo, isPrimary, xOffset, fillColor) {
    const key = getClefKey(clefInfo.family, clefInfo.line);
    const data = getClefData(key);
    if (!data || !data.path) return;

    const targetW = clefWidth(isPrimary);
    const vb = data.viewBox.split(' ').map(Number);
    const aspect = vb[2] / vb[3];
    const renderH = targetW / aspect;

    const anchorY = data.anchorRatio * renderH;
    const targetY = lineY(clefInfo.line);
    const y = targetY - anchorY;

    const scaleX = targetW / vb[2];
    const scaleY = renderH / vb[3];

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${xOffset},${y}) scale(${scaleX},${scaleY})`);

    if (data.fromFile) {
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d', data.path);
      if (data.fillRule) pathEl.setAttribute('fill-rule', data.fillRule);
      pathEl.setAttribute('fill', fillColor || 'currentColor');
      pathEl.setAttribute('stroke', 'none');
      g.appendChild(pathEl);
    } else {
      data.path.split('M').filter(Boolean).forEach(seg => {
        const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.setAttribute('d', 'M' + seg);
        if (data.fillRule) pathEl.setAttribute('fill-rule', data.fillRule);
        if (data.strokeOnly) {
          pathEl.setAttribute('fill', 'none');
          pathEl.setAttribute('stroke', fillColor || 'currentColor');
          pathEl.setAttribute('stroke-width', '2');
          pathEl.setAttribute('stroke-linecap', 'round');
        } else {
          pathEl.setAttribute('fill', fillColor || 'currentColor');
          pathEl.setAttribute('stroke', 'none');
        }
        g.appendChild(pathEl);
      });
    }

    svg.appendChild(g);
  }

  function placeTextOnStaff(svg, label, xOffset) {
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', xOffset + 2);
    text.setAttribute('y', STAFF_HEIGHT / 2 + 4);
    text.setAttribute('font-size', '11');
    text.setAttribute('font-family', 'serif');
    text.setAttribute('font-style', 'italic');
    text.setAttribute('fill', 'currentColor');
    text.textContent = label;
    svg.appendChild(text);
  }

  // --- Public API ---

  function renderClef(container, clefData) {
    if (!clefData || !clefData.clef) { container.innerHTML = ''; return; }
    const parts = parseClefCode(clefData.clef);
    if (!parts.length) { container.innerHTML = ''; return; }

    const wrapper = document.createElement('div');
    wrapper.style.display = 'inline-block';
    wrapper.style.position = 'relative';
    wrapper.style.verticalAlign = 'middle';
    wrapper.style.padding = '20px 0';

    if (clefData.missing) wrapper.classList.add('clef-missing');
    if (clefData.incomplete) wrapper.classList.add('clef-incomplete');
    if (clefData.optional) wrapper.classList.add('clef-optional');

    if (parts.every(p => p.type === 'text')) {
      const span = document.createElement('span');
      span.style.fontStyle = 'italic';
      span.style.fontSize = '0.85em';
      span.style.color = 'currentColor';
      span.textContent = parts.map(p => p.label).join(' / ');
      wrapper.appendChild(span);
      container.innerHTML = '';
      container.appendChild(wrapper);
      return;
    }

    let totalWidth = 3;
    parts.forEach((part, idx) => {
      if (part.type === 'text') totalWidth += 24;
      else totalWidth += clefWidth(idx === 0) + 2;
    });
    totalWidth += 3;

    const svg = createStaffSVG(Math.max(totalWidth, 24));
    let xOff = 3;
    parts.forEach((part, idx) => {
      if (part.type === 'text') {
        placeTextOnStaff(svg, part.label, xOff);
        xOff += 24;
      } else {
        placeClefOnStaff(svg, part, idx === 0, xOff, idx === 0 ? null : SECONDARY_COLOR);
        xOff += clefWidth(idx === 0) + 2;
      }
    });

    wrapper.appendChild(svg);
    container.innerHTML = '';
    container.appendChild(wrapper);
  }

  function renderClefStrip(container) {
    const targets = container.querySelectorAll('.clef-render-target');
    if (!targets.length) { container.innerHTML = ''; return; }

    const entries = Array.from(targets).map(el => ({
      clef: el.dataset.clef,
      missing: el.dataset.missing === 'true',
      incomplete: el.dataset.incomplete === 'true',
      optional: el.dataset.optional === 'true'
    })).filter(e => e.clef && e.clef.trim());

    container.innerHTML = '';
    if (!entries.length) return;

    const strip = document.createElement('div');
    strip.className = 'clef-strip';

    entries.forEach(entry => {
      const parts = parseClefCode(entry.clef);
      if (!parts.length) return;

      const cell = document.createElement('div');
      cell.className = 'clef-strip-cell';
      if (entry.missing) cell.classList.add('clef-missing');
      if (entry.incomplete) cell.classList.add('clef-incomplete');
      if (entry.optional) cell.classList.add('clef-optional');

      if (parts.every(p => p.type === 'text')) {
        const span = document.createElement('span');
        span.className = 'clef-strip-text';
        span.textContent = parts.map(p => p.label).join('/');
        cell.appendChild(span);
        strip.appendChild(cell);
        return;
      }

      let cellWidth = 1;
      parts.forEach((part, idx) => {
        if (part.type === 'text') cellWidth += 22;
        else cellWidth += clefWidth(idx === 0) + 1;
      });
      cellWidth += 1;

      const svg = createStaffSVG(Math.max(cellWidth, 18));
      let xOff = 1;
      parts.forEach((part, idx) => {
        if (part.type === 'text') {
          placeTextOnStaff(svg, part.label, xOff);
          xOff += 22;
        } else {
          placeClefOnStaff(svg, part, idx === 0, xOff, idx === 0 ? null : SECONDARY_COLOR);
          xOff += clefWidth(idx === 0) + 1;
        }
      });

      cell.appendChild(svg);
      strip.appendChild(cell);
    });

    container.appendChild(strip);
  }

  function replaceAllClefImages() {
    document.querySelectorAll('img[src*="/clef_images/"]').forEach(img => {
      const filename = img.getAttribute('src').split('/').pop().replace('.png', '');
      const clefCode = filename.replace(/([a-z])(\d)([a-z])/g, '$1$2/$3');
      const wrapper = document.createElement('span');
      wrapper.style.display = 'inline-block';
      renderClef(wrapper, {
        clef: clefCode,
        missing: img.classList.contains('clef-missing'),
        incomplete: img.classList.contains('clef-incomplete'),
        optional: img.classList.contains('clef-optional')
      });
      img.replaceWith(wrapper);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', preloadClefs);
  } else {
    preloadClefs();
  }

  window.clefRenderer = {
    renderClef,
    renderClefStrip,
    replaceAllClefImages,
    parseClefCode,
    preloadClefs
  };
})();
