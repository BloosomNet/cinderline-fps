// player.js — movement physics shared by the player and every bot, the player's own controller
// (keyboard/mouse, or the bot brain in demo mode), and the first-person camera + viewmodel.
// Physics is deliberately simple and identical for everyone: exponential velocity approach
// (acceleration and friction in one), gravity, a jump, and circle-vs-box collision with a
// 0.55 m step-up so the dock platform and low crates can be mounted without a jump.

import * as THREE from 'three';
import { S } from './state.js';
import { WEAPONS } from './weapons.js';
import { COLLIDERS, groundHeight } from './world.js';
import { clamp } from './rng.js';
import * as input from './input.js';

const RADIUS = 0.38;
const STEP = 0.55;
const GRAVITY = 22;
const JUMP_VEL = 7.6;
const EYE = 1.62;
const EYE_CROUCH = 1.12;

function collideAxis(c, axis, delta) {
  if (delta === 0) return;
  if (axis === 'x') c.x += delta; else c.z += delta;
  const feet = c.y;
  const head = c.y + (c.crouching ? 1.25 : 1.72);
  for (const col of COLLIDERS) {
    if (col.top <= feet + STEP) continue; // low enough to step onto — groundHeight handles it
    if (col.bottom >= head) continue; // passes overhead
    const nx = clamp(c.x, col.minX, col.maxX);
    const nz = clamp(c.z, col.minZ, col.maxZ);
    const dx = c.x - nx;
    const dz = c.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= RADIUS * RADIUS) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      c.x = nx + (dx / d) * RADIUS;
      c.z = nz + (dz / d) * RADIUS;
    } else if (axis === 'x') {
      c.x = delta > 0 ? col.minX - RADIUS : col.maxX + RADIUS;
    } else {
      c.z = delta > 0 ? col.minZ - RADIUS : col.maxZ + RADIUS;
    }
    if (axis === 'x') c.vx = 0; else c.vz = 0;
  }
  c.x = clamp(c.x, -33.8, 33.8);
  c.z = clamp(c.z, -33.8, 33.8);
}

// Advance one combatant by dt with a normalized wish direction (world space).
export function integrate(c, dt, wishX, wishZ, wantJump) {
  const cap = c.crouching ? 2.6 : WEAPONS[c.weapon].moveSpeed;
  const rate = c.grounded ? 11 : 1.3; // snappy on ground, drifty in the air
  const k = 1 - Math.exp(-rate * dt);
  c.vx += (wishX * cap - c.vx) * k;
  c.vz += (wishZ * cap - c.vz) * k;
  if (wantJump && c.grounded) {
    c.vy = JUMP_VEL;
    c.grounded = false;
  }
  c.vy = Math.max(-30, c.vy - GRAVITY * dt);
  collideAxis(c, 'x', c.vx * dt);
  collideAxis(c, 'z', c.vz * dt);
  c.y += c.vy * dt;
  const g = groundHeight(c.x, c.z, c.y);
  if (c.y <= g) {
    c.y = g;
    c.vy = 0;
    c.grounded = true;
  } else if (c.y > g + 0.02) {
    c.grounded = false;
  }
  c.speed2d = Math.hypot(c.vx, c.vz);
}

export function eyeHeight(c) {
  return c.crouching ? EYE_CROUCH : EYE;
}

// ---------------------------------------------------------------- player controller

const mouse = { x: 0, y: 0 };
let bobPhase = 0;
let stepAcc = 0;

export function updatePlayer(dt) {
  const p = S.player;
  if (S.demoMode || S.shotMode) return; // driven elsewhere (bot brain / staged scene)
  if (!p.alive) return;
  input.takeMouseDelta(mouse);
  const sens = 0.0021;
  p.yaw -= mouse.x * sens;
  p.pitch = clamp(p.pitch - mouse.y * sens, -1.45, 1.45);

  const canMove = S.phase === 'live' || S.phase === 'planted' || S.phase === 'roundEnd';
  let ix = 0, iz = 0;
  if (canMove) {
    const a = input.moveAxes(); // keyboard WASD, or the touch joystick on mobile
    ix = a.x;
    iz = a.z;
  }
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  // forward = (-sin, -cos), right = (cos, -sin)
  const wishX = -sin * iz + cos * ix;
  const wishZ = -cos * iz - sin * ix;
  p.crouching = input.down('ShiftLeft') || input.down('KeyC');
  const wantJump = canMove && input.pressed('Space');
  integrate(p, dt, wishX, wishZ, wantJump);

  // Recoil recovery and footstep noise.
  p.recoil *= Math.exp(-8 * dt);
  if (p.grounded && p.speed2d > 1 && S.phase === 'live') {
    stepAcc += p.speed2d * dt;
    if (stepAcc > 2.3) {
      stepAcc = 0;
      if (!p.crouching) S.noises.push({ x: p.x, z: p.z, radius: 9, team: p.team, kind: 'step', t: S.time });
    }
  }
  bobPhase += p.speed2d * dt * 1.7;
}

