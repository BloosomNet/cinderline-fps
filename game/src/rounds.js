// rounds.js — the match itself: phases (freeze → live → planted → round end → match end),
// the bomb (carry, drop, plant, defuse, detonate), the economy, and the buy phase. This module
// owns every phase transition; a finished plant flips the whole map's objectives.

import { S, ROUND, ECONOMY, makeCombatant, aliveCount } from './state.js';
import { SPAWNS, SITES, siteAt } from './world.js';
import { makeAI, planRound, onPlanted, buyWeapon } from './bots.js';
import { WEAPONS, ARMOR, GRENADE } from './weapons.js';
import * as input from './input.js';
import * as audio from './audio.js';

const EMBER_NAMES = ['Vex', 'Onyx', 'Rook'];
const WARD_NAMES = ['Hale', 'Moss', 'Ivers', 'Tarn'];
const EMBER_SKILL = [0.66, 0.74, 0.8];
const WARD_SKILL = [0.6, 0.68, 0.74, 0.8];

export function createMatch(seed) {
  S.rng.reseed(seed);
  S.combatants = [];
  const player = makeCombatant({ name: 'You', team: 'ember', isPlayer: true });
  S.combatants.push(player);
  S.player = player;
  EMBER_NAMES.forEach((name, i) => {
    const c = makeCombatant({ name, team: 'ember', isBot: true });
    c.ai = makeAI(c, EMBER_SKILL[i]);
    S.combatants.push(c);
  });
  WARD_NAMES.forEach((name, i) => {
    const c = makeCombatant({ name, team: 'ward', isBot: true });
    c.ai = makeAI(c, WARD_SKILL[i]);
    S.combatants.push(c);
  });
  S.scores.ember = 0;
  S.scores.ward = 0;
  S.round = 0;
  startRound();
}

function startRound() {
  S.round += 1;
  S.phase = 'freeze';
  S.phaseT = ROUND.freeze;
  S.roundTarget = S.rng.next() < 0.5 ? 'A' : 'B';
  S.roundWinner = null;
  S.roundReason = '';
  S.grenades.length = 0;
  S.fx.tracers.length = 0;
  S.fx.impacts.length = 0;
  S.fx.explosions.length = 0;
  let ei = 0, wi = 0;
  for (const c of S.combatants) {
    const spawn = c.team === 'ember' ? SPAWNS.ember[ei++] : SPAWNS.ward[wi++];
    const survived = c.alive && S.round > 1;
    c.x = spawn.x; c.z = spawn.z; c.y = 0;
    c.vx = 0; c.vy = 0; c.vz = 0;
    c.yaw = spawn.yaw; c.pitch = 0;
    c.hp = 100;
    c.alive = true;
    c.fireT = 0; c.reloadT = 0; c.grenadeT = 0; c.flashT = 0;
    c.bloom = 0; c.recoil = 0; c.aimErr = 0;
    c.channel = null;
    c.crouching = false;
    c.grounded = true;
    c.speed2d = 0;
    if (!survived) {
      c.weapon = 'sidearm';
      c.armor = false;
      c.grenades = 0;
    }
    const w = WEAPONS[c.weapon];
    c.mag = w.magSize;
    c.reserve = w.reserve;
    if (c.ai) { c.ai.path = null; c.ai.seenEnemy = null; c.ai.seenT = -99; c.ai.heardT = -99; }
  }
  S.bomb.state = 'carried';
  S.bomb.carrier = S.player;
  S.bomb.planter = null;
  S.bomb.site = null;
  S.bomb.x = S.player.x;
  S.bomb.z = S.player.z;
  planRound();
  // Team economy: when the typical bot on a team cannot afford a rifle, the whole team
  // saves together — sidearms this round, rifles the next.
  const saveRound = {};
  for (const team of ['ember', 'ward']) {
    const money = S.combatants.filter((c) => c.isBot && c.team === team)
      .map((c) => c.money).sort((a, b) => a - b);
    saveRound[team] = S.round > 1 && money[1] < WEAPONS.rifle.cost;
  }
  for (const c of S.combatants) if (c.isBot) botBuy(c, saveRound[c.team]);
  S.events.push({ type: 'roundStart', round: S.round, target: S.roundTarget });
}

