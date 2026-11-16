// bots.js — the seven AI combatants and, in demo mode, the player's stand-in brain.
// Perception is honest: a bot only knows what it can see (110° cone, line of sight, 55 m) or
// hear (gunfire, footsteps, the plant beep), and remembers the last place it saw you. Tactics
// come from round roles, cover play and team calls (planRound / updateBot below); in combat a
// bot settles its aim while still and fires bursts through the same weapons code the player uses.

import * as THREE from 'three';
import { S, aliveCount } from './state.js';
import { clamp, lerp, yawOf } from './rng.js';
import { findPath, nearestNode, hasLOS, segmentBlocked, COLLIDERS, HOLDS, SITES } from './world.js';
import { integrate, eyeHeight } from './player.js';
import * as weapons from './weapons.js';

export function makeAI(c, skill) {
  return {
    skill,
    role: 'hold',
    path: null,
    pathI: 0,
    goal: null, // {x, z} the bot is currently moving toward
    checkT: S.rng.next() * 0.15,
    seenEnemy: null,
    seenT: -99,
    seenX: 0, seenZ: 0,
    heardX: 0, heardZ: 0, heardT: -99,
    reactT: 0,
    firing: false,
    burstT: 0,
    strafeDir: 1,
    strafeT: 0,
    stillT: 0,
    scanYaw: c.yaw,
    scanT: 0,
    wantPlant: false,
    investigate: false,
    faceX: 0, faceZ: 0, hasFace: false, // the entry lane a settled bot pre-aims
    coverX: 0, coverZ: 0, hasCover: false, // a fighting position in a blocker's shadow
    homeX: 0, homeZ: 0, // the last spot with a clear shot — the peek point from cover
  };
}

// ---- round planning

// Called at freeze with the round's chosen attack site. Roles are plain assignments of goals;
// the per-step brain below turns goals into movement.
export function planRound() {
  const target = SITES[S.roundTarget];
  const other = SITES[S.roundTarget === 'A' ? 'B' : 'A'];
  const embers = S.combatants.filter((c) => c.team === 'ember' && c.isBot);
  embers.forEach((c, i) => {
    const ai = c.ai;
    ai.investigate = false;
    ai.hasCover = false;
    ai.hasFace = false;
    if (i === 0) { ai.role = 'entry'; ai.goal = { x: target.plant.x, z: target.plant.z }; }
    else if (i === 1) { ai.role = 'support'; ai.goal = { x: target.cx + (target.cx < 0 ? 6 : -6), z: target.cz + 2 }; }
    else { ai.role = 'lurker'; ai.goal = { x: other.cx, z: other.cz + 8 }; }
    ai.path = null;
  });
  const wards = S.combatants.filter((c) => c.team === 'ward' && c.isBot);
  const holds = [HOLDS.A[0], HOLDS.A[1], HOLDS.B[0], HOLDS.mid[0], HOLDS.B[1]];
  wards.forEach((c, i) => {
    const ai = c.ai;
    ai.investigate = false;
    ai.hasCover = false;
    const h = holds[i % holds.length];
    ai.role = 'hold';
    ai.goal = { x: h.x, z: h.z };
    ai.faceX = h.wx; ai.faceZ = h.wz; ai.hasFace = true; // pre-aim the entry this hold covers
    ai.path = null;
  });
}

// When the charge goes down, defenders rotate to the planted site and attackers fall back
// to distinct post-plant slots around it (never clumped), watching the door for the retake.
const POST_PLANT = [[-4.5, 2], [4.5, -2.5], [-6, 0.5], [3.5, -5.5]];

export function onPlanted() {
  const site = SITES[S.bomb.site];
  let slot = 0;
  for (const c of S.combatants) {
    if (!c.ai || !c.alive) continue;
    const ai = c.ai;
    ai.investigate = false;
    if (c.team === 'ward') {
      ai.role = 'rotate';
      ai.goal = { x: site.plant.x, z: site.plant.z };
    } else {
      ai.role = 'holdSite';
      const [ox, oz] = POST_PLANT[slot++ % POST_PLANT.length];
      ai.goal = { x: site.plant.x + ox, z: site.plant.z + oz };
      ai.faceX = site.cx + (site.cx < 0 ? 9 : -9); ai.faceZ = site.cz + 2; ai.hasFace = true;
    }
    ai.path = null;
  }
}

