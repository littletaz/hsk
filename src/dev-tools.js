// Development-only utilities -- not part of the actual wall.
//
// To remove all dev tooling later: delete this file, remove its <script>
// tag from index.html, and remove the one guarded call to devHooks.onRender
// in wall.js's render() function. Nothing else references this file.
//
// Add more dev tools by adding more methods here (e.g. a camera/zoom
// readout, visible-tile count, cache size) and calling them the same way.

const devHooks = {
  fps: 0,
  _fpsFrames: 0,
  _fpsLastTime: performance.now(),

  onRender(ctx, cssW, cssH) {
    this._fpsFrames++;
    const now = performance.now();
    if (now - this._fpsLastTime >= 500) {
      this.fps = Math.round((this._fpsFrames * 1000) / (now - this._fpsLastTime));
      this._fpsFrames = 0;
      this._fpsLastTime = now;
    }

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(8, 8, 60, 22);
    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(this.fps + ' fps', 14, 13);
  }
};