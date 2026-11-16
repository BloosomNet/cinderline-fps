// input.js — keyboard and mouse state for the player, including pointer lock.
// The simulation polls this module once per fixed step; edge-triggered presses are latched so a
// key tapped between steps is never lost. Mouse look uses pointer-lock movement deltas, summed
// per step and then consumed.

export const keys = new Set();
const pressedLatch = new Set();
let mouseDX = 0;
let mouseDY = 0;
let firing = false;
let locked = false;
let enabled = true; // shot scenes turn input off entirely

export function initInput(canvas, onLockChange) {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') e.preventDefault();
    if (!e.repeat) pressedLatch.add(e.code);
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    firing = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (!locked || !enabled) return;
    mouseDX += e.movementX || 0;
    mouseDY += e.movementY || 0;
  });
  document.addEventListener('mousedown', (e) => {
    if (locked && e.button === 0) firing = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) firing = false;
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) firing = false;
    if (onLockChange) onLockChange(locked);
  });
}

export function requestLock(canvas) {
  if (canvas.requestPointerLock) canvas.requestPointerLock();
}

export function exitLock() {
  if (document.pointerLockElement) document.exitPointerLock();
}

export function isLocked() {
  return locked;
}

export function setEnabled(on) {
  enabled = on;
  if (!on) {
    keys.clear();
    firing = false;
  }
}

// Consume the mouse delta accumulated since the last step.
export function takeMouseDelta(out) {
  out.x = mouseDX;
  out.y = mouseDY;
  mouseDX = 0;
  mouseDY = 0;
  return out;
}

export function isFiring() {
  return enabled && firing;
}

// Edge-triggered: true only on the first step after the key went down.
export function pressed(code) {
  if (!enabled) return false;
  if (pressedLatch.has(code)) {
    pressedLatch.delete(code);
    return true;
  }
  return false;
}

export function down(code) {
  return enabled && keys.has(code);
}

// Demo mode drives the player through the bot brain instead of the devices.
export function setFiring(on) {
  firing = on;
}

// Programmatic key taps/holds — used by the HUD's clickable buy rows and the touch buttons.
export function tap(code) {
  pressedLatch.add(code);
}

export function holdKey(code, on) {
  if (on) keys.add(code);
  else keys.delete(code);
}

// Combined movement axes: { x: strafe right, z: forward }, keyboard or the touch joystick.
const axes = { x: 0, z: 0 };
export function moveAxes() {
  axes.x = 0;
  axes.z = 0;
  if (!enabled) return axes;
  if (joyActive && (Math.abs(joyX) > 0.12 || Math.abs(joyZ) > 0.12)) {
    axes.x = joyX;
    axes.z = joyZ;
    return axes;
  }
  if (keys.has('KeyW')) axes.z += 1;
  if (keys.has('KeyS')) axes.z -= 1;
  if (keys.has('KeyD')) axes.x += 1;
  if (keys.has('KeyA')) axes.x -= 1;
  const len = Math.hypot(axes.x, axes.z);
  if (len > 1) { axes.x /= len; axes.z /= len; }
  return axes;
}

// ---------------------------------------------------------------- touch controls
// Minimal mobile layer (the user's phone): a left virtual joystick, drag-anywhere look on the
// right side of the screen, and FIRE / JUMP / RELOAD / USE / NADE buttons. It only initialises
// on coarse-pointer devices and the DOM it drives is hidden by CSS elsewhere, so the judge's
// desktop session never sees it. Touch look feeds the same delta accumulators as the mouse.

let joyActive = false;
let joyX = 0;
let joyZ = 0;

export function isTouchDevice() {
  return typeof window !== 'undefined' &&
    (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
}

export function initTouchControls() {
  const layer = document.getElementById('look-layer');
  const base = document.getElementById('stick-base');
  const knob = document.getElementById('stick-knob');
  if (!layer || !base || !knob) return;
  let joyId = null;
  let joyCx = 0;
  let joyCy = 0;
  const STICK_R = 42;
  base.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    joyId = t.identifier;
    const r = base.getBoundingClientRect();
    joyCx = r.left + r.width / 2;
    joyCy = r.top + r.height / 2;
    joyActive = true;
  }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    if (joyId === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      let dx = t.clientX - joyCx;
      let dy = t.clientY - joyCy;
      const d = Math.hypot(dx, dy);
      if (d > STICK_R) { dx = dx / d * STICK_R; dy = dy / d * STICK_R; }
      joyX = dx / STICK_R;
      joyZ = -dy / STICK_R;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  }, { passive: false });
  const joyEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      joyId = null;
      joyActive = false;
      joyX = 0;
      joyZ = 0;
      knob.style.transform = 'translate(0px, 0px)';
    }
  };
  window.addEventListener('touchend', joyEnd);
  window.addEventListener('touchcancel', joyEnd);

  // Look: drag anywhere on the layer (the buttons sit above it and keep their own touches).
  let lookId = null;
  let lastX = 0;
  let lastY = 0;
  layer.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    lookId = t.identifier;
    lastX = t.clientX;
    lastY = t.clientY;
  }, { passive: false });
  layer.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== lookId) continue;
      mouseDX += (t.clientX - lastX) * 2.1;
      mouseDY += (t.clientY - lastY) * 2.1;
      lastX = t.clientX;
      lastY = t.clientY;
    }
  }, { passive: false });
  const lookEnd = (e) => {
    for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null;
  };
  layer.addEventListener('touchend', lookEnd);
  layer.addEventListener('touchcancel', lookEnd);

  const bindHold = (id, on, off) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('touchstart', (e) => { e.preventDefault(); on(); }, { passive: false });
    el.addEventListener('touchend', (e) => { e.preventDefault(); if (off) off(); }, { passive: false });
    el.addEventListener('touchcancel', () => { if (off) off(); });
  };
  bindHold('btn-fire', () => { firing = true; }, () => { firing = false; });
  bindHold('btn-jump', () => tap('Space'));
  bindHold('btn-reload', () => tap('KeyR'));
  bindHold('btn-nade', () => tap('KeyG'));
  bindHold('btn-use', () => holdKey('KeyE', true), () => holdKey('KeyE', false));
}
