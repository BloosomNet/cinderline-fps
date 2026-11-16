// hud.js — every piece of DOM the player reads: vitals, ammo, money, the round clock and
// score, a live minimap, killfeed, hitmarkers, hurt direction, the plant/defuse channel bar,
// the buy menu, and the result banners. The simulation never touches the DOM; this module
// reads S once per frame and drains S.events for the transient stuff (kills, hits, plants).
// Values are cached so unchanged text is never re-written.

import { S, ROUND } from './state.js';
import { WEAPONS, ARMOR, GRENADE } from './weapons.js';
import { MINIMAP_RECTS, SITES, hasLOS } from './world.js';
import * as input from './input.js';

const el = {};
const cache = {};
let playHandler = null;
let bannerUntil = 0;
let hitUntil = 0;
let hitKill = false;
let hurtUntil = 0;
let mapT = 0;
let playerRoundKills = 0; // the player's kills this round, for the banner callout

function grab(id) {
  el[id] = document.getElementById(id);
  return el[id];
}

function setText(id, text) {
  if (cache[id] !== text) {
    cache[id] = text;
    el[id].textContent = text;
  }
}

function setClass(id, cls, on) {
  const key = id + ':' + cls;
  if (cache[key] !== on) {
    cache[key] = on;
    el[id].classList.toggle(cls, on);
  }
}

export function setPlayHandler(fn) {
  playHandler = fn;
}

export function initHUD() {
  for (const id of ['timer', 'score-line', 'pips', 'killfeed', 'hp-fill', 'hp-num', 'armor-tag',
    'weapon-name', 'ammo-line', 'money', 'nade-line', 'bomb-tag', 'crosshair', 'hitmarker',
    'hurt-vignette', 'lowhp', 'hurt-dir', 'channel', 'channel-label', 'channel-fill', 'banner',
    'banner-title', 'banner-sub', 'buy-panel', 'interact-hint', 'center-msg', 'overlay',
    'play-btn', 'minimap']) grab(id);
  el.mapCtx = el.minimap.getContext('2d');
  el['play-btn'].addEventListener('click', () => { if (playHandler) playHandler(); });
  buildBuyPanel();
}

const BUY_ROWS = [
  { key: 'Digit1', label: 'VK-7 Rifle', price: () => WEAPONS.rifle.cost, state: (p) => p.weapon === 'rifle' ? 'OWNED' : '' },
  { key: 'Digit2', label: 'Rook-9 SMG', price: () => WEAPONS.smg.cost, state: (p) => p.weapon === 'smg' ? 'OWNED' : '' },
  { key: 'Digit3', label: 'Plating (armor)', price: () => ARMOR.cost, state: (p) => p.armor ? 'OWNED' : '' },
  { key: 'Digit4', label: 'Frag Grenade', price: () => GRENADE.cost, state: (p) => p.grenades >= 2 ? 'FULL' : `×${p.grenades}` },
  { key: 'Digit5', label: 'Refill Ammo', price: () => 0, state: () => '' },
];

function buildBuyPanel() {
  const panel = el['buy-panel'];
  const title = document.createElement('div');
  title.className = 'buy-title';
  title.textContent = 'BUY — keys 1–5';
  panel.appendChild(title);
  BUY_ROWS.forEach((row, i) => {
    const div = document.createElement('div');
    div.className = 'buy-row';
    div.innerHTML = `<span class="buy-key">${i + 1}</span><span class="buy-name"></span><span class="buy-price"></span>`;
    div.addEventListener('click', () => input.tap(row.key));
    panel.appendChild(div);
    row.div = div;
    row.nameEl = div.querySelector('.buy-name');
    row.priceEl = div.querySelector('.buy-price');
  });
}

function showBanner(title, sub, seconds) {
  el['banner-title'].textContent = title;
  el['banner-sub'].textContent = sub;
  el.banner.classList.add('show');
  bannerUntil = S.time + seconds;
}

