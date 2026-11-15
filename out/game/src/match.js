// The match engine: two squads, a purse each, a charge to plant or stop,
// and a clock. Phases run buy -> live -> (planted) -> end, first to seven
// rounds takes the match. Everything the genre promises is enforced here
// and nowhere else: who may fire when, what a round pays (kill bounties,
// win bonuses, a loss streak that climbs so a beaten squad can re-arm),
// when a round is actually over — including the awkward case where the
// attacking squad is wiped out after the plant, when the charge itself
// decides the round.

import * as THREE from 'three';
import { MATCH, WEAPONS, REWARDS, BOT_NAMES, ARMOR_PRICE } from './config.js';
import { SPAWNS, SITES, raycastWorld } from './world.js';
import { Player } from './player.js';
import { Bot } from './bots.js';
import { Fx } from './weapons.js';
import { makeRng } from './rng.js';
import { sfx } from './audio.js';

const SKILLS = [
  { reaction: 0.42, aimError: 0.045, burst: 4 },
  { reaction: 0.55, aimError: 0.06, burst: 3 },
  { reaction: 0.65, aimError: 0.075, burst: 3 },
  { reaction: 0.5, aimError: 0.055, burst: 5 },
  { reaction: 0.75, aimError: 0.09, burst: 3 },
];

