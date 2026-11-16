// main.js — boot and the frame loop. The simulation advances in fixed 1/60 steps from an
// accumulator (rendering never changes the game's outcome), while the camera, bot bodies,
// effects and HUD update every animation frame. Modes: normal play (pointer lock / touch),
// ?demo=1 (the bot brain drives the player), and ?shot=<name> (a frozen screenshot scene).

import * as THREE from 'three';
import { S, ROUND } from './state.js';
import { buildWorld, worldTick, glowTexture } from './world.js';
import { createMatch, updateRounds } from './rounds.js';
import * as input from './input.js';
import { initView, updatePlayer, updateCamera } from './player.js';
import * as weapons from './weapons.js';
import * as bots from './bots.js';
import { initHUD, updateHUD, setPlayHandler } from './hud.js';
import { setupShot, tickShots } from './shots.js';
import * as audio from './audio.js';

const params = new URLSearchParams(location.search);
const shotName = params.get('shot');
const seed = Number(params.get('seed') || 20261116);
S.shotMode = !!shotName;
S.demoMode = params.get('demo') === '1';
const touchMode = input.isTouchDevice();

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x3a2742);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 240);

buildWorld(scene);
createMatch(seed);
bots.buildBotBodies(scene);
initView(scene, camera);
initHUD();

// ---- effects pools

const glowTex = glowTexture(); // the shared soft-glow texture from world.js

const TRACER_MAX = 48;
const tracerGeo = new THREE.BufferGeometry();
const tracerPos = new Float32Array(TRACER_MAX * 6);
tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3));
const tracers = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({
  color: 0xffd9a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
}));
tracers.frustumCulled = false;
scene.add(tracers);

function makeSpritePool(n, color, size) {
  const pool = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    m.scale.setScalar(size);
    m.visible = false;
    scene.add(m);
    pool.push(m);
  }
  return pool;
}
const impactPool = makeSpritePool(20, 0xffc98a, 0.5);
const hitPool = makeSpritePool(14, 0xff7a55, 0.42);
const boomPool = makeSpritePool(4, 0xff9a4d, 3);
const boomLight = new THREE.PointLight(0xff8a3c, 0, 26, 1.5);
scene.add(boomLight);

// Explosion dressing, spawned render-side when a new explosion or impact appears in S.fx:
// lingering smoke, debris sparks, a ground shockwave ring, chips off impacts. None of it
// feeds back into the sim.
const smokePool = [];
for (let i = 0; i < 8; i++) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x554a52, transparent: true, opacity: 0, depthWrite: false }));
  m.visible = false;
  scene.add(m);
  smokePool.push({ m, life: 0, max: 1 });
}
// A pool of additive glow sprites with velocity — debris sparks and impact chips alike.
function makeParticlePool(n, color, size) {
  const pool = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.scale.setScalar(size);
    m.visible = false;
    scene.add(m);
    pool.push({ m, life: 0, vx: 0, vy: 0, vz: 0 });
  }
  return pool;
}
const debrisPool = makeParticlePool(22, 0xffb060, 0.13);
const chipPool = makeParticlePool(18, 0xd8c9a8, 0.09);
const ringPool = [];
{
  const rGeo = new THREE.RingGeometry(0.42, 0.5, 36);
  for (let i = 0; i < 2; i++) {
    const m = new THREE.Mesh(rGeo, new THREE.MeshBasicMaterial({ color: 0xffa050, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    scene.add(m);
    ringPool.push({ m, life: 0, big: false });
  }
}
const seenBooms = new Set();
const seenImpacts = new Set();

function spawnDebris(pool, x, y, z, count, spread, up, life) {
  let n = 0;
  for (const d of pool) {
    if (d.life > 0) continue;
    const a = n * 2.4 + x; // deterministic fan — render dressing needs no rng
    d.life = life + (n % 4) * 0.07;
    d.m.visible = true;
    d.m.position.set(x, y, z);
    d.vx = Math.cos(a) * spread * (0.5 + (n % 5) * 0.22);
    d.vz = Math.sin(a) * spread * (0.5 + (n % 5) * 0.22);
    d.vy = up + (n % 3) * 0.9;
    if (++n >= count) break;
  }
}

function spawnBoomFx(ex) {
  let used = 0;
  for (const s of smokePool) {
    if (s.life > 0) continue;
    s.life = s.max = 0.9 + used * 0.25;
    s.m.visible = true;
    s.m.position.set(ex.x + (used - 1) * 0.7, ex.y + 0.5 + used * 0.4, ex.z + (used % 2 ? 0.5 : -0.4));
    if (++used >= 3) break;
  }
  spawnDebris(debrisPool, ex.x, ex.y + 0.2, ex.z, 12, 2.6, 2.6, 0.5);
  for (const r of ringPool) {
    if (r.life > 0) continue;
    r.life = 0.45;
    r.big = !!ex.big;
    r.m.visible = true;
    r.m.position.set(ex.x, 0.06, ex.z);
    break;
  }
}


const grenadePool = [];
{
  const geo = new THREE.SphereGeometry(0.11, 10, 8);
  const mat = new THREE.MeshStandardMaterial({ color: 0x35402c, roughness: 0.5, metalness: 0.4 });
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    scene.add(m);
    grenadePool.push(m);
  }
}

// The charge itself: a dark case with a blinking amber light.
const bombMesh = new THREE.Group();
{
  const caseMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.16, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x1d1d22, roughness: 0.5, metalness: 0.5 }),
  );
  caseMesh.position.y = 0.08;
  bombMesh.add(caseMesh);
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.05, 0.08),
    new THREE.MeshBasicMaterial({ color: 0xffb02e }),
  );
  lamp.position.set(0.1, 0.18, 0);
  bombMesh.add(lamp);
  bombMesh.userData.lamp = lamp;
  scene.add(bombMesh);
}
const bombLight = new THREE.PointLight(0xff3524, 0, 9, 1.6);
scene.add(bombLight);

