// The pannable/zoomable wall: camera state, input handling, per-tile crater
// depth effect, and the render loop.
//
// INFINITE PANNING: rather than pre-building a fixed array of tiles, each
// frame computes which grid cells are currently visible (from camera
// position + zoom), and maps each cell to a word via modulo indexing into
// the (finite) word list. There is no edge -- dragging forever just keeps
// computing new cells and wrapping back through the same word list, like a
// repeating tile pattern. This also means memory/CPU cost stays flat
// regardless of how far you've panned, since we only ever touch the cells
// actually on screen.


const CRATER_RADIUS = 1200;
const CRATER_DEPTH = 0.1;
const CRATER_EDGE_BIAS = 0.9;
const GRID_COLS = 25;
const GRID_GAP = 10;
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 1.2;
const ENABLE_GRADIENT_ANIMATION = false; // flip to false to A/B test performance



// Stagger/spring-follow: each tile eases toward its true position rather
// than snapping instantly, with responsiveness based on distance from the
// cursor -- close tiles react almost immediately, far ones lag and settle
// with a slight bounce. Same system handles both the drag-time stagger and
// the post-release "bounce back to rest", since it's just a spring chasing
// a target that happens to stop moving once you let go.
const STAGGER_RADIUS = 1200;   // px -- distance over which responsiveness varies
const STIFFNESS_NEAR = 0.1;   // near cursor: snappy, minimal lag
const STIFFNESS_FAR = 0.5;    // far from cursor: noticeable lag
const DAMPING_NEAR = 0.32;    // near cursor: little to no overshoot
const DAMPING_FAR = 0.7;     // far from cursor: slight bounce/overshoot when settling
const SETTLE_EPS_POS = 0.2;   // px -- close enough to target to consider settled
const SETTLE_EPS_VEL = 0.02;  // px/frame -- slow enough to consider settled


function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

// Proper modulo (JS's % can return negative for negative inputs, which
// breaks wrapping in the leftward/upward pan directions).
function mod(n, m) {
  return ((n % m) + m) % m;
}

