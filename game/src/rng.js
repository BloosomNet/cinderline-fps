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
  // float in [0, 1)
  f() {
    return this.next();
  }
  // float in [min, max)
  range(min, max) {
    return min + this.next() * (max - min);
  }
  // integer in [min, max]
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  // -1 or +1
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
  pick(list) {
    return list[Math.floor(this.next() * list.length)];
  }
  // true with probability p
  chance(p) {
    return this.next() < p;
  }
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// Yaw convention for the whole game: yaw 0 faces -z (north, toward the sites); the facing
// vector is (-sin yaw, -cos yaw) in xz. Pitch is positive looking up.
export function yawOf(dx, dz) {
  return Math.atan2(-dx, -dz);
}
