// weapons.js — gunplay and grenades, shared verbatim by the player and the bots: the same
// hitscan, spread, recoil and damage code resolves every shot in the game. Spread is the
// tactical heart: it grows with per-shot bloom, movement and air time, and shrinks when
// crouched — standing still and aiming beats running and spraying. Head hits pay triple.

import { S } from './state.js';
import { clamp } from './rng.js';
import { raycastWorld, segmentBlocked } from './world.js';
import { eyeHeight, onPlayerFired } from './player.js';
import * as audio from './audio.js';

export const WEAPONS = {
  sidearm: {
    name: 'P9 Sidearm', cost: 0, dmg: 26, rpm: 320, auto: false,
    magSize: 12, reserve: 48, reload: 1.6, spread: 0.011, bloomAdd: 0.006, bloomCap: 0.03,
    recoil: 0.011, moveSpeed: 5.5, range: 90,
  },
  smg: {
    name: 'Rook-9 SMG', cost: 1400, dmg: 21, rpm: 800, auto: true,
    magSize: 32, reserve: 96, reload: 2.0, spread: 0.016, bloomAdd: 0.005, bloomCap: 0.045,
    recoil: 0.008, moveSpeed: 5.4, range: 80,
  },
  rifle: {
    name: 'VK-7 Rifle', cost: 2700, dmg: 33, rpm: 600, auto: true,
    magSize: 30, reserve: 90, reload: 2.3, spread: 0.008, bloomAdd: 0.007, bloomCap: 0.04,
    recoil: 0.014, moveSpeed: 5.25, range: 120,
  },
};
export const ARMOR = { name: 'Plating', cost: 650, bodyMult: 0.5, headMult: 0.55 };
export const GRENADE = { name: 'Frag Grenade', cost: 300, maxDmg: 90, radius: 5.5 };

const PARTS = [
  { name: 'head', mult: 3, r: 0.23, standY: 1.58, crouchY: 1.08 },
  { name: 'chest', mult: 1, r: 0.34, standY: 1.15, crouchY: 0.78 },
  { name: 'pelvis', mult: 0.85, r: 0.3, standY: 0.72, crouchY: 0.45 },
];

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  const t = tca - Math.sqrt(r2 - d2);
  return t > 0 ? t : Infinity;
}

function soundPan(x, z) {
  const p = S.player;
  const dx = x - p.x, dz = z - p.z;
  const dist = Math.hypot(dx, dz) || 1;
  const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
  return { dist, pan: clamp((dx * rx + dz * rz) / dist, -1, 1) };
}

export function applyDamage(attacker, target, dmg, part) {
  if (!target.alive || dmg <= 0) return;
  let mult = part ? part.mult : 1;
  if (target.armor) mult *= part && part.name === 'head' ? ARMOR.headMult : ARMOR.bodyMult;
  const final = Math.max(1, Math.round(dmg * mult));
  target.hp -= final;
  target.lastAttacker = attacker;
  target.hurtT = S.time;
  if (attacker === S.player) S.events.push({ type: 'hitmark', kill: false, head: !!part && part.name === 'head' });
  if (target === S.player) {
    S.events.push({ type: 'playerHurt', amount: final, fromX: attacker ? attacker.x : target.x, fromZ: attacker ? attacker.z : target.z });
    audio.playHurt();
    S.shake = Math.min(0.7, S.shake + 0.25);
  }
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.deathT = S.time;
    if (attacker && attacker !== target) attacker.money += 300;
    if (attacker === S.player) {
      const marks = S.events;
      for (let i = marks.length - 1; i >= 0; i--) {
        if (marks[i].type === 'hitmark') { marks[i].kill = true; break; }
      }
      audio.playHit(true);
    }
    S.events.push({ type: 'kill', attacker, victim: target, headshot: !!part && part.name === 'head' });
  } else if (attacker === S.player) {
    audio.playHit(false);
  }
}

function fire(c) {
  const w = WEAPONS[c.weapon];
  const rng = S.rng;
  c.mag -= 1;
  c.fireT = 60 / w.rpm;
  c.flashT = 0.05;
  // Spread: weapon base + bloom + the shooter's aim error (bots), punished by movement and air.
  let spread = w.spread + c.bloom + (c.aimErr || 0);
  if (!c.grounded) spread += 0.035;
  spread += c.speed2d * 0.0042;
  if (c.crouching) spread *= 0.55;
  c.bloom = Math.min(w.bloomCap, c.bloom + w.bloomAdd);
  c.recoil += w.recoil;

  const cp = Math.cos(c.pitch);
  let dx = -Math.sin(c.yaw) * cp;
  let dy = Math.sin(c.pitch);
  let dz = -Math.cos(c.yaw) * cp;
  // perpendicular basis for the spread cone
  const rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);
  const ox = (rng.next() * 2 - 1) * spread;
  const oy = (rng.next() * 2 - 1) * spread;
  dx += rx * ox;
  dz += rz * ox;
  dy += oy;
  const inv = 1 / Math.hypot(dx, dy, dz);
  dx *= inv; dy *= inv; dz *= inv;

  const ex = c.x, ey = c.y + eyeHeight(c) - 0.06, ez = c.z;
  const worldT = raycastWorld(ex, ey, ez, dx, dy, dz, w.range);
  let bestT = worldT;
  let bestTarget = null;
  let bestPart = null;
  for (const t of S.combatants) {
    if (!t.alive || t.team === c.team) continue;
    for (const part of PARTS) {
      const cy = t.y + (t.crouching ? part.crouchY : part.standY);
      const tt = raySphere(ex, ey, ez, dx, dy, dz, t.x, cy, t.z, part.r);
      if (tt < bestT) { bestT = tt; bestTarget = t; bestPart = part; }
    }
  }
  const hx = ex + dx * bestT, hy = ey + dy * bestT, hz = ez + dz * bestT;
  S.fx.tracers.push({ x1: ex + dx * 0.6, y1: ey - 0.12 + dy * 0.6, z1: ez + dz * 0.6, x2: hx, y2: hy, z2: hz, t: 0.055 });
  if (bestTarget) {
    S.fx.impacts.push({ x: hx, y: hy, z: hz, t: 0.16, hit: true });
    const falloff = bestT > 25 ? Math.max(0.6, 1 - (bestT - 25) / 60) : 1;
    applyDamage(c, bestTarget, w.dmg * falloff, bestPart);
  } else if (bestT < w.range) {
    S.fx.impacts.push({ x: hx, y: hy, z: hz, t: 0.22 });
  }
  if (c === S.player) onPlayerFired();
  const sp = soundPan(c.x, c.z);
  audio.playShot(c.weapon, c === S.player ? 0 : sp.dist, c === S.player ? 0 : sp.pan);
  if (S.phase === 'live' || S.phase === 'planted') {
    S.noises.push({ x: c.x, z: c.z, radius: 26, team: c.team, kind: 'shot', t: S.time });
  }
}

