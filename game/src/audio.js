// audio.js — every sound in CINDERLINE is synthesized with WebAudio; the game ships no audio
// files. The context is created lazily on the first user gesture (browsers require one), and
// every function here is a no-op until then, so headless renders and screenshot scenes stay
// silent and error-free.

let ctx = null;
let master = null;
let noiseBuffer = null;

export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.45;
  master.connect(ctx.destination);
  // One shared white-noise buffer, reused by every noise-based sound.
  const len = Math.floor(ctx.sampleRate * 0.5);
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
}

function noiseBurst({ dur, freq, q = 1, gain, type = 'lowpass', pan = 0, sweepTo = null }) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t);
  if (sweepTo !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(30, sweepTo), t + dur);
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  // Chain: source -> filter -> gain -> (optional stereo pan) -> master.
  src.connect(filter);
  filter.connect(g);
  if (pan !== 0 && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    p.connect(master);
  } else {
    g.connect(master);
  }
  src.start(t, Math.random() * 0.2);
  src.stop(t + dur + 0.02);
}

function tone({ freq, dur, gain, type = 'sine', at = 0, slideTo = null }) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// A gunshot, voiced per weapon; distance and pan place other shooters in the world.
export function playShot(weaponId, distance = 0, pan = 0) {
  if (!ctx) return;
  const near = Math.max(0, 1 - distance / 70);
  const gain = 0.12 + 0.5 * near * near;
  const bright = distance < 2 ? 3200 : 500 + 1400 * near;
  if (weaponId === 'rifle') {
    noiseBurst({ dur: 0.16, freq: bright, gain, pan, sweepTo: 220 });
    tone({ freq: 120, dur: 0.09, gain: gain * 0.5, type: 'triangle', slideTo: 55 });
  } else if (weaponId === 'smg') {
    noiseBurst({ dur: 0.1, freq: bright * 1.2, gain: gain * 0.8, pan, sweepTo: 300 });
  } else {
    noiseBurst({ dur: 0.11, freq: bright * 1.1, gain: gain * 0.85, pan, sweepTo: 260 });
    tone({ freq: 150, dur: 0.06, gain: gain * 0.35, type: 'triangle', slideTo: 70 });
  }
}

export function playDryFire() {
  tone({ freq: 1900, dur: 0.03, gain: 0.08, type: 'square' });
}

export function playReload() {
  tone({ freq: 700, dur: 0.03, gain: 0.1, type: 'square' });
  tone({ freq: 480, dur: 0.03, gain: 0.12, type: 'square', at: 0.22 });
  tone({ freq: 950, dur: 0.04, gain: 0.12, type: 'square', at: 0.5 });
}

export function playHit(kill) {
  tone({ freq: kill ? 1560 : 1250, dur: 0.05, gain: 0.14, type: 'square' });
  if (kill) tone({ freq: 2090, dur: 0.07, gain: 0.12, type: 'square', at: 0.05 });
}

export function playHurt() {
  noiseBurst({ dur: 0.12, freq: 300, gain: 0.25 });
  tone({ freq: 90, dur: 0.12, gain: 0.2, type: 'sine', slideTo: 50 });
}

export function playBeep(final) {
  tone({ freq: final ? 1560 : 1040, dur: 0.06, gain: 0.1, type: 'square' });
}

export function playPlantDone() {
  tone({ freq: 880, dur: 0.07, gain: 0.12, type: 'square' });
  tone({ freq: 1320, dur: 0.09, gain: 0.12, type: 'square', at: 0.08 });
}

export function playExplosion(distance = 0) {
  if (!ctx) return;
  const near = Math.max(0, 1 - distance / 60);
  noiseBurst({ dur: 0.9, freq: 900, gain: 0.35 + 0.55 * near, sweepTo: 60 });
  tone({ freq: 64, dur: 0.8, gain: 0.5 * (0.4 + near), type: 'sine', slideTo: 30 });
}

export function playThrow() {
  noiseBurst({ dur: 0.08, freq: 1200, gain: 0.06, type: 'bandpass' });
}

export function playStinger(win) {
  if (win) {
    tone({ freq: 392, dur: 0.16, gain: 0.14, type: 'triangle' });
    tone({ freq: 523, dur: 0.3, gain: 0.14, type: 'triangle', at: 0.13 });
  } else {
    tone({ freq: 330, dur: 0.16, gain: 0.14, type: 'triangle' });
    tone({ freq: 262, dur: 0.32, gain: 0.14, type: 'triangle', at: 0.13 });
  }
}