function feedEvent(ev) {
  if (ev.type === 'kill') {
    if (ev.attacker === S.player) playerRoundKills++;
    const div = document.createElement('div');
    div.className = 'feed-row';
    const a = ev.attacker ? ev.attacker.name : '—';
    div.innerHTML = `<b class="${ev.attacker && ev.attacker.team === 'ember' ? 'em' : 'wa'}"></b> ▸ <b class="${ev.victim.team === 'ember' ? 'em' : 'wa'}"></b>${ev.headshot ? ' <i>HEADSHOT</i>' : ''}`;
    div.children[0].textContent = a;
    div.children[1].textContent = ev.victim.name;
    el.killfeed.prepend(div);
    while (el.killfeed.children.length > 5) el.killfeed.lastChild.remove();
    setTimeout(() => div.remove(), 4200);
  } else if (ev.type === 'hitmark') {
    hitUntil = performance.now() + (ev.kill ? 190 : 95);
    hitKill = ev.kill;
  } else if (ev.type === 'playerHurt') {
    hurtUntil = performance.now() + 320;
    const p = S.player;
    const dx = ev.fromX - p.x, dz = ev.fromZ - p.z;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const rel = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz) * 180 / Math.PI;
    el['hurt-dir'].style.transform = `rotate(${rel}deg)`;
  } else if (ev.type === 'planted') {
    showBanner('CHARGE PLANTED', `Site ${ev.site} — ${ROUND.bombTime} seconds to detonation`, 2.2);
  } else if (ev.type === 'roundEnd') {
    const emberWon = ev.winner === 'ember';
    const reasons = {
      elimination: emberWon ? 'Ward team eliminated' : 'Ember team eliminated',
      bomb: 'The charge detonated',
      defused: 'The charge was defused',
      time: 'The clock ran out on Ember',
    };
    // A multi-kill round by the player earns its own line under the result.
    const feat = playerRoundKills >= 4 ? ' · ACE — you dropped all four'
      : playerRoundKills === 3 ? ' · Triple kill'
      : playerRoundKills === 2 ? ' · Double kill' : '';
    showBanner(emberWon ? 'EMBER TAKES THE ROUND' : 'WARD HOLDS THE LINE', (reasons[ev.reason] || '') + feat, 3.4);
  } else if (ev.type === 'matchEnd') {
    showBanner(ev.winner === 'ember' ? 'EMBER WINS THE MATCH' : 'WARD WINS THE MATCH',
      `Final score ${S.scores.ember} — ${S.scores.ward}`, 6);
  } else if (ev.type === 'roundStart') {
    playerRoundKills = 0;
    showBanner(`ROUND ${ev.round}`, `Ember to plant at site ${ev.target}`, 1.6);
  }
}