// ---- perception

function perceive(c, dt) {
  const ai = c.ai;
  ai.checkT -= dt;
  // Hearing is checked every step against fresh noises (they are pruned after 0.3 s).
  for (const n of S.noises) {
    if (n.team === c.team) continue;
    if (n.t <= ai.heardT) continue;
    const d = Math.hypot(n.x - c.x, n.z - c.z);
    if (d <= n.radius) {
      ai.heardX = n.x; ai.heardZ = n.z; ai.heardT = n.t;
      if (n.kind === 'shot' || n.kind === 'boom') ai.investigate = c.team === 'ward';
    }
  }
  if (ai.checkT > 0) return;
  ai.checkT = 0.15;
  const eyeY = c.y + eyeHeight(c);
  let best = null;
  let bestD = 56;
  for (const e of S.combatants) {
    if (!e.alive || e.team === c.team) continue;
    const dx = e.x - c.x, dz = e.z - c.z;
    const d = Math.hypot(dx, dz);
    if (d > 55 || d >= bestD) continue;
    if (d > 6) {
      const ang = Math.abs(((yawOf(dx, dz) - c.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (ang > 1.92) continue; // outside the 110° cone
    }
    if (!hasLOS(c.x, eyeY, c.z, e.x, e.y + 1.15, e.z)) continue;
    best = e;
    bestD = d;
  }
  if (best) {
    if (ai.seenEnemy !== best || S.time - ai.seenT > 1.2) {
      ai.reactT = lerp(0.5, 0.22, ai.skill); // fresh contact: human-like reaction delay
      if (ai.seenEnemy !== best) ai.hasCover = false; // cover was picked against another threat
      callSpot(c, best);
    }
    ai.seenEnemy = best;
    ai.seenT = S.time;
    ai.seenX = best.x;
    ai.seenZ = best.z;
    if (c.team === 'ember') S.spotted.set(best, S.time + 3); // shared with the player's minimap
  }
}

// A defender's fresh sighting is radioed to its team: the nearest living teammate notes
// the position, and a holding mate starts rotating to help at once.
function callSpot(c, e) {
  if (c.team !== 'ward') return;
  let mate = null;
  let bestD = Infinity;
  for (const t of S.combatants) {
    if (t === c || !t.ai || !t.alive || t.team !== 'ward') continue;
    const d = Math.hypot(t.x - e.x, t.z - e.z);
    if (d < bestD) { bestD = d; mate = t; }
  }
  if (!mate) return;
  mate.ai.heardX = e.x;
  mate.ai.heardZ = e.z;
  mate.ai.heardT = S.time;
  if (mate.ai.role === 'hold') mate.ai.investigate = true;
}

// ---- steering

function turnToward(c, targetYaw, rate, dt) {
  const diff = ((targetYaw - c.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  const step = clamp(diff, -rate * dt, rate * dt);
  c.yaw += step;
  return Math.abs(diff) < 0.05;
}

function moveAlong(c, tx, tz, dt, speedScale = 1) {
  const ai = c.ai;
  if (!ai.path || ai.pathI >= ai.path.length) {
    const from = nearestNode(c.x, c.z);
    const to = nearestNode(tx, tz);
    ai.path = from === to ? [{ x: tx, z: tz }] : (findPath(from, to) || [{ x: tx, z: tz }]);
    // finish at the exact goal, not the nearest node
    const last = ai.path[ai.path.length - 1];
    if (!last || Math.hypot(last.x - tx, last.z - tz) > 0.01) ai.path.push({ x: tx, z: tz });
    ai.pathI = 0;
  }
  let wp = ai.path[ai.pathI];
  while (wp && Math.hypot(wp.x - c.x, wp.z - c.z) < 0.75) {
    ai.pathI += 1;
    wp = ai.path[ai.pathI];
  }
  if (!wp) return true; // arrived
  steer(c, wp.x, wp.z, dt, speedScale);
  return false;
}

function steer(c, tx, tz, dt, speedScale = 1) {
  const dx = tx - c.x, dz = tz - c.z;
  const d = Math.hypot(dx, dz) || 1;
  let dirX = dx / d, dirZ = dz / d;
  // Simple avoidance: if a wall blocks the waist-high line just ahead, veer sideways.
  if (segmentBlocked(c.x, c.y + 1, c.z, c.x + dirX * 1.3, c.y + 1, c.z + dirZ * 1.3)) {
    const side = (Math.floor(S.time * 2 + c.x) % 2 === 0) ? 1 : -1;
    const px = -dirZ * side, pz = dirX * side;
    dirX = (dirX + px * 0.9);
    dirZ = (dirZ + pz * 0.9);
    const inv = 1 / Math.hypot(dirX, dirZ);
    dirX *= inv; dirZ *= inv;
  }
  turnToward(c, yawOf(dirX, dirZ), 6, dt);
  integrate(c, dt, dirX * speedScale, dirZ * speedScale, false);
}

// Find a fighting position in a blocker's shadow (relative to the threat at tx, tz):
// a point behind a solid collider whose line to the threat is blocked. Sets ai.coverX/Z.
function findCover(c, tx, tz) {
  const ai = c.ai;
  ai.hasCover = false;
  let bestD = 9; // only nearby cover is worth running to
  for (const col of COLLIDERS) {
    if (col.top < 1) continue; // low crates don't hide a standing bot
    // The collider centre relative to the threat picks the shadow face to stand behind.
    const dx = (col.minX + col.maxX) / 2 - tx, dz = (col.minZ + col.maxZ) / 2 - tz;
    let px, pz;
    if (Math.abs(dx) > Math.abs(dz)) {
      px = dx > 0 ? col.maxX + 0.55 : col.minX - 0.55;
      pz = clamp(c.z, col.minZ + 0.2, col.maxZ - 0.2);
    } else {
      pz = dz > 0 ? col.maxZ + 0.55 : col.minZ - 0.55;
      px = clamp(c.x, col.minX + 0.2, col.maxX - 0.2);
    }
    const d = Math.hypot(px - c.x, pz - c.z);
    if (d < bestD && segmentBlocked(tx, 1.4, tz, px, 1.1, pz)) {
      bestD = d;
      ai.coverX = px;
      ai.coverZ = pz;
      ai.hasCover = true;
    }
  }
}

// ---- the brain

export function updateBot(c, dt) {
  const ai = c.ai;
  if (!ai || !c.alive) return;
  if (S.phase === 'freeze') { // buy time: everyone holds position, guns down
    integrate(c, dt, 0, 0, false);
    weapons.updateShooter(c, dt, false);
    return;
  }
  perceive(c, dt);
  ai.wantPlant = false;
  let wantFire = false;

  if (c.channel) { // planting or defusing: rooted, defenceless, committed
    integrate(c, dt, 0, 0, false);
    weapons.updateShooter(c, dt, false);
    return;
  }

  const e = ai.seenEnemy;
  const phaseLive = S.phase === 'live' || S.phase === 'planted';
  const seesNow = phaseLive && e && e.alive && S.time - ai.seenT < 0.45 &&
    hasLOS(c.x, c.y + eyeHeight(c), c.z, e.x, e.y + 1.15, e.z);
  // A fight lasts a few seconds past the last sighting: the bot plays its memory of the
  // enemy — cover, a frag at the spot, re-acquiring — instead of dropping back to routine.
  const inFight = phaseLive && e && e.alive && S.time - ai.seenT < 2.5;

  if (inFight) {
    const tx = seesNow ? e.x : ai.seenX;
    const tz = seesNow ? e.z : ai.seenZ;
    const dx = tx - c.x, dz = tz - c.z;
    const dist = Math.hypot(dx, dz) || 1;
    turnToward(c, yawOf(dx, dz), lerp(4.5, 7.5, ai.skill), dt);
    if (seesNow) {
      c.pitch = clamp(Math.atan2((e.y + 1.15) - (c.y + eyeHeight(c)), dist), -0.6, 0.6);
      ai.homeX = c.x; ai.homeZ = c.z; // the last spot with a clear shot — the peek point
      // Aim settles while still; movement and target movement spoil it.
      const stillness = c.speed2d < 0.4 ? 1 : 0;
      ai.stillT = stillness ? ai.stillT + dt : 0;
      c.aimErr = Math.max(0.004, (1 - ai.skill) * 0.028 + dist * 0.00035 + e.speed2d * 0.005 - ai.stillT * 0.006);
      // Burst discipline: fire a burst, pause, fire again.
      if (ai.reactT > 0) ai.reactT -= dt;
      else {
        ai.burstT -= dt;
        if (ai.burstT <= 0) {
          ai.firing = !ai.firing;
          ai.burstT = ai.firing ? lerp(0.22, 0.45, S.rng.next()) : lerp(0.3, 0.7, S.rng.next()) * (dist > 25 ? 0.7 : 1);
        }
        wantFire = ai.firing;
      }
      // Occasional frag at a mid-range target the bot can see.
      if (c.grenades > 0 && dist > 8 && dist < 23 && S.rng.next() < dt * 0.25) {
        weapons.throwGrenade(c);
      }
    } else {
      ai.firing = false;
      // No eyes on the target right now: a frag at the last-seen spot, while it's fresh.
      if (c.grenades > 0 && S.time - ai.seenT < 1.2 && dist > 7 && dist < 22 &&
          turnToward(c, yawOf(dx, dz), 7, dt) && S.rng.next() < dt * 1.5) {
        c.pitch = 0.12;
        weapons.throwGrenade(c);
      }
    }
    // Movement. Reloading or badly hurt means fighting from cover: duck behind the nearest
    // blocker, and on each burst step back out to the peek point, in again on the pause.
    // tp is the point to move toward (null = open strafe below); stop is close enough.
    const needCover = c.reloadT > 0 || c.hp <= 40;
    if (needCover && !ai.hasCover) findCover(c, tx, tz);
    let mx = 0, mz = 0;
    let tp = null, stop = 0.5, spd = 1;
    if (ai.hasCover && needCover) { tp = [ai.coverX, ai.coverZ]; stop = 0.7; }
    else if (ai.hasCover && seesNow) tp = ai.firing ? [ai.homeX, ai.homeZ] : [ai.coverX, ai.coverZ];
    else if (!seesNow) { tp = [tx, tz]; stop = 6; spd = 0.9; }
    if (tp) {
      const px = tp[0] - c.x, pz = tp[1] - c.z;
      const pd = Math.hypot(px, pz);
      c.crouching = ai.hasCover && needCover && pd < 0.7; // settled in cover: stay low
      if (pd > stop) { mx = px / pd * spd; mz = pz / pd * spd; }
    } else {
      // Open combat movement: close the distance, back off point-blank, otherwise strafe.
      ai.strafeT -= dt;
      if (ai.strafeT <= 0) { ai.strafeDir = S.rng.next() < 0.5 ? -1 : 1; ai.strafeT = lerp(0.7, 1.4, S.rng.next()); }
      if (dist > 17) { mx = dx / dist; mz = dz / dist; }
      else if (dist < 4.5) { mx = -dx / dist; mz = -dz / dist; }
      else { mx = (-dz / dist) * ai.strafeDir; mz = (dx / dist) * ai.strafeDir; }
      c.crouching = dist > 13 && ai.stillT > 0.8;
    }
    integrate(c, dt, mx, mz, false);
  } else {
    ai.firing = false;
    ai.hasCover = false;
    c.aimErr = 0.03;
    c.crouching = false;
    if (c.mag < WEAPONS_LOW(c) && c.reloadT <= 0) weapons.startReload(c);
    objectiveMove(c, dt);
  }
  weapons.updateShooter(c, dt, wantFire);
}

function WEAPONS_LOW(c) {
  return { sidearm: 4, smg: 9, rifle: 8 }[c.weapon];
}

// Movement when nobody is in sight: pursue the role's goal, investigate sounds, work the bomb.
function objectiveMove(c, dt) {
  const ai = c.ai;
  // The bomb carrier's job: get to the plant point of the target site and plant.
  if (S.bomb.carrier === c && S.phase === 'live') {
    const site = SITES[S.roundTarget];
    const d = Math.hypot(site.plant.x - c.x, site.plant.z - c.z);
    if (d < 1.1) {
      turnToward(c, yawOf(site.cx - c.x, site.cz - c.z), 5, dt);
      ai.wantPlant = true;
      integrate(c, dt, 0, 0, false);
      return;
    }
    ai.goal = { x: site.plant.x, z: site.plant.z };
  }
  // A defender near a planted charge defuses it; an attacker near a dropped one picks it
  // up (rounds.js validates the channel itself — here we just walk to the spot and ask).
  if (S.bomb.state === 'planted' && c.team === 'ward') {
    const d = Math.hypot(S.bomb.x - c.x, S.bomb.z - c.z);
    if (d < 1.1) {
      ai.wantPlant = true; // shared flag: "interact with the bomb here"
      integrate(c, dt, 0, 0, false);
      return;
    }
    // Retake roles: the nearest defender goes for the defuse; the others hold a few metres
    // off the charge, angled toward the last-seen attacker, covering the defuser.
    const nearest = !S.combatants.some((t) => t !== c && t.team === 'ward' && t.alive &&
      Math.hypot(S.bomb.x - t.x, S.bomb.z - t.z) < d);
    if (nearest) {
      ai.goal = { x: S.bomb.x, z: S.bomb.z };
    } else {
      const fresh = S.time - ai.seenT < 30;
      const ex = fresh ? ai.seenX : S.bomb.x + 5;
      const ez = fresh ? ai.seenZ : S.bomb.z;
      const od = Math.hypot(S.bomb.x - ex, S.bomb.z - ez) || 1;
      ai.goal = { x: S.bomb.x + (S.bomb.x - ex) / od * 3.2, z: S.bomb.z + (S.bomb.z - ez) / od * 3.2 };
      ai.faceX = ex; ai.faceZ = ez; ai.hasFace = true;
    }
    ai.path = null;
  }
  if (S.bomb.state === 'dropped' && c.team === 'ember') {
    const d = Math.hypot(S.bomb.x - c.x, S.bomb.z - c.z);
    if (d < 14) { ai.goal = { x: S.bomb.x, z: S.bomb.z }; ai.path = null; }
  }
  let gx = ai.goal ? ai.goal.x : c.x;
  let gz = ai.goal ? ai.goal.z : c.z;
  // Investigate a recent sound if the role allows it.
  if (ai.investigate && S.time - ai.heardT < 3 && S.phase === 'live') {
    gx = ai.heardX; gz = ai.heardZ;
    if (Math.hypot(gx - c.x, gz - c.z) < 1.6) ai.investigate = false;
  }
  // Alone against three or more, a bot stops pushing: it falls back to its site's door and
  // ambushes. A defender picks the nearer site; a nearby dropped charge still wins.
  if (S.phase === 'live' && S.bomb.carrier !== c && aliveCount(c.team) === 1 &&
      aliveCount(c.team === 'ember' ? 'ward' : 'ember') >= 3 &&
      !(S.bomb.state === 'dropped' && Math.hypot(S.bomb.x - c.x, S.bomb.z - c.z) < 14)) {
    let site = SITES[S.roundTarget];
    if (c.team === 'ward') {
      site = Math.hypot(c.x - SITES.A.cx, c.z - SITES.A.cz) < Math.hypot(c.x - SITES.B.cx, c.z - SITES.B.cz)
        ? SITES.A : SITES.B;
    }
    gx = site.cx + (site.cx < 0 ? 9 : -9);
    gz = site.cz + 2;
    ai.faceX = site.plant.x; ai.faceZ = site.plant.z; ai.hasFace = true;
  }
  // The support bot never outruns its entry: closer to the plant than the entry is, it
  // holds position and covers until the entry catches up.
  if (ai.role === 'support' && S.phase === 'live' && S.bomb.state === 'carried') {
    const site = SITES[S.roundTarget];
    let entry = null;
    for (const t of S.combatants) if (t.ai && t.team === c.team && t.ai.role === 'entry') entry = t;
    if (entry && entry.alive &&
        Math.hypot(c.x - site.plant.x, c.z - site.plant.z) < Math.hypot(entry.x - site.plant.x, entry.z - site.plant.z) - 1) {
      integrate(c, dt, 0, 0, false);
      return;
    }
  }
  const arrived = moveAlong(c, gx, gz, dt, ai.role === 'lurker' ? 0.8 : 1);
  if (arrived) {
    // Settle: hold the position and watch the assigned entry lane, sweeping a narrow arc
    // around it; without an assignment, sweep-scan the surroundings as before.
    ai.scanT -= dt;
    if (ai.scanT <= 0) {
      ai.scanT = lerp(1.2, 2.6, S.rng.next());
      ai.scanYaw = ai.hasFace
        ? yawOf(ai.faceX - c.x, ai.faceZ - c.z) + lerp(-0.45, 0.45, S.rng.next())
        : c.yaw + lerp(-1.1, 1.1, S.rng.next());
    }
    turnToward(c, ai.scanYaw, 2.2, dt);
    c.crouching = ai.role === 'hold' || ai.role === 'holdSite';
  }
}

// Demo mode: the player entity is driven by this same brain (plus shopping in the freeze).
export function updateDemoPlayer(dt) {
  const p = S.player;
  if (!p.ai) p.ai = makeAI(p, 0.78);
  if (S.phase === 'freeze' && p.alive) {
    if (p.weapon === 'sidearm' && p.money >= 2700) buyWeapon(p, 'rifle');
    else if (p.weapon === 'sidearm' && p.money >= 1400) buyWeapon(p, 'smg');
    if (!p.armor && p.money >= 650) { p.money -= 650; p.armor = true; }
    if (p.grenades < 1 && p.money >= 300) { p.money -= 300; p.grenades = 1; }
  }
  updateBot(p, dt);
}

export function buyWeapon(c, id) {
  const w = weapons.WEAPONS[id];
  if (!w || c.money < w.cost) return false;
  c.money -= w.cost;
  c.weapon = id;
  c.mag = w.magSize;
  c.reserve = w.reserve;
  c.reloadT = 0;
  c.bloom = 0;
  return true;
}

// ---- bot bodies (rendering)

const bodies = new Map();

export function buildBotBodies(scene) {
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a189, roughness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a3a44, roughness: 0.6, metalness: 0.4 });
  for (const c of S.combatants) {
    if (!c.isBot) continue;
    const teamMat = new THREE.MeshStandardMaterial({
      color: c.team === 'ember' ? 0xd95f26 : 0x1f8a93,
      roughness: 0.7, emissive: c.team === 'ember' ? 0x2a1002 : 0x03282c,
    });
    const g = new THREE.Group();
    // One body part: a box of the given size/material placed in the body group.
    const part = (w, h, d, mat, x, y, z, shadow = true) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      g.add(m);
      return m;
    };
    const basic = (color) => new THREE.MeshBasicMaterial({ color });
    const legGeo = new THREE.BoxGeometry(0.17, 0.58, 0.17);
    const mkLeg = (sideX) => {
      const pivot = new THREE.Group();
      pivot.position.set(sideX, 0.58, 0);
      const mesh = new THREE.Mesh(legGeo, darkMat);
      mesh.position.y = -0.29;
      mesh.castShadow = true;
      pivot.add(mesh);
      g.add(pivot);
      return pivot;
    };
    const legL = mkLeg(-0.13);
    const legR = mkLeg(0.13);
    part(0.52, 0.62, 0.3, teamMat, 0, 1.06, 0); // torso
    part(0.56, 0.38, 0.36, darkMat, 0, 1.1, 0); // vest
    // A lit team strip across the chest: friend-or-foe reads at a glance, even in silhouette.
    const glowCol = c.team === 'ember' ? 0xff8a3c : 0x4de3ec;
    part(0.34, 0.05, 0.02, basic(glowCol), 0, 1.2, -0.19, false);
    part(0.3, 0.3, 0.3, skinMat, 0, 1.58, 0); // head
    part(0.37, 0.15, 0.37, teamMat, 0, 1.76, 0, false); // helmet
    // A lit visor slit and a team shoulder light: the head reads as gear, not a bare box.
    part(0.3, 0.06, 0.02, basic(c.team === 'ember' ? 0xffa050 : 0x6ff2fa), 0, 1.6, -0.16, false);
    part(0.4, 0.5, 0.16, darkMat, 0, 1.12, 0.24); // backpack
    part(0.08, 0.05, 0.08, basic(glowCol), -0.31, 1.44, 0, false);
    const armR = new THREE.Group(); armR.position.set(0.34, 1.34, 0);
    const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.46, 0.13), teamMat);
    armMesh.position.set(0, -0.12, -0.12);
    armMesh.rotation.x = -1.1;
    armR.add(armMesh);
    g.add(armR);
    // A shaped gun per weapon class — receiver, barrel and furniture differ, so a bot's
    // loadout reads at a glance. Each carries its own muzzle flash at the barrel's tip.
    const guns = {};
    const mkGun = (parts, flashZ) => {
      const grp = new THREE.Group();
      for (const [w, h, d, x, y, z] of parts) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), darkMat);
        m.position.set(x, y, z);
        grp.add(m);
      }
      const fl = new THREE.Mesh(
        new THREE.PlaneGeometry(0.4, 0.4),
        new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      fl.position.set(0, 0.01, flashZ);
      fl.rotation.z = Math.PI / 4; // a diamond burst reads as a flash, not a sticker
      fl.visible = false;
      grp.add(fl);
      grp.position.set(0.3, 1.3, -0.2);
      grp.visible = false;
      g.add(grp);
      return { grp, fl };
    };
    guns.sidearm = mkGun([[0.06, 0.11, 0.3, 0, 0, -0.15]], -0.36);
    guns.smg = mkGun([[0.07, 0.12, 0.46, 0, 0, -0.2], [0.05, 0.15, 0.07, 0, -0.12, -0.28], [0.05, 0.05, 0.18, 0, 0.02, -0.5]], -0.62);
    guns.rifle = mkGun([[0.07, 0.13, 0.62, 0, 0, -0.26], [0.04, 0.06, 0.16, 0, 0.1, -0.3], [0.05, 0.05, 0.24, 0, 0.01, -0.68]], -0.86);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.52, 24),
      new THREE.MeshBasicMaterial({ color: c.team === 'ember' ? 0xff7a33 : 0x39c2c9, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    g.add(ring);
    scene.add(g);
    bodies.set(c, { g, legL, legR, armR, guns, teamMat, walk: 0, fallT: 0, gunW: null });
  }
}

