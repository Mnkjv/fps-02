// Bots: the other nine guns in the match. Each bot is a box-built figure in
// its squad colour with the same body statistics as the player — health,
// armour, a two-slot loadout, an eye height — and it shoots through the
// same damage model, the same spread maths and the same hit tests. What
// makes a bot beatable is not weaker bullets but a human-shaped aim model:
// a reaction delay before the first shot, an aim error that starts wide
// and settles the longer it tracks a target, and burst discipline — it
// fires in short bursts and stops moving to shoot, exactly the trade the
// accuracy model rewards in the player.
//
// Orders come from the match (attack this site, hold that one, plant,
// defuse, retake). A bot follows waypoint paths, un-sticks itself when a
// corner catches it, and channels the plant/defuse while standing in the
// open — the most dangerous seconds of its round.

import * as THREE from 'three';
import { WEAPONS, SQUADS } from './config.js';
import { WORLD, collide, losClear, findPath, SITES } from './world.js';
import { buildWorldModel, damageAt, spreadDirection } from './weapons.js';
import { applyDamage, actorHitZones, makeWeaponState, raySphere } from './player.js';
import { sfx } from './audio.js';

const BOT_SPEED = 4.6;
const SCAN_EVERY = 0.12;

const MAT_SKIN = new THREE.MeshStandardMaterial({ color: 0xc9a186, roughness: 0.8, metalness: 0 });
const MAT_DARK = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.7, metalness: 0.2 });

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// A low-poly soldier: legs, torso in squad colour, head with a coloured
// cap band, and the gun held forward. Built facing -Z, like the cameras.
export function buildFigure(team) {
  const color = SQUADS[team].color;
  const matTeam = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25 });
  const g = new THREE.Group();
  g.add(box(0.17, 0.78, 0.2, MAT_DARK, -0.12, 0.39, 0)); // legs
  g.add(box(0.17, 0.78, 0.2, MAT_DARK, 0.12, 0.39, 0));
  g.add(box(0.46, 0.62, 0.26, matTeam, 0, 1.09, 0)); // torso
  g.add(box(0.3, 0.3, 0.3, MAT_SKIN, 0, 1.55, 0)); // head
  g.add(box(0.32, 0.1, 0.32, matTeam, 0, 1.68, 0)); // cap
  g.add(box(0.11, 0.5, 0.14, matTeam, -0.3, 1.12, -0.05)); // arms
  g.add(box(0.11, 0.5, 0.14, matTeam, 0.3, 1.12, -0.05));
  const gun = new THREE.Group();
  gun.position.set(0.12, 1.18, -0.18);
  g.add(gun);
  g.userData.gun = gun;
  g.userData.matTeam = matTeam;
  return g;
}

export class Bot {
  constructor(scene, team, name, skill) {
    this.team = team;
    this.name = name;
    this.isPlayer = false;
    this.skill = skill; // { reaction, aimError, burst }
    this.pos = new THREE.Vector3(0, 0, 0);
    this.yaw = 0;
    this.health = 100;
    this.armor = 0;
    this.money = 0;
    this.alive = true;
    this.crouch = false;
    this.weapons = { primary: null, sidearm: makeWeaponState('p9') };
    this.active = 'sidearm';
    this.fireTimer = 0;
    this.reloadTimer = 0;
    this.bloom = 0;
    this.path = [];
    this.pathIdx = 0;
    this.order = { kind: 'hold' };
    this.target = null;
    this.reactT = 0;
    this.trackT = 0;
    this.scanT = Math.random() * SCAN_EVERY;
    this.burstLeft = 0;
    this.burstPause = 0;
    this.stuckT = 0;
    this.lastPos = new THREE.Vector3();
    this.strafeT = 0;
    this.strafeDir = 1;
    this.channelT = 0;
    this.heardPos = null;
    this.heardT = 0;
    this.figure = buildFigure(team);
    this.setGunModel('p9');
    scene.add(this.figure);
  }

  setGunModel(weaponId) {
    const gun = this.figure.userData.gun;
    while (gun.children.length) {
      const c = gun.children.pop();
      c.geometry?.dispose?.();
      gun.remove(c);
    }
    gun.add(buildWorldModel(weaponId));
  }

  weaponState() { return this.weapons[this.active]; }
  weaponDef() { return WEAPONS[this.weaponState().id]; }

  equipPrimary(id) {
    this.weapons.primary = makeWeaponState(id);
    this.active = 'primary';
    this.reloadTimer = 0;
    this.setGunModel(id);
  }

  // The bot's own buy policy: a rifle and armour when rich, an SMG when
  // not, and it saves on pistol rounds like everyone else.
  autoBuy() {
    if (this.money >= WEAPONS.ar7.price + 650) {
      this.money -= WEAPONS.ar7.price;
      this.equipPrimary('ar7');
      this.money -= 650;
      this.armor = 100;
    } else if (this.money >= WEAPONS.kestrel.price) {
      this.money -= WEAPONS.kestrel.price;
      this.equipPrimary('kestrel');
      if (this.money >= 650) { this.money -= 650; this.armor = 100; }
    } else if (this.money >= 650 && this.armor <= 0) {
      this.money -= 650;
      this.armor = 100;
    }
  }

