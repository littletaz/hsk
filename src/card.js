const CARD_W = 300;
const CARD_H = 240;

let _noisePatternCache = null;
let _noisePatternDpr = null;

function getNoisePattern(ctx) {
  const dpr = window.devicePixelRatio || 1;
  if (_noisePatternCache && _noisePatternDpr === dpr) return _noisePatternCache;

  const tileSize = 96;
  const sourceSize = Math.round(tileSize * dpr);

  const off = document.createElement('canvas');
  off.width = sourceSize;
  off.height = sourceSize;
  const octx = off.getContext('2d');
  const imgData = octx.createImageData(sourceSize, sourceSize);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const v = Math.floor(Math.random() * 255);
    imgData.data[i] = v;
    imgData.data[i + 1] = v;
    imgData.data[i + 2] = v;
    imgData.data[i + 3] = 255;
  }
  octx.putImageData(imgData, 0, 0);

  const pattern = ctx.createPattern(off, 'repeat');
  if (pattern.setTransform) {
    pattern.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, 0, 0]));
  }

  _noisePatternCache = pattern;
  _noisePatternDpr = dpr;
  return _noisePatternCache;
}

let _cardMaskAlpha = null;

function loadCardMask(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const tmp = document.createElement('canvas');
      tmp.width = img.naturalWidth;
      tmp.height = img.naturalHeight;
      const tctx = tmp.getContext('2d');
      tctx.drawImage(img, 0, 0);

      const data = tctx.getImageData(0, 0, tmp.width, tmp.height);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const luminance = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
        px[i + 3] = luminance;
      }
      tctx.putImageData(data, 0, 0);

      _cardMaskAlpha = tmp;
      resolve(tmp);
    };
    img.onerror = reject;
    img.src = src;
  });
}

// Slow, non-repeating wander for a gradient blob's center. Each blob gets its
// own periods/phases on x and y (a Lissajous-style path) so multiple blobs
// never drift in sync with each other. `time` is in milliseconds.
function driftOffset(time, periodXMs, periodYMs, phaseX, phaseY, ampX, ampY) {
  const t = time / 1000;
  return {
    x: Math.sin(t * (2 * Math.PI / (periodXMs / 1000)) + phaseX) * ampX,
    y: Math.sin(t * (2 * Math.PI / (periodYMs / 1000)) + phaseY) * ampY
  };
}

// Derives a blob's *base* position from the word's canonical grid cell
// (fixed per word -- see wall.js's wordGridPos map) instead of a constant
// shared by every card. Low frequencies mean neighboring cells land close
// together (so scanning across the wall feels like one continuous field
// rather than a hard cut between tiles), while cells further apart in the
// grid diverge -- giving each unique word a genuinely different-looking
// blob layout instead of every card repeating the identical pattern.
function fieldBase(gridRow, gridCol, freqCol, freqRow, phase, centerX, centerY, spreadX, spreadY) {
  const angle = gridCol * freqCol + gridRow * freqRow + phase;
  return {
    x: centerX + Math.sin(angle) * spreadX,
    y: centerY + Math.cos(angle * 1.3) * spreadY
  };
}

function drawHSK1Card(ctx, word, x, y, time, gridRow, gridCol) {
  time = time || 0;
  gridRow = gridRow || 0;
  gridCol = gridCol || 0;
  const dpr = window.devicePixelRatio || 1;

  const off = document.createElement('canvas');
  off.width = CARD_W * dpr;
  off.height = CARD_H * dpr;
  const octx = off.getContext('2d');
  octx.scale(dpr, dpr);

  octx.fillStyle = '#F8B51E';
  octx.fillRect(0, 0, CARD_W, CARD_H);

  function paintBlob(colorRGB, base, baseRadiusFrac, driftPeriods, driftPhases, driftAmps, breathePeriod, breathePhase, breatheAmp) {
    const drift = driftOffset(time, driftPeriods[0], driftPeriods[1], driftPhases[0], driftPhases[1], driftAmps[0], driftAmps[1]);
    const breathe = Math.sin((time / 1000) * (2 * Math.PI / (breathePeriod / 1000)) + breathePhase) * breatheAmp;

    const cx = (base.x + drift.x) * CARD_W;
    const cy = (base.y + drift.y) * CARD_H;
    const r = baseRadiusFrac * CARD_W * (1 + breathe);

    const g = octx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(r, 1));
    g.addColorStop(0, `rgb(${colorRGB})`);
    g.addColorStop(1, `rgba(${colorRGB},0)`);
    octx.fillStyle = g;
    octx.fillRect(0, 0, CARD_W, CARD_H);
  }

  // Each blob: a field-derived base (varies per word, via grid position)
  // plus a much smaller time-drift than the earlier diagnostic version --
  // now that spatial variety is doing the "look different" work, the time
  // component just needs to add gentle liveliness on top, not carry the
  // whole effect.
  const orangeBase = fieldBase(gridRow, gridCol, 0.28, 0.45, 0, 0.32, 0.68, 0.22, 0.18);
  paintBlob('255,96,0', orangeBase, 0.55, [5200, 6100], [0, 1.2], [0.14, 0.11], 4200, 0, 0.18);   // #FF6000

  const yellowBase = fieldBase(gridRow, gridCol, 0.33, 0.4, 2.1, 0.7, 0.25, 0.2, 0.16);
  paintBlob('255,218,0', yellowBase, 0.5, [5800, 5000], [2.1, 0.4], [0.13, 0.14], 4800, 1.5, 0.16); // #FFDA00

  const amberBase = fieldBase(gridRow, gridCol, 0.4, 0.3, 1.0, 0.5, 0.5, 0.25, 0.2);
  paintBlob('255,178,0', amberBase, 0.6, [6400, 5400], [1.0, 2.8], [0.14, 0.13], 5100, 2.4, 0.15);   // #FFB200

  octx.globalCompositeOperation = 'overlay';
  octx.globalAlpha = 0.22;
  octx.fillStyle = getNoisePattern(octx);
  octx.fillRect(0, 0, CARD_W, CARD_H);
  octx.globalAlpha = 1;
  octx.globalCompositeOperation = 'source-over';

  octx.fillStyle = '#1c1712';
  octx.font = '400 53px "Huninn", "Noto Sans SC", sans-serif';
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.fillText(word.h, CARD_W / 2, CARD_H * 0.46);

  octx.fillStyle = 'rgba(28, 23, 18, 0.7)';
  octx.font = '600 15px "Quicksand", sans-serif';
  octx.fillText(word.p, CARD_W / 2, CARD_H * 0.68);

  if (_cardMaskAlpha) {
    octx.globalCompositeOperation = 'destination-in';
    octx.drawImage(_cardMaskAlpha, 0, 0, CARD_W, CARD_H);
    octx.globalCompositeOperation = 'source-over';
  }

  ctx.drawImage(off, x, y, CARD_W, CARD_H);
}