export function updateBotBodies(rdt) {
  for (const [c, b] of bodies) {
    b.g.visible = c.alive || b.fallT < 1;
    if (!c.alive) {
      b.fallT = Math.min(1, b.fallT + rdt * 3);
      b.g.rotation.x = -Math.PI / 2 * b.fallT * 0.9;
      b.g.position.set(c.x, c.y + 0.12, c.z);
      continue;
    }
    b.fallT = 0;
    b.g.rotation.x = 0;
    b.g.position.set(c.x, c.y, c.z);
    b.g.rotation.y = c.yaw;
    b.walk += c.speed2d * rdt * 2.4;
    const swing = Math.sin(b.walk) * (c.speed2d > 0.3 ? 0.5 : 0);
    b.legL.rotation.x = swing;
    b.legR.rotation.x = -swing;
    const targetScaleY = c.crouching || c.channel ? 0.8 : 1;
    b.g.scale.y += (targetScaleY - b.g.scale.y) * Math.min(1, rdt * 10);
    if (b.gunW !== c.weapon) { // swap the held model when the loadout changes (buy phase)
      b.gunW = c.weapon;
      for (const id of Object.keys(b.guns)) b.guns[id].grp.visible = id === c.weapon;
    }
    const fl = b.guns[c.weapon].fl;
    fl.visible = c.flashT > 0;
    if (fl.visible) fl.rotation.z = Math.PI / 4 + (S.time * 31 % Math.PI);
    const hurt = S.time - c.hurtT < 0.09;
    b.teamMat.emissive.setHex(hurt ? 0xaa4422 : (c.team === 'ember' ? 0x2a1002 : 0x03282c));
  }
}
