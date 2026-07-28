// The pannable/zoomable wall: camera state, input handling, per-tile crater
// depth effect, and the render loop.

const ENABLE_CRATER_EFFECT = false; // flip to false to A/B test with the effect off
const ENABLE_GRADIENT_ANIMATION = true; // flip to false to A/B test performance
const INFINITE_WALL = false;

const CRATER_RADIUS = 1200;   // px -- distance at which the effect fully settles
const CRATER_DEPTH = 0.1;   // 0..~0.4 -- how strong the shrink/enlarge range is
const CRATER_EDGE_BIAS = 0.9; // >1 concentrates the size change near the rim; 1 = even/gradual
const GRID_GAP = 20;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.2;

const RUBBER_BAND_MAX_OVER = 100;    // px -- roughly the max overscroll, however hard you pull
const BOUNDED_MARGIN = 100; // px -- extra room past the content edge before the hard stop, so there's visible negative space rather than cards flush against the screen edge
const RUBBER_BAND_RESISTANCE = 0.55; // 0..1 -- higher = less give near the edge
const CAM_SPRING_STIFFNESS = 0.2;
const CAM_SPRING_DAMPING = 0.75;

const STAGGER_RADIUS = 1200;   // px -- distance over which responsiveness varies
const STIFFNESS_NEAR = 0.35;   // near cursor: snappy, minimal lag
const STIFFNESS_FAR = 0.2;    // far from cursor: noticeable lag
const DAMPING_NEAR = 0.32;    // near cursor: little to no overshoot
const DAMPING_FAR = 0.7;     // far from cursor: slight bounce/overshoot when settling
const SETTLE_EPS_POS = 0.2;   // px -- close enough to target to consider settled
const SETTLE_EPS_VEL = 0.02;  // px/frame -- slow enough to consider settled

const FILTER_STAGGER_RADIUS = 900;    // px -- distance range over which stagger delay varies
const FILTER_EXIT_DURATION = 260;     // ms -- each tile's own shrink duration
const FILTER_ENTER_DURATION = 320;    // ms -- each tile's own grow duration
const FILTER_STAGGER_MAX_DELAY = 220; // ms -- extra delay for the farthest-out tile

const RESPONSIVE_SCALE = CARD_W / 300;

// --- Border misregistration (all four are meant to be tuned by eye) ---
// BORDER_MARGIN = 4 matches the border image's own baked-in margin
// (308x188 artwork over a 300x180 card), so the artwork renders at its
// intended proportions. Changing it makes the frame sit tighter/looser
// than drawn, which also stretches the line thickness slightly.
const BORDER_MARGIN = -3;
const BORDER_OFFSET_RANGE = 3;     // px -- max seeded resting drift in x/y
const BORDER_ROTATION_RANGE = 4;   // degrees -- max seeded tilt
const MAX_BORDER_OFFSET = 3;       // px -- hard clamp on seeded + lag combined

// --- Pan lag: border trails the card's motion, then springs back ---
const PAN_LAG_STIFFNESS = 0.3;
const PAN_LAG_DAMPING = 0.55;
const PAN_LAG_VELOCITY_SCALE = 0.15; // how much of a tile's velocity becomes lag displacement


function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Column count as a function of word count, aiming for a 5:4 (columns:rows)
// grid shape rather than a fixed width or a perfect square. Recomputed
// every time the active word list changes (see setActiveWords /
// updateTransitionPhase) -- not a fixed constant, since a good column count
// for 300 words is a bad one for 10.
function computeGridCols(wordCount) {
  return Math.max(1, Math.ceil(Math.sqrt(wordCount * 5 / 4)));
}

// Proper modulo (JS's % can return negative for negative inputs, which
// breaks wrapping in the leftward/upward pan directions).
function mod(n, m) {
  return ((n % m) + m) % m;
}

// Identity key for caches/state keyed by word (bitmaps, open/dim state,
// bump timing, spotlight, grid position). Uses each word's stamped id
// (set once per data file, e.g. HSK2.forEach((w,i) => w.id = 'hsk2_'+i))
// rather than hanzi alone -- hanzi can collide even within one level
// (HSK3's 得 dé "to get" vs 得 děi "must" -- same character, genuinely
// different words) and even hanzi+level can collide across levels or
// within a level, so word.id is the only fully reliable key.
function wordKey(word) {
  return word.id || (word.h + '_' + word.lvl);
}

