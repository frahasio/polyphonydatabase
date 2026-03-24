/**
 * Dynamic SVG clef renderer.
 * Replaces static PNG clef images with dynamically rendered SVG clefs on a CSS staff.
 *
 * Usage:
 *   renderClef(container, { clef: 'g2', missing: false, incomplete: false, optional: false })
 *   renderClef(container, { clef: 'g2/c3', ... })  // primary g2, secondary c3
 *
 * Call replaceAllClefImages() to auto-replace all <img src="/clef_images/..."> on the page.
 */
(function() {
  'use strict';

  // Staff geometry
  const STAFF_HEIGHT = 40;
  const LINE_SPACING = STAFF_HEIGHT / 4; // 10px between lines
  const STAFF_WIDTH = 60;
  const CLEF_HEIGHT = 28;
  const SECONDARY_CLEF_HEIGHT = 18;

  // Y positions for staff lines (line 1 = bottom, line 5 = top)
  function lineY(lineNum) {
    return STAFF_HEIGHT - (lineNum - 1) * LINE_SPACING;
  }

  // SVG paths for clef families (simplified outlines)
  // Anchor line: the staff line the clef "sits on"
  const CLEF_DEFS = {
    g: {
      // Treble clef - anchor is the line it curls around
      viewBox: '0 0 20 44',
      path: 'M10 44c-1-3-3-6-3-9 0-5 3-8 5-10L8 6C6 2 8 0 10 0s4 2 2 6l-4 19c3-2 7-1 7 4 0 4-2 6-4 7 1 3 0 6-1 8z',
      anchorRatio: 0.545
    },
    c: {
      // Alto/tenor clef
      viewBox: '0 0 18 32',
      path: 'M0 0h3v32H0zM5 0h2v32H5zM9 10c4 0 7 3 7 6s-3 6-7 6M9 10v12',
      anchorRatio: 0.5
    },
    f: {
      // Bass clef
      viewBox: '0 0 20 28',
      path: 'M0 8c8-12 18-4 14 4-3 6-9 6-12 4M16 6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M16 12a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3',
      anchorRatio: 0.286
    },
    d: {
      // D clef (soprano variant)
      viewBox: '0 0 18 32',
      path: 'M0 0h2v32H0zM4 0h2v32H4zM8 6c5 0 8 4 8 10s-3 10-8 10V6z',
      anchorRatio: 0.5
    },
    x: {
      // Percussion / x-clef
      viewBox: '0 0 16 24',
      path: 'M2 2l12 20M14 2L2 22',
      anchorRatio: 0.5,
      strokeOnly: true
    },
    y: {
      // Y clef variant
      viewBox: '0 0 16 28',
      path: 'M2 0l6 14 6-14M8 14v14',
      anchorRatio: 0.5,
      strokeOnly: true
    }
  };

  // Text labels for special instruments
  const TEXT_INSTRUMENTS = { org: 'Org', bc: 'B.c.', lut: 'Lut' };

  function parseClefCode(code) {
    if (!code) return [];
    // Split on '/' for multi-clef entries like 'g2/c3/c2'
    return code.split('/').map(part => {
      part = part.trim().toLowerCase();
      if (TEXT_INSTRUMENTS[part]) return { type: 'text', label: TEXT_INSTRUMENTS[part] };
      const match = part.match(/^([a-z])(\d)$/);
      if (match) return { type: 'clef', family: match[1], line: parseInt(match[2]) };
      return null;
    }).filter(Boolean);
  }

  function createStaffSVG(width) {
    const w = width || STAFF_WIDTH;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${STAFF_HEIGHT}`);
    svg.setAttribute('width', w);
    svg.setAttribute('height', STAFF_HEIGHT);
    svg.style.display = 'block';

    for (let i = 1; i <= 5; i++) {
      const y = lineY(i);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', 0);
      line.setAttribute('y1', y);
      line.setAttribute('x2', w);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', '#999');
      line.setAttribute('stroke-width', '0.8');
      svg.appendChild(line);
    }
    return svg;
  }

  function placeClefOnStaff(svg, clefInfo, isPrimary, xOffset, fillColor) {
    const def = CLEF_DEFS[clefInfo.family];
    if (!def) return;

    const height = isPrimary ? CLEF_HEIGHT : SECONDARY_CLEF_HEIGHT;
    const anchorY = def.anchorRatio * height;
    const targetY = lineY(clefInfo.line);
    const y = targetY - anchorY;

    const vb = def.viewBox.split(' ').map(Number);
    const aspect = vb[2] / vb[3];
    const width = height * aspect;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${xOffset}, ${y}) scale(${width / vb[2]}, ${height / vb[3]})`);

    def.path.split('M').filter(Boolean).forEach(segment => {
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d', 'M' + segment);
      if (def.strokeOnly) {
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

  /**
   * Render a clef into a container element.
   * @param {HTMLElement} container - The DOM element to render into
   * @param {Object} clefData - { clef: string, missing: bool, incomplete: bool, optional: bool }
   */
  function renderClef(container, clefData) {
    if (!clefData || !clefData.clef) {
      container.innerHTML = '';
      return;
    }

    const parts = parseClefCode(clefData.clef);
    if (parts.length === 0) {
      container.innerHTML = '';
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.style.display = 'inline-block';
    wrapper.style.position = 'relative';
    wrapper.style.verticalAlign = 'middle';

    if (clefData.missing) wrapper.classList.add('clef-missing');
    if (clefData.incomplete) wrapper.classList.add('clef-incomplete');
    if (clefData.optional) wrapper.classList.add('clef-optional');

    // Check if it's purely text instruments
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

    // Calculate total width needed
    let totalWidth = 4; // initial padding
    parts.forEach((part, index) => {
      if (part.type === 'text') totalWidth += 24;
      else if (part.type === 'clef') totalWidth += index === 0 ? 22 : 16;
    });
    totalWidth += 4; // trailing padding

    const svg = createStaffSVG(Math.max(totalWidth, 30));

    let xOffset = 4;
    parts.forEach((part, index) => {
      const isPrimary = index === 0;

      if (part.type === 'text') {
        placeTextOnStaff(svg, part.label, xOffset);
        xOffset += 24;
      } else if (part.type === 'clef') {
        const color = isPrimary ? null : '#0d6efd';
        placeClefOnStaff(svg, part, isPrimary, xOffset, color);
        xOffset += isPrimary ? 22 : 16;
      }
    });

    wrapper.appendChild(svg);
    container.innerHTML = '';
    container.appendChild(wrapper);
  }

  /**
   * Replace all <img src="/clef_images/..."> on the page with dynamic SVG renders.
   */
  function replaceAllClefImages() {
    document.querySelectorAll('img[src*="/clef_images/"]').forEach(img => {
      const src = img.getAttribute('src');
      const filename = src.split('/').pop().replace('.png', '');

      const clefCode = filename.replace(/([a-z])(\d)([a-z])/g, '$1$2/$3');
      const clefData = {
        clef: clefCode,
        missing: img.classList.contains('clef-missing'),
        incomplete: img.classList.contains('clef-incomplete'),
        optional: img.classList.contains('clef-optional')
      };

      const wrapper = document.createElement('span');
      wrapper.style.display = 'inline-block';
      wrapper.style.height = img.style.height || '40px';
      wrapper.style.marginRight = img.style.marginRight || '8px';

      renderClef(wrapper, clefData);

      img.replaceWith(wrapper);
    });
  }

  // Exports
  window.clefRenderer = {
    renderClef,
    replaceAllClefImages,
    parseClefCode
  };
})();
