(function () {
  'use strict';

  const MAX_PARTS_PER_AXIS = 100;
  const MAX_TOTAL_PARTS = 400;

  const $ = (id) => document.getElementById(id);
  const els = {
    dropzone: $('dropzone'), file: $('file'), workspace: $('workspace'),
    fileName: $('fileName'), fileDims: $('fileDims'), changeBtn: $('changeBtn'),
    cols: $('cols'), rows: $('rows'), colsField: $('colsField'), rowsField: $('rowsField'),
    showLines: $('showLines'), summary: $('summary'), warning: $('warning'),
    sourceImg: $('sourceImg'), guides: $('guides'),
    prefix: $('prefix'), zipBtn: $('zipBtn'), tiles: $('tiles'),
    viewer: $('viewer'), viewerTitle: $('viewerTitle'), viewerImg: $('viewerImg'),
    viewerPrev: $('viewerPrev'), viewerNext: $('viewerNext'),
    viewerDownload: $('viewerDownload'), viewerClose: $('viewerClose'),
  };

  const state = {
    source: null,        // ImageBitmap or HTMLImageElement (full resolution)
    width: 0,
    height: 0,
    sourceUrl: null,
    mode: 'h',           // 'h' = side-by-side columns, 'v' = stacked rows, 'grid'
    cols: 3,
    rows: 3,
    tiles: [],           // { canvas, name, r, c, x, y, w, h }
    viewerIndex: -1,
    viewerUrl: null,
  };

  /* ---------- Loading ---------- */

  async function decode(file) {
    // Prefer createImageBitmap without color-space conversion so pixels are
    // copied exactly as stored in the file (lossless).
    if ('createImageBitmap' in window) {
      try {
        return await createImageBitmap(file, {
          colorSpaceConversion: 'none',
          premultiplyAlpha: 'none',
          imageOrientation: 'from-image',
        });
      } catch (_) { /* fall back below */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      alert('Please choose an image file.');
      return;
    }
    let bmp;
    try {
      bmp = await decode(file);
    } catch (e) {
      alert('Could not read this image. Your browser may not support this format.');
      return;
    }
    if (state.source && state.source.close) state.source.close();
    if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);

    state.source = bmp;
    state.width = bmp.width || bmp.naturalWidth;
    state.height = bmp.height || bmp.naturalHeight;
    state.sourceUrl = URL.createObjectURL(file);

    els.sourceImg.src = state.sourceUrl;
    els.fileName.textContent = file.name || 'Pasted image';
    els.fileDims.textContent = `${state.width} × ${state.height} px · ${formatBytes(file.size)}`;
    els.prefix.value = baseName(file.name || 'image');

    els.dropzone.hidden = true;
    els.workspace.hidden = false;
    render();
  }

  /* ---------- Splitting ---------- */

  // Boundaries for splitting `length` into `n` parts. When `length` isn't
  // divisible by `n`, the leftover pixels are spread so parts differ by ≤ 1px.
  function edges(length, n) {
    const out = [];
    for (let i = 0; i <= n; i++) out.push(Math.round((i * length) / n));
    return out;
  }

  function currentGrid() {
    let cols = state.mode === 'v' ? 1 : state.cols;
    let rows = state.mode === 'h' ? 1 : state.rows;
    cols = clamp(cols, 1, Math.min(MAX_PARTS_PER_AXIS, state.width));
    rows = clamp(rows, 1, Math.min(MAX_PARTS_PER_AXIS, state.height));
    return { cols, rows };
  }

  function render() {
    if (!state.source) return;
    const { cols, rows } = currentGrid();
    const total = cols * rows;

    updateGuides(cols, rows);

    const xs = edges(state.width, cols);
    const ys = edges(state.height, rows);
    const widths = xs.slice(1).map((x, i) => x - xs[i]);
    const heights = ys.slice(1).map((y, i) => y - ys[i]);

    // Summary + warnings
    const wSet = [...new Set(widths)];
    const hSet = [...new Set(heights)];
    const sizeText = (set) => set.length === 1 ? `${set[0]}` : `${Math.min(...set)}–${Math.max(...set)}`;
    els.summary.textContent =
      `${total} part${total > 1 ? 's' : ''} · ${cols} × ${rows} · each ${sizeText(wSet)} × ${sizeText(hSet)} px`;

    const notes = [];
    if (wSet.length > 1) notes.push(`width ${state.width} isn't divisible by ${cols}`);
    if (hSet.length > 1) notes.push(`height ${state.height} isn't divisible by ${rows}`);
    if (notes.length) {
      els.warning.textContent = `Note: ${notes.join(' and ')}, so some parts are 1px larger. No pixels are lost.`;
      els.warning.hidden = false;
    } else {
      els.warning.hidden = true;
    }

    if (total > MAX_TOTAL_PARTS) {
      els.warning.textContent = `Too many parts (${total}). The maximum is ${MAX_TOTAL_PARTS}.`;
      els.warning.hidden = false;
      els.tiles.innerHTML = '';
      state.tiles = [];
      els.zipBtn.disabled = true;
      return;
    }
    els.zipBtn.disabled = false;

    // Build tiles
    const prefix = sanitize(els.prefix.value) || 'image';
    const pad = String(total).length;
    const tiles = [];
    const frag = document.createDocumentFragment();
    let index = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        index++;
        const x = xs[c], y = ys[r], w = widths[c], h = heights[r];
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { alpha: true });
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(state.source, x, y, w, h, 0, 0, w, h);

        const label = rows > 1 && cols > 1
          ? `r${r + 1}_c${c + 1}`
          : String(index).padStart(pad, '0');
        const name = `${prefix}_${label}.png`;
        const tile = { canvas, name, label, r, c, x, y, w, h, index: index - 1 };
        tiles.push(tile);

        const el = document.createElement('div');
        el.className = 'tile';
        canvas.title = `${name} — click to enlarge`;
        canvas.addEventListener('click', () => openViewer(tile.index));

        const meta = document.createElement('div');
        meta.className = 'tile-meta';
        const info = document.createElement('span');
        info.textContent = `#${index} · ${w}×${h}`;
        const dl = document.createElement('button');
        dl.textContent = 'Save';
        dl.title = 'Download this part';
        dl.addEventListener('click', () => downloadTile(tile));
        meta.append(info, dl);

        el.append(canvas, meta);
        frag.append(el);
      }
    }

    els.tiles.style.gridTemplateColumns = widths.map((w) => `minmax(0, ${w}fr)`).join(' ');
    els.tiles.replaceChildren(frag);
    state.tiles = tiles;
  }

  function updateGuides(cols, rows) {
    const svg = els.guides;
    svg.setAttribute('viewBox', `0 0 ${state.width} ${state.height}`);
    svg.innerHTML = '';
    if (!els.showLines.checked) return;
    const ns = 'http://www.w3.org/2000/svg';
    const xs = edges(state.width, cols).slice(1, -1);
    const ys = edges(state.height, rows).slice(1, -1);
    const lines = [
      ...xs.map((x) => [x, 0, x, state.height]),
      ...ys.map((y) => [0, y, state.width, y]),
    ];
    for (const cls of ['shadow', '']) {
      for (const [x1, y1, x2, y2] of lines) {
        const l = document.createElementNS(ns, 'line');
        l.setAttribute('x1', x1); l.setAttribute('y1', y1);
        l.setAttribute('x2', x2); l.setAttribute('y2', y2);
        if (cls) l.setAttribute('class', cls);
        svg.append(l);
      }
    }
  }

  /* ---------- Export ---------- */

  function toPng(canvas) {
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), 'image/png'));
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function downloadTile(tile) {
    saveBlob(await toPng(tile.canvas), tile.name);
  }

  async function downloadZip() {
    const tiles = state.tiles;
    if (!tiles.length) return;
    const btn = els.zipBtn;
    const label = btn.textContent;
    btn.disabled = true;
    try {
      const files = [];
      for (let i = 0; i < tiles.length; i++) {
        btn.textContent = `Encoding ${i + 1}/${tiles.length}…`;
        const blob = await toPng(tiles[i].canvas);
        files.push({ name: tiles[i].name, data: new Uint8Array(await blob.arrayBuffer()) });
      }
      btn.textContent = 'Zipping…';
      const zip = createZip(files);
      saveBlob(zip, `${sanitize(els.prefix.value) || 'image'}_split.zip`);
    } catch (e) {
      alert('Something went wrong while creating the ZIP: ' + e.message);
    } finally {
      btn.textContent = label;
      btn.disabled = false;
    }
  }

  /* ---------- Viewer ---------- */

  async function openViewer(i) {
    const tile = state.tiles[i];
    if (!tile) return;
    state.viewerIndex = i;
    els.viewerTitle.textContent = `${tile.name} · ${tile.w} × ${tile.h} px (${i + 1}/${state.tiles.length})`;
    els.viewerPrev.disabled = i === 0;
    els.viewerNext.disabled = i === state.tiles.length - 1;
    const blob = await toPng(tile.canvas);
    if (state.viewerIndex !== i) return;
    if (state.viewerUrl) URL.revokeObjectURL(state.viewerUrl);
    state.viewerUrl = URL.createObjectURL(blob);
    els.viewerImg.src = state.viewerUrl;
    if (!els.viewer.open) els.viewer.showModal();
  }

  function closeViewer() {
    els.viewer.close();
  }

  els.viewer.addEventListener('close', () => {
    state.viewerIndex = -1;
    els.viewerImg.removeAttribute('src');
    if (state.viewerUrl) URL.revokeObjectURL(state.viewerUrl);
    state.viewerUrl = null;
  });
  els.viewer.addEventListener('click', (e) => { if (e.target === els.viewer) closeViewer(); });
  els.viewerClose.addEventListener('click', closeViewer);
  els.viewerPrev.addEventListener('click', () => openViewer(state.viewerIndex - 1));
  els.viewerNext.addEventListener('click', () => openViewer(state.viewerIndex + 1));
  els.viewerDownload.addEventListener('click', () => {
    const t = state.tiles[state.viewerIndex];
    if (t) downloadTile(t);
  });
  document.addEventListener('keydown', (e) => {
    if (!els.viewer.open) return;
    if (e.key === 'ArrowLeft' && state.viewerIndex > 0) openViewer(state.viewerIndex - 1);
    if (e.key === 'ArrowRight' && state.viewerIndex < state.tiles.length - 1) openViewer(state.viewerIndex + 1);
  });

  /* ---------- Controls ---------- */

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('.seg button').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on);
    });
    const colsOn = mode !== 'v';
    const rowsOn = mode !== 'h';
    els.cols.disabled = !colsOn;
    els.rows.disabled = !rowsOn;
    els.colsField.classList.toggle('disabled', !colsOn);
    els.rowsField.classList.toggle('disabled', !rowsOn);
    els.cols.value = colsOn ? state.cols : 1;
    els.rows.value = rowsOn ? state.rows : 1;
    render();
  }

  document.querySelectorAll('.seg button').forEach((b) =>
    b.addEventListener('click', () => setMode(b.dataset.mode)));

  let timer = null;
  const renderSoon = () => { clearTimeout(timer); timer = setTimeout(render, 120); };

  function readNumber(input, key) {
    const v = parseInt(input.value, 10);
    if (Number.isFinite(v) && v >= 1) {
      state[key] = Math.min(v, MAX_PARTS_PER_AXIS);
      renderSoon();
    }
  }
  els.cols.addEventListener('input', () => readNumber(els.cols, 'cols'));
  els.rows.addEventListener('input', () => readNumber(els.rows, 'rows'));
  for (const [input, key] of [[els.cols, 'cols'], [els.rows, 'rows']]) {
    input.addEventListener('change', () => { if (!input.disabled) input.value = state[key]; });
  }
  els.showLines.addEventListener('change', () => updateGuides(currentGrid().cols, currentGrid().rows));
  els.prefix.addEventListener('input', () => {
    // Only names change; rename without redrawing.
    const prefix = sanitize(els.prefix.value) || 'image';
    for (const t of state.tiles) {
      t.name = `${prefix}_${t.label}.png`;
      t.canvas.title = `${t.name} — click to enlarge`;
    }
  });
  els.zipBtn.addEventListener('click', downloadZip);

  /* ---------- Upload UI ---------- */

  els.dropzone.addEventListener('click', () => els.file.click());
  els.dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.file.click(); }
  });
  els.changeBtn.addEventListener('click', () => els.file.click());
  els.file.addEventListener('change', () => {
    if (els.file.files[0]) loadFile(els.file.files[0]);
    els.file.value = '';
  });

  ['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => {
    e.preventDefault();
    els.dropzone.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => {
    e.preventDefault();
    if (t === 'dragleave' && e.relatedTarget) return;
    els.dropzone.classList.remove('over');
  }));
  document.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  document.addEventListener('paste', (e) => {
    if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'text') return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) loadFile(item.getAsFile());
  });

  /* ---------- Utils ---------- */

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function baseName(n) { return sanitize(n.replace(/\.[^.]+$/, '')) || 'image'; }
  function sanitize(s) { return s.trim().replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80); }
  function formatBytes(b) {
    if (!b) return '';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return `${b.toFixed(i ? 1 : 0)} ${u[i]}`;
  }

  setMode('h');
})();