function botBuy(c, saveRound) {
  const rng = S.rng;
  if (saveRound) {
    // Coordinated save: no weapon or grenade buys; armor only for a bot rich enough that
    // it still banks most of a rifle for next round.
    if (!c.armor && c.money >= 2200) { c.money -= ARMOR.cost; c.armor = true; }
    return;
  }
  // Weapon first (armor bought first could eat the rifle money), then armor, then a frag.
  if (c.weapon === 'sidearm') {
    if (c.money >= WEAPONS.rifle.cost && rng.next() < 0.75) buyWeapon(c, 'rifle');
    else if (c.money >= WEAPONS.smg.cost) buyWeapon(c, 'smg');
  } else if (c.weapon === 'smg' && c.money >= 3400) {
    buyWeapon(c, 'rifle');
  }
  if (!c.armor && c.money >= 1000) { c.money -= ARMOR.cost; c.armor = true; }
  if (c.grenades === 0 && c.money >= 900 && rng.next() < 0.5) {
    c.money -= GRENADE.cost;
    c.grenades = 1;
  }
}

// The player's buy menu: number keys during the freeze, display handled by the HUD.
function playerBuy() {
  const p = S.player;
  if (!p.alive || S.phase !== 'freeze') return;
  if (input.pressed('Digit1')) { if (buyWeapon(p, 'rifle')) audio.playBeep(false); }
  if (input.pressed('Digit2')) { if (buyWeapon(p, 'smg')) audio.playBeep(false); }
  if (input.pressed('Digit3') && !p.armor && p.money >= ARMOR.cost) {
    p.money -= ARMOR.cost; p.armor = true; audio.playBeep(false);
  }
  if (input.pressed('Digit4') && p.grenades < 2 && p.money >= GRENADE.cost) {
    p.money -= GRENADE.cost; p.grenades += 1; audio.playBeep(false);
  }
  if (input.pressed('Digit5')) {
    const w = WEAPONS[p.weapon];
    p.mag = w.magSize;
    p.reserve = w.reserve;
  }
}

function endRound(winner, reason) {
  S.phase = 'roundEnd';
  S.phaseT = ROUND.roundEnd;
  S.roundWinner = winner;
  S.roundReason = reason;
  S.scores[winner] += 1;
  const loser = winner === 'ember' ? 'ward' : 'ember';
  for (const c of S.combatants) {
    c.channel = null;
    if (c.team === winner) c.money += ECONOMY.winBonus;
    else c.money += ECONOMY.lossBonus;
  }
  if (S.bomb.planter) {
    S.bomb.planter.money += ECONOMY.plantBonus;
    for (const c of S.combatants) if (c.team === 'ember') c.money += ECONOMY.teamPlantBonus;
  }
  audio.playStinger(winner === 'ember');
  S.events.push({ type: 'roundEnd', winner, reason });
}

function explodeBomb() {
  const b = S.bomb;
  S.fx.explosions.push({ x: b.x, y: 0.6, z: b.z, t: 0.7, big: true });
  audio.playExplosion(Math.hypot(S.player.x - b.x, S.player.z - b.z));
  S.shake = 1;
  S.events.push({ type: 'explosion', x: b.x, z: b.z });
}

let sparkT = 0; // last time the charge threw a work spark (render dressing, sim-time based)

// Who is currently working the bomb, if anyone: returns the channeling combatant.
function channeler() {
  for (const c of S.combatants) if (c.channel) return c;
  return null;
}

