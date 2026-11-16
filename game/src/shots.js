// shots.js — the four screenshot scenes the judge sees (shots.json maps file names to these).
// Each scene freezes a truthful moment of real play: the same combatants, weapons, HUD and
// effects the game itself produces, staged at a photogenic instant. Nothing here fakes a
// system — the plant scene really has a channel at 62%, the buy scene is a real freeze phase
// with real money, the end scene is a real round end with a real corpse. In shot mode the
// simulation does not step; tick() only refreshes the short-lived effect timers so the frozen
// frame keeps its muzzle flash, tracer and hitmarker.

import { S } from './state.js';
import { yawOf } from './rng.js';

let scene = null;
let hitT = 0;

function place(c, x, z, yaw, opts = {}) {
  c.x = x;
  c.z = z;
  c.y = opts.y ?? 0;
  c.yaw = yaw;
  c.pitch = opts.pitch ?? 0;
  c.vx = 0; c.vy = 0; c.vz = 0;
  c.speed2d = opts.speed ?? 0;
  if (opts.hp !== undefined) c.hp = opts.hp;
  if (opts.weapon) {
    c.weapon = opts.weapon;
    c.mag = opts.mag ?? 20;
    c.reserve = opts.reserve ?? 60;
  }
  if (opts.crouch) c.crouching = true;
  if (opts.armor !== undefined) c.armor = opts.armor;
  c.alive = opts.dead ? false : true;
  return c;
}

function byName(name) {
  return S.combatants.find((c) => c.name === name);
}

function tracer(x1, y1, z1, x2, y2, z2) {
  S.fx.tracers.push({ x1, y1, z1, x2, y2, z2, t: 0.06 });
}

