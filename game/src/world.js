// The Foundry: an original compact tactical map, roughly 64 by 64 metres of
// industrial yard. EMBER spawns south-west and attacks; SABLE spawns
// north-east and defends site A (north-west, the furnace hall) and site B
// (south-east, the container stack). Mid runs between the two sites, with a
// south lane and a north lane as the rotation routes.
//
// Everything solid is an axis-aligned box. The same box list drives the
// visuals, movement collision, line-of-sight tests and bullet raycasts, so
// what a player sees is exactly what the simulation believes.

import * as THREE from 'three';

export const WORLD = {
  half: 32, // the yard wall sits at +/-32 on both axes
  eyeHeight: 1.62,
  crouchHeight: 1.15,
  playerRadius: 0.42,
};

// A box: x/z centre, width/depth, height from the ground, a palette key and
// whether it is low cover (blocks crouched sight and bullets, not standing
// sight lines over it).
const BOXES = [
  // Perimeter is handled by the wall clamp; these are the interior solids.
  // The furnace block in mid: two masses with a gap a player can slip through.
  { x: 0, z: -4, w: 10, d: 5, h: 4.2, mat: 'furnace' },
  { x: 1, z: 5, w: 8, d: 4, h: 3.2, mat: 'metal' },
  // Mid cover crates.
  { x: -8, z: 2, w: 2.2, d: 2.2, h: 1.1, mat: 'crate' },
  { x: 7, z: -9, w: 2.2, d: 2.2, h: 1.1, mat: 'crate' },
  { x: -4, z: 12, w: 3, d: 1.4, h: 0.55, mat: 'lowMetal', low: true },
  { x: 5, z: 13, w: 3, d: 1.4, h: 0.55, mat: 'lowMetal', low: true },
  // Site A: furnace hall furniture — a tall stack, a long low wall, crates.
  { x: -24, z: -14, w: 5, d: 3, h: 3.6, mat: 'furnace' },
  { x: -14, z: -21, w: 6, d: 1.4, h: 1.05, mat: 'metal' },
  { x: -19, z: -24, w: 2.2, d: 2.2, h: 2.2, mat: 'crate' },
  { x: -12, z: -15, w: 2.2, d: 2.2, h: 1.1, mat: 'crate' },
  { x: -25, z: -25, w: 2.4, d: 2.4, h: 1.1, mat: 'crate' },
  // A link choke: a container angled across the lane (axis-aligned by design).
  { x: -13, z: -6, w: 6, d: 2.4, h: 2.6, mat: 'containerTeal' },
  // Site B: container stack and warehouse corner.
  { x: 20, z: 13, w: 7, d: 2.6, h: 2.6, mat: 'containerRust' },
  { x: 20, z: 24, w: 2.6, d: 6, h: 2.6, mat: 'containerTeal' },
  { x: 13, z: 20, w: 2.2, d: 2.2, h: 1.1, mat: 'crate' },
  { x: 25, z: 19, w: 2.2, d: 2.2, h: 2.2, mat: 'crate' },
  { x: 16, z: 16, w: 3, d: 1.4, h: 0.55, mat: 'lowMetal', low: true },
  // B link choke.
  { x: 10, z: 6, w: 2.4, d: 6, h: 2.6, mat: 'containerRust' },
  // Spawn-yard dressing and lane cover.
  { x: -26, z: 18, w: 3, d: 3, h: 1.6, mat: 'metal' },
  { x: 26, z: -18, w: 3, d: 3, h: 1.6, mat: 'metal' },
  { x: -2, z: 26, w: 4, d: 1.4, h: 1.05, mat: 'metal' },
  { x: 2, z: -26, w: 4, d: 1.4, h: 1.05, mat: 'metal' },
  { x: -20, z: 6, w: 2.2, d: 2.2, h: 1.1, mat: 'crate' },
  { x: 20, z: -6, w: 2.2, d: 2.2, h: 1.1, mat: 'crate' },
];

export const SITES = {
  A: { id: 'A', x: -19, z: -19, radius: 6.5 },
  B: { id: 'B', x: 19, z: 19, radius: 6.5 },
};

export const SPAWNS = {
  ember: [
    { x: -25, z: 26, heading: -Math.PI / 4 },
    { x: -22, z: 28, heading: -Math.PI / 4 },
    { x: -28, z: 23, heading: -Math.PI / 4 },
    { x: -23, z: 21, heading: -Math.PI / 4 },
    { x: -27, z: 28, heading: -Math.PI / 4 },
  ],
  sable: [
    { x: 25, z: -26, heading: Math.PI * 0.75 },
    { x: 22, z: -28, heading: Math.PI * 0.75 },
    { x: 28, z: -23, heading: Math.PI * 0.75 },
    { x: 23, z: -21, heading: Math.PI * 0.75 },
    { x: 27, z: -28, heading: Math.PI * 0.75 },
  ],
};