// ---------------------------------------------------------------- viewmodel + camera

let viewGroup = null;
let gunMeshes = {};
let muzzle = null;
let muzzleLight = null;
let flashT = 0;
const casings = [];
let casingI = 0;
let lastWeapon = null;
let drawT = 0;
const MUZZLE_Z = { sidearm: -0.4, smg: -0.62, rifle: -0.82 };

function gunPart(g, w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

function sightDot(g, y, z) {
  const dot = new THREE.Mesh(
    new THREE.BoxGeometry(0.013, 0.013, 0.013),
    new THREE.MeshBasicMaterial({ color: 0xffc46b }),
  );
  dot.position.set(0, y, z);
  g.add(dot);
}

// Three distinct silhouettes: a compact sidearm, an SMG with a fat suppressor and curved mag,
// and a long rifle with a scope block — the class reads before the HUD name does.
function buildSidearm(matBody, matAccent, matGrip) {
  const g = new THREE.Group();
  gunPart(g, 0.085, 0.13, 0.3, matBody, 0, 0, -0.06);
  gunPart(g, 0.04, 0.05, 0.14, matBody, 0, 0.035, -0.26);
  gunPart(g, 0.095, 0.028, 0.16, matAccent, 0, -0.02, -0.06);
  gunPart(g, 0.075, 0.15, 0.085, matGrip, 0, -0.12, 0.05).rotation.x = 0.35;
  gunPart(g, 0.018, 0.04, 0.018, matAccent, 0, 0.085, -0.14);
  sightDot(g, 0.108, -0.14);
  return g;
}

function buildSmg(matBody, matAccent, matGrip) {
  const g = new THREE.Group();
  gunPart(g, 0.09, 0.14, 0.44, matBody, 0, 0, -0.12);
  const supp = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.24, 10), matGrip);
  supp.rotation.x = Math.PI / 2;
  supp.position.set(0, 0.03, -0.44);
  g.add(supp);
  gunPart(g, 0.05, 0.18, 0.08, matGrip, 0, -0.15, -0.18).rotation.x = 0.18;
  gunPart(g, 0.095, 0.03, 0.22, matAccent, 0, -0.02, -0.14);
  gunPart(g, 0.08, 0.15, 0.09, matGrip, 0, -0.12, 0.08).rotation.x = 0.35;
  gunPart(g, 0.018, 0.045, 0.018, matAccent, 0, 0.09, -0.24);
  sightDot(g, 0.115, -0.24);
  return g;
}

function buildRifle(matBody, matAccent, matGrip) {
  const g = new THREE.Group();
  gunPart(g, 0.09, 0.15, 0.58, matBody, 0, 0, -0.18);
  gunPart(g, 0.042, 0.042, 0.3, matBody, 0, 0.04, -0.6);
  gunPart(g, 0.05, 0.075, 0.22, matGrip, 0, 0.115, -0.22); // scope block
  gunPart(g, 0.095, 0.03, 0.3, matAccent, 0, -0.02, -0.2);
  gunPart(g, 0.085, 0.11, 0.16, matGrip, 0, -0.03, 0.14); // stock
  gunPart(g, 0.08, 0.16, 0.09, matGrip, 0, -0.13, 0.02).rotation.x = 0.35;
  sightDot(g, 0.16, -0.22);
  return g;
}

export function initView(scene, camera) {
  const matBody = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.32, metalness: 0.85 });
  const matGrip = new THREE.MeshStandardMaterial({ color: 0x141419, roughness: 0.65, metalness: 0.2 });
  const matAccent = new THREE.MeshStandardMaterial({ color: 0xff7a33, roughness: 0.45, emissive: 0xa84800, emissiveIntensity: 1.0 });
  viewGroup = new THREE.Group();
  gunMeshes = {
    sidearm: buildSidearm(matBody, matAccent, matGrip),
    smg: buildSmg(matBody, matAccent, matGrip),
    rifle: buildRifle(matBody, matAccent, matGrip),
  };
  for (const id of Object.keys(gunMeshes)) {
    gunMeshes[id].visible = false;
    viewGroup.add(gunMeshes[id]);
  }
  // Spent casings: a small pool of brass boxes that pop out of the player's gun per shot.
  const caseGeo = new THREE.BoxGeometry(0.014, 0.014, 0.032);
  const caseMat = new THREE.MeshStandardMaterial({ color: 0xd8a83c, roughness: 0.35, metalness: 0.8 });
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(caseGeo, caseMat);
    m.visible = false;
    viewGroup.add(m);
    casings.push({ m, life: 0, vx: 0, vy: 0, vz: 0, spin: 0 });
  }
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffc46b, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  // Two crossed planes: the flash has volume from any roll angle, not a flat sticker.
  muzzle = new THREE.Group();
  const flashGeo = new THREE.PlaneGeometry(0.36, 0.36);
  const flashA = new THREE.Mesh(flashGeo, flashMat);
  const flashB = new THREE.Mesh(flashGeo, flashMat);
  flashB.rotation.y = Math.PI / 2;
  muzzle.add(flashA, flashB);
  muzzle.position.set(0, 0.045, -0.62);
  muzzle.visible = false;
  viewGroup.add(muzzle);
  muzzleLight = new THREE.PointLight(0xffa050, 0, 9, 1.8);
  muzzleLight.position.set(0.2, -0.1, -0.6);
  viewGroup.add(muzzleLight);
  viewGroup.position.set(0.24, -0.22, -0.45);
  camera.add(viewGroup);
  scene.add(camera);
}

