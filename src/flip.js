// Click-to-open flip + scale transition. All tunable values are here --
// change these, nothing else needs touching.
const FLIP_CONFIG = {
  resetDuration: 180,   // ms -- ease back to flat before the flip begins
  duration: 600,        // ms -- the flip + scale animation itself
  easing: 'cubic-bezier(0.65, 0, 0.35, 1)', // ease-in-out-style curve
  openWidth: 520,       // px -- stage size once open
  openHeight: 420
};

function attachFlip(stageEl, tiltController) {
  let isOpen = false;

  stageEl.style.setProperty('--flip-duration', FLIP_CONFIG.duration + 'ms');
  stageEl.style.setProperty('--flip-easing', FLIP_CONFIG.easing);
  stageEl.style.setProperty('--flip-open-w', FLIP_CONFIG.openWidth + 'px');
  stageEl.style.setProperty('--flip-open-h', FLIP_CONFIG.openHeight + 'px');

  function open() {
    if (isOpen) return;
    isOpen = true;

    // "Go to initial state" -- ease any active tilt back to flat first...
    tiltController.setEnabled(false);
    tiltController.reset(true, FLIP_CONFIG.resetDuration);

    // ...then, once that's settled, start the flip + scale.
    setTimeout(() => {
      stageEl.classList.add('is-open');
    }, FLIP_CONFIG.resetDuration);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    stageEl.classList.remove('is-open');
    setTimeout(() => tiltController.setEnabled(true), FLIP_CONFIG.duration);
  }

  stageEl.addEventListener('click', (e) => {
    if (isOpen) {
      if (e.target.closest('.detail-close')) close();
      return; // clicking elsewhere on the open card doesn't close it
    }
    open();
  });

  return { open, close };
}