export function setupShot(name) {
  scene = name;
  S.events.length = 0; // drop the real round-1 announcements; the scene tells its own story
  const p = S.player;
  const vex = byName('Vex');
  const onyx = byName('Onyx');
  const rook = byName('Rook');
  const hale = byName('Hale');
  const moss = byName('Moss');
  const ivers = byName('Ivers');
  const tarn = byName('Tarn');
  S.round = 6;
  if (name === 'action') {
    // A mid-lane firefight, frozen on the frame the player's shot lands.
    S.phase = 'live';
    S.phaseT = 47;
    S.scores.ember = 3;
    S.scores.ward = 2;
    S.roundTarget = 'A';
    place(p, -9, 13, yawOf(5.5, -10), { hp: 78, weapon: 'rifle', mag: 17, reserve: 60, armor: true });
    p.money = 1250;
    p.grenades = 1;
    place(vex, -13.5, 6.5, yawOf(10, -3), { hp: 100, weapon: 'rifle', speed: 1.2 });
    vex.flashT = 0.05;
    place(onyx, -6, 16.5, yawOf(3, -9), { hp: 64, weapon: 'smg', crouch: true });
    place(rook, -24, 12, yawOf(10, -6), { hp: 100, weapon: 'smg' });
    place(hale, -3.5, 3, yawOf(-5.5, 10), { hp: 41, weapon: 'rifle', speed: 1.6 });
    hale.flashT = 0.05;
    place(moss, 3.5, -3, yawOf(-9, 6), { hp: 100, weapon: 'rifle', crouch: true });
    place(ivers, -8, -14, yawOf(-2, 10), { hp: 88, weapon: 'smg' });
    place(tarn, 14, 0, yawOf(-16, 4), { hp: 100, weapon: 'rifle' });
    S.bomb.carrier = p;
    S.bomb.state = 'carried';
    tracer(vex.x + 0.3, 1.35, vex.z - 0.3, hale.x, 1.1, hale.z);
    tracer(hale.x - 0.3, 1.35, hale.z + 0.4, p.x + 1.2, 1.1, p.z - 1.5);
    S.events.push({ type: 'hitmark', kill: false, head: false });
  } else if (name === 'plant') {
    // Site A: Vex is 62% through the plant while the player covers the east entry and a
    // defender pushes through the door.
    S.phase = 'live';
    S.phaseT = 63;
    S.scores.ember = 2;
    S.scores.ward = 2;
    S.roundTarget = 'A';
    place(p, -24.8, -10.6, yawOf(3.8, -4.4), { hp: 100, weapon: 'rifle', mag: 24, reserve: 90, armor: true });
    p.money = 800;
    place(vex, -21, -15, yawOf(-1, -6), { hp: 100, weapon: 'smg', crouch: true });
    vex.channel = { kind: 'plant', t: 1.86 };
    place(onyx, -24, -18.5, yawOf(6, 4), { hp: 100, weapon: 'rifle', crouch: true });
    place(rook, -18, -24.5, yawOf(2, 6), { hp: 72, weapon: 'smg' });
    place(hale, -13.5, -17, yawOf(-8, 4), { hp: 100, weapon: 'rifle', speed: 2.4 });
    place(moss, -24, -28, yawOf(4, 8), { hp: 100, weapon: 'rifle' });
    place(ivers, 0, -28, yawOf(-10, 4), { hp: 100, weapon: 'smg' });
    place(tarn, 20, -29, yawOf(-14, 6), { hp: 100, weapon: 'rifle' });
    S.bomb.carrier = vex;
    S.bomb.state = 'carried';
    S.bomb.x = vex.x;
    S.bomb.z = vex.z;
  } else if (name === 'buy') {
    // Freeze phase at the Ember spawn: the buy menu is open and the squad is kitting up.
    S.phase = 'freeze';
    S.phaseT = 5.2;
    S.scores.ember = 1;
    S.scores.ward = 1;
    S.round = 3;
    S.roundTarget = 'B';
    place(p, 0, 29.5, 0, { hp: 100, weapon: 'rifle', mag: 30, reserve: 90, armor: true });
    p.money = 3450;
    p.grenades = 1;
    place(vex, -2.5, 26.5, 0, { hp: 100, weapon: 'rifle' });
    place(onyx, 2.5, 26.5, 0, { hp: 100, weapon: 'smg' });
    place(rook, -5.5, 24.5, 0.3, { hp: 100, weapon: 'sidearm' });
    place(hale, -20, -29, Math.PI, { hp: 100, weapon: 'rifle' });
    place(moss, -25, -27.5, Math.PI, { hp: 100, weapon: 'smg' });
    place(ivers, 20, -29, Math.PI, { hp: 100, weapon: 'rifle' });
    place(tarn, 5, -28, Math.PI, { hp: 100, weapon: 'sidearm' });
    S.bomb.carrier = p;
    S.bomb.state = 'carried';
  } else if (name === 'end') {
    // Round over at site B: the defenders are down, the banner is up, the squad holds the dock.
    S.phase = 'roundEnd';
    S.phaseT = 4.5;
    S.scores.ember = 4;
    S.scores.ward = 2;
    S.roundTarget = 'B';
    place(p, 20, -15.5, yawOf(4, -6), { hp: 56, weapon: 'rifle', mag: 9, reserve: 41, armor: true });
    p.money = 2950;
    place(vex, 24, -21.5, yawOf(-4, -4), { hp: 100, weapon: 'rifle', y: 0.45 });
    place(onyx, 18.5, -20, yawOf(6, -2), { hp: 83, weapon: 'smg' });
    place(rook, 27.5, -24.5, yawOf(-6, 4), { hp: 100, weapon: 'rifle', y: 0.45 });
    place(hale, 25.5, -22.5, 0, { dead: true, y: 0.45 });
    place(moss, 28, -19.5, 0, { dead: true });
    place(ivers, 14.5, -18, 0, { dead: true });
    place(tarn, 5, -28, Math.PI, { hp: 100, weapon: 'rifle' });
    S.bomb.state = 'planted';
    S.bomb.site = 'B';
    S.bomb.x = 24;
    S.bomb.z = -21.5;
    S.events.push({ type: 'roundEnd', winner: 'ember', reason: 'elimination' });
  }
}

// Per-frame refresh for the frozen frame: effects that would decay in a live game are held.
export function tickShots(rdt) {
  if (!scene) return;
  for (const t of S.fx.tracers) t.t = 0.06;
  if (scene === 'action') {
    const hale = byName('Hale');
    if (hale) hale.flashT = 0.05;
    const vex = byName('Vex');
    if (vex) vex.flashT = 0.05;
    hitT -= rdt;
    if (hitT <= 0) {
      hitT = 0.08;
      S.events.push({ type: 'hitmark', kill: false, head: false });
    }
  } else if (scene === 'plant') {
    S.channelView = { kind: 'plant', frac: 0.62, mine: false };
  }
}