function updateBomb(dt) {
  const b = S.bomb;
  if (b.state === 'carried') {
    if (!b.carrier || !b.carrier.alive) {
      b.state = 'dropped';
      b.x = b.carrier ? b.carrier.x : b.x;
      b.z = b.carrier ? b.carrier.z : b.z;
      b.carrier = null;
      S.events.push({ type: 'bombDropped', x: b.x, z: b.z });
    } else {
      b.x = b.carrier.x;
      b.z = b.carrier.z;
    }
  }
  if (b.state === 'dropped') {
    for (const c of S.combatants) {
      if (c.team === 'ember' && c.alive && Math.hypot(c.x - b.x, c.z - b.z) < 1.2) {
        b.state = 'carried';
        b.carrier = c;
        S.events.push({ type: 'bombPickup', by: c });
        break;
      }
    }
  }
  // Starting a channel: the carrier plants inside the target site; a defender defuses at the
  // planted charge. Bots ask through ai.wantPlant; the player holds E.
  const current = channeler();
  if (!current && S.phase === 'live' && b.state === 'carried' && b.carrier && b.carrier.alive) {
    const c = b.carrier;
    const site = siteAt(c.x, c.z);
    if (site && site.id === S.roundTarget) {
      const wants = c.isPlayer ? input.down('KeyE') : (c.ai && c.ai.wantPlant);
      if (wants) c.channel = { kind: 'plant', t: 0 };
    }
  }
  if (!current && S.phase === 'planted' && b.state === 'planted') {
    for (const c of S.combatants) {
      if (c.team !== 'ward' || !c.alive) continue;
      if (Math.hypot(c.x - b.x, c.z - b.z) < 1.4 && c.ai && c.ai.wantPlant) {
        c.channel = { kind: 'defuse', t: 0 };
        break;
      }
    }
  }
  // Progressing (or losing) a channel: moving, dying, or leaving the spot cancels it.
  const ch = channeler();
  if (ch) {
    const need = ch.channel.kind === 'plant' ? ROUND.plantTime : ROUND.defuseTime;
    let ok = ch.alive && ch.speed2d < 0.6;
    if (ch.channel.kind === 'plant') {
      const site = siteAt(ch.x, ch.z);
      ok = ok && site && site.id === S.roundTarget && b.state === 'carried' && b.carrier === ch;
      if (ch.isPlayer && !input.down('KeyE')) ok = false;
    } else {
      ok = ok && b.state === 'planted' && Math.hypot(ch.x - b.x, ch.z - b.z) < 1.6;
    }
    if (!ok) {
      ch.channel = null;
    } else {
      ch.channel.t += dt;
      // Working the charge throws the odd spark off its casing.
      if (S.time - sparkT > 0.17) {
        sparkT = S.time;
        S.fx.impacts.push({ x: b.x + 0.15, y: 0.35, z: b.z, t: 0.16, hit: true });
      }
      ch.crouching = true;
      S.channelView = { kind: ch.channel.kind, frac: Math.min(1, ch.channel.t / need), mine: ch.isPlayer };
      if (ch.channel.t >= need) {
        if (ch.channel.kind === 'plant') {
          b.state = 'planted';
          b.site = S.roundTarget;
          b.planter = ch;
          const site = SITES[b.site];
          b.x = site.plant.x;
          b.z = site.plant.z;
          ch.channel = null;
          S.phase = 'planted';
          S.phaseT = ROUND.bombTime;
          audio.playPlantDone();
          S.noises.push({ x: b.x, z: b.z, radius: 60, team: 'ember', kind: 'plant', t: S.time });
          S.events.push({ type: 'planted', site: b.site, by: ch });
          onPlanted();
        } else {
          ch.channel = null;
          b.state = 'defused';
          endRound('ward', 'defused');
        }
      }
    }
  } else if (S.channelView) {
    S.channelView = null;
  }
  // The planted charge beeps, faster as it runs down, and everyone can hear it.
  if (S.phase === 'planted') {
    S.beepT -= dt;
    if (S.beepT <= 0) {
      const frac = S.phaseT / ROUND.bombTime;
      S.beepT = 0.25 + frac * 0.75;
      audio.playBeep(frac < 0.25);
      S.noises.push({ x: b.x, z: b.z, radius: 42, team: 'ember', kind: 'beep', t: S.time });
    }
  }
}

export function updateRounds(dt) {
  playerBuy();
  S.phaseT -= dt;
  switch (S.phase) {
    case 'freeze':
      if (S.phaseT <= 0) {
        S.phase = 'live';
        S.phaseT = ROUND.live;
        S.events.push({ type: 'phase', phase: 'live' });
      }
      break;
    case 'live': {
      updateBomb(dt);
      if (S.phase !== 'live') break; // a plant just flipped the phase
      const emberAlive = aliveCount('ember');
      const wardAlive = aliveCount('ward');
      if (wardAlive === 0) endRound('ember', 'elimination');
      else if (emberAlive === 0) endRound('ward', 'elimination');
      else if (S.phaseT <= 0) endRound('ward', 'time');
      break;
    }
    case 'planted': {
      updateBomb(dt);
      if (S.phase !== 'planted') break; // defused
      if (aliveCount('ward') === 0) endRound('ember', 'elimination');
      else if (S.phaseT <= 0) {
        explodeBomb();
        endRound('ember', 'bomb');
      }
      break;
    }
    case 'roundEnd':
      if (S.phaseT <= 0) {
        const decided = S.scores.ember >= ROUND.winTarget || S.scores.ward >= ROUND.winTarget ||
          S.round >= ROUND.maxRounds;
        if (decided) {
          S.phase = 'matchEnd';
          S.phaseT = ROUND.matchEnd;
          const winner = S.scores.ember > S.scores.ward ? 'ember' : 'ward';
          S.events.push({ type: 'matchEnd', winner });
        } else {
          startRound();
        }
      }
      break;
    case 'matchEnd':
      if (S.phaseT <= 0) {
        for (const c of S.combatants) c.money = ECONOMY.start;
        S.scores.ember = 0;
        S.scores.ward = 0;
        S.round = 0;
        startRound();
      }
      break;
  }
  // A channel view only lives while someone channels.
  if (!channeler() && S.channelView) S.channelView = null;
}
