// Canvas2D renderer for a single vocabulary card.
//
// Two separate effects compose together here:
// 1. Surface grain -- fine noise overlaid on the gradient fill (unchanged
//    from before).
// 2. Edge erosion -- the card's silhouette is clipped through an alpha mask
//    (assets/card-mask.png) instead of a crisp rounded-rect path, giving the
//    organic, sprayed-edge boundary from the reference design.

const CARD_W = 300;   // was 400
const CARD_H = 240;   // was 320

// ---------- Grain (surface texture) ----------
let _noisePatternCache = null;
let _noisePatternDpr = null;

function getNoisePattern(ctx) {
  const dpr = window.devicePixelRatio || 1;
  if (_noisePatternCache && _noisePatternDpr === dpr) return _noisePatternCache;

  const tileSize = 96;   // was 128 -- keeps grain density visually consistent at the smaller size
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

// ---------- Edge mask (shape silhouette) ----------
let _cardMaskAlpha = null; // cached, converted from color to alpha

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
        // White -> alpha 255 (kept), black -> alpha 0 (erased). Color itself
        // becomes irrelevant once this is used purely for its alpha.
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

// ---------- Card ----------
// Draws one HSK1-colored card at (x, y) in the given canvas context.
// `word` is a data entry from data/hsk1.js: { h, p, pos, def, ctx, ex, learned }.
function drawHSK1Card(ctx, word, x, y) {
  const dpr = window.devicePixelRatio || 1;

  // Drawn on an offscreen buffer first, so the mask can clip the whole
  // finished card (gradients + grain + text) in one step at the end.
  const off = document.createElement('canvas');
  off.width = CARD_W * dpr;
  off.height = CARD_H * dpr;
  const octx = off.getContext('2d');
  octx.scale(dpr, dpr);

  // Solid fallback so there are no transparent gaps once the gradients'
  // faded edges are layered on top.
  octx.fillStyle = '#FFB300';
  octx.fillRect(0, 0, CARD_W, CARD_H);

  // Orange undertone, bleeding in from the bottom-left.
  const orangeGlow = octx.createRadialGradient(
    CARD_W * 0.15, CARD_H * 0.92, 0,
    CARD_W * 0.15, CARD_H * 0.92, CARD_W * 1.05
  );
  orangeGlow.addColorStop(0, '#FF6000');
  orangeGlow.addColorStop(0.346, '#FF7D00');
  orangeGlow.addColorStop(0.692, 'rgba(255, 182, 0, 0.59)');
  orangeGlow.addColorStop(1, 'rgba(255, 217, 0, 0)');
  octx.fillStyle = orangeGlow;
  octx.fillRect(0, 0, CARD_W, CARD_H);

  // Yellow glow, top-right, screen-blended so both layers stay visible.
  const yellowGlow = octx.createRadialGradient(
    CARD_W * 0.78, CARD_H * 0.12, 0,
    CARD_W * 0.78, CARD_H * 0.12, CARD_W * 1.1
  );
  yellowGlow.addColorStop(0, '#FFDA00');
  yellowGlow.addColorStop(0.5117, '#FFCC00');
  yellowGlow.addColorStop(1, '#FFB300');
  octx.globalCompositeOperation = 'screen';
  octx.fillStyle = yellowGlow;
  octx.fillRect(0, 0, CARD_W, CARD_H);
  octx.globalCompositeOperation = 'source-over';

  // Grain.
  octx.globalCompositeOperation = 'overlay';
  octx.globalAlpha = 0.22;
  octx.fillStyle = getNoisePattern(octx);
  octx.fillRect(0, 0, CARD_W, CARD_H);
  octx.globalAlpha = 1;
  octx.globalCompositeOperation = 'source-over';

  // Hanzi.
  octx.fillStyle = '#1c1712';
  octx.font = '400 70px "Huninn", "Noto Sans SC", sans-serif';
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.fillText(word.h, CARD_W / 2, CARD_H * 0.46);

  // Pinyin.
  octx.fillStyle = 'rgba(28, 23, 18, 0.7)';
  octx.font = '600 16px "Quicksand", sans-serif';
  octx.fillText(word.p, CARD_W / 2, CARD_H * 0.68);

  // Clip the finished card through the organic edge mask.
  if (_cardMaskAlpha) {
    octx.globalCompositeOperation = 'destination-in';
    octx.drawImage(_cardMaskAlpha, 0, 0, CARD_W, CARD_H);
    octx.globalCompositeOperation = 'source-over';
  }

  ctx.drawImage(off, x, y, CARD_W, CARD_H);
}