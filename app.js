(function () {
  'use strict';

  const MAX_PARTS_PER_AXIS = 100;
  const MAX_TOTAL_PARTS = 400;
  // Longest side of the downscaled copy used for on-screen previews. Full
  // resolution parts are only rendered when exporting, which keeps memory low
  // on phones (iOS Safari in particular has strict canvas memory limits).
  const PREVIEW_MAX_SIDE = 2048;
  // iOS Safari refuses to create canvases larger than this many pixels.
  const IOS_MAX_CANVAS_PIXELS = 16777216;

  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const canShareFiles = (() => {
    try {
      return !!navigator.canShare &&
        navigator.canShare({ files: [new File([new Blob()], 'a.png', { type: 'image/png' })] });
    } catch (_) { return false; }
  })();
  const useShare = canShareFiles && isTouch;

  const $ = (id) => document.getElementById(id);
  const els = {
    dropzone: $('dropzone'), file: $('file'), workspace: $('workspace'),
    fileName: $('fileName'), fileDims: $('fileDims'), changeBtn: $('changeBtn'),
    cols: $('cols'), rows: $('rows'), colsField: $('colsField'), rowsField: $('rowsField'),
    showLines: $('showLines'), summary: $('summary'), warning: $('warning'),
    sourceImg: $('sourceImg'), guides: $('guides'),
    prefix: $('prefix'), zipBtn: $('zipBtn'), shareAllBtn: $('shareAllBtn'), tiles: $('tiles'),
    viewer: $('viewer'), viewerTitle: $('viewerTitle'), viewerImg: $('viewerImg'),
    viewerBody: $('viewerBody'), viewerPrev: $('viewerPrev'), viewerNext: $('viewerNext'),
    viewerShare: $('viewerShare'), viewerDownload: $('viewerDownload'), viewerClose: $('viewerClose'),
    toast: $('toast'),
  };

  const state = {
    source: null,        // full resolution ImageBitmap or HTMLImageElement
    preview: null,       // downscaled canvas for thumbnails
    previewScale: 1,
    width: 0,
    height: 0,
    sourceUrl: null,
    mode: 'h',           // 'h' = side-by-side columns, 'v' = stacked rows, 'grid'
    cols: 3,
    rows: 3,
    tiles: [],           // { thumb, name, label, x, y, w, h, index, blob }
    generation: 0,
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
    // Some Android file pickers report an empty MIME type, so only reject
    // files that clearly aren't images and let decoding decide the rest.
    if (!file || (file.type && !file.type.startsWith('image/'))) {
      toast('Please choose an image file.');
      return;
    }
    let bmp;
    try {
      bmp = await decode(file);
    } catch (e) {
      toast('Could not read this image. Your browser may not support this format.');
      return;
    }
    if (state.source && state.source.close) state.source.close();
    if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
    releaseCanvas(state.preview);

    state.source = bmp;
    state.width = bmp.width || bmp.naturalWidth;
    state.height = bmp.height || bmp.naturalHeight;
    state.sourceUrl = URL.createObjectURL(file);
    buildPreview();

    els.sourceImg.src = state.sourceUrl;
    els.fileName.textContent = file.name || 'Pasted image';
    els.fileDims.textContent = `${state.width} × ${state.height} px · ${formatBytes(file.size)}`;
    els.prefix.value = baseName(file.name || 'image');

    els.dropzone.hidden = true;
    els.workspace.hidden = false;
    render();
  }

  function buildPreview() {
    const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(state.width, state.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(state.width * scale));
    c.height = Math.max(1, Math.round(state.height * scale));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(state.source, 0, 0, c.width, c.height);
    state.preview = c;
    state.previewScale = scale;
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
    const gen = ++state.generation;
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
    if (wSet.length > 1 || hSet.length > 1) {
      const parts = [];
      if (wSet.length > 1) parts.push(`width ${state.width} isn't divisible by ${cols}`);
      if (hSet.length > 1) parts.push(`height ${state.height} isn't divisible by ${rows}`);
      notes.push(`Note: ${parts.join(' and ')}, so some parts are 1px larger. No pixels are lost.`);
    }
    if (isIOS && Math.max(...widths) * Math.max(...heights) > IOS_MAX_CANVAS_PIXELS) {
      notes.push('Parts larger than about 16 megapixels may not export on iOS. Split into more parts if downloads come out blank.');
    }

    clearTiles();

    if (total > MAX_TOTAL_PARTS) {
      notes.push(`Too many parts (${total}). The maximum is ${MAX_TOTAL_PARTS}.`);
      showWarning(notes);
      setExportEnabled(false);
      return;
    }
    showWarning(notes);
    setExportEnabled(true);

    // Build preview tiles from the downscaled copy.
    const prefix = currentPrefix();
    const pad = String(total).length;
    const s = state.previewScale;
    const tiles = [];
    const frag = document.createDocumentFragment();
    let index = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = index++;
        const x = xs[c], y = ys[r], w = widths[c], h = heights[r];
        const label = rows > 1 && cols > 1 ? `r${r + 1}_c${c + 1}` : String(i + 1).padStart(pad, '0');
        const tile = { name: `${prefix}_${label}.png`, label, x, y, w, h, index: i, blob: null };

        const px = Math.round(x * s), py = Math.round(y * s);
        const pw = Math.max(1, Math.round((x + w) * s) - px);
        const ph = Math.max(1, Math.round((y + h) * s) - py);
        const thumb = document.createElement('canvas');
        thumb.width = pw;
        thumb.height = ph;
        // Keep the true aspect ratio even when the thumbnail is rounded.
        thumb.style.aspectRatio = `${w} / ${h}`;
        thumb.getContext('2d').drawImage(state.preview, px, py, pw, ph, 0, 0, pw, ph);
        thumb.title = `${tile.name} — click to enlarge`;
        thumb.addEventListener('click', () => openViewer(i));
        tile.thumb = thumb;
        tiles.push(tile);

        const el = document.createElement('div');
        el.className = 'tile';
        const meta = document.createElement('div');
        meta.className = 'tile-meta';
        const info = document.createElement('span');
        info.innerHTML = `#${i + 1}<span class="dims"> · ${w}×${h}</span>`;
        const dl = document.createElement('button');
        dl.textContent = 'Save';
        dl.title = 'Download this part';
        dl.addEventListener('click', () => downloadTile(tile));
        meta.append(info, dl);
        el.append(thumb, meta);
        frag.append(el);
      }
    }

    els.tiles.style.gridTemplateColumns = widths.map((w) => `minmax(0, ${w}fr)`).join(' ');
    els.tiles.replaceChildren(frag);
    state.tiles = tiles;

    // When sharing is available, pre-encode in the background so the share
    // sheet can open straight from a tap (browsers require a recent gesture).
    if (useShare) setTimeout(() => preEncode(gen), 600);
  }

  function clearTiles() {
    for (const t of state.tiles) releaseCanvas(t.thumb);
    state.tiles = [];
    els.tiles.replaceChildren();
  }

  function showWarning(notes) {
    els.warning.textContent = notes.join(' ');
    els.warning.hidden = notes.length === 0;
  }

  function setExportEnabled(on) {
    els.zipBtn.disabled = !on;
    els.shareAllBtn.disabled = !on;
  }

  function updateGuides(cols, rows) {
    const svg = els.guides;
    svg.setAttribute('viewBox', `0 0 ${state.width} ${state.height}`);
    svg.replaceChildren();
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

  // Render one part at full resolution, encode it as PNG, then free the
  // canvas right away. Results are cached per part.
  async function getBlob(tile) {
    if (tile.blob) return tile.blob;
    const canvas = document.createElement('canvas');
    canvas.width = tile.w;
    canvas.height = tile.h;
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This part is too large for your browser. Try splitting into more parts.');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(state.source, tile.x, tile.y, tile.w, tile.h, 0, 0, tile.w, tile.h);
      tile.blob = await new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed. The part may be too large for this device.'))), 'image/png'));
      return tile.blob;
    } finally {
      releaseCanvas(canvas);
    }
  }

  async function preEncode(gen) {
    for (const t of state.tiles) {
      if (gen !== state.generation) return;
      try { await getBlob(t); } catch (_) { return; }
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
    // Mobile browsers may read the blob late, so keep the URL alive a while.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function downloadTile(tile) {
    try {
      saveBlob(await getBlob(tile), tile.name);
    } catch (e) {
      toast(e.message);
    }
  }

  async function withBusy(btn, fn) {
    const label = btn.textContent;
    btn.disabled = true;
    try {
      return await fn((text) => { btn.textContent = text; });
    } finally {
      btn.textContent = label;
      btn.disabled = false;
    }
  }

  async function encodeAll(progress) {
    const tiles = state.tiles;
    const out = [];
    for (let i = 0; i < tiles.length; i++) {
      progress(`Encoding ${i + 1}/${tiles.length}…`);
      out.push(await getBlob(tiles[i]));
    }
    return out;
  }

  async function downloadZip() {
    if (!state.tiles.length) return;
    const tiles = state.tiles;
    await withBusy(els.zipBtn, async (progress) => {
      try {
        const blobs = await encodeAll(progress);
        progress('Zipping…');
        const files = [];
        for (let i = 0; i < tiles.length; i++) {
          files.push({ name: tiles[i].name, data: new Uint8Array(await blobs[i].arrayBuffer()) });
        }
        saveBlob(createZip(files), `${currentPrefix()}_split.zip`);
      } catch (e) {
        toast('Could not create the ZIP: ' + e.message);
      }
    });
  }

  async function share(tiles, btn) {
    const ready = tiles.every((t) => t.blob);
    const run = async (progress) => {
      const blobs = [];
      for (let i = 0; i < tiles.length; i++) {
        if (!ready) progress(`Preparing ${i + 1}/${tiles.length}…`);
        blobs.push(await getBlob(tiles[i]));
      }
      const files = tiles.map((t, i) => new File([blobs[i]], t.name, { type: 'image/png' }));
      if (!navigator.canShare({ files })) throw new Error('Your device cannot share these files.');
      await navigator.share({ files });
    };
    try {
      await (ready ? run(() => {}) : withBusy(btn, run));
    } catch (e) {
      if (e.name === 'AbortError') return; // user closed the share sheet
      if (e.name === 'NotAllowedError') {
        // Encoding took long enough that the tap no longer counts as recent.
        toast('Ready. Tap Share again.');
        return;
      }
      toast(e.message || 'Sharing failed.');
    }
  }

  /* ---------- Viewer ---------- */

  async function openViewer(i) {
    const tile = state.tiles[i];
    if (!tile) return;
    state.viewerIndex = i;
    els.viewerTitle.textContent = `${tile.name} · ${tile.w} × ${tile.h} (${i + 1}/${state.tiles.length})`;
    els.viewerPrev.disabled = i === 0;
    els.viewerNext.disabled = i === state.tiles.length - 1;
    if (!els.viewer.open) {
      els.viewer.showModal();
      document.documentElement.style.overflow = 'hidden';
    }
    // Show the preview instantly, then swap in the full-resolution part.
    els.viewerImg.src = tile.thumb.toDataURL();
    let blob;
    try {
      blob = await getBlob(tile);
    } catch (e) {
      toast(e.message);
      return;
    }
    if (state.viewerIndex !== i || !els.viewer.open) return;
    if (state.viewerUrl) URL.revokeObjectURL(state.viewerUrl);
    state.viewerUrl = URL.createObjectURL(blob);
    els.viewerImg.src = state.viewerUrl;
  }

  function step(delta) {
    const n = state.viewerIndex + delta;
    if (n >= 0 && n < state.tiles.length) openViewer(n);
  }

  els.viewer.addEventListener('close', () => {
    state.viewerIndex = -1;
    els.viewerImg.removeAttribute('src');
    if (state.viewerUrl) URL.revokeObjectURL(state.viewerUrl);
    state.viewerUrl = null;
    document.documentElement.style.overflow = '';
  });
  els.viewer.addEventListener('click', (e) => { if (e.target === els.viewer) els.viewer.close(); });
  els.viewerClose.addEventListener('click', () => els.viewer.close());
  els.viewerPrev.addEventListener('click', () => step(-1));
  els.viewerNext.addEventListener('click', () => step(1));
  els.viewerDownload.addEventListener('click', () => {
    const t = state.tiles[state.viewerIndex];
    if (t) downloadTile(t);
  });
  els.viewerShare.addEventListener('click', () => {
    const t = state.tiles[state.viewerIndex];
    if (t) share([t], els.viewerShare);
  });
  document.addEventListener('keydown', (e) => {
    if (!els.viewer.open) return;
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });

  // Swipe left/right to move between parts (ignored while pinch-zoomed).
  let touchStart = null;
  els.viewerBody.addEventListener('touchstart', (e) => {
    touchStart = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  els.viewerBody.addEventListener('touchend', (e) => {
    if (!touchStart || e.changedTouches.length !== 1) return;
    if (window.visualViewport && window.visualViewport.scale > 1.01) return;
    const dx = e.changedTouches[0].clientX - touchStart.x;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  }, { passive: true });

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
    setFieldEnabled(els.colsField, colsOn);
    setFieldEnabled(els.rowsField, rowsOn);
    els.cols.value = colsOn ? state.cols : 1;
    els.rows.value = rowsOn ? state.rows : 1;
    render();
  }

  function setFieldEnabled(field, on) {
    field.classList.toggle('disabled', !on);
    field.querySelectorAll('input, button').forEach((el) => { el.disabled = !on; });
  }

  document.querySelectorAll('.seg button').forEach((b) =>
    b.addEventListener('click', () => setMode(b.dataset.mode)));

  let timer = null;
  const renderSoon = () => { clearTimeout(timer); timer = setTimeout(render, 150); };

  function readNumber(input, key) {
    const v = parseInt(input.value, 10);
    if (Number.isFinite(v) && v >= 1) {
      state[key] = Math.min(v, MAX_PARTS_PER_AXIS);
      renderSoon();
    }
  }
  for (const [input, key] of [[els.cols, 'cols'], [els.rows, 'rows']]) {
    input.addEventListener('input', () => readNumber(input, key));
    input.addEventListener('change', () => { if (!input.disabled) input.value = state[key]; });
    input.addEventListener('focus', () => input.select());
  }
  document.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.for;
    state[key] = clamp(state[key] + Number(b.dataset.step), 1, MAX_PARTS_PER_AXIS);
    els[key].value = state[key];
    renderSoon();
  }));

  els.showLines.addEventListener('change', () => {
    const { cols, rows } = currentGrid();
    updateGuides(cols, rows);
  });
  els.prefix.addEventListener('input', () => {
    const prefix = currentPrefix();
    for (const t of state.tiles) {
      t.name = `${prefix}_${t.label}.png`;
      t.thumb.title = `${t.name} — click to enlarge`;
    }
  });
  els.zipBtn.addEventListener('click', downloadZip);
  els.shareAllBtn.addEventListener('click', () => share(state.tiles, els.shareAllBtn));
  els.shareAllBtn.hidden = !useShare;
  els.viewerShare.hidden = !useShare;

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

  let toastTimer = null;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    // Show above the modal viewer when it is open.
    if (els.viewer.open) els.viewer.append(els.toast); else document.body.append(els.toast);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3500);
  }

  // Shrinking a canvas to 0×0 frees its memory immediately. iOS Safari
  // otherwise keeps it around and eventually refuses to create new canvases.
  function releaseCanvas(c) {
    if (c) { c.width = 0; c.height = 0; }
  }

  function currentPrefix() { return sanitize(els.prefix.value) || 'image'; }
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