// Called by weapons.js when the player fires, so the viewmodel can flash.
export function onPlayerFired() {
  flashT = 0.045;
  const cs = casings[casingI++ % casings.length];
  if (cs) { // eject one brass casing to the right of the receiver
    cs.life = 0.55;
    cs.m.visible = true;
    cs.m.position.set(0.07, -0.01, -0.18);
    cs.vx = 0.5 + Math.random() * 0.35;
    cs.vy = 0.85 + Math.random() * 0.4;
    cs.vz = 0.3 + Math.random() * 0.2;
    cs.spin = 9 + Math.random() * 8;
  }
}

// Render-side: place the camera at the player's eye (with recoil, bob and shake) and pose the
// viewmodel gun. Runs every animation frame, independent of the fixed simulation step.
export function updateCamera(camera, rdt) {
  const p = S.player;
  const eye = p.y + eyeHeight(p) + (p.grounded && p.speed2d > 0.5 ? Math.sin(bobPhase) * 0.028 : 0);
  camera.position.set(p.x, eye, p.z);
  let roll = 0;
  if (!p.alive) roll = 0.45; // slumped when down
  camera.rotation.order = 'YXZ';
  camera.rotation.y = p.yaw;
  camera.rotation.x = p.pitch + p.recoil + (S.shake > 0 ? (Math.sin(S.time * 91) * 0.5) * S.shake * 0.05 : 0);
  camera.rotation.z = roll + (S.shake > 0 ? Math.sin(S.time * 83) * S.shake * 0.03 : 0);
  if (S.shake > 0) S.shake = Math.max(0, S.shake - rdt * 2.2);

  if (!viewGroup) return;
  const showGun = p.alive;
  viewGroup.visible = showGun;
  if (!showGun) return;
  // Idle sway: the gun breathes almost imperceptibly, so a still frame never looks frozen stiff.
  viewGroup.position.x = 0.24 + Math.sin(S.time * 1.25) * 0.0035;
  viewGroup.position.y = -0.22 + Math.sin(S.time * 1.7) * 0.0028;
  if (p.weapon !== lastWeapon) { // a fresh gun comes up from below, muzzle re-seated per class
    lastWeapon = p.weapon;
    drawT = 0.3;
    muzzle.position.z = MUZZLE_Z[p.weapon];
  }
  if (drawT > 0) drawT = Math.max(0, drawT - rdt);
  const dk = drawT / 0.3;
  for (const id of Object.keys(gunMeshes)) gunMeshes[id].visible = id === p.weapon;
  const gun = gunMeshes[p.weapon];
  const kick = p.recoil * 0.55;
  gun.position.z = kick * 0.35;
  gun.rotation.x = kick * 0.5;
  if (p.reloadT > 0) {
    const w = WEAPONS[p.weapon];
    const t = 1 - p.reloadT / w.reload; // 0..1 through the reload
    gun.rotation.x += Math.sin(t * Math.PI) * 0.55;
    gun.position.y = -Math.sin(t * Math.PI) * 0.05;
  } else {
    gun.position.y = 0;
  }
  gun.position.y -= 0.26 * dk; // the draw/raise, layered over sway and the reload dip
  gun.rotation.x += 0.65 * dk;
  for (const cs of casings) { // brass arcs out, tumbles, and is gone in half a second
    if (cs.life <= 0) continue;
    cs.life -= rdt;
    if (cs.life <= 0) { cs.m.visible = false; continue; }
    cs.vy -= 3.6 * rdt;
    cs.m.position.x += cs.vx * rdt;
    cs.m.position.y += cs.vy * rdt;
    cs.m.position.z += cs.vz * rdt;
    cs.m.rotation.x += cs.spin * rdt;
    cs.m.rotation.z += cs.spin * 0.7 * rdt;
  }
  if (flashT > 0) {
    flashT -= rdt;
    muzzle.visible = true;
    muzzle.rotation.z = S.time * 37 % Math.PI;
    muzzleLight.intensity = 26;
  } else {
    muzzle.visible = false;
    muzzleLight.intensity = 0;
  }
}
