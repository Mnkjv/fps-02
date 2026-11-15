// Weapons: low-poly view models built from boxes, the shared maths for
// spread and damage falloff, and a small effects pool (tracers, muzzle
// flashes, impact sparks) that every shooter — the player and the bots —
// draws through, so a firefight reads the same from every seat.

import * as THREE from 'three';
import { WEAPONS } from './config.js';

const MAT = {
  body: new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.45, metalness: 0.6 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.8, metalness: 0.1 }),
  accent: new THREE.MeshStandardMaterial({ color: 0xe8762d, roughness: 0.5, metalness: 0.3 }),
  lens: new THREE.MeshStandardMaterial({ color: 0x9fd8e8, roughness: 0.15, metalness: 0.2, emissive: 0x1c3d47 }),
};

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

// A first-person gun held low-right of the camera. Each weapon is assembled
// from the same kit of parts at different lengths so the silhouettes differ:
// the P9 is all grip and slide, the Longbow is barrel and scope.
export function buildViewModel(weaponId) {
  const g = new THREE.Group();
  if (weaponId === 'p9') {
    g.add(box(0.055, 0.09, 0.24, MAT.body, 0, 0, -0.1)); // slide
    g.add(box(0.05, 0.13, 0.07, MAT.grip, 0, -0.09, 0.02)); // grip
    g.add(box(0.02, 0.03, 0.02, MAT.accent, 0, 0.055, -0.21)); // front sight
  } else if (weaponId === 'kestrel') {
    g.add(box(0.06, 0.1, 0.46, MAT.body, 0, 0, -0.16));
    g.add(box(0.05, 0.16, 0.06, MAT.grip, 0, -0.11, -0.1)); // magazine
    g.add(box(0.05, 0.12, 0.06, MAT.grip, 0, -0.09, 0.06)); // grip
    g.add(box(0.045, 0.05, 0.14, MAT.body, 0, -0.01, 0.14)); // stock
    g.add(box(0.02, 0.035, 0.02, MAT.accent, 0, 0.07, -0.34));
  } else if (weaponId === 'longbow') {
    g.add(box(0.055, 0.09, 0.78, MAT.body, 0, 0, -0.3));
    g.add(box(0.03, 0.03, 0.3, MAT.body, 0, 0.01, -0.72)); // barrel
    g.add(box(0.05, 0.15, 0.06, MAT.grip, 0, -0.1, -0.05));
    g.add(box(0.05, 0.11, 0.18, MAT.body, 0, -0.02, 0.22)); // stock
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.16, 10), MAT.grip);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.085, -0.18);
    g.add(scope);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.02, 10), MAT.lens);
    lens.position.set(0, 0.085, -0.265);
    lens.rotation.y = Math.PI;
    g.add(lens);
  } else {
    // ar7 carbine
    g.add(box(0.06, 0.1, 0.58, MAT.body, 0, 0, -0.2));
    g.add(box(0.05, 0.17, 0.06, MAT.grip, 0, -0.12, -0.08));
    g.add(box(0.05, 0.12, 0.06, MAT.grip, 0, -0.09, 0.08));
    g.add(box(0.05, 0.06, 0.2, MAT.body, 0, 0.0, 0.2)); // stock
    g.add(box(0.07, 0.05, 0.1, MAT.body, 0, 0.075, -0.12)); // carry sight
    g.add(box(0.02, 0.04, 0.02, MAT.accent, 0, 0.07, -0.46));
    g.add(box(0.035, 0.035, 0.16, MAT.grip, 0, 0, -0.55)); // suppressor
  }
  // Hands: two simple mitts so the gun is held, not floating.
  g.add(box(0.07, 0.05, 0.09, MAT.grip, 0.01, -0.075, -0.28));
  g.add(box(0.07, 0.05, 0.09, MAT.grip, 0.01, -0.13, 0.05));
  g.position.set(0.24, -0.22, -0.45);
  return g;
}

// The same gun, simplified, for a bot's hands (third person).
export function buildWorldModel(weaponId) {
  const g = new THREE.Group();
  const len = weaponId === 'p9' ? 0.24 : weaponId === 'kestrel' ? 0.5 : weaponId === 'longbow' ? 0.95 : 0.68;
  g.add(box(0.05, 0.08, len, MAT.body, 0, 0, -len / 2 + 0.08));
  g.add(box(0.045, 0.12, 0.05, MAT.grip, 0, -0.08, 0.02));
  return g;
}