// The navigation graph. Bots walk node to node; the links were chosen so
// every lane a player can take exists in the graph: spawn to mid, mid to
// either site, and the two rotation lanes along the south and north edges.
export const WAYPOINTS = [
  { id: 0, x: -24, z: 24, links: [1] }, // ember spawn
  { id: 1, x: -16, z: 16, links: [0, 2, 15] },
  { id: 2, x: -7, z: 10, links: [1, 3, 18] },
  { id: 3, x: -3, z: 0, links: [2, 5, 17] }, // mid west
  { id: 4, x: 8, z: -3, links: [13, 17, 19] }, // mid east
  { id: 5, x: -11, z: -7, links: [3, 6, 20] }, // a link
  { id: 6, x: -16, z: -12, links: [5, 7] }, // a door
  { id: 7, x: -19, z: -19, links: [6, 8], site: 'A' },
  { id: 8, x: -25, z: -25, links: [7, 16], site: 'A' },
  { id: 9, x: 10, z: 9, links: [11, 19, 21] }, // b link
  { id: 10, x: 14, z: 13, links: [9, 11] }, // b door
  { id: 11, x: 19, z: 19, links: [10, 12], site: 'B' },
  { id: 12, x: 25, z: 25, links: [11, 15], site: 'B' },
  { id: 13, x: 16, z: -16, links: [4, 14, 22] }, // sable yard
  { id: 14, x: 6, z: -19, links: [13, 16, 17] }, // sable to A
  { id: 15, x: -2, z: 26, links: [1, 12, 21] }, // south lane
  { id: 16, x: 2, z: -26, links: [8, 14, 22] }, // north lane
  { id: 17, x: -1, z: -11, links: [3, 4, 14] }, // mid north
  { id: 18, x: -13, z: 4, links: [2, 20] },
  { id: 19, x: 6, z: 3, links: [4, 9] },
  { id: 20, x: -20, z: -4, links: [5, 18] }, // a short
  { id: 21, x: 4, z: 19, links: [9, 15] }, // b short
  { id: 22, x: 24, z: -24, links: [13, 16] }, // sable spawn
];

export function nearestWaypoint(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const w of WAYPOINTS) {
    const d = (w.x - x) ** 2 + (w.z - z) ** 2;
    if (d < bestD) { bestD = d; best = w; }
  }
  return best;
}

// Breadth-first path over the waypoint graph, returned as world points with
// the destination appended so the walker ends exactly where it was sent.
export function findPath(fromX, fromZ, toX, toZ) {
  const start = nearestWaypoint(fromX, fromZ);
  const goal = nearestWaypoint(toX, toZ);
  if (start.id === goal.id) return [{ x: toX, z: toZ }];
  const prev = new Map([[start.id, null]]);
  const queue = [start];
  while (queue.length) {
    const node = queue.shift();
    if (node.id === goal.id) break;
    for (const linkId of node.links) {
      if (!prev.has(linkId)) {
        prev.set(linkId, node.id);
        queue.push(WAYPOINTS[linkId]);
      }
    }
  }
  if (!prev.has(goal.id)) return [{ x: toX, z: toZ }];
  const ids = [];
  for (let id = goal.id; id !== null; id = prev.get(id)) ids.push(id);
  ids.reverse();
  const points = ids.map((id) => ({ x: WAYPOINTS[id].x, z: WAYPOINTS[id].z }));
  points.push({ x: toX, z: toZ });
  return points;
}

// Movement collision: push a circle (the actor) out of every box footprint
// and clamp it inside the yard walls. Boxes at or below knee height are low
// cover and do not block movement — actors wade past them visually at a
// step, which keeps lanes forgiving.
export function collide(pos, radius = WORLD.playerRadius) {
  pos.x = Math.max(-WORLD.half + radius, Math.min(WORLD.half - radius, pos.x));
  pos.z = Math.max(-WORLD.half + radius, Math.min(WORLD.half - radius, pos.z));
  for (const b of BOXES) {
    if (b.low) continue;
    const hx = b.w / 2 + radius;
    const hz = b.d / 2 + radius;
    const dx = pos.x - b.x;
    const dz = pos.z - b.z;
    if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
      const pushX = hx - Math.abs(dx);
      const pushZ = hz - Math.abs(dz);
      if (pushX < pushZ) pos.x = b.x + (dx >= 0 ? hx : -hx);
      else pos.z = b.z + (dz >= 0 ? hz : -hz);
    }
  }
  return pos;
}