export function startReload(c) {
  const w = WEAPONS[c.weapon];
  if (c.reloadT > 0 || c.mag >= w.magSize || c.reserve <= 0) return;
  c.reloadT = w.reload;
  if (c === S.player) audio.playReload();
}

export function updateShooter(c, dt, wantFire) {
  if (!c.alive) return;
  if (c.fireT > 0) c.fireT -= dt;
  if (c.flashT > 0) c.flashT -= dt;
  if (c.grenadeT > 0) c.grenadeT -= dt;
  c.bloom *= Math.exp(-5.5 * dt);
  if (c.reloadT > 0) {
    c.reloadT -= dt;
    if (c.reloadT <= 0) {
      const w = WEAPONS[c.weapon];
      const need = w.magSize - c.mag;
      const take = Math.min(need, c.reserve);
      c.mag += take;
      c.reserve -= take;
      c.reloadT = 0;
    }
    return;
  }
  if (!wantFire || c.channel) return;
  if (S.phase !== 'live' && S.phase !== 'planted') return;
  const w = WEAPONS[c.weapon];
  if (c.mag <= 0) {
    if (c.reserve > 0) startReload(c);
    else if (c.fireT <= 0) {
      if (c === S.player) audio.playDryFire();
      c.fireT = 0.3;
    }
    return;
  }
  if (c.fireT <= 0) fire(c);
}

export function throwGrenade(c) {
  if (!c.alive || c.grenades <= 0 || c.grenadeT > 0 || c.channel) return;
  if (S.phase !== 'live' && S.phase !== 'planted') return;
  c.grenades -= 1;
  c.grenadeT = 0.8;
  const cp = Math.cos(c.pitch);
  const dx = -Math.sin(c.yaw) * cp, dy = Math.sin(c.pitch) + 0.32, dz = -Math.cos(c.yaw) * cp;
  const inv = 1 / Math.hypot(dx, dy, dz);
  S.grenades.push({
    x: c.x + dx * 0.5, y: c.y + eyeHeight(c) - 0.1, z: c.z + dz * 0.5,
    px: c.x + dx * 0.5, py: c.y + eyeHeight(c) - 0.1, pz: c.z + dz * 0.5,
    vx: dx * inv * 13, vy: dy * inv * 13, vz: dz * inv * 13,
    fuse: 1.6, team: c.team, owner: c,
  });
  if (c === S.player) audio.playThrow();
}

export function updateGrenades(dt) {
  for (let i = S.grenades.length - 1; i >= 0; i--) {
    const g = S.grenades[i];
    g.fuse -= dt;
    g.vy -= 18 * dt;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.z += g.vz * dt;
    if (g.y < 0.16) {
      g.y = 0.16;
      g.vy *= -0.35;
      g.vx *= 0.7;
      g.vz *= 0.7;
    }
    g.x = clamp(g.x, -33.9, 33.9);
    g.z = clamp(g.z, -33.9, 33.9);
    // A fading tracer arc trails the throw, so the lob reads even in a still frame.
    S.fx.tracers.push({ x1: g.px, y1: g.py, z1: g.pz, x2: g.x, y2: g.y, z2: g.z, t: 0.4 });
    g.px = g.x; g.py = g.y; g.pz = g.z;
    if (g.fuse > 0) continue;
    S.grenades.splice(i, 1);
    S.fx.explosions.push({ x: g.x, y: g.y + 0.3, z: g.z, t: 0.4 });
    const sp = soundPan(g.x, g.z);
    audio.playExplosion(sp.dist);
    if (sp.dist < 13) S.shake = Math.min(1, S.shake + (1 - sp.dist / 13) * 0.8);
    S.noises.push({ x: g.x, z: g.z, radius: 30, team: g.team, kind: 'boom', t: S.time });
    for (const t of S.combatants) {
      if (!t.alive) continue;
      if (t.team === g.team && t !== g.owner) continue; // no friendly fire
      const d = Math.hypot(t.x - g.x, t.z - g.z);
      if (d > GRENADE.radius + 0.4) continue;
      if (segmentBlocked(g.x, g.y + 0.3, g.z, t.x, t.y + 0.9, t.z)) continue;
      const dmg = GRENADE.maxDmg * Math.max(0, 1 - d / (GRENADE.radius + 0.4));
      applyDamage(g.owner, t, t === g.owner ? dmg * 0.5 : dmg, null);
    }
  }
}
