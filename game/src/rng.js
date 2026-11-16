// rng.js — one seeded random source for the whole game, plus small math helpers.
// The simulation never touches Math.random or the wall clock: a run with the same seed makes the
// same decisions, which keeps bot behaviour, spread and the staged screenshot scenes repeatable.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) {
    this.next = mulberry32(seed);
  }
  reseed(seed) {
    this.next = mulberry32(seed);
  }
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// Yaw convention for the whole game: yaw 0 faces -z (north, toward the sites); the facing
// vector is (-sin yaw, -cos yaw) in xz. Pitch is positive looking up.
export function yawOf(dx, dz) {
  return Math.atan2(-dx, -dz);
}