export class Match {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.rng = makeRng((Math.random() * 1e9) | 0);
    this.fx = new Fx(scene);
    this.player = new Player(camera);
    this.emberBots = BOT_NAMES.ember.map((n, i) => new Bot(scene, 'ember', n, SKILLS[i % SKILLS.length]));
    this.sableBots = BOT_NAMES.sable.map((n, i) => new Bot(scene, 'sable', n, SKILLS[(i + 2) % SKILLS.length]));
    this.ember = [this.player, ...this.emberBots];
    this.sable = [...this.sableBots];
    this.all = [...this.ember, ...this.sable];
    this.onEvent = () => {};
    this.phase = 'buy';
    this.phaseT = MATCH.buySeconds;
    this.round = 0;
    this.scores = { ember: 0, sable: 0 };
    this.streaks = { ember: 0, sable: 0 };
    this.bomb = { state: 'carried', carrier: null, site: null, pos: null, timer: 0 };
    this.playerPlantHeld = false;
    this.playerChannelT = 0;
    this.targetSite = 'A';
    this.over = false;
    this.winner = null;
    this.raycast = (origin, dir) => raycastWorld(origin, dir, 200);
  }

  startMatch() {
    for (const a of this.all) {
      a.money = MATCH.startMoney;
      a.weapons = { primary: null, sidearm: a.weapons.sidearm };
      a.active = 'sidearm';
      a.armor = 0;
      if (!a.isPlayer) a.setGunModel('p9');
      else a.setViewModel('p9');
    }
    this.scores = { ember: 0, sable: 0 };
    this.streaks = { ember: 0, sable: 0 };
    this.round = 0;
    this.over = false;
    this.startRound();
  }

  startRound() {
    this.round += 1;
    this.targetSite = this.rng.next() < 0.5 ? 'A' : 'B';
    const otherSite = this.targetSite === 'A' ? 'B' : 'A';
    // Spawns and survival: whoever died last round re-arms from a pistol.
    this.ember.forEach((a, i) => {
      if (a._diedLastRound) {
        a.weapons = { primary: null, sidearm: a.weapons.sidearm };
        a.weapons.sidearm.mag = WEAPONS.p9.mag;
        a.weapons.sidearm.reserve = WEAPONS.p9.reserve;
        a.active = 'sidearm';
        a.armor = 0;
        if (a.isPlayer) a.setViewModel('p9'); else a.setGunModel('p9');
      }
      a._diedLastRound = false;
      a.reset(SPAWNS.ember[i]);
    });
    this.sable.forEach((a, i) => {
      if (a._diedLastRound) {
        a.weapons = { primary: null, sidearm: a.weapons.sidearm };
        a.weapons.sidearm.mag = WEAPONS.p9.mag;
        a.weapons.sidearm.reserve = WEAPONS.p9.reserve;
        a.active = 'sidearm';
        a.armor = 0;
        a.setGunModel('p9');
      }
      a._diedLastRound = false;
      a.reset(SPAWNS.sable[i]);
    });
    // The charge starts with a random EMBER bot, so the player both
    // escorts plants and makes them.
    const carrier = this.emberBots[(this.rng.next() * this.emberBots.length) | 0];
    this.bomb = { state: 'carried', carrier, site: null, pos: null, timer: 0 };
    this.playerChannelT = 0;
    // Orders. EMBER: carrier and two escorts to the target site, one
    // lurker toward the other site. SABLE: two hold each site, one mid.
    const site = SITES[this.targetSite];
    const other = SITES[otherSite];
    this.emberBots.forEach((b, i) => {
      if (b === carrier) b.order = { kind: 'goto', site: this.targetSite, spread: 0, spreadZ: 0 };
      else if (i === 3) b.order = { kind: 'goto', site: otherSite, spread: 2, spreadZ: -2 };
      else b.order = { kind: 'goto', site: this.targetSite, spread: (i - 1.5) * 3, spreadZ: (i % 2) * 3 - 1.5 };
    });
    this.sableBots.forEach((b, i) => {
      const mine = i % 2 === 0 ? site : other;
      b.order = {
        kind: 'hold',
        x: mine.x + ((i * 7) % 5) - 2,
        z: mine.z + ((i * 11) % 5) - 2,
      };
      if (i === 4) b.order = { kind: 'hold', x: 0, z: 0 }; // mid watch
    });
    for (const b of this.emberBots) b.autoBuy();
    for (const b of this.sableBots) b.autoBuy();
    this.phase = 'buy';
    this.phaseT = MATCH.buySeconds;
    this.onEvent('roundStart', { round: this.round });
    sfx.roundStart();
  }

  // Player purchases, buy phase only. Returns a refusal reason or null.
  buy(item) {
    if (this.phase !== 'buy') return 'Buy phase is over';
    const p = this.player;
    if (item === 'armor') {
      if (p.money < ARMOR_PRICE) return 'Not enough money';
      if (p.armor >= 100) return 'Armour already full';
      p.money -= ARMOR_PRICE;
      p.armor = 100;
      sfx.buy();
      return null;
    }
    const def = WEAPONS[item];
    if (!def || def.slot !== 'primary') return 'Unknown item';
    if (p.money < def.price) return 'Not enough money';
    if (p.weapons.primary?.id === item) return 'Already owned';
    p.money -= def.price;
    p.equipPrimary(item);
    sfx.buy();
    return null;
  }

  aliveCount(team) {
    return this[team].filter((a) => a.alive).length;
  }

  onKill(victim, killer, isHead) {
    victim._diedLastRound = true;
    if (killer && killer !== victim) {
      killer.money = Math.min(MATCH.maxMoney, killer.money + REWARDS.kill);
    }
    if (this.bomb.state === 'carried' && this.bomb.carrier === victim) {
      this.bomb.state = 'dropped';
      this.bomb.carrier = null;
      this.bomb.pos = { x: victim.pos.x, z: victim.pos.z };
      this.onEvent('bombDropped', { pos: this.bomb.pos });
    }
    this.onEvent('kill', { victim, killer, isHead });
    if (victim.isPlayer) sfx.hurt();
  }

  onHit(victim, attacker, dealt, isHead) {
    this.onEvent('hit', { victim, attacker, dealt, isHead });
  }

  plantBomb(siteId, planter) {
    const site = SITES[siteId];
    this.bomb.state = 'planted';
    this.bomb.site = siteId;
    this.bomb.pos = { x: planter.pos.x, z: planter.pos.z };
    this.bomb.timer = MATCH.bombSeconds;
    this.phase = 'planted';
    this.phaseT = MATCH.bombSeconds;
    for (const a of this.ember) a.money = Math.min(MATCH.maxMoney, a.money + REWARDS.plantTeam);
    planter.money = Math.min(MATCH.maxMoney, planter.money + REWARDS.plantPersonal);
    // SABLE retakes: nearest living bot defuses, the rest converge.
    let defuser = null;
    let bestD = Infinity;
    for (const b of this.sableBots) {
      if (!b.alive) continue;
      const d = Math.hypot(b.pos.x - site.x, b.pos.z - site.z);
      if (d < bestD) { bestD = d; defuser = b; }
    }
    for (const b of this.sableBots) {
      if (!b.alive) continue;
      if (b === defuser) b.order = { kind: 'defuse' };
      else b.order = { kind: 'retake', site: siteId, spread: (this.sableBots.indexOf(b) - 2) * 2.5, spreadZ: 2 };
    }
    for (const b of this.emberBots) {
      if (b.alive) b.order = { kind: 'hold', x: site.x + (this.emberBots.indexOf(b) - 1.5) * 3, z: site.z + ((this.emberBots.indexOf(b) % 2) * 4 - 2) };
    }
    this.onEvent('plant', { site: siteId, planter });
    sfx.plantBeep(1);
  }

  endRound(winner, reason) {
    this.phase = 'end';
    this.phaseT = MATCH.endSeconds;
    this.scores[winner] += 1;
    const loser = winner === 'ember' ? 'sable' : 'ember';
    const objective = reason === 'detonation' || reason === 'defuse';
    const winPay = objective ? REWARDS.winObjective : REWARDS.winElimination;
    for (const a of this[winner]) a.money = Math.min(MATCH.maxMoney, a.money + winPay);
    this.streaks[loser] += 1;
    this.streaks[winner] = 0;
    const lossPay = Math.min(REWARDS.lossBase + (this.streaks[loser] - 1) * REWARDS.lossStreakStep, REWARDS.lossStreakCap);
    for (const a of this[loser]) a.money = Math.min(MATCH.maxMoney, a.money + lossPay);
    if (winner === 'ember') sfx.roundWin(); else sfx.roundLose();
    this.onEvent('roundEnd', { winner, reason, scores: { ...this.scores } });
    if (this.scores.ember >= MATCH.roundsToWin || this.scores.sable >= MATCH.roundsToWin || this.round >= MATCH.maxRounds) {
      this.over = true;
      this.winner = this.scores.ember === this.scores.sable ? 'draw'
        : this.scores.ember > this.scores.sable ? 'ember' : 'sable';
    }
  }

  update(dt) {
    this.fx.update(dt);
    this.phaseT -= dt;
    const fighting = this.phase === 'live' || this.phase === 'planted';
    // --- actors ---------------------------------------------------------
    const playerCtx = {
      foes: this.sable, fx: this.fx, rng: this.rng, raycast: this.raycast,
      canFire: fighting,
      onHit: (v, d, h) => this.onHit(v, this.player, d, h),
      onKill: (v, h) => this.onKill(v, this.player, h),
    };
    if (fighting) this.player.update(dt, playerCtx);
    else this.player.syncCamera(dt);
    for (const b of this.emberBots) {
      if (fighting) {
        b.update(dt, {
          foes: this.sable, fx: this.fx, rng: this.rng, raycast: this.raycast,
          bombPos: this.bomb.pos,
          onHit: (v, a, d, h) => this.onHit(v, a, d, h),
          onKill: (v, a, h) => this.onKill(v, a, h),
        });
      } else b.syncFigure(); // freeze time: nobody moves during buy or the pause
    }
    for (const b of this.sableBots) {
      if (fighting) {
        b.update(dt, {
          foes: this.ember, fx: this.fx, rng: this.rng, raycast: this.raycast,
          bombPos: this.bomb.pos,
          onHit: (v, a, d, h) => this.onHit(v, a, d, h),
          onKill: (v, a, h) => this.onKill(v, a, h),
        });
      } else b.syncFigure();
    }
    // --- phase clocks that run while nobody fights -----------------------
    if (this.phase === 'buy') {
      if (this.phaseT <= 0) { this.phase = 'live'; this.phaseT = MATCH.roundSeconds; }
      return;
    }
    if (this.phase === 'end') {
      if (this.phaseT <= 0) {
        if (this.over) { this.phase = 'matchover'; this.onEvent('matchOver', { winner: this.winner, scores: { ...this.scores } }); }
        else this.startRound();
      }
      return;
    }
    if (this.phase === 'matchover') return;
    // --- the charge -----------------------------------------------------
    if (this.bomb.state === 'carried' && this.bomb.carrier) {
      const c = this.bomb.carrier;
      if (!c.isPlayer) {
        const site = SITES[this.targetSite];
        const d = Math.hypot(c.pos.x - site.x, c.pos.z - site.z);
        if (d < site.radius - 1.5) {
          c.order = { kind: 'plant', site: this.targetSite };
          if (c.channelT >= MATCH.plantSeconds) this.plantBomb(this.targetSite, c);
        } else if (c.order.kind === 'plant') c.order = { kind: 'goto', site: this.targetSite };
      }
    }
    if (this.bomb.state === 'dropped') {
      // Any living EMBER who reaches the charge picks it up.
      for (const a of this.ember) {
        if (!a.alive) continue;
        if (Math.hypot(a.pos.x - this.bomb.pos.x, a.pos.z - this.bomb.pos.z) < 1.3) {
          this.bomb.state = 'carried';
          this.bomb.carrier = a;
          if (!a.isPlayer) a.order = { kind: 'goto', site: this.targetSite };
          this.onEvent('bombPickup', { by: a });
          break;
        }
      }
      // A dropped charge still needs a fetcher: send the nearest bot.
      if (this.bomb.state === 'dropped') {
        let best = null;
        let bestD = Infinity;
        for (const b of this.emberBots) {
          if (!b.alive) continue;
          const d = Math.hypot(b.pos.x - this.bomb.pos.x, b.pos.z - this.bomb.pos.z);
          if (d < bestD) { bestD = d; best = b; }
        }
        if (best && !(best.order.kind === 'goto' && best.order.x !== undefined)) {
          best.order = { kind: 'goto', x: this.bomb.pos.x, z: this.bomb.pos.z };
        }
      }
    }
    // The player plants by holding the interact key inside a site.
    if (this.bomb.state === 'carried' && this.bomb.carrier === this.player && this.player.alive) {
      let inSite = null;
      for (const id of ['A', 'B']) {
        const s = SITES[id];
        if (Math.hypot(this.player.pos.x - s.x, this.player.pos.z - s.z) < s.radius) inSite = id;
      }
      if (inSite && this.playerPlantHeld) {
        this.playerChannelT += dt;
        if (this.playerChannelT >= MATCH.plantSeconds) this.plantBomb(inSite, this.player);
      } else this.playerChannelT = 0;
    } else this.playerChannelT = 0;
    // A defuse in progress: the defuser's channel is read off the bot.
    if (this.phase === 'planted') {
      for (const b of this.sableBots) {
        if (b.alive && b.order.kind === 'defuse' && b.channelT >= MATCH.defuseSeconds) {
          sfx.defuseDone();
          this.endRound('sable', 'defuse');
          return;
        }
      }
      if (this.phaseT <= 0) {
        // Detonation.
        const bp = new THREE.Vector3(this.bomb.pos.x, 0, this.bomb.pos.z);
        this.fx.explosionFx(bp);
        sfx.explosion();
        for (const a of this.all) {
          if (!a.alive) continue;
          const d = Math.hypot(a.pos.x - bp.x, a.pos.z - bp.z);
          if (d < 5.5) { a.health = 0; a.alive = false; a._diedLastRound = true; this.onEvent('kill', { victim: a, killer: null, isHead: false }); }
        }
        this.endRound('ember', 'detonation');
        return;
      }
    }
    // --- round resolution ----------------------------------------------
    const emberAlive = this.aliveCount('ember');
    const sableAlive = this.aliveCount('sable');
    if (sableAlive === 0) { this.endRound('ember', 'elimination'); return; }
    if (emberAlive === 0) {
      if (this.phase !== 'planted') { this.endRound('sable', 'elimination'); return; }
      // Planted and EMBER is wiped: the charge decides. If no SABLE can
      // reach it, fast-forward to the detonation.
      const anyDefuser = this.sableBots.some((b) => b.alive && b.order.kind === 'defuse');
      if (!anyDefuser) this.phaseT = Math.min(this.phaseT, 0.01);
      return;
    }
    if (this.phase === 'live' && this.phaseT <= 0) { this.endRound('sable', 'time'); return; }
  }
}
