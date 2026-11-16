// state.js — the game's single state object and the combatant factory.
// Everything mutable lives in S (or in a module's own render-only scratch); the simulation steps
// read and write S, and the renderer only reads it. Keeping state in one place is what lets the
// round machine, the bots and the HUD agree without passing references around. The simulation
// reads only S.time and S.rng — never the wall clock or Math.random — so a seeded match replays
// identically.

import { Rng } from './rng.js';

export const TEAMS = {
  ember: { name: 'EMBER', role: 'attack', color: 0xff7a33 },
  ward: { name: 'WARD', role: 'defence', color: 0x39c2c9 },
};

export const ROUND = {
  freeze: 6, // buy + set-up time at round start
  live: 105, // seconds on the round clock
  plantTime: 3, // seconds working the plant inside a site
  defuseTime: 5, // seconds working the defuse at the planted charge
  bombTime: 35, // seconds from plant to detonation
  roundEnd: 4.5, // round-end banner time
  matchEnd: 7,
  winTarget: 7, // first to 7 rounds takes the match
  maxRounds: 12,
};

export const ECONOMY = {
  start: 800,
  kill: 300,
  plantBonus: 300, // to the planter
  teamPlantBonus: 200, // to every Ember member when the charge goes down
  winBonus: 1400,
  lossBonus: 1000,
};

// One combatant is the shared shape for the player and every bot: position/velocity as plain
// numbers (no per-frame allocation), a current weapon with its own ammo counters, and per-bot
// brain state attached by bots.js as `ai`. Timers count down in seconds of simulation time.
export function makeCombatant({ name, team, isPlayer = false, isBot = false }) {
  return {
    name,
    team,
    isPlayer,
    isBot,
    alive: true,
    hp: 100,
    armor: false,
    // kinematics (y is feet height)
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    yaw: 0,
    pitch: 0,
    crouching: false,
    grounded: true,
    speed2d: 0,
    // weapon state (sidearm defaults; rounds.js refills from WEAPONS each round)
    weapon: 'sidearm',
    mag: 12,
    reserve: 48,
    grenades: 0,
    fireT: 0, // seconds until the weapon can fire again
    reloadT: 0, // seconds left in the current reload (0 = not reloading)
    grenadeT: 0, // throw cooldown
    flashT: 0, // muzzle flash visibility
    bloom: 0, // accumulated spread from recent fire, radians
    recoil: 0, // accumulated view kick, recovered in player.js
    aimErr: 0, // bots only: current aim error, radians
    channel: null, // { kind: 'plant' | 'defuse', t } while working the bomb
    // bookkeeping
    money: ECONOMY.start,
    lastAttacker: null,
    hurtT: -99, // last time this combatant took damage (hit flash)
    deathT: 0,
    ai: null, // bots.js brain; null for the player (demo mode attaches one)
  };
}

export const S = {
  rng: new Rng(7),
  time: 0, // simulation seconds since boot; the only clock the sim reads
  phase: 'freeze', // freeze | live | planted | roundEnd | matchEnd
  phaseT: 0, // seconds left in the current phase (or on the round/bomb clock)
  round: 0,
  scores: { ember: 0, ward: 0 },
  roundTarget: 'A', // the site Ember chose for this round: 'A' | 'B'
  roundWinner: null,
  roundReason: '', // 'elimination' | 'bomb' | 'defused' | 'time'
  combatants: [],
  player: null,
  // The breach charge. carrier is a combatant while state is 'carried'.
  bomb: { state: 'carried', carrier: null, planter: null, site: null, x: 0, z: 0 },
  beepT: 0, // planted-charge beep countdown
  // What the HUD's channel bar shows: { kind, frac, mine } while anyone works the bomb.
  channelView: null,
  grenades: [], // live frag grenades in flight
  // Short-lived render effects, filled by weapons/rounds, drawn and decayed by main.
  fx: { tracers: [], impacts: [], explosions: [] },
  // Event queue: weapons/bots/rounds push; the HUD consumes once per frame.
  events: [],
  // Recent noises for bot hearing: { x, z, radius, team, kind, t } — pruned after 0.3 s.
  noises: [],
  // Enemies the player's team has eyes on, for the minimap: combatant -> S.time expiry.
  spotted: new Map(),
  shake: 0, // camera shake for the player (explosions, damage), render-side decay
  // Set from the URL by main.js: staged screenshot scenes and the bot-driven demo mode.
  shotMode: false,
  demoMode: false,
};

export function aliveCount(team) {
  let n = 0;
  for (const c of S.combatants) if (c.team === team && c.alive) n++;
  return n;
}
