// The human player: a pointer-lock first-person controller with the same
// body the bots have (health, armour, a two-slot loadout, an eye height
// that drops when crouching), so one damage model serves everyone.
//
// Accuracy is the skill this game grades. Spread comes straight from the
// weapon table: a still shooter is several times tighter than a moving
// one, and holding the trigger grows `bloom`, which walks the muzzle —
// short bursts land, long sprays wander. The bots obey the same numbers.

import * as THREE from 'three';
import { WEAPONS, ARMOR_ABSORB } from './config.js';
import { WORLD, collide } from './world.js';
import { buildViewModel, damageAt, spreadDirection } from './weapons.js';
import { sfx } from './audio.js';

const WALK_SPEED = 5.0;
const CROUCH_SPEED = 2.2;

// A fresh magazine-and-reserve state for one weapon slot.
export function makeWeaponState(id) {
  const def = WEAPONS[id];
  return { id, mag: def.mag, reserve: def.reserve };
}

// Shared damage model. Armour turns away ARMOR_ABSORB of every hit while
// it lasts and wears down as it does; headshots multiply before armour.
// Returns the health actually removed.
export function applyDamage(target, rawDamage, isHead) {
  let dmg = rawDamage; // the head multiplier, if any, was applied by the shooter
  if (target.armor > 0) {
    // Armour can only absorb what it has: each point of armour soaks two
    // points of incoming damage at the ARMOR_ABSORB rate.
    const absorbed = Math.min(dmg * ARMOR_ABSORB, target.armor * 2);
    target.armor = Math.max(0, target.armor - absorbed * 0.5);
    dmg -= absorbed;
  }
  const before = target.health;
  target.health = Math.max(0, target.health - dmg);
  if (target.health <= 0) target.alive = false;
  return before - target.health;
}

// Does a ray from `origin` along `dir` pass through the sphere? Returns the
// distance along the ray, or Infinity. Used for body and head hit tests —
// the bots shoot through the same test, so nobody gets a fairer ray.
export function raySphere(origin, dir, center, radius) {
  const ox = center.x - origin.x;
  const oy = center.y - origin.y;
  const oz = center.z - origin.z;
  const tca = ox * dir.x + oy * dir.y + oz * dir.z;
  if (tca < 0) return Infinity;
  const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
  const r2 = radius * radius;
  if (d2 > r2) return Infinity;
  const thc = Math.sqrt(r2 - d2);
  if (tca - thc >= 0) return tca - thc;
  return tca + thc >= 0 ? 0 : Infinity; // the eye starts inside the sphere
}