function updateFx(rdt) {
  let n = 0;
  for (const t of S.fx.tracers) {
    if (n >= TRACER_MAX) break;
    tracerPos[n * 6] = t.x1; tracerPos[n * 6 + 1] = t.y1; tracerPos[n * 6 + 2] = t.z1;
    tracerPos[n * 6 + 3] = t.x2; tracerPos[n * 6 + 4] = t.y2; tracerPos[n * 6 + 5] = t.z2;
    n++;
  }
  tracerGeo.setDrawRange(0, n * 2);
  tracerGeo.attributes.position.needsUpdate = true;
  let ii = 0;
  let hi = 0;
  for (const im of S.fx.impacts) {
    if (!seenImpacts.has(im)) { // fresh impact: knock a few chips off the surface
      seenImpacts.add(im);
      if (seenImpacts.size > 40) seenImpacts.clear();
      spawnDebris(chipPool, im.x, im.y, im.z, 3, 0.9, 0.9, 0.32);
    }
    // Body hits burst hot and tight; world hits puff wider and paler.
    const s = im.hit ? hitPool[hi++] : impactPool[ii++];
    if (!s) continue;
    s.visible = true;
    s.position.set(im.x, im.y, im.z);
    const life = Math.max(0, im.t / 0.22);
    s.material.opacity = life * 0.9;
    s.scale.setScalar(0.3 + (1 - life) * 0.5);
  }
  for (; ii < impactPool.length; ii++) impactPool[ii].visible = false;
  for (; hi < hitPool.length; hi++) hitPool[hi].visible = false;
  let bi = 0;
  boomLight.intensity = 0;
  for (const ex of S.fx.explosions) {
    if (!seenBooms.has(ex)) {
      seenBooms.add(ex);
      if (seenBooms.size > 32) seenBooms.clear();
      spawnBoomFx(ex);
    }
    const s = boomPool[bi++];
    if (!s) break;
    s.visible = true;
    s.position.set(ex.x, ex.y, ex.z);
    const max = ex.big ? 0.7 : 0.4;
    const life = Math.max(0, ex.t / max);
    s.material.opacity = life;
    s.scale.setScalar((ex.big ? 9 : 5.5) * (1.25 - life * 0.25));
    boomLight.position.set(ex.x, ex.y + 0.6, ex.z);
    // The flash falls off faster than the sprite fades, and its reach shrinks with it.
    boomLight.intensity = 150 * life * life;
    boomLight.distance = (ex.big ? 34 : 26) * (0.55 + 0.45 * life);
  }
  for (; bi < boomPool.length; bi++) boomPool[bi].visible = false;
  for (let i = 0; i < grenadePool.length; i++) {
    const g = S.grenades[i];
    grenadePool[i].visible = !!g;
    if (g) grenadePool[i].position.set(g.x, g.y, g.z);
  }
  // Animate the dressing: smoke rises and thins, debris arcs and bounces, the ring expands.
  for (const s of smokePool) {
    if (s.life <= 0) continue;
    s.life -= rdt;
    if (s.life <= 0) { s.m.visible = false; s.m.material.opacity = 0; continue; }
    const f = 1 - s.life / s.max;
    s.m.position.y += rdt * 1.1;
    s.m.scale.setScalar(1.6 + f * 4.2);
    s.m.material.opacity = 0.34 * Math.sin(Math.PI * Math.min(1, f + 0.15));
  }
  for (const pool of [debrisPool, chipPool]) {
    for (const d of pool) {
      if (d.life <= 0) continue;
      d.life -= rdt;
      if (d.life <= 0) { d.m.visible = false; d.m.material.opacity = 0; continue; }
      d.vy -= 8.5 * rdt;
      d.m.position.x += d.vx * rdt;
      d.m.position.y += d.vy * rdt;
      d.m.position.z += d.vz * rdt;
      if (d.m.position.y < 0.05) { d.m.position.y = 0.05; d.vy *= -0.4; }
      d.m.material.opacity = Math.min(1, d.life * 2.4);
    }
  }
  for (const r of ringPool) {
    if (r.life <= 0) continue;
    r.life -= rdt;
    if (r.life <= 0) { r.m.visible = false; continue; }
    const f = 1 - r.life / 0.45;
    r.m.scale.setScalar(0.5 + f * (r.big ? 15 : 8.5));
    r.m.material.opacity = 0.55 * (1 - f);
  }
  // The charge follows its carrier's back, sits where dropped, and blinks faster when planted.
  const b = S.bomb;
  if (b.state === 'carried' && b.carrier) {
    const c = b.carrier;
    bombMesh.position.set(c.x + Math.sin(c.yaw) * 0.26, c.y + 1.18, c.z + Math.cos(c.yaw) * 0.26);
    bombMesh.rotation.y = c.yaw;
    bombMesh.visible = c !== S.player; // in first person you don't see your own pack
  } else {
    bombMesh.position.set(b.x, 0, b.z);
    bombMesh.rotation.y = 0.6;
    bombMesh.visible = true;
  }
  // The planted charge blinks red, faster as its clock runs down; otherwise it ticks amber.
  const planted = b.state === 'planted';
  const frac = planted ? Math.max(0, S.phaseT / ROUND.bombTime) : 1;
  const on = Math.sin(S.time * (planted ? 3 + (1 - frac) * 11 : 2) * Math.PI) > 0;
  bombMesh.userData.lamp.material.color.setHex(planted ? (on ? 0xff3524 : 0x4a0f08) : (on ? 0xffb02e : 0x59390a));
  bombLight.position.copy(bombMesh.position);
  bombLight.position.y += 0.4;
  bombLight.intensity = planted && on ? 13 : 0;
}