function segmentHitsBox(ax, az, bx, bz, b, pad = 0) {
  // Slab test in 2D: does the segment enter the (padded) box footprint?
  const minX = b.x - b.w / 2 - pad;
  const maxX = b.x + b.w / 2 + pad;
  const minZ = b.z - b.d / 2 - pad;
  const maxZ = b.z + b.d / 2 + pad;
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  if (Math.abs(dx) < 1e-9) {
    if (ax < minX || ax > maxX) return false;
  } else {
    let ta = (minX - ax) / dx;
    let tb = (maxX - ax) / dx;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (az < minZ || az > maxZ) return false;
  } else {
    let ta = (minZ - az) / dz;
    let tb = (maxZ - az) / dz;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

// Line of sight at standing eye height: low cover never blocks it, crates
// and taller solids do.
export function losClear(ax, az, bx, bz) {
  for (const b of BOXES) {
    if (b.low || b.h < 1.0) continue;
    if (segmentHitsBox(ax, az, bx, bz, b)) return false;
  }
  return true;
}

// Bullet raycast against the world: returns the distance to the nearest box
// surface (or the yard wall) along the ray, or Infinity on a clean miss.
export function raycastWorld(origin, dir, maxDist = 200) {
  let nearest = maxDist;
  for (const b of BOXES) {
    const min = { x: b.x - b.w / 2, y: 0, z: b.z - b.d / 2 };
    const max = { x: b.x + b.w / 2, y: b.h, z: b.z + b.d / 2 };
    let tmin = 0;
    let tmax = nearest;
    let hit = true;
    for (const axis of ['x', 'y', 'z']) {
      const o = origin[axis];
      const d = dir[axis];
      if (Math.abs(d) < 1e-9) {
        if (o < min[axis] || o > max[axis]) { hit = false; break; }
      } else {
        let ta = (min[axis] - o) / d;
        let tb = (max[axis] - o) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        tmin = Math.max(tmin, ta);
        tmax = Math.min(tmax, tb);
        if (tmin > tmax) { hit = false; break; }
      }
    }
    if (hit && tmin < nearest && tmin > 0) nearest = tmin;
  }
  return nearest;
}

const PALETTE = {
  ground: 0x4a4a4c,
  groundLine: 0x3a3a3c,
  furnace: 0x5d4030,
  metal: 0x707880,
  lowMetal: 0x596066,
  crate: 0x8a6b42,
  containerRust: 0x9c4f26,
  containerTeal: 0x2e6f6a,
  wall: 0x61666d,
};

export function buildWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  scene.background = new THREE.Color(0x1a2027);
  scene.fog = new THREE.Fog(0x1a2027, 55, 130);

  const hemi = new THREE.HemisphereLight(0xbdd3e0, 0x3a3128, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe3b3, 1.6);
  sun.position.set(28, 42, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 120;
  scene.add(sun);

  // Ground: a slab with a painted grid so movement reads clearly.
  const groundMat = new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 0.95 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.half * 2 + 24, WORLD.half * 2 + 24), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  const grid = new THREE.GridHelper(WORLD.half * 2, 32, PALETTE.groundLine, PALETTE.groundLine);
  grid.position.y = 0.02;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  group.add(grid);

  // Yard walls.
  const wallMat = new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.85 });
  const wallGeo = new THREE.BoxGeometry(WORLD.half * 2 + 2, 4.5, 1);
  for (const [x, z, rot] of [[0, -WORLD.half - 0.5, 0], [0, WORLD.half + 0.5, 0], [-WORLD.half - 0.5, 0, Math.PI / 2], [WORLD.half + 0.5, 0, Math.PI / 2]]) {
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(x, 2.25, z);
    wall.rotation.y = rot;
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  }

  // Interior solids.
  const geoCache = new Map();
  for (const b of BOXES) {
    const key = `${b.w}x${b.h}x${b.d}`;
    if (!geoCache.has(key)) geoCache.set(key, new THREE.BoxGeometry(b.w, b.h, b.d));
    const mesh = new THREE.Mesh(
      geoCache.get(key),
      new THREE.MeshStandardMaterial({ color: PALETTE[b.mat], roughness: 0.8, metalness: b.mat === 'metal' || b.mat === 'lowMetal' ? 0.35 : 0.05 }),
    );
    mesh.position.set(b.x, b.h / 2, b.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Site markers: a painted ring, corner posts and a light pillar per site,
  // coloured by the defending squad, so the objective reads from anywhere.
  for (const site of Object.values(SITES)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.radius - 0.35, site.radius, 48),
      new THREE.MeshBasicMaterial({ color: 0xe8762d, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.04, site.z);
    group.add(ring);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 15, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xe8762d, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
    );
    pillar.position.set(site.x, 7.5, site.z);
    group.add(pillar);
    const label = makeTextSprite(site.id === 'A' ? 'SITE A' : 'SITE B', '#ffb27a');
    label.position.set(site.x, 6.2, site.z);
    group.add(label);
  }
  return group;
}

// A billboarded text label drawn on a canvas — site signs without font files.
function makeTextSprite(text, css) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.font = 'bold 72px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = css;
  g.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(7, 1.75, 1);
  return sprite;
}
