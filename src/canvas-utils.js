// Sizes a canvas's backing resolution to the screen's actual pixel density,
// so drawing (text, gradients, everything) is crisp on Retina/HiDPI
// displays instead of rendering at 1x and looking soft.
//
// Usage: const ctx = setupHiDPICanvas(canvas, 420, 340);
// cssWidth/cssHeight are the size you want the canvas to occupy on screen --
// draw using those same dimensions afterward, the scaling is handled for you.

function setupHiDPICanvas(canvas, cssWidth, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}