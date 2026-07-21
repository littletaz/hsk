// Mouse-driven 3D tilt + hover "bump" for a card element (the canvas).
// Purely a CSS transform -- doesn't touch whatever is drawn inside it.

function attachTilt(el, options) {
  const opts = Object.assign({
    maxTilt: 12,       // max rotation in degrees, either axis
    perspective: 700,  // px -- lower = more exaggerated depth
    bumpZ: 24,         // px -- how far the card lifts toward the viewer on hover
    easeMove: 60,      // ms transition while the mouse is moving (snappy)
    easeLeave: 400     // ms transition when resetting to flat (smooth)
  }, options || {});

  let enabled = true;

  el.style.willChange = 'transform';
  el.style.transition = `transform ${opts.easeLeave}ms cubic-bezier(.2,.8,.3,1)`;

  function setTilt(rotateX, rotateY, z) {
    el.style.transform =
      `perspective(${opts.perspective}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(${z}px)`;
  }

  function reset(withTransition, duration) {
    const d = duration != null ? duration : opts.easeLeave;
    el.style.transition = withTransition ? `transform ${d}ms cubic-bezier(.2,.8,.3,1)` : 'none';
    setTilt(0, 0, 0);
  }

  el.addEventListener('mouseenter', () => {
    if (!enabled) return;
    el.style.transition = `transform ${opts.easeMove}ms linear`;
  });

  el.addEventListener('mousemove', (e) => {
    if (!enabled) return;
    const rect = el.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;

    const rotateY = nx * opts.maxTilt;
    const rotateX = -ny * opts.maxTilt;

    setTilt(rotateX, rotateY, opts.bumpZ);
  });

  el.addEventListener('mouseleave', () => {
    if (!enabled) return;
    reset(true);
  });

  return {
    setEnabled(value) {
      enabled = value;
      if (!value) reset(false);
    },
    reset
  };
}