// The hit zones of a standing or crouching actor, as spheres in world space.
export function actorHitZones(actor) {
  const top = actor.crouch ? WORLD.crouchHeight : WORLD.eyeHeight;
  return {
    head: { center: new THREE.Vector3(actor.pos.x, top + 0.12, actor.pos.z), radius: 0.23 },
    body: { center: new THREE.Vector3(actor.pos.x, top * 0.55, actor.pos.z), radius: 0.52 },
  };
}

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.team = 'ember';
    this.isPlayer = true;
    this.name = 'You';
    this.pos = new THREE.Vector3(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.health = 100;
    this.armor = 0;
    this.money = 0; // the match sets the purse
    this.alive = true;
    this.crouch = false;
    this.weapons = { primary: null, sidearm: makeWeaponState('p9') };
    this.active = 'sidearm';
    this.fireTimer = 0;
    this.reloadTimer = 0;
    this.bloom = 0;
    this.moving = false;
    this.keys = new Set();
    this.mouseDown = false;
    this.bobPhase = 0;
    this.vmKick = 0;
    this.viewModel = null;
    this.setViewModel('p9');
    this.boundKeyDown = (e) => this.onKey(e, true);
    this.boundKeyUp = (e) => this.onKey(e, false);
    this.boundMouseMove = (e) => this.onMouseMove(e);
    this.boundMouseDown = (e) => { if (e.button === 0) this.mouseDown = true; };
    this.boundMouseUp = (e) => { if (e.button === 0) this.mouseDown = false; };
    // If focus or the pointer lock is lost mid-press, no keyup/mouseup may
    // ever arrive — clear the input state so nothing sticks on.
    this.boundBlur = () => { this.keys.clear(); this.mouseDown = false; };
    this.boundLockChange = () => { if (!document.pointerLockElement) this.boundBlur(); };
  }

  setViewModel(weaponId) {
    if (this.viewModel) {
      this.camera.remove(this.viewModel);
      // Free the old gun's geometries; the materials are shared and stay.
      this.viewModel.traverse((o) => o.geometry?.dispose?.());
    }
    this.viewModel = buildViewModel(weaponId);
    this.camera.add(this.viewModel);
  }

  weaponState() { return this.weapons[this.active]; }
  weaponDef() { return WEAPONS[this.weaponState().id]; }

  equipPrimary(id) {
    this.weapons.primary = makeWeaponState(id);
    this.active = 'primary';
    this.reloadTimer = 0;
    this.setViewModel(id);
  }

  // Place the player at a spawn point, alive and facing the map.
  reset(spawn) {
    this.pos.set(spawn.x, 0, spawn.z);
    this.yaw = spawn.heading;
    this.pitch = 0;
    this.health = 100;
    this.alive = true;
    this.crouch = false;
    this.fireTimer = 0;
    this.reloadTimer = 0;
    this.bloom = 0;
    this.mouseDown = false;
    this.syncCamera(0);
  }

  attachInput(dom) {
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    window.addEventListener('mousemove', this.boundMouseMove);
    dom.addEventListener('mousedown', this.boundMouseDown);
    window.addEventListener('mouseup', this.boundMouseUp);
    window.addEventListener('blur', this.boundBlur);
    document.addEventListener('pointerlockchange', this.boundLockChange);
  }

  detachInput(dom) {
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    window.removeEventListener('mousemove', this.boundMouseMove);
    dom.removeEventListener('mousedown', this.boundMouseDown);
    window.removeEventListener('mouseup', this.boundMouseUp);
    window.removeEventListener('blur', this.boundBlur);
    document.removeEventListener('pointerlockchange', this.boundLockChange);
  }

  onKey(e, down) {
    if (e.code === 'KeyC' && down && !e.repeat) this.crouch = !this.crouch;
    if (down) this.keys.add(e.code); else this.keys.delete(e.code);
    if (down && e.code === 'KeyR') this.startReload();
    if (down && e.code === 'Digit1' && this.weapons.primary) this.switchTo('primary');
    if (down && e.code === 'Digit2') this.switchTo('sidearm');
  }

  switchTo(slot) {
    if (this.active === slot || !this.weapons[slot]) return;
    this.active = slot;
    this.reloadTimer = 0;
    this.setViewModel(this.weapons[slot].id);
  }

  onMouseMove(e) {
    if (!document.pointerLockElement) return;
    this.yaw -= e.movementX * 0.0021;
    this.pitch -= e.movementY * 0.0021;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  }

  eyePos() {
    const h = this.crouch ? WORLD.crouchHeight : WORLD.eyeHeight;
    return new THREE.Vector3(this.pos.x, h, this.pos.z);
  }

  viewDir() {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    return dir;
  }

  startReload() {
    const st = this.weaponState();
    const def = this.weaponDef();
    if (this.reloadTimer > 0 || st.mag >= def.mag || st.reserve <= 0) return;
    this.reloadTimer = def.reloadSeconds;
    sfx.reload();
  }

  finishReload() {
    const st = this.weaponState();
    const def = this.weaponDef();
    const take = Math.min(def.mag - st.mag, st.reserve);
    st.mag += take;
    st.reserve -= take;
  }

  syncCamera(dt) {
    const eye = this.eyePos();
    if (this.moving && !this.crouch) this.bobPhase += dt * 9; else this.bobPhase = 0;
    eye.y += Math.sin(this.bobPhase) * 0.028;
    this.camera.position.copy(eye);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;
    // The view model kicks back as shots leave and settles between them.
    this.vmKick = Math.max(0, this.vmKick - dt * 6);
    if (this.viewModel) {
      this.viewModel.position.z = -0.45 + this.vmKick * 0.06;
      this.viewModel.position.y = -0.22 + Math.sin(this.bobPhase) * 0.006 - this.vmKick * 0.02;
      this.viewModel.rotation.x = this.vmKick * 0.35;
    }
  }

  // One frame of movement and gunplay. `ctx` carries the shared world:
  // { foes, fx, rng, canFire, onHit(foe, dmg, isHead), onKill(foe, isHead) }.
  update(dt, ctx) {
    if (!this.alive) return;
    // --- movement -------------------------------------------------------
    const fwd = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const speed = this.crouch ? CROUCH_SPEED : WALK_SPEED;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Forward on the ground plane is (-sin yaw, -cos yaw); right is (cos, -sin).
    const mx = (-sin * fwd + cos * strafe);
    const mz = (-cos * fwd - sin * strafe);
    const len = Math.hypot(mx, mz) || 1;
    this.moving = (fwd !== 0 || strafe !== 0);
    if (this.moving) {
      this.pos.x += (mx / len) * speed * dt;
      this.pos.z += (mz / len) * speed * dt;
      collide(this.pos);
    }
    // --- timers ---------------------------------------------------------
    this.fireTimer -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 5);
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this.finishReload();
    }
    // --- firing ---------------------------------------------------------
    if (this.mouseDown && ctx.canFire && this.reloadTimer <= 0) this.tryFire(ctx);
    this.syncCamera(dt);
  }

  tryFire(ctx) {
    const st = this.weaponState();
    const def = this.weaponDef();
    if (this.fireTimer > 0) return;
    if (st.mag <= 0) {
      this.fireTimer = 0.3;
      sfx.dryFire();
      this.startReload();
      return;
    }
    this.fireTimer += 60 / def.rpm; // keep the overshoot: rate stays honest at any frame rate
    st.mag -= 1;
    this.bloom = Math.min(6, this.bloom + 1);
    this.vmKick = Math.min(1, this.vmKick + 0.55);
    this.pitch = Math.min(1.45, this.pitch + def.kick); // recoil climbs, never past vertical
    sfx.shot(def.id);
    const origin = this.eyePos();
    const spread = this.moving ? def.spreadMove : def.spreadStill;
    const dir = spreadDirection(this.viewDir(), spread, this.bloom * 0.35, ctx.rng);
    // The world is hit-tested first: a wall in front of a foe eats the round.
    const wallDist = ctx.raycast ? ctx.raycast(origin, dir) : Infinity;
    let best = null;
    for (const foe of ctx.foes) {
      if (!foe.alive) continue;
      const zones = actorHitZones(foe);
      const headT = raySphere(origin, dir, zones.head.center, zones.head.radius);
      const bodyT = raySphere(origin, dir, zones.body.center, zones.body.radius);
      const t = Math.min(headT, bodyT);
      if (t < wallDist && (!best || t < best.t)) {
        best = { foe, t, isHead: headT < bodyT };
      }
    }
    const muzzle = new THREE.Vector3();
    this.viewModel.getWorldPosition(muzzle);
    if (best) {
      const point = origin.clone().add(dir.clone().multiplyScalar(best.t));
      const raw = damageAt(def, best.t) * (best.isHead ? def.headMult : 1);
      const dealt = applyDamage(best.foe, raw, best.isHead);
      ctx.fx.tracer(muzzle, point, def.tracer);
      ctx.fx.impact(point, true);
      ctx.fx.muzzle(muzzle);
      sfx.hit();
      if (!best.foe.alive) { sfx.kill(); ctx.onKill?.(best.foe, best.isHead); }
      else ctx.onHit?.(best.foe, dealt, best.isHead);
    } else if (wallDist !== Infinity) {
      const point = origin.clone().add(dir.clone().multiplyScalar(wallDist));
      ctx.fx.tracer(muzzle, point, def.tracer);
      ctx.fx.impact(point, false);
      ctx.fx.muzzle(muzzle);
    }
  }
}