function fmtTime(t) {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function drawMinimap() {
  const ctx = el.mapCtx;
  const W = 168;
  const px = (x) => (x + 36) / 72 * W;
  const pz = (z) => (z + 36) / 72 * W;
  ctx.fillStyle = '#17131f';
  ctx.fillRect(0, 0, W, W);
  for (const id of ['A', 'B']) {
    const s = SITES[id];
    ctx.fillStyle = id === 'A' ? 'rgba(255,122,51,0.20)' : 'rgba(57,194,201,0.20)';
    ctx.fillRect(px(s.cx - s.half), pz(s.cz - s.half), s.half * 2 / 72 * W, s.half * 2 / 72 * W);
    ctx.fillStyle = id === 'A' ? '#ff7a33' : '#39c2c9';
    ctx.font = 'bold 11px system-ui';
    ctx.fillText(id, px(s.cx) - 3, pz(s.cz) + 4);
  }
  ctx.fillStyle = '#4a4258';
  for (const r of MINIMAP_RECTS) {
    ctx.fillRect(px(r.x - r.w / 2), pz(r.z - r.d / 2), Math.max(2, r.w / 72 * W), Math.max(2, r.d / 72 * W));
  }
  if (S.bomb.state === 'dropped' || S.bomb.state === 'planted') {
    ctx.fillStyle = S.bomb.state === 'planted' && Math.floor(S.time * 3) % 2 ? '#ffffff' : '#ffb02e';
    ctx.beginPath();
    ctx.arc(px(S.bomb.x), pz(S.bomb.z), 3.4, 0, Math.PI * 2);
    ctx.fill();
  }
  const p = S.player;
  for (const c of S.combatants) {
    if (!c.alive || c === p) continue;
    let show = c.team === 'ember';
    if (!show) {
      const spotted = (S.spotted.get(c) || 0) > S.time;
      const dx = c.x - p.x, dz = c.z - p.z;
      const d = Math.hypot(dx, dz);
      const seen = p.alive && d < 45 && hasLOS(p.x, p.y + 1.6, p.z, c.x, c.y + 1.1, c.z) &&
        Math.abs(((Math.atan2(-dx, -dz) - p.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 1.05;
      show = spotted || seen || d < 9;
    }
    if (!show) continue;
    ctx.fillStyle = c.team === 'ember' ? '#ff7a33' : '#39c2c9';
    ctx.beginPath();
    ctx.arc(px(c.x), pz(c.z), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // The player: a wedge pointing the way they face (screen x = world x, screen y = world z).
  ctx.save();
  ctx.translate(px(p.x), pz(p.z));
  const heading = Math.atan2(-Math.cos(p.yaw), -Math.sin(p.yaw)); // screen angle of the facing vector
  ctx.rotate(heading + Math.PI / 2);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -5.5);
  ctx.lineTo(3.8, 4.2);
  ctx.lineTo(-3.8, 4.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function updateHUD(rdt) {
  for (const ev of S.events) feedEvent(ev);
  S.events.length = 0;
  const p = S.player;
  if (!p) return;
  const now = performance.now();

  // Clock + score.
  const phaseLabel = {
    freeze: 'BUY', live: '', planted: 'PLANTED', roundEnd: 'ROUND OVER', matchEnd: 'MATCH OVER',
  }[S.phase];
  setText('timer', `${phaseLabel ? phaseLabel + ' ' : ''}${fmtTime(S.phaseT)}`);
  setClass('timer', 'danger', S.phase === 'planted' || (S.phase === 'live' && S.phaseT < 11));
  setText('score-line', `EMBER ${S.scores.ember} — ${S.scores.ward} WARD`);
  setText('pips', `${'●'.repeat(S.scores.ember)}${'○'.repeat(Math.max(0, ROUND.winTarget - S.scores.ember))}  ·  ${'●'.repeat(S.scores.ward)}${'○'.repeat(Math.max(0, ROUND.winTarget - S.scores.ward))}`);

  // Vitals + weapon.
  el['hp-fill'].style.width = `${Math.max(0, p.hp)}%`;
  setClass('hp-fill', 'low', p.hp <= 30);
  setText('hp-num', `${Math.ceil(p.hp)}`);
  setText('armor-tag', p.armor ? 'PLATED' : '');
  const w = WEAPONS[p.weapon];
  setText('weapon-name', w.name);
  setText('ammo-line', `${p.mag} / ${p.reserve}`);
  setClass('ammo-line', 'low', p.mag === 0 || (p.mag <= w.magSize * 0.25 && p.reserve > 0));
  setText('money', `$${p.money}`);
  setText('nade-line', p.grenades > 0 ? `FRAG ×${p.grenades} [G]` : '');
  setText('bomb-tag', S.bomb.state === 'carried' && S.bomb.carrier === p ? '◆ YOU CARRY THE CHARGE' : (S.bomb.state === 'dropped' ? '◆ CHARGE DROPPED' : ''));

  // Crosshair spread mirrors the real accuracy model.
  const spread = w.spread + p.bloom + p.speed2d * 0.0042 + (!p.grounded ? 0.035 : 0);
  el.crosshair.style.setProperty('--gap', `${Math.round(5 + spread * 620)}px`);
  setClass('crosshair', 'hidden', !p.alive || S.phase === 'freeze');
  el.hitmarker.classList.toggle('show', now < hitUntil);
  el.hitmarker.classList.toggle('kill', hitKill && now < hitUntil);
  el['hurt-vignette'].style.opacity = now < hurtUntil ? '1' : String(Math.max(0, (1 - p.hp / 100) * 0.55));
  el['hurt-dir'].style.opacity = now < hurtUntil ? '1' : '0';
  setClass('lowhp', 'on', p.alive && p.hp <= 30 && (S.phase === 'live' || S.phase === 'planted'));

  // Channel bar (plant / defuse), whoever is working the bomb.
  if (S.channelView) {
    el.channel.classList.add('show');
    setText('channel-label', S.channelView.kind === 'plant' ? 'PLANTING THE CHARGE' : 'DEFUSING THE CHARGE');
    el['channel-fill'].style.width = `${Math.round(S.channelView.frac * 100)}%`;
  } else {
    el.channel.classList.remove('show');
  }

  // Interact hint for the carrier standing in the target site.
  let hint = '';
  if (p.alive && S.phase === 'live' && S.bomb.carrier === p) {
    hint = 'Reach site ' + S.roundTarget + ' and hold E to plant';
  }
  setText('interact-hint', hint);
  setText('center-msg', !p.alive && (S.phase === 'live' || S.phase === 'planted') ? 'YOU ARE DOWN — your team fights on' : '');

  // Buy panel.
  const buying = S.phase === 'freeze' && p.alive;
  el['buy-panel'].classList.toggle('show', buying);
  if (buying) {
    for (const row of BUY_ROWS) {
      const price = row.price();
      const state = row.state(p);
      row.nameEl.textContent = row.label;
      row.priceEl.textContent = state || (price ? `$${price}` : 'FREE');
      row.div.classList.toggle('owned', !!state);
      row.div.classList.toggle('poor', !state && price > p.money);
    }
  }

  if (bannerUntil && S.time > bannerUntil) {
    el.banner.classList.remove('show');
    bannerUntil = 0;
  }
  mapT -= rdt;
  if (mapT <= 0) {
    mapT = 0.066;
    drawMinimap();
  }
}