  reset(spawn) {
    this.pos.set(spawn.x, 0, spawn.z);
    this.yaw = spawn.heading;
    this.health = 100;
    this.alive = true;
    this.crouch = false;
    this.target = null;
    this.path = [];
    this.channelT = 0;
    this.fireTimer = 0;
    this.reloadTimer = 0;
    this.bloom = 0;
    this.figure.visible = true;
    this.figure.rotation.set(0, this.yaw, 0);
    this.syncFigure();
  }

  eyePos() {
    const h = this.crouch ? WORLD.crouchHeight : WORLD.eyeHeight;
    return new THREE.Vector3(this.pos.x, h, this.pos.z);
  }

  syncFigure() {
    this.figure.position.copy(this.pos);
    if (!this.alive) {
      // Down: tipped onto its back where it fell.
      this.figure.rotation.set(-Math.PI / 2, this.yaw, 0);
      this.figure.position.y = 0.25;
      return;
    }
    this.figure.rotation.set(0, this.yaw, 0);
    this.figure.position.y = this.crouch ? -0.45 : 0;
  }

  setPathTo(x, z) {
    this.path = findPath(this.pos.x, this.pos.z, x, z);
    this.pathIdx = 0;
    this.stuckT = 0;
    this.lastPos.copy(this.pos);
  }