function createWall(canvas, words) {
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext('2d');

  let cssW = 0, cssH = 0;
  let camX = 0, camY = 0, zoom = 1;

  const colStep = CARD_W + GRID_GAP;
  const rowStep = CARD_H + GRID_GAP;
  let GRID_COLS = computeGridCols(words.length);
  let blockRows = Math.ceil(words.length / GRID_COLS);

  // Per-word bitmap cache -- each unique word is pre-rendered once and
  // reused for every tile showing that word, however many times it repeats
  // across the infinite wrap. Bitmaps are periodically regenerated (see
  // BITMAP_REFRESH_INTERVAL below) with a new time value, which is what
  // drives the gradient drift -- the wall's pan/zoom itself stays purely
  // event-driven and unaffected; only the cached tile artwork changes.
  const BITMAP_REFRESH_INTERVAL = 220; // ms -- ~4.5 refreshes/sec, plenty for slow drift
  const bitmapCache = new Map(); // wordKey(word) -> HTMLCanvasElement
  const BITMAP_SCALE = 2.2 * dpr; // headroom so crater-enlarged tiles stay crisp

  // Each word's fixed position within the repeating block -- used to seed
  // that word's blob field layout (see fieldBase in card.js) so different
  // words look visibly different from each other, while every wrapped
  // repeat of the *same* word still shares one identical cached bitmap.
  // Rebuilt whenever the active word list changes (see setActiveWords).
  let wordGridPos = new Map(); // wordKey(word) -> { row, col }
  function rebuildWordGridPos() {
    wordGridPos = new Map();
    words.forEach((w, i) => {
      wordGridPos.set(wordKey(w), { row: Math.floor(i / GRID_COLS), col: i % GRID_COLS });
    });
  }
  rebuildWordGridPos();

  function renderBitmap(word, time) {
    const bmp = document.createElement('canvas');
    bmp.width = CARD_W * BITMAP_SCALE;
    bmp.height = CARD_H * BITMAP_SCALE;
    const bctx = bmp.getContext('2d');
    bctx.scale(BITMAP_SCALE, BITMAP_SCALE);
    const gridPos = wordGridPos.get(wordKey(word)) || { row: 0, col: 0 };
    drawHSK1Card(bctx, word, 0, 0, time, gridPos.row, gridPos.col);
    bitmapCache.set(wordKey(word), bmp);
    return bmp;
  }

  function getBitmap(word) {
    const cached = bitmapCache.get(wordKey(word));
    if (cached) return cached;
    return renderBitmap(word, performance.now()); // first draw, synchronous
  }

  function resize() {
    cssW = canvas.clientWidth;
    cssH = canvas.clientHeight;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  // Simple deterministic string hash -> [0,1). Not cryptographic, doesn't
  // need to be -- just needs to give the same word the same "random" value
  // every time, forever, without storing anything.
function seededRandom(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 10000) / 10000;
}

// Each word's resting (non-lagged) border offset/rotation. Cached per word
// since it never changes -- no reason to recompute the hash every frame.
const borderOffsetCache = new Map(); // wordKey(word) -> { x, y, rotation }

function borderOffsetFor(word) {
  const key = wordKey(word);
  const cached = borderOffsetCache.get(key);
  if (cached) return cached;

  const rx = seededRandom(key + '_bx') * 2 - 1; // -1..1
  const ry = seededRandom(key + '_by') * 2 - 1;
  const rr = seededRandom(key + '_br') * 2 - 1;
  const result = {
    x: rx * BORDER_OFFSET_RANGE,
    y: ry * BORDER_OFFSET_RANGE,
    rotation: rr * BORDER_ROTATION_RANGE
  };
  borderOffsetCache.set(key, result);
  return result;
}

// Per-cell spring (same "row,col" key as the primary stagger) that adds a
// small extra displacement, opposite the tile's current velocity, while
// it's moving fast -- reads as the border "lagging behind" the card's
// motion -- and relaxes back to (0,0) as the tile's own velocity decays.
const borderLagState = new Map(); // "row,col" -> { x, y, vx, vy }

function updateBorderLag(key, velX, velY) {
  let s = borderLagState.get(key);
  if (!s) {
    s = { x: 0, y: 0, vx: 0, vy: 0 };
    borderLagState.set(key, s);
  }
  const targetX = -velX * PAN_LAG_VELOCITY_SCALE;
  const targetY = -velY * PAN_LAG_VELOCITY_SCALE;
  s.vx = (s.vx + (targetX - s.x) * PAN_LAG_STIFFNESS) * PAN_LAG_DAMPING;
  s.vy = (s.vy + (targetY - s.y) * PAN_LAG_STIFFNESS) * PAN_LAG_DAMPING;
  s.x += s.vx;
  s.y += s.vy;

  if (Math.abs(targetX - s.x) > 0.1 || Math.abs(targetY - s.y) > 0.1 ||
      Math.abs(s.vx) > 0.05 || Math.abs(s.vy) > 0.05) {
    anyUnsettled = true;
  }
  return s;
}

// Draws the border artwork (see loadCardBorder in card.js) as a separate
// layer over the card, offset and rotated per its seed + pan lag. Only the
// border rotates -- the card bitmap itself is always drawn axis-aligned,
// which is what produces the misregistration look.
//
// The source image is 308x188 against a 300x180 card, i.e. it has a uniform
// 4px margin baked into the artwork; BORDER_MARGIN = 4 therefore reproduces
// it at its exact intended proportions with no distortion. The margin is
// multiplied by the tile's current on-screen scale so it tracks zoom rather
// than staying a fixed pixel amount as cards shrink.
function drawCardBorder(screenX, screenY, w, h, offsetX, offsetY, rotationDeg) {
  if (!_cardBorderImg) return; // not loaded yet -- skip this frame
  const scale = w / CARD_W;
  const margin = BORDER_MARGIN * scale;
  const bw = w + margin * 2;
  const bh = h + margin * 2;
  ctx.save();
  ctx.translate(screenX + w / 2 + offsetX, screenY + h / 2 + offsetY);
  ctx.rotate(rotationDeg * Math.PI / 180);
  ctx.drawImage(_cardBorderImg, -bw / 2, -bh / 2, bw, bh);
  ctx.restore();
}

  function craterScaleFor(screenCX, screenCY) {
    if (!ENABLE_CRATER_EFFECT) return 1;
    const dx = screenCX - cssW / 2;
    const dy = screenCY - cssH / 2;
    const dist = Math.hypot(dx, dy);
    const normalized = Math.min(dist / CRATER_RADIUS, 1);
    const biased = Math.pow(normalized, CRATER_EDGE_BIAS);
    const t = smoothstep(biased);
    // t=0 (center) -> shrunk; t=1 (at/past radius) -> enlarged.
    return 1 + CRATER_DEPTH * (t * 2 - 1);
  }

  // Maps a grid cell to a word index. In infinite mode, wraps forever via
  // modulo. In bounded mode, cells outside the actual content simply have
  // no word (-1) -- no wrap, so the content has a real edge.
  function cellWordIndex(row, col) {
    if (INFINITE_WALL) {
      const idx = mod(row, blockRows) * GRID_COLS + mod(col, GRID_COLS);
      return idx < words.length ? idx : -1;
    }
    if (row < 0 || col < 0 || col >= GRID_COLS) return -1;
    const idx = row * GRID_COLS + col;
    return idx < words.length ? idx : -1;
  }

  // Camera pan bounds at the current zoom (bounded mode only). If the
  // content is smaller than the viewport at this zoom, there's no real
  // range to drag within -- content just sits centered.
  // Actual occupied width in columns -- GRID_COLS once there's enough
  // content to fill every column, but narrower whenever the word count is
  // smaller than that (otherwise centering/bounds math assumes content
  // spans the full width even when it doesn't, landing far off to the
  // side of where the cards actually are).
  function occupiedCols(wordCount) {
    return Math.min(wordCount, GRID_COLS);
  }

  function getCameraBounds() {
    const contentW = occupiedCols(words.length) * colStep - GRID_GAP;
    const contentH = blockRows * rowStep - GRID_GAP;
    const scaledW = contentW * zoom;
    const scaledH = contentH * zoom;

    let minX, maxX, minY, maxY;
    if (scaledW <= cssW) {
      minX = maxX = (cssW - scaledW) / 2;
    } else {
      minX = cssW - scaledW - BOUNDED_MARGIN;
      maxX = BOUNDED_MARGIN;
    }
    if (scaledH <= cssH) {
      minY = maxY = (cssH - scaledH) / 2;
    } else {
      minY = cssH - scaledH - BOUNDED_MARGIN;
      maxY = BOUNDED_MARGIN;
    }
    return { minX, maxX, minY, maxY };
  }

  function dampOver(over) {
    return (RUBBER_BAND_MAX_OVER * over * RUBBER_BAND_RESISTANCE) /
           (RUBBER_BAND_MAX_OVER + over * RUBBER_BAND_RESISTANCE);
  }

  function applyRubberBand(value, min, max) {
    if (value < min) return min - dampOver(min - value);
    if (value > max) return max + dampOver(value - max);
    return value;
  }

  // ---------- Generalized camera targeting ----------
  // One spring, one target, reused for three different callers: snapping
  // back into bounds after a rubber-banded drag, recentering after a filter
  // change, and (later) jumping to a specific searched word. Whoever sets a
  // target last wins; the spring itself doesn't know or care why it's
  // moving toward a given point.
  let camVX = 0, camVY = 0;
  let camTargetX = null, camTargetY = null;

  function setCameraTarget(x, y) {
    camTargetX = x;
    camTargetY = y;
  }

  function updateCameraSpring() {
    if (camTargetX === null) return;
    const closeEnough =
      Math.abs(camTargetX - camX) < 0.5 && Math.abs(camTargetY - camY) < 0.5 &&
      Math.abs(camVX) < 0.05 && Math.abs(camVY) < 0.05;
    if (closeEnough) {
      camX = camTargetX; camY = camTargetY; camVX = 0; camVY = 0;
      camTargetX = null; camTargetY = null;
      return;
    }
    camVX = (camVX + (camTargetX - camX) * CAM_SPRING_STIFFNESS) * CAM_SPRING_DAMPING;
    camVY = (camVY + (camTargetY - camY) * CAM_SPRING_STIFFNESS) * CAM_SPRING_DAMPING;
    camX += camVX;
    camY += camVY;
    anyUnsettled = true;
  }

  // Bounded mode only: if panned out of bounds and nothing else has already
  // claimed the camera (a filter recenter, a future search jump), ease back.
  function checkBoundsAndSnapBack() {
    if (INFINITE_WALL || dragging || camTargetX !== null) return;
    const { minX, maxX, minY, maxY } = getCameraBounds();
    const targetX = Math.min(Math.max(camX, minX), maxX);
    const targetY = Math.min(Math.max(camY, minY), maxY);
    if (Math.abs(targetX - camX) > 0.5 || Math.abs(targetY - camY) > 0.5) {
      setCameraTarget(targetX, targetY);
    }
  }

  // Centers the camera on an arbitrary world-space point -- the shared
  // primitive underneath the two functions below.
  function centerCameraOnWorldPoint(worldX, worldY) {
    let targetX = cssW / 2 - worldX * zoom;
    let targetY = cssH / 2 - worldY * zoom;
    if (!INFINITE_WALL) {
      const { minX, maxX, minY, maxY } = getCameraBounds();
      targetX = Math.min(Math.max(targetX, minX), maxX);
      targetY = Math.min(Math.max(targetY, minY), maxY);
    }
    setCameraTarget(targetX, targetY);
  }

  // Recenters on the geometric middle of a word list of the given length,
  // without needing that list to be the currently-active one yet (used
  // mid-transition, right as the data swaps but before blockRows updates
  // elsewhere have necessarily happened).
  function centerCameraOnContent(wordCount) {
    const rows = Math.ceil(wordCount / GRID_COLS);
    const contentW = occupiedCols(wordCount) * colStep - GRID_GAP;
    const contentH = rows * rowStep - GRID_GAP;
    centerCameraOnWorldPoint(contentW / 2, contentH / 2);
  }

  // Jumps to a specific word by its index in the *currently active* words
  // array, and gives it a bump-highlight on arrival (reusing the same bump
  // used for click-to-open) so it's easy to spot once the camera settles
  // there. Exposed via createWall's return value -- used by search now.
  function centerCameraOnWordIndex(index, spotlight) {
    const row = Math.floor(index / GRID_COLS);
    const col = index % GRID_COLS;
    centerCameraOnWorldPoint(col * colStep + CARD_W / 2, row * rowStep + CARD_H / 2);
    const word = words[index];
    if (word) {
      bumpStartTimes.set(wordKey(word), performance.now());
      if (spotlight) spotlightWordH = wordKey(word);
      startSettleLoopIfNeeded();
    }
  }

  // ---------- Filter-change transition ----------
  let transitionPhase = 'idle'; // 'idle' | 'exiting' | 'entering'
  let transitionStartTime = 0;
  let pendingWords = null;

  // Swaps which words the wall displays (used by the filters). Rather than
  // swapping immediately, kicks off the shrink-out phase -- see
  // updateTransitionPhase for the rest of the sequence.
  function setActiveWords(newWords) {
    pendingWords = newWords;
    transitionPhase = 'exiting';
    transitionStartTime = performance.now();
    startSettleLoopIfNeeded();
  }

  function transitionScaleFor(screenCX, screenCY) {
    if (transitionPhase === 'idle') return 1;

    const dist = Math.hypot(screenCX - cssW / 2, screenCY - cssH / 2);
    const distFactor = Math.min(dist / FILTER_STAGGER_RADIUS, 1);
    const delay = distFactor * FILTER_STAGGER_MAX_DELAY;
    const duration = transitionPhase === 'exiting' ? FILTER_EXIT_DURATION : FILTER_ENTER_DURATION;
    const elapsed = performance.now() - transitionStartTime - delay;
    const t = Math.min(Math.max(elapsed / duration, 0), 1);
    const eased = easeInOutCubic(t);

    anyUnsettled = true;
    return transitionPhase === 'exiting' ? (1 - eased) : eased;
  }

  // Advances exiting -> (data swap + recenter) -> entering -> idle. Called
  // once at the top of every render() so the same frame that finishes
  // exiting can immediately start entering with the new data.
  function updateTransitionPhase() {
    if (transitionPhase === 'idle') return;

    const totalExit = FILTER_STAGGER_MAX_DELAY + FILTER_EXIT_DURATION;
    const totalEnter = FILTER_STAGGER_MAX_DELAY + FILTER_ENTER_DURATION;
    const elapsed = performance.now() - transitionStartTime;

    if (transitionPhase === 'exiting' && elapsed >= totalExit) {
      words = pendingWords;
      pendingWords = null;
      GRID_COLS = computeGridCols(words.length);
      blockRows = Math.ceil(words.length / GRID_COLS);
      rebuildWordGridPos();
      bitmapCache.clear();
      openBitmapCache.clear();
      centerCameraOnContent(words.length);
      transitionPhase = 'entering';
      transitionStartTime = performance.now();
      anyUnsettled = true;
    } else if (transitionPhase === 'entering' && elapsed >= totalEnter) {
      transitionPhase = 'idle';
    } else {
      anyUnsettled = true;
    }
  }

  // Tiles currently drawn, rebuilt every render() call. Reused for
  // hit-testing on click so we don't compute visibility twice.
  let visibleTiles = [];

  // Words currently showing the "open" (definition) state instead of their
  // normal gradient card. Keyed by word, not by tile position -- tapping any
  // instance opens every instance of that word across the wrap.
  const openWords = new Set();

  // Search spotlight: while set, every tile except this word renders using
  // the flat, muted card (see drawDimmedCard in card.js) at reduced scale,
  // making a search result stand out against the rest of the wall. Cleared
  // automatically the moment a new drag starts (see pointerdown below).
  // Scale-down is centered on the tile's own position (same eased.x/eased.y
  // anchor as every other scale effect), so it shrinks in place -- grid
  // spacing itself never changes, only how large a tile renders within it.
  const SPOTLIGHT_DIM_SCALE = 0.75;
  let spotlightWordH = null;
  const dimBitmapCache = new Map(); // wordKey(word) -> HTMLCanvasElement, static, no drift

  function getDimBitmap(word) {
    const cached = dimBitmapCache.get(wordKey(word));
    if (cached) return cached;
    const bmp = document.createElement('canvas');
    bmp.width = CARD_W * BITMAP_SCALE;
    bmp.height = CARD_H * BITMAP_SCALE;
    const bctx = bmp.getContext('2d');
    bctx.scale(BITMAP_SCALE, BITMAP_SCALE);
    drawDimmedCard(bctx, word, 0, 0);
    dimBitmapCache.set(wordKey(word), bmp);
    return bmp;
  }

  // Search spotlight: while set, every tile except this word renders dimmed,
  // making a search result stand out against the rest of the wall. Cleared
  // automatically the moment a new drag starts (see pointerdown below).
  // Dim amount is a placeholder -- exact look not designed yet, easy to tune.
  const openBitmapCache = new Map(); // wordKey(word) -> HTMLCanvasElement, rendered once (static, no drift)

  function getOpenBitmap(word) {
    const cached = openBitmapCache.get(wordKey(word));
    if (cached) return cached;
    const bmp = document.createElement('canvas');
    bmp.width = CARD_W * BITMAP_SCALE;
    bmp.height = CARD_H * BITMAP_SCALE;
    const bctx = bmp.getContext('2d');
    bctx.scale(BITMAP_SCALE, BITMAP_SCALE);
    drawOpenCard(bctx, word, 0, 0);
    openBitmapCache.set(wordKey(word), bmp);
    return bmp;
  }

  // Tiny "bump" pop whenever a word's open state is toggled. Reuses the
  // existing settle loop (via anyUnsettled) rather than needing a separate
  // animation loop -- the bump just keeps that loop alive a bit longer.
  const BUMP_DURATION = 260; // ms
  const BUMP_PEAK = 0.12;    // extra scale at the peak of the pop
  const bumpStartTimes = new Map(); // wordKey(word) -> performance.now() at last toggle

  function bumpScaleFor(wordH) {
    const start = bumpStartTimes.get(wordH);
    if (start == null) return 1;
    const elapsed = performance.now() - start;
    if (elapsed >= BUMP_DURATION) return 1;
    anyUnsettled = true;
    const t = elapsed / BUMP_DURATION;
    return 1 + BUMP_PEAK * Math.sin(t * Math.PI);
  }

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
    updateTransitionPhase();
    checkBoundsAndSnapBack();
    updateCameraSpring();

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    visibleTiles = [];
    anyUnsettled = false;

    const refX = pointerScreenX !== null ? pointerScreenX : cssW / 2;
    const refY = pointerScreenY !== null ? pointerScreenY : cssH / 2;

    // World-space rectangle currently visible, with a one-tile buffer so
    // tiles partially entering the view (or enlarged by the crater effect
    // near the rim) don't pop in/out abruptly.
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
        const wordIndex = cellWordIndex(row, col);
        if (wordIndex < 0) continue;

        const word = words[wordIndex];
        const worldX = col * colStep;
        const worldY = row * rowStep;

        const targetCX = (worldX + CARD_W / 2) * zoom + camX;
        const targetCY = (worldY + CARD_H / 2) * zoom + camY;

        // Cull against the *target* position (cheap, and near enough to
        // correct -- a tile settling in from off-screen for a frame or two
        // isn't worth the extra bookkeeping to prevent).
        if (targetCX < -CARD_W || targetCY < -CARD_H || targetCX > cssW + CARD_W || targetCY > cssH + CARD_H) continue;

        const distFromPointer = Math.hypot(targetCX - refX, targetCY - refY);
        const distFactor = Math.min(distFromPointer / STAGGER_RADIUS, 1);
        const stiffness = lerp(STIFFNESS_NEAR, STIFFNESS_FAR, distFactor);
        const damping = lerp(DAMPING_NEAR, DAMPING_FAR, distFactor);

        const key = row + ',' + col;
        const eased = updateStagger(key, targetCX, targetCY, stiffness, damping);

        const isDimmed = spotlightWordH !== null && wordKey(word) !== spotlightWordH;
        const dimScale = isDimmed ? SPOTLIGHT_DIM_SCALE : 1;
        const cScale = craterScaleFor(eased.x, eased.y);
        const bump = bumpScaleFor(wordKey(word));
        const tScale = transitionScaleFor(eased.x, eased.y);
        const totalScale = cScale * bump * tScale * dimScale;
        const w = CARD_W * zoom * totalScale;
        const h = CARD_H * zoom * totalScale;
        const x = eased.x - w / 2;
        const y = eased.y - h / 2;

        if (w < 0.5 || h < 0.5) continue; // fully shrunk during a transition
        if (x + w < 0 || y + h < 0 || x > cssW || y > cssH) continue;

        const isOpen = openWords.has(wordKey(word));
        const bmp = isDimmed ? getDimBitmap(word) : (isOpen ? getOpenBitmap(word) : getBitmap(word));
        ctx.drawImage(bmp, x, y, w, h);
        visibleTiles.push({ word, screen: { x, y, w, h } });

        // Border is part of the normal card's identity only -- the open
        // (definition) card and the dimmed search state both drop it, so
        // those states read as clearly set apart rather than just recolored.
        // Skipping the lag spring too means no wasted settle-loop frames
        // animating something that isn't drawn.
        if (!isOpen && !isDimmed) {
          const resting = borderOffsetFor(word);
          const lag = updateBorderLag(key, eased.vx, eased.vy);
          let borderX = resting.x + lag.x;
          let borderY = resting.y + lag.y;
          const borderDist = Math.hypot(borderX, borderY);
          if (borderDist > MAX_BORDER_OFFSET) {
            const clampScale = MAX_BORDER_OFFSET / borderDist;
            borderX *= clampScale;
            borderY *= clampScale;
          }
          drawCardBorder(x, y, w, h, borderX, borderY, resting.rotation);
        }
      }
    }

    // Dev-only, no-op if src/dev-tools.js isn't loaded (see that file to
    // remove all dev tooling later in one place).
    if (typeof devHooks !== 'undefined') devHooks.onRender(ctx, cssW, cssH);
  }

  // ---------- Pan (drag) ----------
  let dragging = false, dragMoved = false;
  let dragStartX = 0, dragStartY = 0, camStartX = 0, camStartY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    dragMoved = false;
    spotlightWordH = null;
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

    let newCamX = camStartX + dx;
    let newCamY = camStartY + dy;
    if (!INFINITE_WALL) {
      const { minX, maxX, minY, maxY } = getCameraBounds();
      newCamX = applyRubberBand(newCamX, minX, maxX);
      newCamY = applyRubberBand(newCamY, minY, maxY);
    }
    camX = newCamX;
    camY = newCamY;

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
    startSettleLoopIfNeeded(); // lets lagging tiles catch up / bounce to rest
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---------- Zoom (wheel, toward cursor) ----------
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

  // ---------- Click-to-open (toggles the word's open state; every instance
  // of that word across the wrap flips together, since "open" is tracked
  // per-word, not per-tile) ----------
  canvas.addEventListener('click', (e) => {
    if (dragMoved) { dragMoved = false; return; }
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const hit = visibleTiles.find(t =>
      px >= t.screen.x && px <= t.screen.x + t.screen.w &&
      py >= t.screen.y && py <= t.screen.y + t.screen.h);
    if (!hit) return;

    const key = wordKey(hit.word);
    if (openWords.has(key)) {
      openWords.delete(key);
    } else {
      openWords.add(key);
    }
    bumpStartTimes.set(key, performance.now());
    render();
    startSettleLoopIfNeeded();
  });

  window.addEventListener('resize', resize);

  // Keeps the gradient drift moving: every tick, regenerate the bitmap for
  // each currently-visible unique word (not every tile -- a repeated word
  // only costs one redraw regardless of how many times it's on screen),
  // then redraw the canvas so the change is visible. Deliberately slow
  // (~4.5/sec) since the drift itself is slow -- no need for 60fps here.
  if (ENABLE_GRADIENT_ANIMATION) {
    setInterval(() => {
      const seen = new Set();
      for (const tile of visibleTiles) {
        if (seen.has(wordKey(tile.word))) continue;
        if (openWords.has(wordKey(tile.word))) continue; // not currently displayed, skip
        seen.add(wordKey(tile.word));
        renderBitmap(tile.word, performance.now());
      }
      if (seen.size > 0) render();
    }, BITMAP_REFRESH_INTERVAL);
  }

  resize();
  render();

  return { setActiveWords, centerCameraOnWordIndex };
}