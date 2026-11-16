// world.js — the Foundry: CINDERLINE's one map, built from original procedural geometry.
// Everything visual and physical comes from the BOXES table below: each entry is drawn as a
// textured box and (unless marked visual) added to COLLIDERS, so what you see is what you hit.
// Textures are painted on canvases at load — the game ships no image files. The module also owns
// the waypoint graph the bots navigate, the two plant sites, spawn/hold points, and the
// line-of-sight and raycast helpers every other system shares.

import * as THREE from 'three';
import { mulberry32 } from './rng.js';

// ---------------------------------------------------------------- textures (procedural)

function canvasTex(size, painter, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  painter(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function speckle(ctx, size, base, flecks, n, rng) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = flecks[Math.floor(rng() * flecks.length)];
    ctx.globalAlpha = 0.05 + rng() * 0.12;
    const s = 1 + rng() * 3;
    ctx.fillRect(rng() * size, rng() * size, s, s);
  }
  ctx.globalAlpha = 1;
}

function makeTextures() {
  const rng = mulberry32(4102);
  const concrete = canvasTex(512, (ctx, s) => {
    speckle(ctx, s, '#8d867c', ['#7a746a', '#9c968c', '#6b655c', '#a39d93'], 9000, rng);
    ctx.strokeStyle = 'rgba(60,56,50,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      let x = rng() * s, y = rng() * s;
      ctx.moveTo(x, y);
      for (let j = 0; j < 4; j++) { x += (rng() - 0.5) * 120; y += rng() * 80; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // cast panel seams: a 2x2 grid of grooves with a lit lip under each
    ctx.fillStyle = 'rgba(40,36,32,0.5)';
    ctx.fillRect(0, s / 2 - 2, s, 4);
    ctx.fillRect(s / 2 - 2, 0, 4, s);
    ctx.fillStyle = 'rgba(255,250,240,0.13)';
    ctx.fillRect(0, s / 2 + 2, s, 2);
    ctx.fillRect(s / 2 + 2, 0, 2, s);
    // anchor bolts near the panel corners
    ctx.fillStyle = 'rgba(38,34,30,0.65)';
    for (const bx of [26, s / 2 - 26, s / 2 + 26, s - 26]) {
      for (const by of [26, s / 2 - 26, s / 2 + 26, s - 26]) {
        ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI * 2); ctx.fill();
      }
    }
    // weather streaks bleeding down from the seams
    for (let i = 0; i < 22; i++) {
      ctx.fillStyle = 'rgba(58,50,42,0.16)';
      const x = rng() * s;
      ctx.fillRect(x, rng() * s * 0.5, 3 + rng() * 5, 60 + rng() * 170);
    }
    const grime = ctx.createLinearGradient(0, s * 0.72, 0, s);
    grime.addColorStop(0, 'rgba(52,48,44,0)');
    grime.addColorStop(1, 'rgba(52,48,44,0.30)');
    ctx.fillStyle = grime;
    ctx.fillRect(0, s * 0.72, s, s * 0.28); // grime at the foot of the wall
  });
  const asphalt = canvasTex(512, (ctx, s) => {
    speckle(ctx, s, '#3b393f', ['#454349', '#322f35', '#504d55', '#2b292e'], 11000, rng);
    ctx.strokeStyle = 'rgba(20,19,22,0.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      let x = rng() * s, y = 0;
      ctx.moveTo(x, y);
      while (y < s) { x += (rng() - 0.5) * 44; y += 36 + rng() * 44; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // oil stains and pale wear patches, so the yard floor is not one flat tone
    for (let i = 0; i < 12; i++) {
      const g = ctx.createRadialGradient(rng() * s, rng() * s, 2, rng() * s, rng() * s, 30 + rng() * 70);
      g.addColorStop(0, 'rgba(12,11,14,0.35)');
      g.addColorStop(1, 'rgba(12,11,14,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = 'rgba(200,190,175,0.05)';
      ctx.beginPath();
      ctx.ellipse(rng() * s, rng() * s, 40 + rng() * 80, 16 + rng() * 30, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 10);
  const corrugated = canvasTex(512, (ctx, s) => {
    for (let x = 0; x < s; x += 32) {
      const g = ctx.createLinearGradient(x, 0, x + 32, 0);
      g.addColorStop(0, '#5d4030');
      g.addColorStop(0.45, '#7d5638');
      g.addColorStop(0.55, '#8a5f3c');
      g.addColorStop(1, '#4e3527');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 32, s);
    }
    // horizontal sheet seams with rivet rows
    ctx.fillStyle = 'rgba(30,20,14,0.45)';
    ctx.fillRect(0, s / 3, s, 4);
    ctx.fillRect(0, (2 * s) / 3, s, 4);
    ctx.fillStyle = 'rgba(25,18,12,0.8)';
    for (let x = 16; x < s; x += 32) {
      for (const y of [s / 3 - 12, s / 3 + 16, (2 * s) / 3 - 12, (2 * s) / 3 + 16]) {
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (let i = 0; i < 52; i++) { // rust streaks running down
      ctx.fillStyle = 'rgba(70,38,20,0.35)';
      const x = rng() * s;
      ctx.fillRect(x, rng() * s * 0.4, 3 + rng() * 6, 60 + rng() * 200);
    }
    const rust = ctx.createLinearGradient(0, s * 0.8, 0, s);
    rust.addColorStop(0, 'rgba(80,40,18,0)');
    rust.addColorStop(1, 'rgba(80,40,18,0.35)');
    ctx.fillStyle = rust;
    ctx.fillRect(0, s * 0.8, s, s * 0.2);
    speckle(ctx, s, 'rgba(0,0,0,0)', ['#3c2718', '#96683f'], 1600, rng);
  });
  const crate = canvasTex(512, (ctx, s) => {
    ctx.fillStyle = '#8a6b42';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 52) {
      ctx.fillStyle = (y / 52) % 2 ? '#93764a' : '#82643d';
      ctx.fillRect(0, y, s, 48);
      ctx.fillStyle = 'rgba(50,36,20,0.55)';
      ctx.fillRect(0, y + 48, s, 4);
      // wood grain runs along each plank
      ctx.strokeStyle = 'rgba(90,64,32,0.35)';
      ctx.lineWidth = 2;
      for (let gi = 0; gi < 3; gi++) {
        ctx.beginPath();
        const gy = y + 8 + rng() * 34;
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(s * 0.3, gy + (rng() - 0.5) * 8, s * 0.7, gy + (rng() - 0.5) * 8, s, gy);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = '#5f472a';
    ctx.lineWidth = 22;
    ctx.strokeRect(11, 11, s - 22, s - 22);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s, s); ctx.moveTo(s, 0); ctx.lineTo(0, s);
    ctx.lineWidth = 14; ctx.stroke();
    // nail heads on the frame
    ctx.fillStyle = 'rgba(40,30,18,0.8)';
    for (const nx of [30, s - 30]) for (const ny of [30, s - 30]) {
      ctx.beginPath(); ctx.arc(nx, ny, 6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(38,28,16,0.55)';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillText('KESTREL FOUNDRY', 34, s - 36);
    speckle(ctx, s, 'rgba(0,0,0,0)', ['#6d5330', '#a5854f'], 2200, rng);
  });
  const container = (base, dark, stencil) => canvasTex(512, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 21) {
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(x, 0, 6, s);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(x + 6, 0, 4, s);
    }
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, s, 22);
    ctx.fillRect(0, s - 22, s, 22);
    // door seam and locking bars on the right-hand third
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(s * 0.68, 0, 5, s);
    ctx.fillRect(s * 0.68 + 26, 22, 7, s - 44);
    ctx.fillRect(s * 0.68 + 62, 22, 7, s - 44);
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = 'bold 62px system-ui, sans-serif';
    ctx.fillText(stencil, 34, 108);
    ctx.font = '700 27px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('KESTREL FOUNDRY DIVISION', 36, 152);
    // rust weeping from the rails and pooling at the foot
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = 'rgba(60,32,16,0.28)';
      const x = rng() * s;
      ctx.fillRect(x, rng() * s * 0.3, 4 + rng() * 6, 80 + rng() * 220);
    }
    const foot = ctx.createLinearGradient(0, s * 0.82, 0, s);
    foot.addColorStop(0, 'rgba(40,26,18,0)');
    foot.addColorStop(1, 'rgba(40,26,18,0.4)');
    ctx.fillStyle = foot;
    ctx.fillRect(0, s * 0.82, s, s * 0.18);
    speckle(ctx, s, 'rgba(0,0,0,0)', ['rgba(30,26,22,0.8)', 'rgba(255,255,255,0.5)'], 1600, rng);
  });
  // Dark structural plate: panel grid, rivets and brushed wear — for pillars, beams, posts.
  const plate = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#2e2e35';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) { // brushed-metal streaks
      ctx.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.16)';
      ctx.fillRect(rng() * s, rng() * s, 14 + rng() * 40, 1.5);
    }
    ctx.fillStyle = 'rgba(10,10,13,0.6)';
    ctx.fillRect(0, s / 2 - 2, s, 4);
    ctx.fillRect(s / 2 - 2, 0, 4, s);
    ctx.fillStyle = 'rgba(200,205,220,0.10)';
    ctx.fillRect(0, s / 2 + 2, s, 2);
    ctx.fillRect(s / 2 + 2, 0, 2, s);
    ctx.fillStyle = 'rgba(12,12,15,0.85)';
    for (const bx of [18, s / 2 - 18, s / 2 + 18, s - 18]) {
      for (const by of [18, s / 2 - 18, s / 2 + 18, s - 18]) {
        ctx.beginPath(); ctx.arc(bx, by, 4, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(120,60,25,0.20)';
    ctx.fillRect(0, s - 14, s, 14);
  });
  // Distant factory facade: near-black slabs pricked with lit windows, for the skyline.
  const windows = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#171021';
    ctx.fillRect(0, 0, s, s);
    for (let y = 14; y < s - 8; y += 21) {
      for (let x = 12; x < s - 10; x += 19) {
        const r = rng();
        if (r < 0.13) ctx.fillStyle = 'rgba(255,180,107,0.95)';
        else if (r < 0.16) ctx.fillStyle = 'rgba(159,216,232,0.8)';
        else if (r < 0.24) ctx.fillStyle = 'rgba(255,180,107,0.35)';
        else ctx.fillStyle = 'rgba(8,6,13,0.9)';
        ctx.fillRect(x, y, 9, 12);
      }
    }
  });
  // Scorch mark: overlapping soot blotches fading to nothing — ground decals near the furnace.
  const scorch = canvasTex(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    for (let i = 0; i < 9; i++) {
      const x = s / 2 + (rng() - 0.5) * s * 0.4, y = s / 2 + (rng() - 0.5) * s * 0.4;
      const r = s * (0.14 + rng() * 0.2);
      const g = ctx.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, 'rgba(8,6,5,0.55)');
      g.addColorStop(1, 'rgba(8,6,5,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
  });
  scorch.wrapS = scorch.wrapT = THREE.ClampToEdgeWrapping;
  // A soft cloud: a cluster of blurred blobs on transparency, tinted dark plum when used.
  const cloud = canvasTex(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    for (let i = 0; i < 16; i++) {
      const x = s * (0.2 + rng() * 0.6), y = s * (0.35 + rng() * 0.3);
      const r = s * (0.10 + rng() * 0.16);
      const g = ctx.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.2)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
  });
  cloud.wrapS = cloud.wrapT = THREE.ClampToEdgeWrapping;
  // Worn painted stripe for the yard walkway: a chipped amber band on transparency.
  const paint = canvasTex(128, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(201,162,39,0.85)';
    ctx.fillRect(s * 0.28, 0, s * 0.44, s);
    for (let i = 0; i < 240; i++) { // chips worn through to the asphalt
      ctx.clearRect(s * 0.28 + rng() * s * 0.44, rng() * s, 2 + rng() * 5, 2 + rng() * 4);
    }
  });
  // Molten metal: a white-hot core cooling to deep red at the edges (furnace mouth, channel).
  const molten = canvasTex(128, (ctx, s) => {
    ctx.fillStyle = '#571c08';
    ctx.fillRect(0, 0, s, s);
    const g = ctx.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s * 0.52);
    g.addColorStop(0, '#fff3c4');
    g.addColorStop(0.35, '#ffb03a');
    g.addColorStop(0.7, '#e85d16');
    g.addColorStop(1, 'rgba(87,28,8,0)');
    ctx.save();
    ctx.translate(s / 2, s / 2);
    ctx.scale(1, 0.42);
    ctx.translate(-s / 2, -s / 2);
    ctx.fillStyle = g;
    ctx.fillRect(0, -s * 0.7, s, s * 2.4);
    ctx.restore();
  });
  molten.wrapS = molten.wrapT = THREE.ClampToEdgeWrapping;
  const hazard = canvasTex(128, (ctx, s) => {
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#22201e';
    for (let x = -s; x < s * 2; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, s); ctx.lineTo(x + 16, s); ctx.lineTo(x + 16 + s, 0); ctx.lineTo(x + s, 0);
      ctx.fill();
    }
  }, 3);
  const letter = (ch, color) => {
    const tex = canvasTex(256, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.strokeStyle = color;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = `bold ${s * 0.52}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ch, s / 2, s / 2 + s * 0.03);
    });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  };
  return { concrete, asphalt, corrugated, crate, hazard, letter, container, plate, windows, molten, scorch, cloud, paint };
}

// Vertical fade for the site beacon columns: solid at the ground, gone before the top, so the
// beam reads as a shaft of light rather than a translucent wall.
function beamTexture() {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0.95)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A soft radial glow sprite texture, shared by lamp halos and the drifting embers.
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- map data
// { x, z, w, d, h, mat, y0?, visual? } — centre x/z, footprint w×d, height h from y0 (default 0).

const BOXES = [
  // perimeter walls
  { x: 0, z: -34.5, w: 70, d: 1, h: 4.5, mat: 'corr' },
  { x: 0, z: 34.5, w: 70, d: 1, h: 4.5, mat: 'corr' },
  { x: -34.5, z: 0, w: 1, d: 70, h: 4.5, mat: 'corr' },
  { x: 34.5, z: 0, w: 1, d: 70, h: 4.5, mat: 'corr' },
  // pump house, centre — the mid landmark both lanes bend around
  { x: 0, z: -2, w: 6, d: 4, h: 3.2, mat: 'conc' },
  { x: 0, z: -2, w: 6.7, d: 4.7, h: 0.25, y0: 3.2, mat: 'dark', visual: true },
  // mid divider walls with a door gap at z 0..3 on each side
  { x: -12, z: -5, w: 1, d: 10, h: 3, mat: 'conc' },
  { x: -12, z: 7, w: 1, d: 8, h: 3, mat: 'conc' },
  { x: 12, z: -5, w: 1, d: 10, h: 3, mat: 'conc' },
  { x: 12, z: 7, w: 1, d: 8, h: 3, mat: 'conc' },
  // mid cover
  { x: -3, z: -16, w: 2, d: 2, h: 1.1, mat: 'crate' },
  { x: 3, z: -16, w: 2, d: 2, h: 2.2, mat: 'crate' },
  { x: 0, z: 4, w: 3, d: 2, h: 1.1, mat: 'crate' },
  { x: 0, z: 10, w: 2, d: 2, h: 1.1, mat: 'crate' },
  // catwalk pillars north of mid (beam is visual only)
  { x: -3, z: -24, w: 1.2, d: 1.2, h: 3.6, mat: 'dark' },
  { x: 3, z: -24, w: 1.2, d: 1.2, h: 3.6, mat: 'dark' },
  { x: 0, z: -24, w: 7.4, d: 1.4, h: 0.3, y0: 3.4, mat: 'dark', visual: true },
  // --- site A: the furnace hall (west)
  { x: -22, z: -21, w: 6, d: 5, h: 3.4, mat: 'rust' },
  { x: -22, z: -21, w: 1.8, d: 1.8, h: 8, mat: 'dark' },
  { x: -28, z: -14, w: 1.2, d: 1.2, h: 3.6, mat: 'conc' },
  { x: -16, z: -14, w: 1.2, d: 1.2, h: 3.6, mat: 'conc' },
  { x: -28, z: -26, w: 1.2, d: 1.2, h: 3.6, mat: 'conc' },
  { x: -16, z: -26, w: 1.2, d: 1.2, h: 3.6, mat: 'conc' },
  { x: -19, z: -16, w: 2, d: 2, h: 1.1, mat: 'crate' },
  { x: -25, z: -24, w: 2, d: 2, h: 2.2, mat: 'crate' },
  { x: -24, z: -15, w: 3, d: 1.6, h: 1.1, mat: 'crate' },
  { x: -27, z: -19, w: 1.6, d: 1.6, h: 1.1, mat: 'crate' },
  // --- site B: the loading dock (east)
  { x: 24, z: -22, w: 10, d: 6, h: 0.45, mat: 'conc' },
  { x: 18, z: -24, w: 6, d: 2.4, h: 2.6, mat: 'contTeal' },
  { x: 27.5, z: -16.5, w: 2.4, d: 5, h: 2.6, mat: 'contOchre' },
  { x: 22, z: -14.5, w: 4, d: 2, h: 1.15, mat: 'crate' },
  { x: 17, z: -17, w: 2, d: 2, h: 1.1, mat: 'crate' },
  { x: 29, z: -26, w: 2, d: 2, h: 1.1, mat: 'crate' },
  // south yard cover, between the spawns and mid
  { x: -10, z: 12, w: 4, d: 2, h: 1.1, mat: 'crate' },
  { x: 10, z: 12, w: 4, d: 2, h: 2.2, mat: 'crate' },
  { x: -2, z: 18, w: 2, d: 2, h: 1.1, mat: 'crate' },
  { x: 14, z: 20, w: 3, d: 2, h: 1.1, mat: 'crate' },
  // lane containers and crates
  { x: -30.5, z: 2, w: 2, d: 4, h: 2.6, mat: 'contOchre' },
  { x: 30.5, z: 2, w: 2, d: 4, h: 2.6, mat: 'contTeal' },
  { x: -24, z: 8, w: 2, d: 2, h: 1.1, mat: 'crate' },
  { x: 24, z: 8, w: 2, d: 2, h: 1.1, mat: 'crate' },
  // extra crate stacks hugging the walls — varied footprints, one of them two high
  { x: -32.5, z: -11, w: 1.6, d: 1.6, h: 1.1, mat: 'crate' },
  { x: -32.5, z: -11, w: 1.2, d: 1.2, h: 0.9, y0: 1.1, mat: 'crate' },
  { x: 32.5, z: -11, w: 1.6, d: 1.6, h: 1.1, mat: 'crate' },
  { x: -16, z: 30.8, w: 2, d: 1.6, h: 1.1, mat: 'crate' },
  { x: 17, z: 30.8, w: 2, d: 1.6, h: 1.1, mat: 'crate' },
  { x: -31, z: -31, w: 2, d: 2, h: 2.2, mat: 'crate' },
  { x: 31, z: -31, w: 2, d: 2, h: 1.1, mat: 'crate' },
  // lamp posts (thin, solid)
  { x: -13, z: -8, w: 0.3, d: 0.3, h: 3.4, mat: 'dark' },
  { x: 13, z: -8, w: 0.3, d: 0.3, h: 3.4, mat: 'dark' },
  { x: 0, z: 20, w: 0.3, d: 0.3, h: 3.4, mat: 'dark' },
];

export const COLLIDERS = [];
for (const b of BOXES) {
  if (b.visual) continue;
  COLLIDERS.push({
    minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
    minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
    bottom: b.y0 ?? 0, top: (b.y0 ?? 0) + b.h,
  });
}

// Rectangles the minimap draws: the solid structures, simplified.
export const MINIMAP_RECTS = BOXES.filter((b) => !b.visual && b.h >= 1)
  .map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d }));

// ---------------------------------------------------------------- sites, spawns, holds

export const SITES = {
  A: { id: 'A', cx: -22, cz: -20, half: 6.5, plant: { x: -21, z: -15 }, color: 0xff7a33 },
  B: { id: 'B', cx: 22, cz: -20, half: 6.5, plant: { x: 24, z: -21.5 }, color: 0x39c2c9 },
};

export function siteAt(x, z) {
  for (const id of ['A', 'B']) {
    const s = SITES[id];
    if (Math.abs(x - s.cx) <= s.half && Math.abs(z - s.cz) <= s.half) return s;
  }
  return null;
}

export const SPAWNS = {
  ember: [
    { x: 0, z: 29.5, yaw: 0 }, // the player
    { x: -4, z: 28, yaw: 0 },
    { x: 4, z: 28, yaw: 0 },
    { x: -8, z: 26, yaw: 0 },
  ],
  ward: [
    { x: -20, z: -29, yaw: Math.PI },
    { x: -25, z: -27.5, yaw: Math.PI },
    { x: 20, z: -29, yaw: Math.PI },
    { x: 5, z: -28, yaw: Math.PI },
  ],
};

// Positions defenders settle into, per site; attackers use the plant points and entries.
export const HOLDS = {
  A: [{ x: -27.5, z: -16.5 }, { x: -17, z: -24.5 }],
  B: [{ x: 20, z: -26.8 }, { x: 28.5, z: -13.2 }],
  mid: [{ x: 5.5, z: -12.5 }],
};

// ---------------------------------------------------------------- waypoints

const NODE_LIST = [
  ['eSpawn', 0, 29], ['eSW', -9, 24], ['eSE', 9, 24],
  ['sW', -17, 13], ['sM', 0, 15], ['sE', 17, 13],
  ['wLaneS', -29, 8], ['eLaneS', 29, 8],
  ['wDoor', -12, 1.5], ['eDoor', 12, 1.5],
  ['midS', 0, 6], ['midW', -7, -3], ['midE', 7, -3], ['midN', 0, -9],
  ['wLane', -30, -4], ['eLane', 30, -4],
  ['midNW', -7, -13], ['midNE', 7, -13],
  ['wLaneN', -29, -15], ['eLaneN', 29, -15],
  ['doorA', -13, -18], ['doorB', 13, -18],
  ['aLane', -29, -20], ['bLane', 29, -20],
  ['aIn', -16, -18], ['bIn', 15, -17],
  ['aPlant', -21, -15], ['bPlant', 24, -21.5],
  ['aW', -27, -21], ['bE', 28, -21],
  ['aN', -22, -25.5], ['bN', 24, -27],
  ['wSpawn', 0, -30], ['wA', -13, -28], ['wB', 13, -28],
];

const EDGE_LIST = [
  ['eSpawn', 'eSW'], ['eSpawn', 'eSE'], ['eSW', 'sW'], ['eSE', 'sE'], ['eSW', 'sM'], ['eSE', 'sM'],
  ['sW', 'wLaneS'], ['sE', 'eLaneS'], ['sM', 'midS'], ['sW', 'wDoor'], ['sE', 'eDoor'],
  ['wLaneS', 'wLane'], ['eLaneS', 'eLane'], ['wLane', 'wLaneN'], ['eLane', 'eLaneN'],
  ['wDoor', 'midW'], ['eDoor', 'midE'], ['wDoor', 'wLane'], ['eDoor', 'eLane'],
  ['midS', 'midW'], ['midS', 'midE'], ['midW', 'midN'], ['midE', 'midN'],
  ['midN', 'midNW'], ['midN', 'midNE'], ['midNW', 'doorA'], ['midNE', 'doorB'],
  ['midNW', 'wLaneN'], ['midNE', 'eLaneN'],
  ['doorA', 'aIn'], ['aIn', 'aPlant'], ['aPlant', 'aW'], ['aW', 'aLane'], ['aLane', 'wLaneN'],
  ['aW', 'aN'], ['aN', 'wA'], ['wA', 'doorA'],
  ['doorB', 'bIn'], ['bIn', 'bPlant'], ['bPlant', 'bE'], ['bE', 'bLane'], ['bLane', 'eLaneN'],
  ['bPlant', 'bN'], ['bN', 'wB'], ['wB', 'doorB'],
  ['wSpawn', 'wA'], ['wSpawn', 'wB'], ['wSpawn', 'midN'],
];

export const NODES = NODE_LIST.map(([name, x, z]) => ({ name, x, z }));
const NODE_INDEX = new Map(NODE_LIST.map(([name], i) => [name, i]));

const ADJ = NODES.map(() => []);
for (const [a, b] of EDGE_LIST) {
  const ia = NODE_INDEX.get(a);
  const ib = NODE_INDEX.get(b);
  ADJ[ia].push(ib);
  ADJ[ib].push(ia);
}

export function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < NODES.length; i++) {
    const dx = NODES[i].x - x;
    const dz = NODES[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// A* over the waypoint graph. Returns an array of {x, z} waypoints from just after the start
// node to the goal node (empty when already there), or null when unreachable. Scratch arrays are
// module-level and reused; paths are short and calls are infrequent (bots repath ~1/second).
const aStar = {
  g: new Float64Array(NODES.length),
  f: new Float64Array(NODES.length),
  came: new Int32Array(NODES.length),
  closed: new Uint8Array(NODES.length),
  open: [],
};

export function findPath(fromIdx, toIdx) {
  const { g, f, came, closed, open } = aStar;
  g.fill(Infinity);
  f.fill(Infinity);
  came.fill(-1);
  closed.fill(0);
  open.length = 0;
  const goal = NODES[toIdx];
  const h = (i) => Math.hypot(NODES[i].x - goal.x, NODES[i].z - goal.z);
  g[fromIdx] = 0;
  f[fromIdx] = h(fromIdx);
  open.push(fromIdx);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur === toIdx) {
      const path = [];
      let n = cur;
      while (n !== fromIdx && n !== -1) {
        path.push({ x: NODES[n].x, z: NODES[n].z });
        n = came[n];
      }
      path.reverse();
      return path;
    }
    closed[cur] = 1;
    for (const nb of ADJ[cur]) {
      if (closed[nb]) continue;
      const step = Math.hypot(NODES[nb].x - NODES[cur].x, NODES[nb].z - NODES[cur].z);
      const ng = g[cur] + step;
      if (ng < g[nb]) {
        g[nb] = ng;
        f[nb] = ng + h(nb);
        came[nb] = cur;
        if (!open.includes(nb)) open.push(nb);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- spatial queries

// Highest standable surface at (x, z) whose top is at most refY + step (0.55): lets combatants
// walk up the dock platform and crates they can step onto, and stand on what they jump onto.
export function groundHeight(x, z, refY) {
  let ground = 0;
  for (const c of COLLIDERS) {
    if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) {
      if (c.top <= refY + 0.55 && c.top > ground) ground = c.top;
    }
  }
  return ground;
}

// 3D segment vs the collider boxes (slab test). True when sight or a bullet is blocked.
export function segmentBlocked(x1, y1, z1, x2, y2, z2) {
  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
  for (const c of COLLIDERS) {
    let t0 = 0, t1 = 1;
    // X slab
    if (Math.abs(dx) < 1e-9) { if (x1 < c.minX || x1 > c.maxX) continue; }
    else {
      let ta = (c.minX - x1) / dx, tb = (c.maxX - x1) / dx;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    // Y slab
    if (Math.abs(dy) < 1e-9) { if (y1 < c.bottom || y1 > c.top) continue; }
    else {
      let ta = (c.bottom - y1) / dy, tb = (c.top - y1) / dy;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    // Z slab
    if (Math.abs(dz) < 1e-9) { if (z1 < c.minZ || z1 > c.maxZ) continue; }
    else {
      let ta = (c.minZ - z1) / dz, tb = (c.maxZ - z1) / dz;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    return true;
  }
  return false;
}

export function hasLOS(x1, y1, z1, x2, y2, z2) {
  return !segmentBlocked(x1, y1, z1, x2, y2, z2);
}

// Nearest distance along the ray (unit direction) that world geometry stops it, or Infinity.
// Includes the ground plane. Used by hitscan fire and impact effects.
export function raycastWorld(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  if (dy < -1e-9) {
    const t = -oy / dy;
    if (t > 0 && t < best) best = t;
  }
  for (const c of COLLIDERS) {
    let t0 = 0, t1 = best;
    if (Math.abs(dx) < 1e-9) { if (ox < c.minX || ox > c.maxX) continue; }
    else {
      let ta = (c.minX - ox) / dx, tb = (c.maxX - ox) / dx;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (Math.abs(dy) < 1e-9) { if (oy < c.bottom || oy > c.top) continue; }
    else {
      let ta = (c.bottom - oy) / dy, tb = (c.top - oy) / dy;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-9) { if (oz < c.minZ || oz > c.maxZ) continue; }
    else {
      let ta = (c.minZ - oz) / dz, tb = (c.maxZ - oz) / dz;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (t0 > 0 && t0 < best) best = t0;
  }
  return best;
}

// ---------------------------------------------------------------- scene construction

// Render-side dressing that moves: the ember drift, the site beacon pulse and the furnace
// flicker. worldTick advances it per animation frame; the fixed-step simulation never sees it.
const animated = { t: 0, embers: null, emberBase: null, emberSpeed: null, beacons: [], mouthMat: null, clouds: [], warn: [], furnace: null, lamps: [] };

export function worldTick(rdt) {
  animated.t += rdt;
  const t = animated.t;
  if (animated.embers) {
    const pos = animated.embers.geometry.attributes.position;
    const base = animated.emberBase;
    const speed = animated.emberSpeed;
    for (let i = 0; i < speed.length; i++) {
      const by = base[i * 3 + 1];
      const top = by > 9 ? 13 : 9.5;
      pos.array[i * 3] = base[i * 3] + Math.sin(t * 0.6 + i * 1.7) * 0.4;
      pos.array[i * 3 + 1] = 0.3 + ((by + t * speed[i]) % top);
      pos.array[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.5 + i * 2.3) * 0.4;
    }
    pos.needsUpdate = true;
  }
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.3);
  for (const b of animated.beacons) {
    b.beam.material.opacity = 0.035 + pulse * 0.03;
    b.ring.material.opacity = 0.5 + pulse * 0.3;
  }
  if (animated.mouthMat) {
    const f = 0.92 + 0.08 * Math.sin(t * 12.7) * Math.sin(t * 7.1 + 1.3);
    animated.mouthMat.color.setScalar(f);
  }
  // Clouds sway a few metres and back; stack warning lights blink out of phase; the furnace
  // light breathes unevenly and the door lamps shimmer almost imperceptibly.
  for (const cl of animated.clouds) {
    cl.m.position.x = cl.x + Math.sin(t * cl.sp + cl.ph) * 7;
  }
  for (const w of animated.warn) w.m.visible = (t * 0.8 + w.ph) % 1 < 0.55;
  if (animated.furnace) {
    animated.furnace.intensity = 60 * (0.84 + 0.16 * Math.sin(t * 11.3) * Math.sin(t * 5.7 + 2.1));
  }
  for (const l of animated.lamps) {
    l.light.intensity = l.base * (0.93 + 0.07 * Math.sin(t * 23 + l.ph) * Math.sin(t * 7.3 + l.ph));
  }
}

// Gradient dusk sky: amber at the horizon under the low sun, plum above, near-black zenith
// with the first faint stars. A single BackSide sphere — no texture, no light cost.
function buildSky(scene, glowTex, cloudTex) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {},
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 zen = vec3(0.055, 0.035, 0.11);
        vec3 mid = vec3(0.26, 0.115, 0.27);
        vec3 hor = vec3(0.78, 0.33, 0.155);
        vec3 col = mix(hor, mid, smoothstep(0.02, 0.30, h));
        col = mix(col, zen, smoothstep(0.22, 0.68, h));
        col = mix(vec3(0.10, 0.06, 0.09), col, smoothstep(-0.08, 0.02, h));
        vec3 sunDir = normalize(vec3(-0.62, 0.16, -0.38));
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.52, 0.22) * pow(s, 14.0) * 0.5;
        col += vec3(1.0, 0.62, 0.30) * pow(s, 90.0) * 0.85;
        if (h > 0.30) {
          vec3 cell = floor(d * 90.0);
          float star = step(0.9975, hash(cell)) * smoothstep(0.30, 0.62, h);
          col += vec3(0.75, 0.8, 1.0) * star * 0.5;
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(205, 24, 16), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);
  // The low sun itself: a bright disc sprite on the horizon, where the shader already glows
  // (sun direction -0.62, 0.16, -0.38 — the directional light sits on the same bearing).
  const sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffc98a, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  sunSpr.position.set(-154, 40, -94);
  sunSpr.scale.setScalar(58);
  scene.add(sunSpr);
  // Slow cloud drift high over the yard: dark sprites that sway in worldTick.
  const crng = mulberry32(9182);
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudTex, color: 0x38203e, transparent: true, depthWrite: false,
      opacity: 0.32 + crng() * 0.3, fog: false,
    }));
    const ang = crng() * Math.PI * 2;
    const rad = 60 + crng() * 110;
    m.position.set(Math.cos(ang) * rad, 46 + crng() * 36, Math.sin(ang) * rad);
    m.scale.set(46 + crng() * 55, 13 + crng() * 12, 1);
    scene.add(m);
    animated.clouds.push({ m, x: m.position.x, sp: 0.008 + crng() * 0.012, ph: crng() * 6.28 });
  }
}

export function buildWorld(scene) {
  const tex = makeTextures();
  const glowTex = glowTexture();
  buildSky(scene, glowTex, tex.cloud);
  const beamTex = beamTexture();
  const mats = {
    conc: new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: 0.95 }),
    asphalt: new THREE.MeshStandardMaterial({ map: tex.asphalt, roughness: 1 }),
    corr: new THREE.MeshStandardMaterial({ map: tex.corrugated, roughness: 0.8, metalness: 0.25 }),
    rust: new THREE.MeshStandardMaterial({ map: tex.corrugated, color: 0xd88a4a, roughness: 0.75, metalness: 0.3 }),
    crate: new THREE.MeshStandardMaterial({ map: tex.crate, roughness: 0.9 }),
    contTeal: new THREE.MeshStandardMaterial({ map: tex.container('#2e6f6a', '#1d4a46', 'UNIT 07 · KESTREL'), roughness: 0.55, metalness: 0.45 }),
    contOchre: new THREE.MeshStandardMaterial({ map: tex.container('#a5712a', '#6e4a1a', 'UNIT 12 · KESTREL'), roughness: 0.55, metalness: 0.45 }),
    dark: new THREE.MeshStandardMaterial({ map: tex.plate, roughness: 0.55, metalness: 0.55 }),
    hazard: new THREE.MeshStandardMaterial({ map: tex.hazard, roughness: 0.85 }),
  };

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(76, 76),
    mats.asphalt,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  for (const b of BOXES) {
    const mesh = new THREE.Mesh(unitBox, mats[b.mat]);
    mesh.scale.set(b.w, b.h, b.d);
    mesh.position.set(b.x, (b.y0 ?? 0) + b.h / 2, b.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Hazard edging on the dock platform rim.
  const dockEdge = new THREE.Mesh(new THREE.BoxGeometry(10, 0.06, 0.5), mats.hazard);
  dockEdge.position.set(24, 0.46, -19.2);
  scene.add(dockEdge);

  // Site decals: painted ring + letter on the ground, and a standing sign at each entry.
  for (const id of ['A', 'B']) {
    const s = SITES[id];
    const colorCss = id === 'A' ? '#ff7a33' : '#39c2c9';
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 11),
      new THREE.MeshBasicMaterial({ map: tex.letter(id, colorCss), transparent: true, opacity: 0.85, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(s.cx, 0.02, s.cz);
    scene.add(decal);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshBasicMaterial({ map: tex.letter(id, colorCss), transparent: true, side: THREE.DoubleSide }),
    );
    sign.position.set(id === 'A' ? -14.2 : 14.2, 2.1, -20);
    sign.rotation.y = id === 'A' ? Math.PI / 2 : -Math.PI / 2;
    scene.add(sign);
    const pole = new THREE.Mesh(unitBox, mats.dark);
    pole.scale.set(0.18, 3.4, 0.18);
    pole.position.set(sign.position.x, 1.7, -20);
    scene.add(pole);
    // A beacon at the plant point itself: a glowing ground ring and a faint column of light,
    // so the objective reads from anywhere on the site. Pulsed in worldTick.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1.2, 28),
      new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.plant.x, 0.04, s.plant.z);
    scene.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.85, 7.5, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: s.color, map: beamTex, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    beam.position.set(s.plant.x, 3.75, s.plant.z);
    scene.add(beam);
    animated.beacons.push({ beam, ring });
  }

  // Furnace mouth glow (site A's landmark) — a molten slit on the furnace's south face, with a
  // white-hot core, and a cooling stream that runs out of it across the yard floor.
  const mouthMat = new THREE.MeshBasicMaterial({ map: tex.molten });
  animated.mouthMat = mouthMat;
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.85), mouthMat);
  mouth.position.set(-22, 0.85, -18.48);
  scene.add(mouth);
  const mouthCore = new THREE.Mesh(
    new THREE.PlaneGeometry(2.1, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xffe9b0 }),
  );
  mouthCore.position.set(-22, 0.85, -18.47);
  scene.add(mouthCore);
  const channel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 5.4),
    new THREE.MeshBasicMaterial({ map: tex.molten, transparent: true, opacity: 0.9 }),
  );
  channel.rotation.x = -Math.PI / 2;
  channel.rotation.z = Math.PI / 2;
  channel.position.set(-22, 0.02, -15.6);
  scene.add(channel);

  // Distant factory silhouettes and two chimney stacks, for depth beyond the walls.
  const skyMat = new THREE.MeshBasicMaterial({ map: tex.windows });
  const skyline = [[-52, -30, 16, 14], [-48, 8, 12, 20], [-55, 34, 18, 10], [50, -38, 20, 16],
    [54, 6, 14, 24], [48, 36, 16, 12], [0, -56, 26, 13], [-24, -54, 12, 18], [26, 54, 22, 11], [-30, 52, 14, 15]];
  for (const [x, z, w, h] of skyline) {
    const m = new THREE.Mesh(unitBox, skyMat);
    m.scale.set(w, h, 8);
    m.position.set(x, h / 2, z);
    scene.add(m);
  }
  const chimneyMat = new THREE.MeshStandardMaterial({ color: 0x241d2e, roughness: 1 });
  for (const [x, z] of [[-46, -44], [44, -48]]) {
    const ch = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.1, 24, 10), chimneyMat);
    ch.position.set(x, 12, z);
    scene.add(ch);
  }

  // Lighting: low sunset key light with shadows, cool sky fill, warm work lamps.
  scene.fog = new THREE.Fog(0x4f2833, 30, 118);
  const hemi = new THREE.HemisphereLight(0x8a6a9e, 0x33241a, 1.18);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb37a, 2.3);
  sun.position.set(-34, 30, -20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -44;
  sun.shadow.camera.right = 44;
  sun.shadow.camera.top = 44;
  sun.shadow.camera.bottom = -44;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  const lampAt = (x, y, z, color, intensity, dist) => {
    const p = new THREE.PointLight(color, intensity, dist, 1.6);
    p.position.set(x, y, z);
    scene.add(p);
    return p;
  };
  animated.furnace = lampAt(-22, 2.2, -19, 0xff8a3c, 60, 20); // furnace glow, site A (flickers)
  lampAt(24, 3.4, -22, 0xffc37a, 40, 20); // dock lamp, site B
  lampAt(0, 3.4, 6, 0xffc37a, 30, 18); // mid lamp
  animated.lamps.push({ light: lampAt(-13, 3.3, -8, 0xffc37a, 16, 15), base: 16, ph: 0 });
  animated.lamps.push({ light: lampAt(13, 3.3, -8, 0xffc37a, 16, 15), base: 16, ph: 2.4 });
  // Lamp heads on the three posts, each with a soft halo sprite so the light has a visible source.
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  for (const [x, z] of [[-13, -8], [13, -8], [0, 20]]) {
    const head = new THREE.Mesh(unitBox, headMat);
    head.scale.set(0.55, 0.18, 0.55);
    head.position.set(x, 3.45, z);
    scene.add(head);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xffc98a, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo.scale.setScalar(2.1);
    halo.position.set(x, 3.45, z);
    scene.add(halo);
  }

  // Amber strip lights along the pump-house roof rim — mid's landmark, visible down both lanes.
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xffb46b });
  for (const dz of [-2.32, 2.32]) {
    const strip = new THREE.Mesh(unitBox, stripMat);
    strip.scale.set(6.7, 0.07, 0.14);
    strip.position.set(0, 3.32, -2 + dz);
    scene.add(strip);
  }

  // ------------------------------------------------ set dressing: pipes, cables, catwalk,
  // crane, barrels and ground paint. Pure scenery except the barrels, which also collide.
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x4c4438, roughness: 0.5, metalness: 0.7 });
  const pipeGeo = new THREE.CylinderGeometry(0.09, 0.09, 1, 10);
  const pipe = (x, y, z, len, axis) => {
    const m = new THREE.Mesh(pipeGeo, pipeMat);
    m.scale.y = len;
    if (axis === 'x') m.rotation.z = Math.PI / 2;
    if (axis === 'z') m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z);
    m.castShadow = true;
    scene.add(m);
  };
  pipe(0, 2.6, 0.28, 6.4, 'x'); // along the pump-house face
  pipe(-2.5, 1.6, 0.28, 2, 'y'); // two drops off it
  pipe(2.5, 1.6, 0.28, 2, 'y');
  pipe(0, 3.1, -33.9, 44, 'x'); // the length of the north wall
  const wheel = new THREE.Mesh(
    new THREE.TorusGeometry(0.27, 0.04, 8, 20),
    new THREE.MeshStandardMaterial({ color: 0xa03a28, roughness: 0.5, metalness: 0.5 }),
  );
  wheel.position.set(1.2, 1.7, 0.32);
  scene.add(wheel);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 8), pipeMat);
  hub.rotation.x = Math.PI / 2;
  hub.position.set(1.2, 1.7, 0.3);
  scene.add(hub);
  // Hanging cables sagging between posts and rooftops.
  const cableMat = new THREE.MeshBasicMaterial({ color: 0x191221 });
  const cable = (x1, y1, z1, x2, y2, z2, sag) => {
    const mid = new THREE.Vector3((x1 + x2) / 2, Math.min(y1, y2) - sag, (z1 + z2) / 2);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x1, y1, z1), mid, new THREE.Vector3(x2, y2, z2)]);
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.028, 5), cableMat));
  };
  cable(-13, 3.4, -8, -3.2, 3.5, -0.6, 0.7);
  cable(13, 3.4, -8, 3.2, 3.5, -0.6, 0.7);
  cable(-3, 3.7, -24, 3, 3.7, -24, 0.55);
  cable(0, 3.45, 20, 3.2, 3.5, 0.4, 0.9);
  // Railings and a ladder for the catwalk beam north of mid (the beam itself is in BOXES).
  for (const dz of [-0.62, 0.62]) {
    for (let i = 0; i < 7; i++) {
      const post = new THREE.Mesh(unitBox, mats.dark);
      post.scale.set(0.05, 0.9, 0.05);
      post.position.set(-3.3 + i * 1.1, 4.12, -24 + dz);
      scene.add(post);
    }
    for (const ry of [4.12, 4.52]) {
      const rail = new THREE.Mesh(unitBox, mats.dark);
      rail.scale.set(7.2, 0.05, 0.05);
      rail.position.set(0, ry, -24 + dz);
      scene.add(rail);
    }
  }
  for (let i = 0; i < 6; i++) {
    const rung = new THREE.Mesh(unitBox, mats.dark);
    rung.scale.set(0.05, 0.05, 0.56);
    rung.position.set(3.72, 0.5 + i * 0.55, -24);
    scene.add(rung);
  }
  for (const dz of [-0.28, 0.28]) {
    const side = new THREE.Mesh(unitBox, mats.dark);
    side.scale.set(0.05, 3.4, 0.05);
    side.position.set(3.72, 1.7, -24 + dz);
    scene.add(side);
  }
  // A gantry crane silhouette beyond the north wall, and blinking lights on the stacks.
  const silMat = new THREE.MeshBasicMaterial({ color: 0x140d1e });
  for (const gx of [-20, 20]) {
    const leg = new THREE.Mesh(unitBox, silMat);
    leg.scale.set(1.4, 15, 1.4);
    leg.position.set(gx, 7.5, -46);
    scene.add(leg);
  }
  const gBeam = new THREE.Mesh(unitBox, silMat);
  gBeam.scale.set(44, 1.3, 1.6);
  gBeam.position.set(0, 15.2, -46);
  scene.add(gBeam);
  const trolley = new THREE.Mesh(unitBox, silMat);
  trolley.scale.set(2.2, 1.4, 1.8);
  trolley.position.set(-6, 14.2, -46);
  scene.add(trolley);
  const hookLine = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.6, 6), silMat);
  hookLine.position.set(-6, 11.4, -46);
  scene.add(hookLine);
  const hookBlock = new THREE.Mesh(unitBox, silMat);
  hookBlock.scale.set(0.9, 0.9, 0.9);
  hookBlock.position.set(-6, 8.8, -46);
  scene.add(hookBlock);
  const warnMat = new THREE.MeshBasicMaterial({ color: 0xff2a22 });
  for (const [x, z, ph] of [[-46, -44, 0], [44, -48, 0.5]]) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 8), warnMat);
    w.position.set(x, 24.6, z);
    scene.add(w);
    animated.warn.push({ m: w, ph });
  }
  // Barrel clusters in the lane corners — two wear a lit band; all of them block movement.
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.02, 12);
  const barrelMats = [0x6e4a2f, 0x2e4a4a, 0x4a4a52].map((col) =>
    new THREE.MeshStandardMaterial({ color: col, roughness: 0.65, metalness: 0.35 }));
  const bandMat = new THREE.MeshBasicMaterial({ color: 0xff8a3c });
  const barrelAt = (x, z, mi, lit) => {
    const b = new THREE.Mesh(barrelGeo, barrelMats[mi % 3]);
    b.position.set(x, 0.51, z);
    b.castShadow = true;
    b.receiveShadow = true;
    scene.add(b);
    if (lit) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.435, 0.435, 0.1, 12), bandMat);
      band.position.set(x, 0.8, z);
      scene.add(band);
    }
    COLLIDERS.push({ minX: x - 0.42, maxX: x + 0.42, minZ: z - 0.42, maxZ: z + 0.42, bottom: 0, top: 1.02 });
  };
  barrelAt(-28.5, -11.5, 0, true);
  barrelAt(-27.6, -12.4, 1, false);
  barrelAt(-28.2, -10.4, 2, false);
  barrelAt(15.8, -12.8, 1, true);
  barrelAt(16.7, -12.0, 2, false);
  barrelAt(-13.8, 17.8, 2, false);
  barrelAt(27.5, 15.5, 0, false);
  // Ground paint: scorch marks, a worn walkway stripe running spawn-to-mid, hazard chevrons
  // at the two door gaps, and the site letters painted large on the walls.
  const scorchMat = new THREE.MeshBasicMaterial({ map: tex.scorch, transparent: true, depthWrite: false });
  for (const [x, z, s, r] of [[-22, -16.6, 5.5, 0.4], [-19.8, -13.2, 3.4, 2.2], [24, -18.6, 4.2, 1.1], [1.5, -7, 3, 2.8]]) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(s, s), scorchMat);
    d.rotation.x = -Math.PI / 2;
    d.rotation.z = r;
    d.position.set(x, 0.015, z);
    d.renderOrder = 1;
    scene.add(d);
  }
  tex.paint.repeat.set(1, 8);
  const walk = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 24),
    new THREE.MeshBasicMaterial({ map: tex.paint, transparent: true, depthWrite: false }),
  );
  walk.rotation.x = -Math.PI / 2;
  walk.position.set(0, 0.015, 16);
  walk.renderOrder = 1;
  scene.add(walk);
  const chevTex = tex.hazard.clone();
  chevTex.repeat.set(1, 1);
  chevTex.needsUpdate = true;
  const chevMat = new THREE.MeshBasicMaterial({ map: chevTex });
  for (const dx of [-12, 12]) {
    const ch = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.1), chevMat);
    ch.rotation.x = -Math.PI / 2;
    ch.position.set(dx, 0.015, 1.5);
    ch.renderOrder = 1;
    scene.add(ch);
  }
  const wallA = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 2.6),
    new THREE.MeshBasicMaterial({ map: tex.letter('A', '#ff7a33'), transparent: true, opacity: 0.9 }),
  );
  wallA.position.set(-22, 2.45, -18.44);
  scene.add(wallA);
  const wallB = new THREE.Mesh(
    new THREE.PlaneGeometry(2.1, 2.1),
    new THREE.MeshBasicMaterial({ map: tex.letter('B', '#39c2c9'), transparent: true, opacity: 0.9 }),
  );
  wallB.position.set(18, 1.45, -22.78);
  scene.add(wallB);

  // Drifting embers: sparks off the furnace column plus a sparse yard-wide drift. One Points
  // cloud, positions recycled in worldTick — no per-frame allocation.
  {
    const N = 240;
    const pos = new Float32Array(N * 3);
    const speed = new Float32Array(N);
    const erng = mulberry32(777);
    for (let i = 0; i < N; i++) {
      if (i < 110) { // the furnace column, site A
        pos[i * 3] = -22 + (erng() - 0.5) * 7;
        pos[i * 3 + 1] = erng() * 12;
        pos[i * 3 + 2] = -20 + (erng() - 0.5) * 7;
      } else {
        pos[i * 3] = (erng() - 0.5) * 66;
        pos[i * 3 + 1] = erng() * 9;
        pos[i * 3 + 2] = (erng() - 0.5) * 66;
      }
      speed[i] = 0.25 + erng() * 0.55;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const embers = new THREE.Points(geo, new THREE.PointsMaterial({
      map: glowTex, color: 0xffa050, size: 0.17, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: false,
    }));
    embers.frustumCulled = false;
    scene.add(embers);
    animated.embers = embers;
    animated.emberBase = pos.slice();
    animated.emberSpeed = speed;
  }
  return { sun };
}