function createWall(canvas, words) {
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext('2d');

  let cssW = 0, cssH = 0;
  let camX = 0, camY = 0, zoom = 1;

  const colStep = CARD_W + GRID_GAP;
  const rowStep = CARD_H + GRID_GAP;
  const blockRows = Math.ceil(words.length / GRID_COLS);

  const BITMAP_REFRESH_INTERVAL = 220;
  const bitmapCache = new Map();
  const BITMAP_SCALE = 2.2 * dpr;

  const wordGridPos = new Map();
  words.forEach((w, i) => {
    wordGridPos.set(w.h, { row: Math.floor(i / GRID_COLS), col: i % GRID_COLS });
  });

  function renderBitmap(word, time) {
    const bmp = document.createElement('canvas');
    bmp.width = CARD_W * BITMAP_SCALE;
    bmp.height = CARD_H * BITMAP_SCALE;
    const bctx = bmp.getContext('2d');
    bctx.scale(BITMAP_SCALE, BITMAP_SCALE);
    const gridPos = wordGridPos.get(word.h) || { row: 0, col: 0 };
    drawHSK1Card(bctx, word, 0, 0, time, gridPos.row, gridPos.col);
    bitmapCache.set(word.h, bmp);
    return bmp;
  }

  function getBitmap(word) {
    const cached = bitmapCache.get(word.h);
    if (cached) return cached;
    return renderBitmap(word, performance.now());
  }

  function resize() {
    cssW = canvas.clientWidth;
    cssH = canvas.clientHeight;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  function craterScaleFor(screenCX, screenCY) {
    const dx = screenCX - cssW / 2;
    const dy = screenCY - cssH / 2;
    const dist = Math.hypot(dx, dy);
    const normalized = Math.min(dist / CRATER_RADIUS, 1);
    const biased = Math.pow(normalized, CRATER_EDGE_BIAS);
    const t = smoothstep(biased);
    return 1 + CRATER_DEPTH * (t * 2 - 1);
  }

  let visibleTiles = [];

  // Per-cell spring state, keyed by grid cell (stable across the infinite
  // wrap, unlike tile objects which are recreated every render() call).
  // Only tracks currently/recently visible cells -- harmless if it grows
  // slowly over a long session, not worth pruning for a prototype this size.
  const staggerState = new Map(); // "row,col" -> {x, y, vx, vy}
  let anyUnsettled = false;

  function updateStagger(key, targetX, targetY, stiffness, damping) {
    let s = staggerState.get(key);
    if (!s) {
      s = { x: targetX, y: targetY, vx: 0, vy: 0 };
      staggerState.set(key, s);
    }
    s.vx = (s.vx + (targetX - s.x) * stiffness) * damping;
    s.vy = (s.vy + (targetY - s.y) * stiffness) * damping;
    s.x += s.vx;
    s.y += s.vy;

    if (Math.abs(targetX - s.x) > SETTLE_EPS_POS || Math.abs(targetY - s.y) > SETTLE_EPS_POS ||
        Math.abs(s.vx) > SETTLE_EPS_VEL || Math.abs(s.vy) > SETTLE_EPS_VEL) {
      anyUnsettled = true;
    }
    return s;
  }

  // Last known pointer position on screen, used as the reference point for
  // stagger responsiveness. Defaults to viewport center so nothing lags
  // before the first drag ever happens.
  let pointerScreenX = null, pointerScreenY = null;

  function render() {
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    visibleTiles = [];
    anyUnsettled = false;

    const refX = pointerScreenX !== null ? pointerScreenX : cssW / 2;
    const refY = pointerScreenY !== null ? pointerScreenY : cssH / 2;

    const worldLeft = (0 - camX) / zoom;
    const worldRight = (cssW - camX) / zoom;
    const worldTop = (0 - camY) / zoom;
    const worldBottom = (cssH - camY) / zoom;

    const colMin = Math.floor(worldLeft / colStep) - 1;
    const colMax = Math.ceil(worldRight / colStep) + 1;
    const rowMin = Math.floor(worldTop / rowStep) - 1;
    const rowMax = Math.ceil(worldBottom / rowStep) + 1;

    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        const wordIndex = mod(row, blockRows) * GRID_COLS + mod(col, GRID_COLS);
        if (wordIndex >= words.length) continue;

        const word = words[wordIndex];
        const worldX = col * colStep;
        const worldY = row * rowStep;

        const targetCX = (worldX + CARD_W / 2) * zoom + camX;
        const targetCY = (worldY + CARD_H / 2) * zoom + camY;

        if (targetCX < -CARD_W || targetCY < -CARD_H || targetCX > cssW + CARD_W || targetCY > cssH + CARD_H) continue;

        const distFromPointer = Math.hypot(targetCX - refX, targetCY - refY);
        const distFactor = Math.min(distFromPointer / STAGGER_RADIUS, 1);
        const stiffness = lerp(STIFFNESS_NEAR, STIFFNESS_FAR, distFactor);
        const damping = lerp(DAMPING_NEAR, DAMPING_FAR, distFactor);

        const key = row + ',' + col;
        const eased = updateStagger(key, targetCX, targetCY, stiffness, damping);

        const cScale = craterScaleFor(eased.x, eased.y);
        const w = CARD_W * zoom * cScale;
        const h = CARD_H * zoom * cScale;
        const x = eased.x - w / 2;
        const y = eased.y - h / 2;

        if (x + w < 0 || y + h < 0 || x > cssW || y > cssH) continue;

        ctx.drawImage(getBitmap(word), x, y, w, h);
        visibleTiles.push({ word, screen: { x, y, w, h } });
      }
    }

    if (typeof devHooks !== 'undefined') devHooks.onRender(ctx, cssW, cssH);
  }

  let dragging = false, dragMoved = false;
  let dragStartX = 0, dragStartY = 0, camStartX = 0, camStartY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    dragMoved = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    camStartX = camX;
    camStartY = camY;
    const rect = canvas.getBoundingClientRect();
    pointerScreenX = e.clientX - rect.left;
    pointerScreenY = e.clientY - rect.top;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
    camX = camStartX + dx;
    camY = camStartY + dy;
    const rect = canvas.getBoundingClientRect();
    pointerScreenX = e.clientX - rect.left;
    pointerScreenY = e.clientY - rect.top;
    render();
  });

  let settleLoopRunning = false;

  function startSettleLoopIfNeeded() {
    if (settleLoopRunning) return;
    settleLoopRunning = true;
    function tick() {
      render();
      if (anyUnsettled) {
        requestAnimationFrame(tick);
      } else {
        settleLoopRunning = false;
      }
    }
    requestAnimationFrame(tick);
  }

  function endDrag() {
    dragging = false;
    canvas.style.cursor = 'grab';
    startSettleLoopIfNeeded();
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const worldX = (px - camX) / zoom;
    const worldY = (py - camY) / zoom;

    const factor = 1 - e.deltaY * 0.0016;
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));

    camX = px - worldX * zoom;
    camY = py - worldY * zoom;
    render();
  }, { passive: false });

  canvas.addEventListener('click', (e) => {
    if (dragMoved) { dragMoved = false; return; }
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const hit = visibleTiles.find(t =>
      px >= t.screen.x && px <= t.screen.x + t.screen.w &&
      py >= t.screen.y && py <= t.screen.y + t.screen.h);
    if (hit) console.log('Clicked word:', hit.word.h, hit.word.p);
  });

  window.addEventListener('resize', resize);

  if (ENABLE_GRADIENT_ANIMATION) {
    setInterval(() => {
      const seen = new Set();
      for (const tile of visibleTiles) {
        if (seen.has(tile.word.h)) continue;
        seen.add(tile.word.h);
        renderBitmap(tile.word, performance.now());
      }
      if (seen.size > 0) render();
    }, BITMAP_REFRESH_INTERVAL);
  }

  resize();
  render();
}