// ---- start / pause flow

const overlay = document.getElementById('overlay');
let started = false;
let hasLock = false;

function begin() {
  audio.unlockAudio();
  if (touchMode || S.demoMode) {
    started = true;
    overlay.style.display = 'none';
  } else {
    input.requestLock(canvas);
  }
}
setPlayHandler(begin);
input.initInput(canvas, (locked) => {
  hasLock = locked;
  if (locked) {
    started = true;
    overlay.style.display = 'none';
  } else if (started && !S.shotMode && !S.demoMode) {
    overlay.style.display = 'flex'; // pointer lock lost (Esc): offer resume
  }
});
if (touchMode) input.initTouchControls();
if (S.shotMode) {
  input.setEnabled(false);
  started = true;
  overlay.style.display = 'none';
  setupShot(shotName);
}
if (S.demoMode) {
  input.setEnabled(false);
  started = true;
  overlay.style.display = 'none';
}

// Debug/testing handle: the live game state, for automated verification.
window.CINDER = { state: S };

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- the loop

function decayFx(dt) {
  for (const list of [S.fx.tracers, S.fx.impacts, S.fx.explosions]) {
    for (let i = list.length - 1; i >= 0; i--) {
      list[i].t -= dt;
      if (list[i].t <= 0) list.splice(i, 1);
    }
  }
}

function stepSim(dt) {
  S.time += dt;
  updateRounds(dt);
  if (S.demoMode) {
    bots.updateDemoPlayer(dt);
  } else {
    updatePlayer(dt);
    const p = S.player;
    weapons.updateShooter(p, dt, input.isFiring());
    if (input.pressed('KeyR')) weapons.startReload(p);
    if (input.pressed('KeyG')) weapons.throwGrenade(p);
  }
  for (const c of S.combatants) if (c.isBot) bots.updateBot(c, dt);
  weapons.updateGrenades(dt);
  decayFx(dt);
  for (let i = S.noises.length - 1; i >= 0; i--) {
    if (S.time - S.noises[i].t > 0.3) S.noises.splice(i, 1);
  }
}

let last = performance.now();
let acc = 0;
const STEP = 1 / 60;
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  const canRun = started && (touchMode || S.demoMode || S.shotMode || hasLock);
  if (canRun && !S.shotMode) {
    acc += rdt;
    let n = 0;
    while (acc >= STEP && n < 5) {
      stepSim(STEP);
      acc -= STEP;
      n++;
    }
    if (n === 5) acc = 0;
  }
  if (S.shotMode) tickShots(rdt);
  worldTick(rdt);
  bots.updateBotBodies(rdt);
  updateCamera(camera, rdt);
  updateFx(rdt);
  updateHUD(rdt);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