  // Walk the current path. Returns true when the destination is reached.
  walk(dt) {
    if (this.pathIdx >= this.path.length) return true;
    const goal = this.path[this.pathIdx];
    const dx = goal.x - this.pos.x;
    const dz = goal.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.55) { this.pathIdx += 1; return this.pathIdx >= this.path.length; }
    const want = Math.atan2(-dx, -dz); // yaw whose forward (-sin, -cos) aims at the goal
    this.yaw = turnToward(this.yaw, want, dt * 7);
    let mx = -Math.sin(this.yaw);
    let mz = -Math.cos(this.yaw);
    if (this.strafeT > 0) {
      // Stuck recovery: sidestep to slide along whatever caught us.
      this.strafeT -= dt;
      mx = Math.cos(this.yaw) * this.strafeDir;
      mz = -Math.sin(this.yaw) * this.strafeDir;
    }
    this.pos.x += mx * BOT_SPEED * dt;
    this.pos.z += mz * BOT_SPEED * dt;
    collide(this.pos);
    this.stuckT += dt;
    if (this.stuckT > 0.7) {
      const moved = Math.hypot(this.pos.x - this.lastPos.x, this.pos.z - this.lastPos.z);
      if (moved < 0.25) {
        this.strafeT = 0.45;
        this.strafeDir = this.strafeDir * -1;
        const end = this.path[this.path.length - 1];
        if (end) this.setPathTo(end.x, end.z);
      }
      this.stuckT = 0;
      this.lastPos.copy(this.pos);
    }
    return false;
  }

  // The nearest foe this bot can actually see right now, or null.
  seeFoe(ctx) {
    let best = null;
    let bestD = Infinity;
    for (const foe of ctx.foes) {
      if (!foe.alive) continue;
      const d = Math.hypot(foe.pos.x - this.pos.x, foe.pos.z - this.pos.z);
      if (d > 46 || d >= bestD) continue;
      if (!losClear(this.pos.x, this.pos.z, foe.pos.x, foe.pos.z)) continue;
      best = foe;
      bestD = d;
    }
    return best;
  }

  update(dt, ctx) {
    if (!this.alive) { this.syncFigure(); return; }
    this.fireTimer -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 5);
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const st = this.weaponState();
        const def = this.weaponDef();
        const take = Math.min(def.mag - st.mag, st.reserve);
        st.mag += take;
        st.reserve -= take;
      }
    }
    this.heardT -= dt;
    // --- perception -----------------------------------------------------
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = SCAN_EVERY;
      const seen = this.seeFoe(ctx);
      if (seen && seen !== this.target) { this.target = seen; this.reactT = this.skill.reaction; this.trackT = 0; }
      if (!seen && this.target && !this.seeFoeStill(ctx)) this.target = null;
    }
    // --- combat ---------------------------------------------------------
    if (this.target && this.target.alive && this.reactT <= 0) {
      this.trackT += dt;
      this.channelT = 0; // a firefight interrupts the channel
      this.faceToward(this.target.pos, dt * 10);
      this.engage(dt, ctx);
      this.syncFigure();
      return; // a fighting bot plants its feet — accuracy over movement
    }
    if (this.target) this.reactT -= dt;
    // --- orders ---------------------------------------------------------
    const o = this.order;
    if (o.kind === 'plant' || o.kind === 'defuse') {
      const spot = o.kind === 'plant' ? SITES[o.site] : ctx.bombPos;
      if (spot) {
        const d = Math.hypot(spot.x - this.pos.x, spot.z - this.pos.z);
        if (d > 1.6) {
          this.channelT = 0;
          if (this.pathIdx >= this.path.length) this.setPathTo(spot.x, spot.z);
          this.walk(dt);
        } else this.channelT += dt; // standing in the open, working
      }
    } else if (o.kind === 'goto' || o.kind === 'retake') {
      const spot = o.site ? SITES[o.site] : o;
      if (spot && this.walk(dt)) { /* arrived: hold from here */ }
      if (spot && this.path.length === 0) this.setPathTo(spot.x + (o.spread || 0), spot.z + (o.spreadZ || 0));
    } else if (o.kind === 'hold') {
      this.crouch = this.team === 'sable';
      if (o.x !== undefined && Math.hypot(o.x - this.pos.x, o.z - this.pos.z) > 1.2) {
        if (this.path.length === 0) this.setPathTo(o.x, o.z);
        this.walk(dt);
      } else if (this.heardPos && this.heardT > 0) {
        this.faceToward(this.heardPos, dt * 5);
      }
    }
    this.syncFigure();
  }

  seeFoeStill(ctx) {
    if (!this.target) return false;
    const d = Math.hypot(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z);
    return d <= 46 && losClear(this.pos.x, this.pos.z, this.target.pos.x, this.target.pos.z);
  }

  faceToward(point, maxTurn) {
    const want = Math.atan2(-(point.x - this.pos.x), -(point.z - this.pos.z));
    this.yaw = turnToward(this.yaw, want, maxTurn);
  }

  engage(dt, ctx) {
    const st = this.weaponState();
    const def = this.weaponDef();
    if (this.reloadTimer > 0) return;
    if (st.mag <= 0) {
      if (st.reserve > 0) { this.reloadTimer = def.reloadSeconds; sfx.reload(); }
      return;
    }
    if (this.burstPause > 0) { this.burstPause -= dt; return; }
    if (this.fireTimer > 0) return;
    this.fireTimer += 60 / def.rpm;
    st.mag -= 1;
    this.bloom = Math.min(6, this.bloom + 1);
    if (this.burstLeft <= 0) this.burstLeft = this.skill.burst;
    this.burstLeft -= 1;
    if (this.burstLeft <= 0) this.burstPause = 0.28 + ctx.rng.next() * 0.25;
    sfx.shot(def.id);
    // Aim: at the target's chest, with an error that starts at the bot's
    // base error and settles as it tracks. Headshots happen when the
    // settled error is small and the roll is kind — aim high sometimes.
    const foe = this.target;
    const zones = actorHitZones(foe);
    const settle = Math.max(0.25, 1 - this.trackT * 0.55);
    const err = this.skill.aimError * settle;
    const aimAt = ctx.rng.next() < 0.3 ? zones.head.center : zones.body.center;
    const origin = this.eyePos();
    const wanted = aimAt.clone().sub(origin).normalize();
    wanted.x += (ctx.rng.next() * 2 - 1) * err;
    wanted.y += (ctx.rng.next() * 2 - 1) * err * 0.7;
    wanted.z += (ctx.rng.next() * 2 - 1) * err;
    wanted.normalize();
    const dir = spreadDirection(wanted, this.crouch ? def.spreadStill : def.spreadMove, this.bloom * 0.35, ctx.rng);
    const wallDist = ctx.raycast ? ctx.raycast(origin, dir) : Infinity;
    let best = null;
    for (const f of ctx.foes) {
      if (!f.alive) continue;
      const z2 = actorHitZones(f);
      const headT = raySphere(origin, dir, z2.head.center, z2.head.radius);
      const bodyT = raySphere(origin, dir, z2.body.center, z2.body.radius);
      const t = Math.min(headT, bodyT);
      if (t < wallDist && (!best || t < best.t)) best = { foe: f, t, isHead: headT < bodyT };
    }
    const muzzle = origin.clone().add(dir.clone().multiplyScalar(0.6));
    muzzle.y -= 0.12;
    if (best) {
      const point = origin.clone().add(dir.clone().multiplyScalar(best.t));
      const raw = damageAt(def, best.t) * (best.isHead ? def.headMult : 1);
      const dealt = applyDamage(best.foe, raw, best.isHead);
      ctx.fx.tracer(muzzle, point, def.tracer);
      ctx.fx.impact(point, true);
      ctx.fx.muzzle(muzzle);
      if (best.foe.isPlayer) sfx.hurt();
      if (!best.foe.alive) ctx.onKill?.(best.foe, this, best.isHead);
      else ctx.onHit?.(best.foe, this, dealt, best.isHead);
    } else if (wallDist !== Infinity) {
      const point = origin.clone().add(dir.clone().multiplyScalar(wallDist));
      ctx.fx.tracer(muzzle, point, def.tracer);
      ctx.fx.impact(point, false);
      ctx.fx.muzzle(muzzle);
    }
    // Everyone nearby hears the shot and turns toward it.
    for (const f of ctx.foes) {
      if (f.alive && !f.isPlayer && Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z) < 26) {
        f.heardPos = { x: this.pos.x, z: this.pos.z };
        f.heardT = 1.6;
      }
    }
  }
}

// Turn `yaw` toward `want` by at most `step`, along the short way round.
export function turnToward(yaw, want, step) {
  let d = want - yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= step) return want;
  return yaw + Math.sign(d) * step;
}