// Damage after range falloff: full damage to falloffStart, then a smooth
// slide to 40% at falloffEnd and beyond.
export function damageAt(weapon, distance) {
  if (distance <= weapon.falloffStart) return weapon.damage;
  if (distance >= weapon.falloffEnd) return weapon.damage * 0.4;
  const t = (distance - weapon.falloffStart) / (weapon.falloffEnd - weapon.falloffStart);
  return weapon.damage * (1 - 0.6 * t);
}

// A firing direction with spread applied. `bloom` grows while a trigger is
// held (spraying walks the muzzle), which is the other half of the accuracy
// model: bursts stay tight, long sprays wander.
export function spreadDirection(dir, spread, bloom, rng) {
  const total = spread * (1 + bloom);
  const out = dir.clone();
  out.x += (rng.next() * 2 - 1) * total;
  out.y += (rng.next() * 2 - 1) * total;
  out.z += (rng.next() * 2 - 1) * total;
  return out.normalize();
}

// Short-lived visual effects, pooled so a firefight never allocates.
export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.flashLight = new THREE.PointLight(0xffc37a, 0, 9, 1.8);
    scene.add(this.flashLight);
  }

  tracer(from, to, color = 0xffd9a0) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    this.items.push({ obj: line, life: 0.055, max: 0.055, kind: 'line' });
  }

  impact(point, isFlesh = false) {
    const count = isFlesh ? 7 : 5;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vel = [];
    for (let i = 0; i < count; i++) {
      pos[i * 3] = point.x;
      pos[i * 3 + 1] = point.y;
      pos[i * 3 + 2] = point.z;
      vel.push(new THREE.Vector3((Math.random() - 0.5) * 1.6, Math.random() * 1.8, (Math.random() - 0.5) * 1.6));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      color: isFlesh ? 0xc23b2a : 0xffca7a, size: 0.09, transparent: true, opacity: 1,
    }));
    this.scene.add(pts);
    this.items.push({ obj: pts, life: 0.32, max: 0.32, kind: 'points', vel });
  }

  muzzle(worldPos) {
    this.flashLight.position.copy(worldPos);
    this.flashLight.intensity = 14;
  }

  explosionFx(point) {
    const light = new THREE.PointLight(0xff7a33, 60, 30, 1.6);
    light.position.copy(point).y += 1.5;
    this.scene.add(light);
    this.items.push({ obj: light, life: 0.7, max: 0.7, kind: 'light' });
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffa050, transparent: true, opacity: 0.85 }),
    );
    sphere.position.copy(point).y += 1.2;
    this.scene.add(sphere);
    this.items.push({ obj: sphere, life: 0.55, max: 0.55, kind: 'boom' });
  }

  update(dt) {
    if (this.flashLight.intensity > 0) this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 160);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      if (it.life <= 0) {
        this.scene.remove(it.obj);
        it.obj.geometry?.dispose?.();
        it.obj.material?.dispose?.();
        this.items.splice(i, 1);
        continue;
      }
      const t = it.life / it.max;
      if (it.kind === 'line') it.obj.material.opacity = 0.9 * t;
      if (it.kind === 'points') {
        const arr = it.obj.geometry.attributes.position;
        for (let j = 0; j < it.vel.length; j++) {
          it.vel[j].y -= 5.5 * dt;
          arr.array[j * 3] += it.vel[j].x * dt;
          arr.array[j * 3 + 1] += it.vel[j].y * dt;
          arr.array[j * 3 + 2] += it.vel[j].z * dt;
        }
        arr.needsUpdate = true;
        it.obj.material.opacity = t;
      }
      if (it.kind === 'boom') {
        const s = 1 + (1 - t) * 9;
        it.obj.scale.set(s, s * 0.8, s);
        it.obj.material.opacity = 0.85 * t;
      }
      if (it.kind === 'light') it.obj.intensity = 60 * t;
    }
  }
}

export function weaponById(id) {
  return WEAPONS[id];
}
